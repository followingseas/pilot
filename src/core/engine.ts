import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { loadConfig, type PilotConfig } from './config.js'
import { loadSource, loadProjectSource, type RutterSource } from './source.js'
import { detectProject, isGitUrl, normalizeRemoteUrl } from './git.js'
import { readDeclaration } from './declaration.js'
import { synthesize, type SynthesisResult } from './synthesize.js'
import { loadPolicySets, type PolicySet } from './policy.js'
import { resolveDependencies, type ResolvedDependency } from './deps.js'
import { mergeValues, parseSetFlag, effectiveValuesDigest } from './values.js'
import { renderArtifacts, type RenderedArtifact } from './adapters.js'
import { computeSourceDigest, buildLock, type RutterLock } from './lock.js'
import { PilotError } from './errors.js'

export interface ResolveReleaseOptions {
  valuesFiles?: string[]
  set?: string[]
  revision: number
}

export interface ResolvedRelease {
  projectRoot: string
  pkg: RutterSource
  sources: RutterSource[]
  synthesis: SynthesisResult
  policySets: PolicySet[]
  values: Record<string, unknown>
  valuesDigest: string
  valuesFiles: string[]
  lockedFields: string[]
  dependencies: ResolvedDependency[]
  artifacts: RenderedArtifact[]
  lock: RutterLock
}

/** 프로젝트가 선언(.rutter.yaml)한 source를 release 대상 패키지로 고른다. 선언이 없으면 유일 connection일 때만 허용 */
function pickPackageSource(sources: RutterSource[], config: PilotConfig, projectRoot: string): RutterSource {
  const external = sources.filter(s => s.kind !== 'project' && !s.id.startsWith('dep-'))
  const decl = readDeclaration(projectRoot)
  if (decl) {
    const match = config.connections.find(c => isGitUrl(decl.source)
      ? normalizeRemoteUrl(c.location) === normalizeRemoteUrl(decl.source)
      : resolve(c.location) === resolve(projectRoot, decl.source))
    const found = match && external.find(s => s.id === match.id)
    if (found) return found
  }
  if (external.length === 1) return external[0]!
  throw new PilotError(
    '릴리스할 패키지를 결정할 수 없습니다',
    '.rutter.yaml 선언을 추가하거나 pilot init --source 로 연결하세요')
}

function readValuesFile(projectRoot: string, file: string): unknown {
  const abs = resolve(projectRoot, file)
  if (!existsSync(abs)) throw new PilotError(`values 파일이 없습니다: ${file}`)
  return parse(readFileSync(abs, 'utf8'))
}

function readDefaults(source: RutterSource): unknown {
  const f = source.manifest.defaultsFile
  if (!f) return undefined
  const abs = join(source.rootDir, f)
  return existsSync(abs) ? parse(readFileSync(abs, 'utf8')) : undefined
}

const sourceLocation = (s: RutterSource, config: PilotConfig): string =>
  config.connections.find(c => c.id === s.id)?.location ?? s.rootDir

/**
 * 릴리스 파이프라인의 순수 해석 단계: sources+deps 로드 → 합성 → policy IR →
 * values 계층 병합(dep defaults → pkg defaults → files → --set) → adapter 렌더 → lock 계산.
 * 파일은 일절 쓰지 않는다(template/install/upgrade가 공유).
 */
export function resolveRelease(cwd: string, releaseName: string, opts: ResolveReleaseOptions): ResolvedRelease {
  const detected = detectProject(cwd)
  if (!detected) throw new PilotError('git 프로젝트가 아닙니다', 'git repo 루트에서 실행하세요')
  const projectRoot = detected.root

  const config = loadConfig()
  const base: RutterSource[] = []
  for (const conn of config.connections) {
    try { base.push(loadSource(conn)) }
    catch (e) { console.error(`경고: source '${conn.id}' 로드 실패 — ${(e as Error).message}`) }
  }
  const local = loadProjectSource(projectRoot)
  if (local) base.push(local)
  if (base.length === 0) throw new PilotError('연결된 rutter가 없습니다', 'pilot init --source <url|path> 로 시작하세요')

  const pkg = pickPackageSource(base, config, projectRoot)
  if (pkg.manifest.packageType === 'library') {
    throw new PilotError(`'${pkg.manifest.name}'은 library 패키지라 단독 release할 수 없습니다`,
      'application 패키지의 dependency로 사용하세요')
  }

  const dependencies = resolveDependencies(pkg)
  const sources = [...dependencies.map(d => d.source), ...base]
  const synthesis = synthesize(sources, null)
  const policySets = sources.flatMap(s => loadPolicySets(s))

  const valuesFiles = opts.valuesFiles ?? []
  const layers: unknown[] = [
    ...dependencies.map(d => readDefaults(d.source)),
    readDefaults(pkg),
    ...valuesFiles.map(f => readValuesFile(projectRoot, f)),
    parseSetFlag(opts.set ?? [])
  ]
  const values = mergeValues(layers, pkg.manifest.mergeOverrides)
  const valuesDigest = `sha256:${effectiveValuesDigest(values)}`
  const lockedFields = pkg.manifest.lockedFields

  const lock = buildLock({
    releaseName,
    pkg: { name: pkg.manifest.name, version: pkg.manifest.version },
    revision: opts.revision,
    sources: sources.map(s => ({ source: s, location: sourceLocation(s, config) })),
    dependencies: dependencies.map(d => ({
      name: d.name, version: d.version, digest: computeSourceDigest(d.source)
    })),
    valuesFiles, valuesDigest, lockedFields
  })

  const pkgDigest = lock.resolved.sources.find(s => s.id === pkg.id)?.digest
  const artifacts = renderArtifacts({
    rutterName: pkg.manifest.name,
    packageName: pkg.manifest.name, packageVersion: pkg.manifest.version,
    releaseName, revision: opts.revision,
    synthesis, policySets,
    adapters: pkg.manifest.adapters,
    lockDigest: pkgDigest
  })

  return {
    projectRoot, pkg, sources, synthesis, policySets,
    values, valuesDigest, valuesFiles, lockedFields, dependencies, artifacts, lock
  }
}

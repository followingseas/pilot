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
import { mergeValues, parseSetFlag, effectiveValuesDigest, isPlainObject } from './values.js'
import { resolveWithin } from './paths.js'
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
  /** 합성·dependency 해석에서 나온 경고 — release 명령은 이를 반드시 표시해야 한다 */
  warnings: string[]
}

/** 프로젝트가 선언(.rutter.yaml)한 source를 release 대상 패키지로 고른다.
 *  선언이 어떤 connection과도 매칭되지 않으면 조용히 폴백하지 않고 실패한다 —
 *  잘못된 패키지가 릴리스되는 것보다 명시적 오류가 낫다. 선언이 없으면 유일 connection일 때만 허용 */
function pickPackageSource(sources: RutterSource[], config: PilotConfig, projectRoot: string): RutterSource {
  const external = sources.filter(s => s.kind !== 'project' && !s.id.startsWith('dep-'))
  const decl = readDeclaration(projectRoot)
  if (decl) {
    const match = config.connections.find(c => isGitUrl(decl.source)
      ? normalizeRemoteUrl(c.location) === normalizeRemoteUrl(decl.source)
      : resolve(c.location) === resolve(projectRoot, decl.source))
    const found = match && external.find(s => s.id === match.id)
    if (found) return found
    throw new PilotError(
      `.rutter.yaml이 선언한 source '${decl.source}'가 연결되어 있지 않습니다`,
      'pilot init 으로 선언을 승인·연결하세요')
  }
  if (external.length === 1) return external[0]!
  throw new PilotError(
    '릴리스할 패키지를 결정할 수 없습니다',
    '.rutter.yaml 선언을 추가하거나 pilot init --source 로 연결하세요')
}

// values 레이어는 반드시 YAML 객체여야 한다 — 스칼라/배열이 조용히 앞 레이어를 지우는 것을 막는다
function parseValuesObject(text: string, label: string): Record<string, unknown> {
  const parsed = parse(text)
  if (parsed === null || parsed === undefined) return {}
  if (!isPlainObject(parsed)) throw new PilotError(`${label}은 YAML 객체여야 합니다`)
  return parsed
}

function readValuesFile(projectRoot: string, file: string): Record<string, unknown> {
  const abs = resolve(projectRoot, file)
  if (!existsSync(abs)) throw new PilotError(`values 파일이 없습니다: ${file}`)
  return parseValuesObject(readFileSync(abs, 'utf8'), `values 파일 '${file}'`)
}

function readDefaults(source: RutterSource): Record<string, unknown> | undefined {
  const f = source.manifest.defaultsFile
  if (!f) return undefined
  const abs = resolveWithin(source.rootDir, f)
  if (!existsSync(abs)) {
    // manifest가 선언한 파일이 없는 것은 고장난 패키지다 — 조용히 defaults 없이 진행하지 않는다
    throw new PilotError(`'${source.manifest.name}'의 defaultsFile '${f}'이 없습니다`,
      '패키지의 values.defaultsFile 선언 또는 파일 경로를 확인하세요')
  }
  return parseValuesObject(readFileSync(abs, 'utf8'), `'${source.manifest.name}'의 defaults '${f}'`)
}

const sourceLocation = (s: RutterSource, config: PilotConfig): string =>
  config.connections.find(c => c.id === s.id)?.location ?? s.rootDir

/**
 * 릴리스 파이프라인의 순수 해석 단계: sources+deps 로드 → 합성 → policy IR →
 * values 계층 병합(dep defaults → pkg defaults → files → --set) → adapter 렌더 → lock 계산.
 * 프로젝트 파일은 쓰지 않는다 — 단, git dependency는 source 캐시에 clone될 수 있다(template/install/upgrade가 공유).
 */
export function resolveRelease(cwd: string, releaseName: string, opts: ResolveReleaseOptions): ResolvedRelease {
  const detected = detectProject(cwd)
  if (!detected) throw new PilotError('git 프로젝트가 아닙니다', 'git repo 루트에서 실행하세요')
  const projectRoot = detected.root

  const config = loadConfig()
  const base: RutterSource[] = []
  const loadFailures: string[] = []
  for (const conn of config.connections) {
    try { base.push(loadSource(conn)) }
    catch (e) { loadFailures.push(`${conn.id}: ${(e as Error).message}`) }
  }
  if (loadFailures.length > 0) {
    // 읽기 전용 loadAll과 달리 release 경로에서는 치명적 — 일부 source가 빠진 채
    // 합성·lock이 만들어지면 잘못된 패키지가 조용히 배포될 수 있다
    throw new PilotError(`source 로드 실패:\n  ${loadFailures.join('\n  ')}`,
      'pilot sync <id> 로 캐시를 복구하거나 pilot connect 설정을 확인하세요')
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

  // dep digest는 여기서 한 번만 계산하고 lock의 sources 목록에도 재사용한다 (content digest는 비싸다)
  const depDigests = new Map(dependencies.map(d => [d.source.id, computeSourceDigest(d.source)]))
  const lock = buildLock({
    releaseName,
    pkg: { name: pkg.manifest.name, version: pkg.manifest.version },
    revision: opts.revision,
    sources: sources.map(s => ({
      source: s, location: sourceLocation(s, config), digest: depDigests.get(s.id)
    })),
    dependencies: dependencies.map(d => ({
      name: d.name, version: d.version, digest: depDigests.get(d.source.id)!
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
    values, valuesDigest, valuesFiles, lockedFields, dependencies, artifacts, lock,
    warnings: [...synthesis.warnings, ...dependencies.flatMap(d => d.warnings)]
  }
}

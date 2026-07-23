import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { cloneSource, loadSource, type RutterSource } from './source.js'
import { isGitUrl, normalizeRemoteUrl, runGit } from './git.js'
import { sourceCacheDir } from './paths.js'
import { parseManifest } from './manifest.js'
import { PilotError } from './errors.js'

export interface ResolvedDependency { name: string; version?: string; source: RutterSource; warnings: string[] }

// dep 이름은 slug화되어 캐시 id가 되므로, 이름이 같고 저장소가 다른 dep이
// 서로의 캐시를 조용히 재사용하지 않도록 remote를 검증하고 불일치 시 재클론한다
function ensureGitDepCache(id: string, repository: string): void {
  const dest = sourceCacheDir(id)
  if (existsSync(dest)) {
    let cachedRemote: string | null = null
    try { cachedRemote = normalizeRemoteUrl(runGit(['remote', 'get-url', 'origin'], { cwd: dest })) }
    catch { cachedRemote = null }
    if (cachedRemote !== normalizeRemoteUrl(repository)) {
      rmSync(dest, { recursive: true, force: true })
    }
  }
  cloneSource({ id, kind: 'git', location: repository })
}

/**
 * 패키지 dependencies를 1단계만 해석한다(재귀 없음 — v2alpha 범위).
 * 로컬 경로는 패키지 루트 기준으로 직접 로드, git URL은 dep-<alias|name> 캐시를 사용한다.
 * dep source는 부모보다 priority를 낮춰 같은 scope에서 부모 문서가 dep 문서를 가리게 한다.
 */
export function resolveDependencies(parent: RutterSource): ResolvedDependency[] {
  const out: ResolvedDependency[] = []
  for (const dep of parent.manifest.dependencies) {
    const id = `dep-${(dep.alias ?? dep.name).toLowerCase().replace(/[^a-z0-9-_]/g, '-')}`.slice(0, 64)
    let source: RutterSource
    if (isGitUrl(dep.repository)) {
      ensureGitDepCache(id, dep.repository)
      source = loadSource({ id, kind: 'git', location: dep.repository })
    } else {
      const dir = resolve(parent.rootDir, dep.repository)
      if (!existsSync(dir)) {
        throw new PilotError(`dependency '${dep.name}' 경로가 없습니다: ${dep.repository}`)
      }
      source = { id, kind: 'local', rootDir: dir, manifest: parseManifest(dir), priority: 0 }
    }
    const warnings: string[] = []
    // semver range 해석은 미지원 — 선언 버전과 실제 버전이 다르면 최소한 알린다
    if (dep.version && source.manifest.version && dep.version !== source.manifest.version) {
      warnings.push(
        `dependency '${dep.name}': 선언 version ${dep.version} ≠ 실제 ${source.manifest.version} (range 해석은 미지원)`)
    }
    out.push({ name: dep.name, version: dep.version, source: { ...source, priority: parent.priority - 1 }, warnings })
  }
  return out
}

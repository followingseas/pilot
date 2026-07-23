import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { cloneSource, loadSource, type RutterSource } from './source.js'
import { isGitUrl } from './git.js'
import { parseManifest } from './manifest.js'
import { PilotError } from './errors.js'

export interface ResolvedDependency { name: string; version?: string; source: RutterSource }

/**
 * 패키지 dependencies를 1단계만 해석한다(재귀 없음 — v2alpha 범위).
 * 로컬 경로는 패키지 루트 기준으로 직접 로드, git URL은 dep-<name> 캐시를 사용한다.
 * dep source는 부모보다 priority를 낮춰 같은 scope에서 부모 문서가 dep 문서를 가리게 한다.
 */
export function resolveDependencies(parent: RutterSource): ResolvedDependency[] {
  const out: ResolvedDependency[] = []
  for (const dep of parent.manifest.dependencies) {
    const id = `dep-${(dep.alias ?? dep.name).toLowerCase().replace(/[^a-z0-9-_]/g, '-')}`.slice(0, 64)
    let source: RutterSource
    if (isGitUrl(dep.repository)) {
      const conn = { id, kind: 'git' as const, location: dep.repository }
      cloneSource(conn)
      source = loadSource(conn)
    } else {
      const dir = resolve(parent.rootDir, dep.repository)
      if (!existsSync(dir)) {
        throw new PilotError(`dependency '${dep.name}' 경로가 없습니다: ${dep.repository}`)
      }
      source = { id, kind: 'local', rootDir: dir, manifest: parseManifest(dir), priority: 0 }
    }
    out.push({ name: dep.name, version: dep.version, source: { ...source, priority: parent.priority - 1 } })
  }
  return out
}

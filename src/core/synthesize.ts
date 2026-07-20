import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { RutterSource } from './source.js'
import type { ProjectMatch } from './identify.js'
import type { Scope } from './manifest.js'
import { resolveWithin } from './paths.js'
import { ConflictError } from './errors.js'

const STRENGTH: Record<Scope, number> = {
  personal: 0, organization: 1, repository: 2, 'project-local': 3
}
const EXCLUDE = new Set(['.git', 'node_modules', '.pilot'])
const MAX_BYTES = 512 * 1024

export interface ContextItem {
  key: string; scope: Scope; sourceId: string; filePath: string; content: string
  shadows: { sourceId: string; scope: Scope }[]
}
export interface SynthesisResult { items: ContextItem[]; warnings: string[] }

function* walkDocs(root: string, dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue
    const full = resolveWithin(root, relative(root, join(dir, name)))
    const st = statSync(full)
    if (st.isDirectory()) yield* walkDocs(root, full)
    else if (/\.(md|ya?ml|json|txt)$/i.test(name) && st.size <= MAX_BYTES) yield full
  }
}

function collectionDirs(s: RutterSource): string[] {
  const p = s.manifest.paths
  const dirs = [p.conventions, p.charts, ...(p.wiki ?? [])].filter((d): d is string => !!d)
  return dirs.length > 0 ? dirs : ['.']
}

export function synthesize(sources: RutterSource[], project: ProjectMatch | null): SynthesisResult {
  const byKey = new Map<string, ContextItem>()
  const warnings: string[] = []
  const ordered = [...sources].sort((a, b) =>
    STRENGTH[a.manifest.scope] - STRENGTH[b.manifest.scope] || a.priority - b.priority)

  for (const s of ordered) {
    for (const dirRel of collectionDirs(s)) {
      const dirAbs = join(s.rootDir, dirRel)
      if (!existsSync(dirAbs)) continue
      for (const file of walkDocs(s.rootDir, dirAbs)) {
        const key = relative(s.rootDir, file)
        const item: ContextItem = {
          key, scope: s.manifest.scope, sourceId: s.id, filePath: file,
          content: readFileSync(file, 'utf8'), shadows: []
        }
        const prev = byKey.get(key)
        if (prev) {
          const sameRank = STRENGTH[prev.scope] === STRENGTH[item.scope] &&
            sourcePriority(ordered, prev.sourceId) === sourcePriority(ordered, item.sourceId)
          if (sameRank) {
            throw new ConflictError(
              `'${key}' 충돌: ${prev.sourceId}와 ${item.sourceId}가 같은 scope·priority입니다. priority를 지정하세요`)
          }
          item.shadows = [...prev.shadows, { sourceId: prev.sourceId, scope: prev.scope }]
          warnings.push(`${key}: ${item.sourceId}(${item.scope})가 ${prev.sourceId}(${prev.scope})를 가림`)
        }
        byKey.set(key, item)
      }
    }
  }
  void project // 매칭 정보는 CLI 표시용 — 합성 자체는 소스 집합으로 결정
  return { items: [...byKey.values()], warnings }
}

function sourcePriority(sources: RutterSource[], id: string): number {
  return sources.find(s => s.id === id)?.priority ?? 0
}

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { RutterSource } from './source.js'
import type { ProjectMatch } from './identify.js'
import type { Scope } from './manifest.js'
import { resolveWithin } from './paths.js'
import { ConflictError, PilotError } from './errors.js'

const STRENGTH: Record<Scope, number> = {
  personal: 0, organization: 1, repository: 2, 'project-local': 3
}
const EXCLUDE = new Set(['.git', 'node_modules', '.pilot'])
const MAX_BYTES = 512 * 1024
const MANIFEST_KEY = 'rutter.yaml'

export interface ContextItem {
  key: string; scope: Scope; sourceId: string; filePath: string; content: string
  shadows: { sourceId: string; scope: Scope }[]
}
export interface SynthesisResult { items: ContextItem[]; warnings: string[] }

// resolveWithin 실패(source 루트 탈출) 시 해당 항목만 건너뛰고 warning을 남긴다 — 전체 합성은 중단하지 않는다
function* walkDocs(root: string, dir: string, sourceId: string, warnings: string[]): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE.has(name)) continue
    const rel = relative(root, join(dir, name))
    let full: string
    try {
      full = resolveWithin(root, rel)
    } catch (e) {
      if (!(e instanceof PilotError)) throw e
      warnings.push(`${sourceId}: 항목 '${rel}'가 소스 루트를 벗어나 무시됨`)
      continue
    }
    const st = statSync(full)
    if (st.isDirectory()) yield* walkDocs(root, full, sourceId, warnings)
    else if (/\.(md|ya?ml|json|txt)$/i.test(name) && st.size <= MAX_BYTES) yield full
  }
}

// 수집 대상 디렉토리를 소스 루트 기준으로 가드하며 절대경로로 조립한다. 탈출 시 해당 디렉토리만 건너뛴다
function collectionDirs(s: RutterSource, warnings: string[]): string[] {
  const p = s.manifest.paths
  const dirs = [p.conventions, p.charts, ...(p.wiki ?? [])].filter((d): d is string => !!d)
  const rels = dirs.length > 0 ? dirs : ['.']
  const abs: string[] = []
  for (const dirRel of rels) {
    try {
      abs.push(resolveWithin(s.rootDir, dirRel))
    } catch (e) {
      if (!(e instanceof PilotError)) throw e
      warnings.push(`${s.id}: 수집 경로 '${dirRel}'가 소스 루트를 벗어나 무시됨`)
    }
  }
  return abs
}

export function synthesize(sources: RutterSource[], project: ProjectMatch | null): SynthesisResult {
  const byKey = new Map<string, ContextItem>()
  const meta = new Map<string, { strength: number; priority: number }>()
  const warnings: string[] = []
  const ordered = [...sources].sort((a, b) =>
    STRENGTH[a.manifest.scope] - STRENGTH[b.manifest.scope] || a.priority - b.priority)

  for (const s of ordered) {
    const visited = new Set<string>() // 소스 내 중첩 paths로 인한 동일 파일 중복 방문(자기충돌) 방지
    for (const dirAbs of collectionDirs(s, warnings)) {
      if (!existsSync(dirAbs)) continue
      for (const file of walkDocs(s.rootDir, dirAbs, s.id, warnings)) {
        if (visited.has(file)) continue
        visited.add(file)
        const key = relative(s.rootDir, file)
        if (key === MANIFEST_KEY) continue // '.' 폴백 시 manifest 자체가 편입되는 것을 방지
        const item: ContextItem = {
          key, scope: s.manifest.scope, sourceId: s.id, filePath: file,
          content: readFileSync(file, 'utf8'), shadows: []
        }
        const prev = byKey.get(key)
        const prevMeta = meta.get(key)
        if (prev && prevMeta) {
          const sameRank = prevMeta.strength === STRENGTH[item.scope] && prevMeta.priority === s.priority
          if (sameRank) {
            throw new ConflictError(
              `'${key}' 충돌: ${prev.sourceId}와 ${item.sourceId}가 같은 scope·priority입니다. priority를 지정하세요`)
          }
          item.shadows = [...prev.shadows, { sourceId: prev.sourceId, scope: prev.scope }]
          warnings.push(`${key}: ${item.sourceId}(${item.scope})가 ${prev.sourceId}(${prev.scope})를 가림`)
        }
        byKey.set(key, item)
        meta.set(key, { strength: STRENGTH[item.scope], priority: s.priority })
      }
    }
  }
  void project // 매칭 정보는 CLI 표시용 — 합성 자체는 소스 집합으로 결정
  return { items: [...byKey.values()], warnings }
}

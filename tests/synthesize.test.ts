import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { synthesize } from '../src/core/synthesize.js'
import type { RutterSource } from '../src/core/source.js'

function makeSource(id: string, scope: RutterSource['manifest']['scope'], priority: number,
  files: Record<string, string>): RutterSource {
  const root = mkdtempSync(join(tmpdir(), `pilot-syn-${id}-`))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return { id, kind: 'local', rootDir: root, priority,
    manifest: { version: 1, name: id, scope, paths: { conventions: 'conventions' }, repositories: [], priority } }
}

describe('synthesize', () => {
  it('다른 scope: repository가 organization을 파일 단위로 가린다', () => {
    const org = makeSource('org', 'organization', 0, { 'conventions/commit.md': 'ORG 규칙' })
    const repo = makeSource('repo', 'repository', 0, { 'conventions/commit.md': 'REPO 규칙' })
    const r = synthesize([org, repo], null)
    const item = r.items.find(i => i.key === 'conventions/commit.md')
    expect(item?.content).toBe('REPO 규칙')
    expect(item?.shadows).toEqual([{ sourceId: 'org', scope: 'organization' }])
  })
  it('같은 scope: priority 높은 소스가 이긴다', () => {
    const a = makeSource('a', 'organization', 5, { 'conventions/commit.md': 'A' })
    const b = makeSource('b', 'organization', 10, { 'conventions/commit.md': 'B' })
    const r = synthesize([a, b], null)
    expect(r.items.find(i => i.key === 'conventions/commit.md')?.content).toBe('B')
  })
  it('같은 scope·같은 priority·같은 key면 ConflictError', () => {
    const a = makeSource('a', 'organization', 0, { 'conventions/commit.md': 'A' })
    const b = makeSource('b', 'organization', 0, { 'conventions/commit.md': 'B' })
    expect(() => synthesize([a, b], null)).toThrow(/충돌/)
  })
  it('충돌 없는 파일은 모두 포함된다', () => {
    const org = makeSource('org', 'organization', 0, { 'conventions/commit.md': 'C', 'conventions/review.md': 'R' })
    const r = synthesize([org], null)
    expect(r.items).toHaveLength(2)
  })
})

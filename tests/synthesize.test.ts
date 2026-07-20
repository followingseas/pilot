import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { synthesize } from '../src/core/synthesize.js'
import type { RutterSource } from '../src/core/source.js'

function makeSource(id: string, scope: RutterSource['manifest']['scope'], priority: number,
  files: Record<string, string>, paths: RutterSource['manifest']['paths'] = { conventions: 'conventions' }): RutterSource {
  const root = mkdtempSync(join(tmpdir(), `pilot-syn-${id}-`))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return { id, kind: 'local', rootDir: root, priority,
    manifest: { version: 1, name: id, scope, paths, repositories: [], priority } }
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
  it('탈출 경로는 격리되고 전체 합성은 중단되지 않는다', () => {
    const sourceA = makeSource('sourceA', 'organization', 0, { 'conventions/commit.md': 'A 규칙' })
    const sourceB = makeSource('sourceB', 'organization', 0, { 'conventions/commit.md': 'B 규칙' },
      { conventions: '../escape' })
    const r = synthesize([sourceA, sourceB], null)
    expect(r.items.find(i => i.key === 'conventions/commit.md')?.content).toBe('A 규칙')
    expect(r.warnings.some(w => w.includes('sourceB'))).toBe(true)
  })
  it("'.' 폴백 시 rutter.yaml은 items에서 제외된다", () => {
    const s = makeSource('s', 'organization', 0,
      { 'rutter.yaml': 'name: s', 'notes.md': 'hello' }, {})
    const r = synthesize([s], null)
    expect(r.items.map(i => i.key)).not.toContain('rutter.yaml')
  })
  it('같은 소스의 중첩 paths는 중복 방문 없이 1개 항목만 생성한다', () => {
    const s = makeSource('s', 'organization', 0, { 'shared/nested/note.md': 'N' },
      { conventions: 'shared', charts: 'shared/nested' })
    const r = synthesize([s], null)
    expect(r.items).toHaveLength(1)
  })
  it('3단 섀도잉 체인: 최종 승자 shadows가 약한 순서 2개 누적된다', () => {
    const personal = makeSource('personal', 'personal', 0, { 'conventions/commit.md': 'P' })
    const organization = makeSource('organization', 'organization', 0, { 'conventions/commit.md': 'O' })
    const repository = makeSource('repository', 'repository', 0, { 'conventions/commit.md': 'R' })
    const r = synthesize([personal, organization, repository], null)
    const item = r.items.find(i => i.key === 'conventions/commit.md')
    expect(item?.content).toBe('R')
    expect(item?.shadows).toEqual([
      { sourceId: 'personal', scope: 'personal' },
      { sourceId: 'organization', scope: 'organization' }
    ])
  })
})

import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upsertMarkedBlock, writeStub, BEGIN_MARK, END_MARK } from '../src/core/stub.js'
import type { SynthesisResult } from '../src/core/synthesize.js'

const synthesis: SynthesisResult = {
  warnings: [],
  items: [{ key: 'conventions/commit.md', sourceId: 'org', scope: 'organization',
    filePath: '/x', content: '# 커밋\n규칙', shadows: [] }]
}

describe('upsertMarkedBlock', () => {
  it('블록이 없으면 끝에 추가한다', () => {
    const out = upsertMarkedBlock('# 기존 내용\n', 'BLOCK')
    expect(out).toContain('# 기존 내용')
    expect(out).toContain(`${BEGIN_MARK}\nBLOCK\n${END_MARK}`)
  })
  it('블록이 있으면 내부만 교체하고 밖은 불가침', () => {
    const before = `위\n${BEGIN_MARK}\n낡은거\n${END_MARK}\n아래`
    const out = upsertMarkedBlock(before, '새거')
    expect(out).toBe(`위\n${BEGIN_MARK}\n새거\n${END_MARK}\n아래`)
  })
  it('멱등: 같은 블록을 두 번 넣어도 결과 동일', () => {
    const once = upsertMarkedBlock('x', 'B')
    expect(upsertMarkedBlock(once, 'B')).toBe(once)
  })
})

describe('writeStub', () => {
  it('CLAUDE.md 기존 내용을 보존하며 블록·context.md·gitignore를 생성한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-stub-'))
    writeFileSync(join(root, 'CLAUDE.md'), '# 내 프로젝트 지침\n')
    writeStub(root, synthesis, 'Acme Handbook')
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('# 내 프로젝트 지침')
    expect(claude).toContain('Acme Handbook')          // manifest name 템플릿
    expect(claude).toContain('@.pilot/context.md')
    expect(existsSync(join(root, '.pilot/context.md'))).toBe(true)
    expect(readFileSync(join(root, '.pilot/.gitignore'), 'utf8')).toBe('*\n')
  })
})

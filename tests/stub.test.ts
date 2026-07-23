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
  it('block에 $\'가 포함돼도 replacement 패턴으로 오염되지 않는다', () => {
    const before = `앞내용\n${BEGIN_MARK}\n낡은거\n${END_MARK}\n뒤내용`
    const block = `블록 안 $' 텍스트`
    const out = upsertMarkedBlock(before, block)
    expect(out).toContain(`${BEGIN_MARK}\n블록 안 $' 텍스트\n${END_MARK}`)
    expect(out).toBe(`앞내용\n${BEGIN_MARK}\n블록 안 $' 텍스트\n${END_MARK}\n뒤내용`)
  })
  it('새 파일(빈 문자열)에 upsert하면 결과가 BEGIN_MARK로 시작한다', () => {
    const out = upsertMarkedBlock('', 'BLOCK')
    expect(out.startsWith(BEGIN_MARK)).toBe(true)
  })
  it('block에 END_MARK 리터럴이 포함되면 무해화되어 밖의 내용을 오염시키지 않는다', () => {
    const before = `앞내용\n${BEGIN_MARK}\n낡은거\n${END_MARK}\n뒤내용`
    const block = `본문 시작\n${END_MARK}\n본문 끝`
    const out = upsertMarkedBlock(before, block)
    const sanitized = `본문 시작\n<!-- pilot:end (escaped) -->\n본문 끝`
    expect(out).toBe(`앞내용\n${BEGIN_MARK}\n${sanitized}\n${END_MARK}\n뒤내용`)
    const beginCount = (out.match(new RegExp(escapeForCount(BEGIN_MARK), 'g')) ?? []).length
    const endCount = (out.match(new RegExp(escapeForCount(END_MARK), 'g')) ?? []).length
    expect(beginCount).toBe(1)
    expect(endCount).toBe(1)
  })
  it('마커 리터럴이 포함된 block으로 재 upsert해도 결과가 동일하다 (멱등)', () => {
    const block = `본문\n${BEGIN_MARK}\n${END_MARK}\n끝`
    const once = upsertMarkedBlock('x', block)
    const twice = upsertMarkedBlock(once, block)
    expect(twice).toBe(once)
  })
})

function escapeForCount(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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
    expect(readFileSync(join(root, '.pilot/.gitignore'), 'utf8')).toBe('*\n!rutter.lock\n!release.yaml\n')
  })
  it('AGENTS.md에 합성 컨텍스트 전문(픽스처 content)이 포함된다', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-stub-'))
    writeStub(root, synthesis, 'Acme Handbook')
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('# 커밋')
  })
})

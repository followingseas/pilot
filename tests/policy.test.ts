import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPolicySets, rulesForAgent } from '../src/core/policy.js'
import { parseManifest } from '../src/core/manifest.js'
import type { RutterSource } from '../src/core/source.js'

const FIXTURE_V2 = new URL('./fixtures/rutter-v2', import.meta.url).pathname

const asSource = (rootDir: string): RutterSource => ({
  id: 'test', kind: 'local', rootDir, manifest: parseManifest(rootDir), priority: 0
})

const V2_HEAD = 'apiVersion: rutter.followingseas.dev/v2alpha1\nkind: Package\nmetadata:\n  name: x\n  version: 1.0.0\npackage:\n  scope: organization\nsources:\n  policies:\n    dir: policies\n'

describe('loadPolicySets', () => {
  it('픽스처의 PolicySet을 파싱한다', () => {
    const sets = loadPolicySets(asSource(FIXTURE_V2))
    expect(sets).toHaveLength(1)
    expect(sets[0]!.name).toBe('org-core')
    expect(sets[0]!.rules.map(r => r.id)).toEqual(['git.branch.naming', 'review.why.required'])
    expect(sets[0]!.rules[0]!.checks?.[0]?.kind).toBe('regex')
    expect(sets[0]!.sourceId).toBe('test')
  })
  it('policiesDir이 없으면 빈 배열', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'version: 1\nname: X\nscope: organization\n')
    expect(loadPolicySets(asSource(dir))).toEqual([])
  })
  it('rule 필수 필드(level) 누락이면 파일 경로를 담아 실패한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'), V2_HEAD)
    mkdirSync(join(dir, 'policies'))
    writeFileSync(join(dir, 'policies', 'bad.yaml'),
      'apiVersion: rutter.followingseas.dev/v2alpha1\nkind: PolicySet\nmetadata:\n  name: bad\nspec:\n  rules:\n    - id: a\n      statement: s\n')
    expect(() => loadPolicySets(asSource(dir))).toThrow(/level/)
  })
  it('rule id가 중복이면 실패한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'), V2_HEAD)
    mkdirSync(join(dir, 'policies'))
    const set = (name: string) =>
      `apiVersion: rutter.followingseas.dev/v2alpha1\nkind: PolicySet\nmetadata:\n  name: ${name}\nspec:\n  rules:\n    - id: dup.rule\n      level: warn\n      statement: s\n`
    writeFileSync(join(dir, 'policies', 'a.yaml'), set('a'))
    writeFileSync(join(dir, 'policies', 'b.yaml'), set('b'))
    expect(() => loadPolicySets(asSource(dir))).toThrow(/중복/)
  })
})

describe('rulesForAgent', () => {
  it('agent 필터 — generic 세트는 모든 agent에 적용된다', () => {
    const sets = loadPolicySets(asSource(FIXTURE_V2))
    expect(rulesForAgent(sets, 'claude')).toHaveLength(2)
    expect(rulesForAgent(sets, 'unknown-agent')).toHaveLength(2) // generic 포함 세트
  })
  it('명시된 agent만 있는 세트는 다른 agent에 적용되지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'), V2_HEAD)
    mkdirSync(join(dir, 'policies'))
    writeFileSync(join(dir, 'policies', 'claude-only.yaml'),
      'apiVersion: rutter.followingseas.dev/v2alpha1\nkind: PolicySet\nmetadata:\n  name: c\nspec:\n  appliesTo:\n    agents: [claude]\n  rules:\n    - id: c.rule\n      level: info\n      statement: s\n')
    const sets = loadPolicySets(asSource(dir))
    expect(rulesForAgent(sets, 'claude')).toHaveLength(1)
    expect(rulesForAgent(sets, 'codex')).toHaveLength(0)
  })
})

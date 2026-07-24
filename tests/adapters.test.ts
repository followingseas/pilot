import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderArtifacts, applyArtifacts, renderRulesMarkdown, type AdapterInput } from '../src/core/adapters.js'
import { defaultAdapters } from '../src/core/manifest.js'
import { sha256Hex } from '../src/core/digest.js'
import type { PolicyRule, PolicySet } from '../src/core/policy.js'

const rules: PolicyRule[] = [
  { id: 'git.branch.naming', level: 'error', statement: '브랜치는 feature/<slug> 형식을 사용한다.', rationale: '일관성' },
  { id: 'review.why', level: 'warn', statement: 'Why를 적는다.' }
]
const policySets: PolicySet[] = [{
  name: 'org-core',
  appliesTo: { agents: ['generic'], repositories: ['*'], paths: ['**'] },
  rules, sourceId: 's'
}]

const input = (over: Partial<AdapterInput> = {}): AdapterInput => ({
  rutterName: 'acme-core',
  packageName: 'acme-core', packageVersion: '2.0.0',
  synthesis: {
    items: [{ key: 'docs/a.md', scope: 'organization', sourceId: 's', filePath: '/x', content: '# A', shadows: [] }],
    warnings: []
  },
  policySets,
  adapters: defaultAdapters(),
  lockDigest: 'sha256:abc',
  ...over
})

describe('renderRulesMarkdown', () => {
  it('level·statement·rationale을 마크다운으로 렌더한다', () => {
    const md = renderRulesMarkdown(rules)
    expect(md).toContain('- [error] 브랜치는 feature/<slug> 형식을 사용한다.')
    expect(md).toContain('  - Why: 일관성')
    expect(md).toContain('- [warn] Why를 적는다.')
  })
})

describe('renderArtifacts', () => {
  it('활성 어댑터만 렌더한다 (copilot 기본 disabled)', () => {
    const arts = renderArtifacts(input())
    expect(arts.map(a => a.path)).toEqual(['.pilot/context.md', 'CLAUDE.md', 'AGENTS.md'])
  })
  it('copilot 활성 시 .github/copilot-instructions.md를 포함한다', () => {
    const adapters = defaultAdapters()
    adapters.copilot.enabled = true
    const arts = renderArtifacts(input({ adapters }))
    expect(arts.map(a => a.path)).toContain('.github/copilot-instructions.md')
  })
  it('provenance와 규칙이 블록에 포함된다', () => {
    const claude = renderArtifacts(input()).find(a => a.path === 'CLAUDE.md')!
    expect(claude.block).toContain('@.pilot/context.md')
    expect(claude.block).toContain('- package: acme-core@2.0.0')
    expect(claude.block).toContain('- digest: sha256:abc')
    expect(claude.block).not.toContain('revision')   // revision은 렌더 파일에 넣지 않는다
    expect(claude.block).toContain('- [error] 브랜치는')
  })
  it('agent 전용 PolicySet은 다른 표면에 새지 않는다', () => {
    const sets: PolicySet[] = [...policySets, {
      name: 'claude-only',
      appliesTo: { agents: ['claude'], repositories: ['*'], paths: ['**'] },
      rules: [{ id: 'c.only', level: 'info', statement: 'Claude 전용 규칙' }],
      sourceId: 's'
    }]
    const arts = renderArtifacts(input({ policySets: sets }))
    expect(arts.find(a => a.path === 'CLAUDE.md')!.block).toContain('Claude 전용 규칙')
    expect(arts.find(a => a.path === 'AGENTS.md')!.block).not.toContain('Claude 전용 규칙')
  })
  it('checksum은 block의 sha256이고 같은 입력이면 동일하다', () => {
    const [a] = renderArtifacts(input())
    expect(a!.checksumSha256).toBe(sha256Hex(a!.block))
    expect(renderArtifacts(input())[0]!.checksumSha256).toBe(a!.checksumSha256)
  })
})

describe('applyArtifacts', () => {
  it('블록형은 marked block으로 삽입해 기존 사용자 내용을 보존한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-apply-'))
    writeFileSync(join(root, 'CLAUDE.md'), '# 내 프로젝트 메모\n')
    const arts = renderArtifacts(input())
    const written = applyArtifacts(root, arts)
    expect(written).toContain('CLAUDE.md')
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('# 내 프로젝트 메모')
    expect(claude).toContain('<!-- pilot:begin -->')
    expect(readFileSync(join(root, '.pilot', 'context.md'), 'utf8')).toContain('# A')
    // 재적용해도 블록이 중복되지 않는다
    applyArtifacts(root, renderArtifacts(input()))
    const again = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    expect(again.match(/<!-- pilot:begin -->/g)).toHaveLength(1)
  })
  it('중첩 경로(.github/...)를 만든다', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-apply-'))
    const adapters = defaultAdapters()
    adapters.copilot.enabled = true
    applyArtifacts(root, renderArtifacts(input({ adapters })))
    expect(existsSync(join(root, '.github', 'copilot-instructions.md'))).toBe(true)
  })
})

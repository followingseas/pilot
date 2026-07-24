import { describe, it, expect } from 'vitest'
import { normalizeRemoteUrl, detectProject, isGitIgnored } from '../src/core/git.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

describe('normalizeRemoteUrl', () => {
  it.each([
    ['git@github.com:acme/payment-api.git', 'github.com/acme/payment-api'],
    ['https://github.com/Acme/Payment-API', 'github.com/acme/payment-api'],
    ['ssh://git@github.com/acme/payment-api.git', 'github.com/acme/payment-api'],
    ['https://gitlab.com/team/sub/proj.git', 'gitlab.com/team/sub/proj']
  ])('%s → %s', (input, want) => {
    expect(normalizeRemoteUrl(input)).toBe(want)
  })
})

describe('detectProject', () => {
  it('git root와 정규화된 origin을 반환한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-proj-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/payment-api.git'], { cwd: dir })
    const p = detectProject(dir)
    expect(p?.remote).toBe('github.com/acme/payment-api')
  })
  it('git repo가 아니면 null', () => {
    expect(detectProject(tmpdir())).toBeNull()
  })
})

describe('isGitIgnored', () => {
  it('gitignore된 파일은 true, 아닌 파일은 false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-ign-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), 'CLAUDE.md\n')
    expect(isGitIgnored(dir, 'CLAUDE.md')).toBe(true)
    expect(isGitIgnored(dir, 'AGENTS.md')).toBe(false)
  })
  it('git repo가 아니면 false', () => {
    expect(isGitIgnored(mkdtempSync(join(tmpdir(), 'pilot-ign-')), 'x')).toBe(false)
  })
})

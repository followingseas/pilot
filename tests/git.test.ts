import { describe, it, expect } from 'vitest'
import { normalizeRemoteUrl, detectProject } from '../src/core/git.js'
import { mkdtempSync } from 'node:fs'
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

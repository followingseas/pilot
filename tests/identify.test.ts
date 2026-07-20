import { describe, it, expect } from 'vitest'
import { identifyProject } from '../src/core/identify.js'
import type { RutterSource } from '../src/core/source.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

function projectWithRemote(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-id-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
  return dir
}
const source = (repos: { id: string; remote: string }[]): RutterSource => ({
  id: 'org', kind: 'local', rootDir: '/tmp/x', priority: 0,
  manifest: { version: 1, name: 'X', scope: 'organization', paths: {}, repositories: repos, priority: 0 }
})

describe('identifyProject', () => {
  it('SSH remote 프로젝트를 HTTPS로 등록된 manifest와 매칭한다', () => {
    const dir = projectWithRemote('git@github.com:acme/payment-api.git')
    const m = identifyProject(dir, [source([{ id: 'pay', remote: 'https://github.com/acme/payment-api' }])])
    expect(m?.repoEntry?.entry.id).toBe('pay')
  })
  it('매칭 실패면 repoEntry null (fallback 컨텍스트용)', () => {
    const dir = projectWithRemote('git@github.com:other/thing.git')
    const m = identifyProject(dir, [source([{ id: 'pay', remote: 'https://github.com/acme/payment-api' }])])
    expect(m).not.toBeNull()
    expect(m?.repoEntry).toBeNull()
  })
})

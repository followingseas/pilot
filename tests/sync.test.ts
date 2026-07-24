import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { shouldRevalidate, syncNow, lastSyncAt } from '../src/core/sync.js'
import { sourceCacheDir } from '../src/core/paths.js'

const H = 3600_000

describe('shouldRevalidate', () => {
  it('기록 없음 → true', () => expect(shouldRevalidate(null, 24, Date.now())).toBe(true))
  it('TTL 이내 → false', () => expect(shouldRevalidate(Date.now() - 1 * H, 24, Date.now())).toBe(false))
  it('TTL 초과 → true', () => expect(shouldRevalidate(Date.now() - 25 * H, 24, Date.now())).toBe(true))
})

describe('syncNow', () => {
  beforeEach(() => { process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'pilot-sync-')) })
  it('git source를 동기화하고 타임스탬프를 남긴다', () => {
    const remote = mkdtempSync(join(tmpdir(), 'pilot-remote-'))
    writeFileSync(join(remote, 'rutter.yaml'), 'name: T\nscope: organization\n')
    execFileSync('git', ['init', '-b', 'main'], { cwd: remote })
    execFileSync('git', ['add', '-A'], { cwd: remote })
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'i'], { cwd: remote })
    const config = {
      connections: [{ id: 't', kind: 'git' as const, location: remote, priority: 0 }],
      approvedDeclarations: [], syncPolicy: 'auto' as const, syncTtlHours: 24
    }
    const r = syncNow(config)
    expect(r.synced).toEqual(['t'])
    expect(lastSyncAt('t')).toBeGreaterThan(Date.now() - 5000)
  })

  it('존재하지 않는 id로 호출 시 failed에 해당 항목을 담는다', () => {
    const config = {
      connections: [{ id: 't', kind: 'git' as const, location: '/nonexistent', priority: 0 }],
      approvedDeclarations: [], syncPolicy: 'auto' as const, syncTtlHours: 24
    }
    const r = syncNow(config, 'unknown-id')
    expect(r.synced).toEqual([])
    expect(r.failed).toEqual([{ id: 'unknown-id', error: '해당 id의 git source가 없습니다' }])
  })
})

describe('lastSyncAt', () => {
  beforeEach(() => { process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'pilot-sync-')) })
  it('stamp 파일이 손상된 값이면 null을 반환한다', () => {
    const dir = sourceCacheDir('garbled')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.pilot-synced-at'), 'garbage')
    expect(lastSyncAt('garbled')).toBeNull()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadSource, cloneSource, fetchSource } from '../src/core/source.js'

function makeRutterRepo(): string {
  const work = mkdtempSync(join(tmpdir(), 'pilot-rutter-'))
  writeFileSync(join(work, 'rutter.yaml'), 'version: 1\nname: Test Handbook\nscope: organization\n')
  execFileSync('git', ['init', '-b', 'main'], { cwd: work })
  execFileSync('git', ['add', '-A'], { cwd: work })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init'], { cwd: work })
  return work
}

beforeEach(() => { process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'pilot-cache-')) })

describe('source', () => {
  it('local source를 로드한다', () => {
    const dir = makeRutterRepo()
    const s = loadSource({ id: 't', kind: 'local', location: dir, priority: 0 })
    expect(s.manifest.name).toBe('Test Handbook')
    expect(s.rootDir).toBe(dir)
  })
  it('git source는 clone 후 로드되고, fetch 실패 시 캐시가 보존된다', () => {
    const remote = makeRutterRepo()
    const conn = { id: 'g', kind: 'git' as const, location: remote, priority: 0 }
    cloneSource(conn)
    const s = loadSource(conn)
    expect(s.manifest.name).toBe('Test Handbook')
    // 원격을 지워 fetch를 실패시켜도 캐시는 그대로 로드 가능
    execFileSync('rm', ['-rf', remote])
    expect(() => fetchSource(conn)).toThrow()
    expect(loadSource(conn).manifest.name).toBe('Test Handbook')
  })
})

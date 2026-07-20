import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadSource, cloneSource, fetchSource } from '../src/core/source.js'
import { sourceCacheDir } from '../src/core/paths.js'

function makeRutterRepo(priority?: number): string {
  const work = mkdtempSync(join(tmpdir(), 'pilot-rutter-'))
  const priorityLine = priority === undefined ? '' : `priority: ${priority}\n`
  writeFileSync(join(work, 'rutter.yaml'), `version: 1\nname: Test Handbook\nscope: organization\n${priorityLine}`)
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
  it('connection에 priority가 없으면 manifest의 priority를 쓴다', () => {
    const dir = makeRutterRepo(7)
    const s = loadSource({ id: 't', kind: 'local', location: dir, priority: undefined })
    expect(s.priority).toBe(7)
  })
  it('connection에 priority: 0이 명시되면 manifest가 7이어도 0을 쓴다', () => {
    const dir = makeRutterRepo(7)
    const s = loadSource({ id: 't', kind: 'local', location: dir, priority: 0 })
    expect(s.priority).toBe(0)
  })
  it('git 실패 에러 메시지에 credential이 노출되지 않고, dest 캐시도 생성되지 않는다', () => {
    const conn = { id: 'leaky', kind: 'git' as const, location: 'https://user:sekrit123@invalid.example/repo.git', priority: 0 }
    let error: Error | undefined
    try {
      cloneSource(conn)
    } catch (e) {
      error = e as Error
    }
    expect(error).toBeDefined()
    expect(error!.message).not.toContain('sekrit123')
    expect(error!.message).toContain('***')
    expect(existsSync(sourceCacheDir(conn.id))).toBe(false)
  })
})

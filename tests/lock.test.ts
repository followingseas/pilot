import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { computeSourceDigest, buildLock, readLock, writeLock } from '../src/core/lock.js'
import { parseManifest } from '../src/core/manifest.js'
import type { RutterSource } from '../src/core/source.js'

const FIXTURE_V2 = new URL('./fixtures/rutter-v2', import.meta.url).pathname

const localSource = (rootDir: string, id = 'src'): RutterSource => ({
  id, kind: 'local', rootDir, manifest: parseManifest(rootDir), priority: 0
})

const copyFixture = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-lock-'))
  cpSync(FIXTURE_V2, dir, { recursive: true })
  return dir
}

describe('computeSourceDigest', () => {
  it('local source는 결정적 content digest — 같은 내용이면 같은 digest', () => {
    const a = copyFixture(); const b = copyFixture()
    expect(computeSourceDigest(localSource(a))).toBe(computeSourceDigest(localSource(b)))
  })
  it('문서 내용이 바뀌면 digest가 바뀐다', () => {
    const dir = copyFixture()
    const before = computeSourceDigest(localSource(dir))
    writeFileSync(join(dir, 'docs', 'conventions', 'style.md'), '# 변경됨\n')
    expect(computeSourceDigest(localSource(dir))).not.toBe(before)
  })
  it('policy 내용이 바뀌어도 digest가 바뀐다', () => {
    const dir = copyFixture()
    const before = computeSourceDigest(localSource(dir))
    writeFileSync(join(dir, 'policies', 'extra.yaml'),
      'apiVersion: rutter.followingseas.dev/v2alpha1\nkind: PolicySet\nmetadata:\n  name: e\nspec:\n  rules: []\n')
    expect(computeSourceDigest(localSource(dir))).not.toBe(before)
  })
  it('git source는 캐시 HEAD sha를 쓴다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-git-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'version: 1\nname: G\nscope: organization\n')
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, env })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    const src: RutterSource = { id: 'g', kind: 'git', rootDir: dir, manifest: parseManifest(dir), priority: 0 }
    expect(computeSourceDigest(src)).toBe(`git:${head}`)
  })
})

describe('lock 파일 왕복', () => {
  it('buildLock → writeLock → readLock이 동일 구조를 복원한다', () => {
    const srcDir = copyFixture()
    const project = mkdtempSync(join(tmpdir(), 'pilot-proj-'))
    const lock = buildLock({
      releaseName: 'payment-api',
      pkg: { name: 'acme-core', version: '2.0.0' },
      revision: 1,
      sources: [{ source: localSource(srcDir), location: 'https://user:secret@github.com/acme/rutter' }],
      dependencies: [{ name: 'shared-git', version: '1.4.2', digest: 'sha256:abc' }],
      valuesFiles: ['values/payment-api.yaml'],
      valuesDigest: 'sha256:def',
      lockedFields: ['/security/signing/required']
    })
    expect(lock.resolved.sources[0]!.location).not.toContain('secret') // credential redact
    writeLock(project, lock)
    const back = readLock(project)
    expect(back).toEqual(lock)
    expect(back!.release.revision).toBe(1)
  })
  it('lock이 없으면 null', () => {
    expect(readLock(mkdtempSync(join(tmpdir(), 'pilot-proj-')))).toBeNull()
  })
})

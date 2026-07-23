import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

const FIXTURE_V2 = new URL('./fixtures/rutter-v2', import.meta.url).pathname

let env: NodeJS.ProcessEnv
const run = (args: string[], cwd: string) =>
  execFileSync('npx', ['tsx', join(process.cwd(), 'src/cli/index.ts'), ...args], { encoding: 'utf8', env, cwd })
const runFail = (args: string[], cwd: string): string => {
  try { run(args, cwd); throw new Error('실패해야 하는 명령이 성공함') }
  catch (e) { return String((e as { stderr?: string }).stderr ?? e) }
}

let pkgDir: string
let proj: string

beforeEach(() => {
  env = { ...process.env,
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'cfg-')),
    XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'cache-')) }
  pkgDir = mkdtempSync(join(tmpdir(), 'pkg-'))
  cpSync(FIXTURE_V2, pkgDir, { recursive: true })
  proj = mkdtempSync(join(tmpdir(), 'proj-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: proj })
  run(['init', '--source', pkgDir, '--yes'], proj)
})

describe('pilot release', () => {
  it('install: lock·release 생성, revision 1, artifact checksum 일치', () => {
    run(['release', 'install', 'payment-api'], proj)
    const lock = parse(readFileSync(join(proj, '.pilot/rutter.lock'), 'utf8'))
    expect(lock.kind).toBe('Lock')
    expect(lock.release).toMatchObject({ name: 'payment-api', package: 'acme-core', version: '2.0.0', revision: 1 })
    expect(lock.resolved.sources[0].digest).toMatch(/^sha256:/)

    const release = parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8'))
    expect(release.metadata).toMatchObject({ name: 'payment-api', revision: 1, status: 'deployed' })
    expect(release.spec.adapters).toEqual(['claude', 'codex', 'copilot'])

    const claude = readFileSync(join(proj, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('- package: acme-core@2.0.0')
    expect(claude).toContain('- [error] 브랜치는 feature/<slug> 형식을 사용한다.')
    expect(existsSync(join(proj, '.github/copilot-instructions.md'))).toBe(true)
  })

  it('재install은 에러(hint: upgrade)', () => {
    run(['release', 'install', 'payment-api'], proj)
    expect(runFail(['release', 'install', 'payment-api'], proj)).toContain('upgrade')
  })

  it('template은 파일을 쓰지 않는다', () => {
    const out = run(['release', 'template', 'payment-api'], proj)
    expect(out).toContain('--- CLAUDE.md')
    expect(existsSync(join(proj, '.pilot/release.yaml'))).toBe(false)
    expect(existsSync(join(proj, '.pilot/rutter.lock'))).toBe(false)
  })

  it('upgrade: revision 2, values 반영, history 기록', () => {
    run(['release', 'install', 'payment-api'], proj)
    run(['release', 'upgrade', 'payment-api', '--set', 'profile.testCommand=pnpm test'], proj)
    const release = parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8'))
    expect(release.metadata.revision).toBe(2)
    expect(release.history.previousRevision).toBe(1)
    const history = run(['release', 'history', 'payment-api'], proj)
    expect(history).toContain('1\tacme-core@2.0.0')
    expect(history).toContain('2\tacme-core@2.0.0')
  })

  it('locked field 변경은 거부, 승인 플래그로 통과', () => {
    run(['release', 'install', 'payment-api'], proj)
    const err = runFail(['release', 'upgrade', 'payment-api', '--set', 'security.signing.required=true'], proj)
    expect(err).toContain('/security/signing/required')
    run(['release', 'upgrade', 'payment-api',
      '--set', 'security.signing.required=true', '--approve-locked-field-change'], proj)
    expect(parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8')).metadata.revision).toBe(2)
  })

  it('rollback: 이전 블록 내용 복원, 새 revision 기록', () => {
    run(['release', 'install', 'payment-api'], proj)
    // 패키지 문서를 바꿔 revision 2를 만든다
    writeFileSync(join(pkgDir, 'docs/conventions/style.md'), '# 새 스타일 v2\n')
    run(['release', 'upgrade', 'payment-api'], proj)
    expect(readFileSync(join(proj, '.pilot/context.md'), 'utf8')).toContain('새 스타일 v2')
    // revision 1로 롤백
    run(['release', 'rollback', 'payment-api', '--to-revision', '1'], proj)
    const release = parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8'))
    expect(release.metadata.revision).toBe(3)
    expect(release.history.previousRevision).toBe(2)
    expect(readFileSync(join(proj, '.pilot/context.md'), 'utf8')).not.toContain('새 스타일 v2')
    const lock = parse(readFileSync(join(proj, '.pilot/rutter.lock'), 'utf8'))
    expect(lock.release.revision).toBe(3)
  })

  it('library 패키지는 install 거부', () => {
    const lib = mkdtempSync(join(tmpdir(), 'lib-'))
    writeFileSync(join(lib, 'rutter.yaml'), [
      'apiVersion: rutter.followingseas.dev/v2alpha1', 'kind: Package',
      'metadata:', '  name: lib', '  version: 1.0.0',
      'package:', '  type: library', '  scope: organization'
    ].join('\n'))
    const p2 = mkdtempSync(join(tmpdir(), 'proj-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: p2 })
    env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'cfg2-'))
    run(['init', '--source', lib, '--yes'], p2)
    expect(runFail(['release', 'install', 'x'], p2)).toContain('library')
  })

  it('dependency: 로컬 dep의 문서·defaults가 병합되고 lock에 기록된다', () => {
    const dep = mkdtempSync(join(tmpdir(), 'dep-'))
    mkdirSync(join(dep, 'docs'))
    writeFileSync(join(dep, 'rutter.yaml'), [
      'apiVersion: rutter.followingseas.dev/v2alpha1', 'kind: Package',
      'metadata:', '  name: shared-git', '  version: 1.4.2',
      'package:', '  type: library', '  scope: organization',
      'sources:', '  docs:', '    conventions: docs',
      'values:', '  defaultsFile: defaults.yaml'
    ].join('\n'))
    writeFileSync(join(dep, 'defaults.yaml'), 'git:\n  flow: github-flow\n')
    writeFileSync(join(dep, 'docs', 'git.md'), '# DEP git 규칙\n')
    // 패키지에 dependency 선언 추가
    const manifest = readFileSync(join(pkgDir, 'rutter.yaml'), 'utf8')
    writeFileSync(join(pkgDir, 'rutter.yaml'),
      `${manifest}\ndependencies:\n  - name: shared-git\n    version: 1.4.2\n    repository: ${dep}\n`)

    run(['release', 'install', 'payment-api'], proj)
    const lock = parse(readFileSync(join(proj, '.pilot/rutter.lock'), 'utf8'))
    expect(lock.resolved.dependencies[0]).toMatchObject({ name: 'shared-git', version: '1.4.2' })
    expect(lock.resolved.dependencies[0].digest).toMatch(/^sha256:/)
    expect(readFileSync(join(proj, '.pilot/context.md'), 'utf8')).toContain('DEP git 규칙')
  })
})

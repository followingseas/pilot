import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

const FIXTURE_PKG = new URL('./fixtures/rutter-v2', import.meta.url).pathname

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
  cpSync(FIXTURE_PKG, pkgDir, { recursive: true })
  proj = mkdtempSync(join(tmpdir(), 'proj-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: proj })
  // 렌더 없이 소스만 연결 — 각 테스트가 apply 시점을 제어한다
  run(['connect', pkgDir, '--id', 'pkg'], proj)
})

const readRelease = () => parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8'))
const readLock = () => parse(readFileSync(join(proj, '.pilot/rutter.lock'), 'utf8'))

describe('pilot apply', () => {
  it('apply: lock·release 생성, revision 1, releaseName=패키지명, checksum 일치', () => {
    run(['apply'], proj)
    const lock = readLock()
    expect(lock.kind).toBe('Lock')
    expect(lock.release).toMatchObject({ name: 'acme-core', package: 'acme-core', version: '2.0.0', revision: 1 })
    expect(lock.resolved.sources[0].digest).toMatch(/^sha256:/)

    const release = readRelease()
    expect(release.metadata).toMatchObject({ name: 'acme-core', revision: 1, status: 'deployed' })
    expect(release.spec.adapters).toEqual(['claude', 'codex', 'copilot'])

    const claude = readFileSync(join(proj, 'CLAUDE.md'), 'utf8')
    expect(claude).toContain('- package: acme-core@2.0.0')
    expect(claude).toContain('- [error] 브랜치는 feature/<slug> 형식을 사용한다.')
    expect(existsSync(join(proj, '.github/copilot-instructions.md'))).toBe(true)
  })

  it('apply는 멱등 — 두 번째 apply는 revision 2로 갱신한다', () => {
    run(['apply'], proj)
    run(['apply'], proj)
    expect(readRelease().metadata.revision).toBe(2)
    expect(readRelease().history.previousRevision).toBe(1)
  })

  it('diff는 파일을 쓰지 않는다', () => {
    const out = run(['diff'], proj)
    expect(out).toContain('--- CLAUDE.md')
    expect(existsSync(join(proj, '.pilot/release.yaml'))).toBe(false)
    expect(existsSync(join(proj, '.pilot/rutter.lock'))).toBe(false)
  })

  it('apply --set: values 반영, history 기록', () => {
    run(['apply'], proj)
    run(['apply', '--set', 'profile.testCommand=pnpm test'], proj)
    expect(readRelease().metadata.revision).toBe(2)
    const history = run(['history'], proj)
    expect(history).toContain('1\tacme-core@2.0.0')
    expect(history).toContain('2\tacme-core@2.0.0')
  })

  it('locked field 변경은 거부, 승인 플래그로 통과', () => {
    run(['apply'], proj)
    const err = runFail(['apply', '--set', 'security.signing.required=true'], proj)
    expect(err).toContain('/security/signing/required')
    run(['apply', '--set', 'security.signing.required=true', '--approve-locked-field-change'], proj)
    expect(readRelease().metadata.revision).toBe(2)
  })

  it('rollback: 이전 블록 내용 복원, 새 revision 기록', () => {
    run(['apply'], proj)
    writeFileSync(join(pkgDir, 'docs/conventions/style.md'), '# 새 스타일 v2\n')
    run(['apply'], proj)
    expect(readFileSync(join(proj, '.pilot/context.md'), 'utf8')).toContain('새 스타일 v2')
    run(['rollback', '--to-revision', '1'], proj)
    expect(readRelease().metadata.revision).toBe(3)
    expect(readRelease().history.previousRevision).toBe(2)
    expect(readFileSync(join(proj, '.pilot/context.md'), 'utf8')).not.toContain('새 스타일 v2')
    expect(readLock().release.revision).toBe(3)
  })

  it('rollback: 없는 revision은 에러이고 상태가 변하지 않는다', () => {
    run(['apply'], proj)
    expect(runFail(['rollback', '--to-revision', '9'], proj)).toContain('revision 9')
    expect(readRelease().metadata.revision).toBe(1)
  })

  it('library 패키지는 apply 거부', () => {
    const lib = mkdtempSync(join(tmpdir(), 'lib-'))
    writeFileSync(join(lib, 'rutter.yaml'),
      'name: lib\nversion: "1.0.0"\nscope: organization\ntype: library\n')
    const p2 = mkdtempSync(join(tmpdir(), 'proj-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: p2 })
    env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'cfg2-'))
    run(['connect', lib, '--id', 'lib'], p2)
    expect(runFail(['apply'], p2)).toContain('library')
  })

  it('--values 파일: defaults를 덮어쓰고 lock에 기록되며, 없는 파일은 에러', () => {
    mkdirSync(join(proj, 'values'))
    writeFileSync(join(proj, 'values', 'app.yaml'), 'profile:\n  testCommand: pnpm test\n')
    run(['apply', '--values', 'values/app.yaml'], proj)
    expect(readLock().values.files).toEqual(['values/app.yaml'])
    const historyValues = parse(readFileSync(join(proj, '.pilot/history/1/values.yaml'), 'utf8'))
    expect(historyValues.values.profile.testCommand).toBe('pnpm test')  // defaults(npm test)를 덮어씀
    expect(historyValues.values.profile.language).toBe('typescript')    // defaults 나머지는 유지
    expect(runFail(['apply', '--values', '없는.yaml'], proj)).toContain('없는.yaml')
  })

  it('values 파일이 객체가 아니면 에러 (스칼라가 defaults를 지우는 것 방지)', () => {
    writeFileSync(join(proj, 'bad.yaml'), '"그냥 문자열"\n')
    expect(runFail(['apply', '--values', 'bad.yaml'], proj)).toContain('객체')
  })

  it('선언 없는 다중 connection은 패키지 결정 불가 에러', () => {
    const pkg2 = mkdtempSync(join(tmpdir(), 'pkg2-'))
    cpSync(FIXTURE_PKG, pkg2, { recursive: true })
    run(['connect', pkg2, '--id', 'second'], proj)
    expect(runFail(['apply'], proj)).toContain('결정할 수 없습니다')
  })

  it('선언된 source가 연결되어 있지 않으면 조용한 폴백 대신 에러', () => {
    writeFileSync(join(proj, '.rutter.yaml'), 'source: /tmp/연결안된-다른-rutter\n')
    expect(runFail(['apply'], proj)).toContain('연결되어 있지 않습니다')
  })

  it('fresh clone(history 없음): 값 불변 apply는 통과, locked 변경 가능성은 승인 요구', () => {
    run(['apply'], proj)
    rmSync(join(proj, '.pilot', 'history'), { recursive: true, force: true })
    run(['apply'], proj)   // digest 동일 → 통과
    expect(readRelease().metadata.revision).toBe(2)

    rmSync(join(proj, '.pilot', 'history'), { recursive: true, force: true })
    const err = runFail(['apply', '--set', 'profile.language=kotlin'], proj)
    expect(err).toContain('확인할 수 없습니다')
    run(['apply', '--set', 'profile.language=kotlin', '--approve-locked-field-change'], proj)
    expect(readRelease().metadata.revision).toBe(3)
  })

  it('어댑터 비활성화 apply 시 이전 산출물을 정리한다', () => {
    run(['apply'], proj)
    expect(existsSync(join(proj, '.github/copilot-instructions.md'))).toBe(true)
    const manifest = readFileSync(join(pkgDir, 'rutter.yaml'), 'utf8')
    writeFileSync(join(pkgDir, 'rutter.yaml'), manifest.replace('copilot:\n    enabled: true', 'copilot:\n    enabled: false'))
    run(['apply'], proj)
    expect(existsSync(join(proj, '.github/copilot-instructions.md'))).toBe(false)
  })

  it('dependency: 로컬 dep의 문서·defaults가 병합되고 lock에 기록된다', () => {
    // 로컬 dep은 패키지 루트 안으로 제한된다 — vendor/ 하위에 배치
    const dep = join(pkgDir, 'vendor', 'shared-git')
    mkdirSync(join(dep, 'docs'), { recursive: true })
    writeFileSync(join(dep, 'rutter.yaml'), [
      'name: shared-git', 'version: "1.4.2"', 'scope: organization', 'type: library',
      'docs:', '  conventions: docs',
      'defaults: defaults.yaml'
    ].join('\n'))
    writeFileSync(join(dep, 'defaults.yaml'), 'git:\n  flow: github-flow\n')
    writeFileSync(join(dep, 'docs', 'git.md'), '# DEP git 규칙\n')
    const manifest = readFileSync(join(pkgDir, 'rutter.yaml'), 'utf8')
    writeFileSync(join(pkgDir, 'rutter.yaml'),
      `${manifest}\ndependencies:\n  - name: shared-git\n    version: "1.4.2"\n    repository: vendor/shared-git\n`)

    run(['apply'], proj)
    const lock = readLock()
    expect(lock.resolved.dependencies[0]).toMatchObject({ name: 'shared-git', version: '1.4.2' })
    expect(lock.resolved.dependencies[0].digest).toMatch(/^sha256:/)
    expect(readFileSync(join(proj, '.pilot/context.md'), 'utf8')).toContain('DEP git 규칙')
    const historyValues = parse(readFileSync(join(proj, '.pilot/history/1/values.yaml'), 'utf8'))
    expect(historyValues.values.git.flow).toBe('github-flow')
  })

  it('dependency: 패키지 루트 밖 로컬 경로는 거부된다', () => {
    const manifest = readFileSync(join(pkgDir, 'rutter.yaml'), 'utf8')
    writeFileSync(join(pkgDir, 'rutter.yaml'),
      `${manifest}\ndependencies:\n  - name: evil\n    repository: ../../etc\n`)
    expect(runFail(['apply'], proj)).toContain('벗어')
  })
})

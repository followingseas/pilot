import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, cpSync, rmSync } from 'node:fs'
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
    writeFileSync(join(lib, 'rutter.yaml'),
      'name: lib\nversion: "1.0.0"\nscope: organization\ntype: library\n')
    const p2 = mkdtempSync(join(tmpdir(), 'proj-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: p2 })
    env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'cfg2-'))
    run(['init', '--source', lib, '--yes'], p2)
    expect(runFail(['release', 'install', 'x'], p2)).toContain('library')
  })

  it('--values 파일: defaults를 덮어쓰고 lock에 기록되며, 없는 파일은 에러', () => {
    mkdirSync(join(proj, 'values'))
    writeFileSync(join(proj, 'values', 'app.yaml'), 'profile:\n  testCommand: pnpm test\n')
    run(['release', 'install', 'payment-api', '--values', 'values/app.yaml'], proj)
    const lock = parse(readFileSync(join(proj, '.pilot/rutter.lock'), 'utf8'))
    expect(lock.values.files).toEqual(['values/app.yaml'])
    const historyValues = parse(readFileSync(join(proj, '.pilot/history/1/values.yaml'), 'utf8'))
    expect(historyValues.values.profile.testCommand).toBe('pnpm test')  // defaults(npm test)를 덮어씀
    expect(historyValues.values.profile.language).toBe('typescript')    // defaults 나머지는 유지
    expect(runFail(['release', 'upgrade', 'payment-api', '--values', '없는.yaml'], proj)).toContain('없는.yaml')
  })

  it('values 파일이 객체가 아니면 에러 (스칼라가 defaults를 지우는 것 방지)', () => {
    writeFileSync(join(proj, 'bad.yaml'), '"그냥 문자열"\n')
    expect(runFail(['release', 'install', 'payment-api', '--values', 'bad.yaml'], proj)).toContain('객체')
  })

  it('선언 없는 다중 connection은 패키지 결정 불가 에러', () => {
    const pkg2 = mkdtempSync(join(tmpdir(), 'pkg2-'))
    cpSync(FIXTURE_V2, pkg2, { recursive: true })
    run(['connect', pkg2, '--id', 'second'], proj)
    execFileSync('rm', [join(proj, '.rutter.yaml')])
    expect(runFail(['release', 'install', 'payment-api'], proj)).toContain('결정할 수 없습니다')
  })

  it('선언된 source가 연결되어 있지 않으면 조용한 폴백 대신 에러', () => {
    writeFileSync(join(proj, '.rutter.yaml'), 'source: /tmp/연결안된-다른-rutter\n')
    expect(runFail(['release', 'install', 'payment-api'], proj)).toContain('연결되어 있지 않습니다')
  })

  it('fresh clone(history 없음): 값 불변 upgrade는 통과, locked 변경 가능성은 승인 요구', () => {
    run(['release', 'install', 'payment-api'], proj)
    rmSync(join(proj, '.pilot', 'history'), { recursive: true, force: true })
    run(['release', 'upgrade', 'payment-api'], proj)   // digest 동일 → 통과
    expect(parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8')).metadata.revision).toBe(2)

    rmSync(join(proj, '.pilot', 'history'), { recursive: true, force: true })
    const err = runFail(['release', 'upgrade', 'payment-api', '--set', 'profile.language=kotlin'], proj)
    expect(err).toContain('확인할 수 없습니다')
    run(['release', 'upgrade', 'payment-api', '--set', 'profile.language=kotlin', '--approve-locked-field-change'], proj)
    expect(parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8')).metadata.revision).toBe(3)
  })

  it('어댑터 비활성화 upgrade 시 이전 산출물을 정리한다', () => {
    run(['release', 'install', 'payment-api'], proj)
    expect(existsSync(join(proj, '.github/copilot-instructions.md'))).toBe(true)
    const manifest = readFileSync(join(pkgDir, 'rutter.yaml'), 'utf8')
    writeFileSync(join(pkgDir, 'rutter.yaml'), manifest.replace('copilot:\n    enabled: true', 'copilot:\n    enabled: false'))
    run(['release', 'upgrade', 'payment-api'], proj)
    expect(existsSync(join(proj, '.github/copilot-instructions.md'))).toBe(false)
  })

  it('rollback: 없는 revision은 에러이고 상태가 변하지 않는다, 잘못된 이름도 에러', () => {
    run(['release', 'install', 'payment-api'], proj)
    expect(runFail(['release', 'rollback', 'payment-api', '--to-revision', '9'], proj)).toContain('revision 9')
    expect(parse(readFileSync(join(proj, '.pilot/release.yaml'), 'utf8')).metadata.revision).toBe(1)
    expect(runFail(['release', 'upgrade', '엉뚱한이름'], proj)).toContain('payment-api')
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
    // 패키지에 dependency 선언 추가 (패키지 루트 기준 상대 경로)
    const manifest = readFileSync(join(pkgDir, 'rutter.yaml'), 'utf8')
    writeFileSync(join(pkgDir, 'rutter.yaml'),
      `${manifest}\ndependencies:\n  - name: shared-git\n    version: 1.4.2\n    repository: vendor/shared-git\n`)

    run(['release', 'install', 'payment-api'], proj)
    const lock = parse(readFileSync(join(proj, '.pilot/rutter.lock'), 'utf8'))
    expect(lock.resolved.dependencies[0]).toMatchObject({ name: 'shared-git', version: '1.4.2' })
    expect(lock.resolved.dependencies[0].digest).toMatch(/^sha256:/)
    expect(readFileSync(join(proj, '.pilot/context.md'), 'utf8')).toContain('DEP git 규칙')
    // dep defaults가 최약 레이어로 병합된다
    const historyValues = parse(readFileSync(join(proj, '.pilot/history/1/values.yaml'), 'utf8'))
    expect(historyValues.values.git.flow).toBe('github-flow')
  })

  it('dependency: 패키지 루트 밖 로컬 경로는 거부된다', () => {
    const manifest = readFileSync(join(pkgDir, 'rutter.yaml'), 'utf8')
    writeFileSync(join(pkgDir, 'rutter.yaml'),
      `${manifest}\ndependencies:\n  - name: evil\n    repository: ../../etc\n`)
    expect(runFail(['release', 'install', 'payment-api'], proj)).toContain('벗어')
  })
})

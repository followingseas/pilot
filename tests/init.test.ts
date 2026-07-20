import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let env: NodeJS.ProcessEnv
const run = (args: string[], cwd: string) =>
  execFileSync('npx', ['tsx', join(process.cwd(), 'src/cli/index.ts'), ...args], { encoding: 'utf8', env, cwd })

function makeRutter(): string {
  const r = mkdtempSync(join(tmpdir(), 'rutter-'))
  writeFileSync(join(r, 'rutter.yaml'), 'version: 1\nname: Acme Handbook\nscope: organization\n')
  writeFileSync(join(r, 'rules.md'), '# 규칙\n내용')
  return r
}
function makeProject(): string {
  const p = mkdtempSync(join(tmpdir(), 'proj-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: p })
  return p
}

beforeEach(() => {
  env = { ...process.env,
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'cfg-')),
    XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'cache-')) }
})

describe('pilot init', () => {
  it('--source로 선언 파일과 스텁을 만들고, 재실행해도 멱등이다', () => {
    const rutter = makeRutter(); const proj = makeProject()
    run(['init', '--source', rutter, '--yes'], proj)
    expect(existsSync(join(proj, '.rutter.yaml'))).toBe(true)
    const claude1 = readFileSync(join(proj, 'CLAUDE.md'), 'utf8')
    expect(claude1).toContain('Acme Handbook')
    run(['init', '--yes'], proj)   // 두 번째: 선언 파일 경로로 진입
    expect(readFileSync(join(proj, 'CLAUDE.md'), 'utf8')).toBe(claude1)
  })
  it('선언 파일이 있는 프로젝트는 --yes 승인만으로 연결된다 (팀원 시나리오)', () => {
    const rutter = makeRutter(); const proj = makeProject()
    writeFileSync(join(proj, '.rutter.yaml'), `source: ${rutter}\n`)
    run(['init', '--yes'], proj)
    expect(readFileSync(join(proj, 'CLAUDE.md'), 'utf8')).toContain('Acme Handbook')
  })
  it('승인 프롬프트를 거부하면 연결도, CLAUDE.md 생성도 일어나지 않는다', () => {
    const rutter = makeRutter(); const proj = makeProject()
    writeFileSync(join(proj, '.rutter.yaml'), `source: ${rutter}\n`)

    // @inquirer/confirm은 비TTY 입력에서 'No'로 정상 처리되어 PilotError로 깔끔히
    // 실패(throw)하거나, ExitPromptError로 비정상 종료할 수 있다 — 둘 중 어느
    // 경로를 타는지는 타이밍에 좌우되므로 강제하지 않는다. 대신 "연결이 일어나지
    // 않았다"는 보안 불변식(성공 로그 없음 + CLAUDE.md 없음 + config 비어있음)만 검증한다.
    let stdout = ''
    try {
      stdout = execFileSync('npx', ['tsx', join(process.cwd(), 'src/cli/index.ts'), 'init'],
        { encoding: 'utf8', env, cwd: proj, input: 'n\n' })
    } catch {
      // 실패 자체가 기대되는 경로 — 아래 불변식만 확인한다
    }

    expect(stdout).not.toContain('연결됨')
    expect(existsSync(join(proj, 'CLAUDE.md'))).toBe(false)

    const configPath = join(env.XDG_CONFIG_HOME!, 'pilot', 'config.json')
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      expect(config.connections ?? []).toHaveLength(0)
    }
  })
  it('자격증명이 포함된 --source는 .rutter.yaml 기록 전에 거부된다', () => {
    const proj = makeProject()
    let stderr = ''
    let threw = false
    try {
      run(['init', '--source', 'https://user:sekrit@example.invalid/repo.git', '--yes'], proj)
    } catch (e) {
      threw = true
      stderr = (e as { stderr?: string }).stderr ?? ''
    }
    expect(threw).toBe(true)
    expect(existsSync(join(proj, '.rutter.yaml'))).toBe(false)
    expect(stderr).not.toContain('sekrit')
  })
})

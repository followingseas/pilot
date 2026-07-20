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
})

import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = ['npx', 'tsx', 'src/cli/index.ts']
let env: NodeJS.ProcessEnv

function run(args: string[], cwd?: string): string {
  return execFileSync(CLI[0]!, [...CLI.slice(1), ...args], { encoding: 'utf8', env, cwd })
}

beforeEach(() => {
  env = { ...process.env,
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'cfg-')),
    XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'cache-')) }
})

describe('pilot CLI', () => {
  it('connect(local) → context --json에 합성 결과가 나온다', () => {
    const rutter = mkdtempSync(join(tmpdir(), 'rutter-'))
    writeFileSync(join(rutter, 'rutter.yaml'),
      'version: 1\nname: T Handbook\nscope: organization\npaths:\n  conventions: conventions\n')
    mkdirSync(join(rutter, 'conventions'))
    writeFileSync(join(rutter, 'conventions/commit.md'), '# 커밋\n규칙')
    run(['connect', rutter, '--id', 't'])
    const out = JSON.parse(run(['context', '--json']))
    expect(out.items[0].key).toBe('conventions/commit.md')
  })
  it('search가 스니펫을 반환한다', () => {
    const rutter = mkdtempSync(join(tmpdir(), 'rutter-'))
    writeFileSync(join(rutter, 'rutter.yaml'), 'version: 1\nname: T\nscope: organization\n')
    writeFileSync(join(rutter, 'commit.md'), '# 커밋 규칙\nBREAKING CHANGE 대문자')
    run(['connect', rutter, '--id', 't'])
    const out = JSON.parse(run(['search', 'BREAKING', '--json']))
    expect(out[0].key).toBe('commit.md')
  })
})

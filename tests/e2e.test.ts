import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let env: NodeJS.ProcessEnv
const run = (args: string[], cwd: string) =>
  execFileSync('npx', ['tsx', join(process.cwd(), 'src/cli/index.ts'), ...args], { encoding: 'utf8', env, cwd })

beforeEach(() => {
  env = { ...process.env,
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'cfg-')),
    XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'cache-')) }
})

it('E2E: 온보딩 → 섀도잉 합성 → 팀원 재현', () => {
  // org rutter (git remote 역할)
  const org = mkdtempSync(join(tmpdir(), 'org-'))
  writeFileSync(join(org, 'rutter.yaml'),
    'version: 1\nname: Org Handbook\nscope: organization\npaths:\n  conventions: conventions\n')
  mkdirSync(join(org, 'conventions'))
  writeFileSync(join(org, 'conventions/commit.md'), '# ORG 커밋 규칙')
  for (const args of [['init', '-b', 'main'], ['add', '-A'],
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'i']])
    execFileSync('git', args, { cwd: org })

  // 프로젝트: project-local .rutter/가 org 규칙을 섀도잉
  const proj = mkdtempSync(join(tmpdir(), 'proj-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: proj })
  mkdirSync(join(proj, '.rutter/conventions'), { recursive: true })
  writeFileSync(join(proj, '.rutter/rutter.yaml'),
    'version: 1\nname: Proj Local\nscope: project-local\npaths:\n  conventions: conventions\n')
  writeFileSync(join(proj, '.rutter/conventions/commit.md'), '# PROJ 커밋 규칙')

  run(['init', '--source', org, '--yes'], proj)
  const ctx = JSON.parse(run(['context', '--json'], proj))
  const item = ctx.items.find((i: { key: string }) => i.key === 'conventions/commit.md')
  expect(item.content).toContain('PROJ')                       // project-local이 org를 가림
  expect(item.shadows[0].scope).toBe('organization')           // provenance 표시
  expect(readFileSync(join(proj, 'CLAUDE.md'), 'utf8')).toContain('@.pilot/context.md')

  // 팀원 시나리오: 같은 프로젝트를 새 환경(clone)에서 승인 한 번으로
  const clone = mkdtempSync(join(tmpdir(), 'clone-'))
  execFileSync('git', ['add', '-A'], { cwd: proj })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'i'], { cwd: proj })
  execFileSync('git', ['clone', proj, join(clone, 'p')])
  env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'cfg2-'))   // 새 사용자 환경
  env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'cache2-'))
  run(['init', '--yes'], join(clone, 'p'))
  expect(readFileSync(join(clone, 'p/CLAUDE.md'), 'utf8')).toContain('Org Handbook')
})

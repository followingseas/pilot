import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { planMigration } from '../src/cli/commands/migrate.js'
import { parseManifest } from '../src/core/manifest.js'
import { lintPackage } from '../src/cli/commands/package.js'

const run = (args: string[], cwd: string) =>
  execFileSync('npx', ['tsx', join(process.cwd(), 'src/cli/index.ts'), ...args], { encoding: 'utf8', cwd })

const v1Package = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-mig-'))
  writeFileSync(join(dir, 'rutter.yaml'),
    'version: 1\nname: Legacy Handbook\nscope: organization\npaths:\n  conventions: conventions\n  charts: charts\n')
  mkdirSync(join(dir, 'conventions'))
  writeFileSync(join(dir, 'conventions', 'a.md'), '# 기존 규약\n')
  mkdirSync(join(dir, 'charts'))
  writeFileSync(join(dir, 'charts', 'map.md'), '# 지도\n')
  return dir
}

describe('planMigration', () => {
  it('v1 → v2 스켈레톤 계획을 만든다', () => {
    const planned = planMigration(v1Package())
    // 파괴적 덮어쓰기(rutter.yaml)는 마지막 — 중간 실패 시 v1 상태 보존
    expect(planned.map(f => f.path)).toEqual(['defaults.yaml', 'policies/legacy-import.yaml', 'rutter.yaml'])
  })
  it('v2 패키지면 에러', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-mig-'))
    writeFileSync(join(dir, 'rutter.yaml'), [
      'apiVersion: rutter.followingseas.dev/v1', 'kind: Package',
      'metadata:', '  name: x', '  version: 1.0.0', 'package:', '  scope: organization'
    ].join('\n'))
    expect(() => planMigration(dir)).toThrow(/이미 v2/)
  })
})

describe('pilot migrate package (CLI)', () => {
  it('dry-run은 파일을 만들지 않는다', () => {
    const dir = v1Package()
    const out = run(['migrate', 'package', dir], dir)
    expect(out).toContain('dry-run')
    expect(existsSync(join(dir, 'defaults.yaml'))).toBe(false)
  })
  it('--write 후 v2로 재파싱되고 lint를 통과하며 기존 문서가 보존된다', () => {
    const dir = v1Package()
    run(['migrate', 'package', dir, '--write'], dir)
    const m = parseManifest(dir)
    expect(m.formatVersion).toBe(2)
    expect(m.name).toBe('Legacy Handbook')
    expect(m.paths.conventions).toBe('conventions')  // 기존 디렉터리 참조 유지
    expect(m.paths.charts).toBe('charts')
    expect(readFileSync(join(dir, 'conventions', 'a.md'), 'utf8')).toContain('기존 규약')
    const { errors } = lintPackage(dir)
    expect(errors).toEqual([])
  })
})

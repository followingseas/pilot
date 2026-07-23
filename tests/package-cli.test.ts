import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lintPackage } from '../src/cli/commands/package.js'

const FIXTURE_V2 = new URL('./fixtures/rutter-v2', import.meta.url).pathname

describe('lintPackage', () => {
  it('v2 픽스처는 에러 없이 통과한다', () => {
    const { errors, warnings } = lintPackage(FIXTURE_V2)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })
  it('v1 패키지는 legacy 경고를 낸다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-lint-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'version: 1\nname: X\nscope: organization\n')
    const { errors, warnings } = lintPackage(dir)
    expect(errors).toEqual([])
    expect(warnings[0]).toContain('migrate')
  })
  it('defaultsFile 부재·고장난 policy·output 탈출을 에러로 잡는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-lint-'))
    cpSync(FIXTURE_V2, dir, { recursive: true })
    writeFileSync(join(dir, 'policies', 'bad.yaml'), 'kind: 뭔가잘못됨\n')
    let manifest = [
      'apiVersion: rutter.followingseas.dev/v2alpha1', 'kind: Package',
      'metadata:', '  name: x', '  version: 1.0.0',
      'package:', '  scope: organization',
      'sources:', '  policies:', '    dir: policies',
      'values:', '  defaultsFile: 없는파일.yaml',
      'adapters:', '  claude:', '    output: ../탈출.md'
    ].join('\n')
    writeFileSync(join(dir, 'rutter.yaml'), manifest)
    const { errors } = lintPackage(dir)
    expect(errors.some(e => e.includes('없는파일.yaml'))).toBe(true)
    expect(errors.some(e => e.includes('bad.yaml'))).toBe(true)
    expect(errors.some(e => e.includes('탈출.md'))).toBe(true)
  })
  it('manifest 자체가 고장이면 에러 하나로 반환한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-lint-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'version: 1\nscope: organization\n') // name 없음
    expect(lintPackage(dir).errors).toHaveLength(1)
  })
})

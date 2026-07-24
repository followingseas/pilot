import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lintPackage } from '../src/cli/commands/package.js'

const FIXTURE_V2 = new URL('./fixtures/rutter-v2', import.meta.url).pathname

describe('lintPackage', () => {
  it('완전한 패키지 픽스처는 에러 없이 통과한다', () => {
    const { errors, warnings } = lintPackage(FIXTURE_V2)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })
  it('최소 매니페스트는 경고 없이 통과한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-lint-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'name: X\nscope: organization\n')
    const { errors, warnings } = lintPackage(dir)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })
  it('defaults 부재·고장난 policy를 에러로 잡는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-lint-'))
    cpSync(FIXTURE_V2, dir, { recursive: true })
    writeFileSync(join(dir, 'policies', 'bad.yaml'), 'rules: 잘못됨\n')
    const manifest = [
      'name: x', 'version: "1.0.0"', 'scope: organization',
      'policies: policies', 'defaults: 없는파일.yaml'
    ].join('\n')
    writeFileSync(join(dir, 'rutter.yaml'), manifest)
    const { errors } = lintPackage(dir)
    expect(errors.some(e => e.includes('없는파일.yaml'))).toBe(true)
    expect(errors.some(e => e.includes('bad.yaml'))).toBe(true)
  })
  it('adapter output 탈출 경로는 manifest 파싱 자체가 거부된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-lint-'))
    writeFileSync(join(dir, 'rutter.yaml'), [
      'name: x', 'scope: organization',
      'adapters:', '  claude:', '    output: ../탈출.md'
    ].join('\n'))
    const { errors } = lintPackage(dir)
    expect(errors.some(e => e.includes('탈출.md'))).toBe(true)
  })
  it('manifest 자체가 고장이면 에러 하나로 반환한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-lint-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'scope: organization\n') // name 없음
    expect(lintPackage(dir).errors).toHaveLength(1)
  })
})

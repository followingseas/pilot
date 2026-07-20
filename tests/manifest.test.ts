import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseManifest } from '../src/core/manifest.js'

const FIXTURE = new URL('./fixtures/rutter-org', import.meta.url).pathname

describe('parseManifest', () => {
  it('유효한 rutter.yaml을 파싱한다', () => {
    const m = parseManifest(FIXTURE)
    expect(m.name).toBe('Acme Engineering Handbook')
    expect(m.scope).toBe('organization')
    expect(m.repositories[0]?.remote).toContain('acme/payment-api')
    expect(m.priority).toBe(0)
  })
  it('없는 파일이면 파일 위치를 담은 ManifestError', () => {
    const empty = mkdtempSync(join(tmpdir(), 'pilot-'))
    expect(() => parseManifest(empty)).toThrow(/rutter\.yaml/)
  })
  it('scope가 무효하면 원인 필드를 알려준다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'version: 1\nname: X\nscope: galaxy\n')
    expect(() => parseManifest(dir)).toThrow(/scope/)
  })
  it('예약 키(team, depends_on)를 허용하고 파싱에 성공한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'),
      'version: 1\nname: X\nscope: organization\nteam: platform\ndepends_on:\n  - other\n')
    const m = parseManifest(dir)
    expect(m.name).toBe('X')
  })
})

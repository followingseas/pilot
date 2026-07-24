import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseManifest } from '../src/core/manifest.js'

const FIXTURE_ORG = new URL('./fixtures/rutter-org', import.meta.url).pathname
const FIXTURE_PKG = new URL('./fixtures/rutter-v2', import.meta.url).pathname

describe('parseManifest', () => {
  it('최소 매니페스트(name/scope)를 파싱한다', () => {
    const m = parseManifest(FIXTURE_ORG)
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
    writeFileSync(join(dir, 'rutter.yaml'), 'name: X\nscope: galaxy\n')
    expect(() => parseManifest(dir)).toThrow(/scope/)
  })
  it('알 수 없는 키(team, depends_on)를 허용하고 파싱에 성공한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'),
      'name: X\nscope: organization\nteam: platform\ndepends_on:\n  - other\n')
    const m = parseManifest(dir)
    expect(m.name).toBe('X')
  })
  it('생략된 필드는 기본값으로 정규화된다', () => {
    const m = parseManifest(FIXTURE_ORG)
    expect(m.packageType).toBe('application')
    expect(m.adapters.claude).toEqual({ enabled: true, output: 'CLAUDE.md', mode: 'import' })
    expect(m.adapters.copilot.enabled).toBe(false)
    expect(m.dependencies).toEqual([])
    expect(m.lockedFields).toEqual([])
  })
})

describe('parseManifest — 전체 패키지', () => {
  it('평면 매니페스트를 정규화 모델로 파싱한다', () => {
    const m = parseManifest(FIXTURE_PKG)
    expect(m.name).toBe('acme-core')
    expect(m.version).toBe('2.0.0')
    expect(m.scope).toBe('organization')
    expect(m.packageType).toBe('application')
    expect(m.paths.conventions).toBe('docs/conventions')
    expect(m.paths.charts).toBe('docs/maps')       // docs.maps → 내부 paths.charts
    expect(m.policiesDir).toBe('policies')
    expect(m.defaultsFile).toBe('defaults.yaml')
    expect(m.lockedFields).toEqual(['/security/signing/required'])
    expect(m.mergeOverrides).toEqual([{ path: '/policies/rules', strategy: 'uniqueBy:id' }])
    expect(m.adapters.copilot.enabled).toBe(true)
    expect(m.adapters.copilot.output).toBe('.github/copilot-instructions.md')
    expect(m.repositories[0]?.id).toBe('payment-api')
  })
  it('name이 없으면 원인 필드를 알려준다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'), 'version: "1.0.0"\nscope: organization\n')
    expect(() => parseManifest(dir)).toThrow(/name/)
  })
  it('library 타입을 인식한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'),
      'name: lib\nversion: "1.0.0"\nscope: organization\ntype: library\n')
    expect(parseManifest(dir).packageType).toBe('library')
  })
  it('adapters output의 절대경로·상위 탈출을 거부한다', () => {
    for (const bad of ['../탈출.md', '/etc/passwd', 'a/../../b.md']) {
      const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
      writeFileSync(join(dir, 'rutter.yaml'), [
        'name: x', 'scope: organization',
        'adapters:', '  codex:', `    output: "${bad}"`
      ].join('\n'))
      expect(() => parseManifest(dir)).toThrow(/상대 경로/)
    }
  })
  it('policies·defaults의 상위 탈출을 거부한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'),
      'name: x\nscope: organization\ndefaults: ../../secrets.yaml\n')
    expect(() => parseManifest(dir)).toThrow(/상대 경로/)
  })
  it('dependencies 선언을 파싱한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-'))
    writeFileSync(join(dir, 'rutter.yaml'), [
      'name: x', 'version: "1.0.0"', 'scope: organization',
      'dependencies:', '  - name: shared-git', '    version: "1.4.0"', '    repository: /tmp/shared-git'
    ].join('\n'))
    expect(parseManifest(dir).dependencies).toEqual([
      { name: 'shared-git', version: '1.4.0', repository: '/tmp/shared-git' }
    ])
  })
})

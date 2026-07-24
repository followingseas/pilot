import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDeclaration, declarationStatus, approveDeclaration } from '../src/core/declaration.js'
import type { PilotConfig } from '../src/core/config.js'

const baseConfig: PilotConfig = {
  connections: [], approvedDeclarations: [], syncPolicy: 'auto', syncTtlHours: 24
}

describe('declaration', () => {
  it('.rutter.yaml을 읽는다 (없으면 null)', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-decl-'))
    expect(readDeclaration(root)).toBeNull()
    writeFileSync(join(root, '.rutter.yaml'), 'source: https://github.com/acme/handbook\n')
    expect(readDeclaration(root)?.source).toContain('acme/handbook')
  })
  it('미승인 선언은 needs-approval, 승인 후엔 connected', () => {
    const decl = { source: 'https://github.com/acme/handbook.git' }
    expect(declarationStatus(decl, baseConfig)).toBe('needs-approval')
    const approved = approveDeclaration(decl, baseConfig)
    expect(declarationStatus(decl, approved)).toBe('connected')
    expect(approved.connections[0]?.id).toBe('handbook')
    expect(approved.connections[0]?.kind).toBe('git')
  })
  it('파생 id를 source cache dir 문자셋에 맞게 정규화한다', () => {
    const decl = { source: 'https://github.com/acme/config.v2.git' }
    const approved = approveDeclaration(decl, baseConfig)
    expect(approved.connections[0]?.id).toBe('config-v2')
  })
  it('같은 source가 다른 id로 이미 연결돼 있으면 connected로 보고 중복을 안 만든다', () => {
    // 사용자가 pilot connect로 다른 id('followingseas')를 먼저 연결한 상황
    const config: PilotConfig = {
      ...baseConfig,
      connections: [{ id: 'followingseas', kind: 'git', location: 'https://github.com/acme/handbook.git' }]
    }
    const decl = { source: 'https://github.com/acme/handbook' } // .git 유무·정규화 무관하게 같은 위치
    expect(declarationStatus(decl, config)).toBe('connected')
    const approved = approveDeclaration(decl, config)
    expect(approved.connections).toHaveLength(1)          // 중복 connection 없음
    expect(approved.connections[0]?.id).toBe('followingseas')
    expect(approved.approvedDeclarations).toContain('github.com/acme/handbook')
  })
})

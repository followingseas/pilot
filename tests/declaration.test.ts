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
})

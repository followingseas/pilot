import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readRelease, writeRelease, saveHistory, listHistory, loadHistoryArtifacts,
  loadHistoryValues, loadHistoryRelease, type PilotRelease
} from '../src/core/release.js'
import { V2_API_VERSION } from '../src/core/manifest.js'
import type { RenderedArtifact } from '../src/core/adapters.js'

const release = (revision: number): PilotRelease => ({
  apiVersion: V2_API_VERSION,
  kind: 'Release',
  metadata: { name: 'payment-api', revision, status: 'deployed' },
  spec: { package: { name: 'acme-core', version: '2.0.0' }, lockFile: '.pilot/rutter.lock', adapters: ['claude', 'codex'] },
  artifacts: [{ path: 'CLAUDE.md', sha256: 'aa' }],
  history: { previousRevision: revision > 1 ? revision - 1 : null }
})

const artifacts: RenderedArtifact[] = [
  { path: 'CLAUDE.md', block: '규칙 v1', wholeFile: false, checksumSha256: 'aa' }
]

describe('release 상태', () => {
  it('release.yaml 왕복', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-rel-'))
    expect(readRelease(root)).toBeNull()
    writeRelease(root, release(1))
    expect(readRelease(root)).toEqual(release(1))
  })
  it('history 저장·목록·아티팩트·values 복원', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-rel-'))
    saveHistory(root, release(1), artifacts, { a: 1 })
    saveHistory(root, release(2), [{ ...artifacts[0]!, block: '규칙 v2' }], { a: 2 })
    expect(listHistory(root).releases.map(r => r.metadata.revision)).toEqual([1, 2])
    expect(loadHistoryArtifacts(root, 1)[0]!.block).toBe('규칙 v1')
    expect(loadHistoryArtifacts(root, 2)[0]!.block).toBe('규칙 v2')
    expect(loadHistoryValues(root, 1)).toEqual({ a: 1 })
    expect(loadHistoryRelease(root, 2).metadata.revision).toBe(2)
  })
  it('values history가 없으면 null — 빈 values와 구분한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-rel-'))
    expect(loadHistoryValues(root, 1)).toBeNull()
  })
  it('없는 revision 로드는 PilotError', () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-rel-'))
    expect(() => loadHistoryArtifacts(root, 9)).toThrow(/revision 9/)
  })
})

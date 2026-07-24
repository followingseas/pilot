import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer } from '../src/mcp/server.js'
import { loadConfig, saveConfig } from '../src/core/config.js'

beforeEach(() => {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'cfg-'))
  process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), 'cache-'))
})

describe('mcp server', () => {
  it('pilot_get_context가 합성 결과를 반환한다', async () => {
    const rutter = mkdtempSync(join(tmpdir(), 'rutter-'))
    writeFileSync(join(rutter, 'rutter.yaml'), 'version: 1\nname: T\nscope: organization\n')
    writeFileSync(join(rutter, 'rules.md'), '# 규칙')
    const c = loadConfig()
    c.connections.push({ id: 't', kind: 'local', location: rutter, priority: 0 })
    saveConfig(c)

    const server = createServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(ct)

    const tools = await client.listTools()
    expect(tools.tools.map(t => t.name).sort()).toEqual(
      ['pilot_doctor', 'pilot_get_context', 'pilot_get_policy',
        'pilot_list_sources', 'pilot_resolve_release', 'pilot_search_knowledge'])
    const res = await client.callTool({ name: 'pilot_get_context', arguments: {} })
    const text = (res.content as { type: string; text: string }[])[0]!.text
    expect(JSON.parse(text).items[0].key).toBe('rules.md')
  })

  it('pilot_search_knowledge가 문서를 검색한다', async () => {
    const rutter = mkdtempSync(join(tmpdir(), 'rutter-'))
    writeFileSync(join(rutter, 'rutter.yaml'), 'version: 1\nname: T\nscope: organization\n')
    writeFileSync(join(rutter, 'rules.md'), '# 규칙\n\n규칙에 따릅니다')
    const c = loadConfig()
    c.connections.push({ id: 't', kind: 'local', location: rutter, priority: 0 })
    saveConfig(c)

    const server = createServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(ct)

    const res = await client.callTool({ name: 'pilot_search_knowledge', arguments: { query: '규칙' } })
    const text = (res.content as { type: string; text: string }[])[0]!.text
    const result = JSON.parse(text)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].key).toBe('rules.md')
  })

  it('pilot_list_sources가 연결된 소스 목록을 반환한다', async () => {
    const rutter = mkdtempSync(join(tmpdir(), 'rutter-'))
    writeFileSync(join(rutter, 'rutter.yaml'), 'version: 1\nname: T\nscope: organization\n')
    writeFileSync(join(rutter, 'rules.md'), '# 규칙')
    const c = loadConfig()
    c.connections.push({ id: 't', kind: 'local', location: rutter, priority: 0 })
    saveConfig(c)

    const server = createServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(ct)

    const res = await client.callTool({ name: 'pilot_list_sources', arguments: {} })
    const text = (res.content as { type: string; text: string }[])[0]!.text
    const result = JSON.parse(text)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('t')
  })

  it('pilot_doctor가 소스 상태를 진단한다', async () => {
    const rutter = mkdtempSync(join(tmpdir(), 'rutter-'))
    writeFileSync(join(rutter, 'rutter.yaml'), 'version: 1\nname: T\nscope: organization\n')
    writeFileSync(join(rutter, 'rules.md'), '# 규칙')
    const c = loadConfig()
    c.connections.push({ id: 't', kind: 'local', location: rutter, priority: 0 })
    saveConfig(c)

    const server = createServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(ct)

    const res = await client.callTool({ name: 'pilot_doctor', arguments: {} })
    const text = (res.content as { type: string; text: string }[])[0]!.text
    const result = JSON.parse(text)
    expect(result.connections).toBeGreaterThan(0)
    expect(result.loaded).toBeGreaterThan(0)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('pilot_resolve_release — 미설치면 installed:false, 설치면 revision·lock 해석 반환', async () => {
    const { writeRelease } = await import('../src/core/release.js')
    const { writeLock } = await import('../src/core/lock.js')
    const { API_VERSION } = await import('../src/core/manifest.js')
    const proj = mkdtempSync(join(tmpdir(), 'proj-'))

    const server = createServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(ct)

    const empty = await client.callTool({ name: 'pilot_resolve_release', arguments: { cwd: proj } })
    expect(JSON.parse((empty.content as { text: string }[])[0]!.text).installed).toBe(false)

    writeRelease(proj, {
      apiVersion: API_VERSION, kind: 'Release',
      metadata: { name: 'payment-api', revision: 7, status: 'deployed' },
      spec: { package: { name: 'acme-core', version: '2.0.0' }, lockFile: '.pilot/rutter.lock', adapters: ['claude'] },
      artifacts: [{ path: 'CLAUDE.md', sha256: 'aa' }],
      history: { previousRevision: 6 }
    })
    writeLock(proj, {
      apiVersion: API_VERSION, kind: 'Lock',
      release: { name: 'payment-api', package: 'acme-core', version: '2.0.0', revision: 7 },
      resolved: { sources: [{ id: 's', kind: 'local', location: '/x', digest: 'sha256:aa' }], dependencies: [] },
      values: { files: [], effectiveDigest: 'sha256:bb' },
      lockedFields: ['/security/signing/required'],
      generatedAt: '2026-07-23T00:00:00Z'
    })
    const res = await client.callTool({ name: 'pilot_resolve_release', arguments: { cwd: proj } })
    const payload = JSON.parse((res.content as { text: string }[])[0]!.text)
    expect(payload).toMatchObject({
      installed: true, releaseName: 'payment-api', revision: 7,
      package: { name: 'acme-core', version: '2.0.0' },
      lockedFields: ['/security/signing/required']
    })
    expect(payload.resolvedSources[0].digest).toBe('sha256:aa')
  })

  it('pilot_get_policy — agent 필터된 rule과 문서 provenance를 반환한다', async () => {
    const rutter = new URL('./fixtures/rutter-v2', import.meta.url).pathname
    const c = loadConfig()
    c.connections.push({ id: 'v2', kind: 'local', location: rutter, priority: 0 })
    saveConfig(c)

    const server = createServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(ct)

    const res = await client.callTool({ name: 'pilot_get_policy', arguments: { agent: 'claude' } })
    const payload = JSON.parse((res.content as { text: string }[])[0]!.text)
    expect(payload.agent).toBe('claude')
    expect(payload.appliedPolicySets[0]).toMatchObject({ name: 'org-core', sourceId: 'v2' })
    expect(payload.rules.map((r: { id: string }) => r.id)).toContain('git.branch.naming')
    expect(payload.rules[0]).toHaveProperty('statement')
    expect(payload.rules[0]).toHaveProperty('rationale')
    expect(payload.documents.some((d: { path: string }) => d.path.startsWith('docs/'))).toBe(true)
  })
})

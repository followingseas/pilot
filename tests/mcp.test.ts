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
      ['pilot_doctor', 'pilot_get_context', 'pilot_list_sources', 'pilot_search_knowledge'])
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
})

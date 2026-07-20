import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig } from '../src/core/config.js'

beforeEach(() => { process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'pilot-cfg-')) })

describe('config', () => {
  it('없으면 기본값을 준다', () => {
    const c = loadConfig()
    expect(c.connections).toEqual([])
    expect(c.syncPolicy).toBe('auto')
    expect(c.syncTtlHours).toBe(24)
  })
  it('저장 후 다시 읽으면 같다', () => {
    const c = loadConfig()
    c.connections.push({ id: 'acme', kind: 'git', location: 'https://github.com/acme/handbook', priority: 0 })
    saveConfig(c)
    expect(loadConfig().connections[0]?.id).toBe('acme')
  })
})

import { describe, it, expect } from 'vitest'
import { mkdtempSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWithin } from '../src/core/paths.js'

describe('resolveWithin', () => {
  const root = mkdtempSync(join(tmpdir(), 'pilot-'))

  it('루트 안의 상대 경로를 절대 경로로 푼다', () => {
    expect(resolveWithin(root, 'a/b.md')).toBe(join(root, 'a/b.md'))
  })
  it('..로 루트를 벗어나면 throw', () => {
    expect(() => resolveWithin(root, '../escape.md')).toThrow(/벗어/)
  })
  it('symlink로 루트를 벗어나면 throw', () => {
    const outside = mkdtempSync(join(tmpdir(), 'pilot-out-'))
    mkdirSync(join(root, 'links'), { recursive: true })
    symlinkSync(outside, join(root, 'links/evil'))
    expect(() => resolveWithin(root, 'links/evil/x.md')).toThrow(/벗어/)
  })
})

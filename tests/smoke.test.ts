import { describe, it, expect } from 'vitest'
import { PilotError } from '../src/core/errors.js'

describe('scaffold', () => {
  it('PilotError는 message와 hint를 가진다', () => {
    const e = new PilotError('boom', 'try again')
    expect(e.message).toBe('boom')
    expect(e.hint).toBe('try again')
  })
})

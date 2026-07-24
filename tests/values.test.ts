import { describe, it, expect } from 'vitest'
import {
  mergeValues, getByPointer, checkLockedFields, effectiveValuesDigest, parseSetFlag
} from '../src/core/values.js'

describe('mergeValues', () => {
  it('scalar는 replace, object는 deep-merge 한다', () => {
    const out = mergeValues([
      { a: 1, nest: { x: 1, y: 1 } },
      { a: 2, nest: { y: 2, z: 3 } }
    ])
    expect(out).toEqual({ a: 2, nest: { x: 1, y: 2, z: 3 } })
  })
  it('array는 기본 replace다', () => {
    expect(mergeValues([{ arr: [1, 2] }, { arr: [3] }])).toEqual({ arr: [3] })
  })
  it('override 전략 append', () => {
    const out = mergeValues([{ arr: [1] }, { arr: [2] }], [{ path: '/arr', strategy: 'append' }])
    expect(out).toEqual({ arr: [1, 2] })
  })
  it('override 전략 unique', () => {
    const out = mergeValues([{ arr: [1, 2] }, { arr: [2, 3] }], [{ path: '/arr', strategy: 'unique' }])
    expect(out).toEqual({ arr: [1, 2, 3] })
  })
  it('override 전략 uniqueBy:id — 나중 레이어가 같은 id를 대체한다', () => {
    const out = mergeValues([
      { rules: [{ id: 'a', level: 'warn' }, { id: 'b', level: 'warn' }] },
      { rules: [{ id: 'a', level: 'error' }] }
    ], [{ path: '/rules', strategy: 'uniqueBy:id' }])
    expect(out).toEqual({ rules: [{ id: 'a', level: 'error' }, { id: 'b', level: 'warn' }] })
  })
  it('약→강 순서로 뒤 레이어가 이긴다', () => {
    expect(mergeValues([{ a: 1 }, { a: 2 }, { a: 3 }])).toEqual({ a: 3 })
  })
})

describe('getByPointer / checkLockedFields', () => {
  it('JSON Pointer로 중첩 값을 읽는다', () => {
    expect(getByPointer({ a: { b: [10, 20] } }, '/a/b/1')).toBe(20)
    expect(getByPointer({ a: 1 }, '/none')).toBeUndefined()
  })
  it('locked field가 바뀌면 해당 pointer를 반환한다', () => {
    const prev = { security: { signing: { required: true } }, other: 1 }
    const next = { security: { signing: { required: false } }, other: 2 }
    expect(checkLockedFields(prev, next, ['/security/signing/required', '/missing']))
      .toEqual(['/security/signing/required'])
  })
  it('값이 같으면 빈 배열', () => {
    expect(checkLockedFields({ a: { b: 1 } }, { a: { b: 1 } }, ['/a/b'])).toEqual([])
  })
})

describe('effectiveValuesDigest', () => {
  it('키 순서와 무관하게 결정적이다', () => {
    expect(effectiveValuesDigest({ b: 1, a: 2 })).toBe(effectiveValuesDigest({ a: 2, b: 1 }))
    expect(effectiveValuesDigest({ a: 1 })).not.toBe(effectiveValuesDigest({ a: 2 }))
  })
})

describe('parseSetFlag', () => {
  it('점 표기 경로와 스칼라 자동 변환을 지원한다', () => {
    expect(parseSetFlag(['a.b=3', 'a.c=true', 'd=hello']))
      .toEqual({ a: { b: 3, c: true }, d: 'hello' })
  })
  it('__proto__ 등 예약 키 경로를 거부한다 (prototype pollution 차단)', () => {
    expect(() => parseSetFlag(['__proto__.polluted=yes'])).toThrow(/예약 키/)
    expect(() => parseSetFlag(['a.constructor.x=1'])).toThrow(/예약 키/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('mergeValues prototype pollution 방어', () => {
  it('__proto__ own key가 있는 레이어를 병합해도 전역 prototype이 오염되지 않는다', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": "yes"}, "ok": 1}')
    const out = mergeValues([{ a: 1 }, malicious])
    expect(out).toMatchObject({ a: 1, ok: 1 })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((out as Record<string, unknown>).polluted).toBeUndefined()
  })
})

import { describe, it, expect } from 'vitest'
import { sha256Hex, canonicalJson, digestItems } from '../src/core/digest.js'

describe('digest', () => {
  it('sha256Hex는 알려진 벡터와 일치한다', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('canonicalJson은 키 순서와 무관하게 같은 문자열을 만든다', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }))
      .toBe(canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }))
  })
  it('canonicalJson은 배열 순서는 보존한다', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
  })
  it('digestItems는 항목 순서와 무관하게 같은 digest를 만든다', () => {
    const a = [{ key: 'x.md', content: '1' }, { key: 'y.md', content: '2' }]
    const b = [a[1]!, a[0]!]
    expect(digestItems(a)).toBe(digestItems(b))
  })
  it('digestItems는 내용이 다르면 digest가 다르다', () => {
    expect(digestItems([{ key: 'x.md', content: '1' }]))
      .not.toBe(digestItems([{ key: 'x.md', content: '2' }]))
  })
})

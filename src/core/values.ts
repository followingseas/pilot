import { sha256Hex, canonicalJson } from './digest.js'
import { PilotError } from './errors.js'

export interface MergeOverrideRule { path: string; strategy: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

function mergeArrays(base: unknown[], next: unknown[], strategy: string): unknown[] {
  if (strategy === 'append') return [...base, ...next]
  if (strategy === 'unique') {
    const seen = new Set<string>()
    return [...base, ...next].filter(v => {
      const k = canonicalJson(v)
      if (seen.has(k)) return false
      seen.add(k); return true
    })
  }
  const byField = strategy.match(/^uniqueBy:(.+)$/)
  if (byField) {
    const field = byField[1]!
    const out = new Map<string, unknown>()
    for (const v of [...base, ...next]) {
      const key = isPlainObject(v) ? String(v[field]) : canonicalJson(v)
      out.set(key, v)
    }
    return [...out.values()]
  }
  throw new PilotError(`알 수 없는 array 병합 전략: ${strategy}`)
}

function mergeTwo(base: unknown, next: unknown, ptr: string, overrides: MergeOverrideRule[]): unknown {
  if (next === undefined) return base
  if (Array.isArray(base) && Array.isArray(next)) {
    const strategy = overrides.find(o => o.path === ptr)?.strategy ?? 'replace'
    return strategy === 'replace' ? next : mergeArrays(base, next, strategy)
  }
  if (isPlainObject(base) && isPlainObject(next)) {
    const out: Record<string, unknown> = { ...base }
    for (const [k, v] of Object.entries(next)) {
      out[k] = mergeTwo(out[k], v, `${ptr}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, overrides)
    }
    return out
  }
  return next
}

/** 레이어를 약→강 순서로 병합한다. scalar replace, object deep-merge, array는 기본 replace + override 전략 */
export function mergeValues(layers: unknown[], overrides: MergeOverrideRule[] = []): Record<string, unknown> {
  let acc: unknown = {}
  for (const layer of layers) {
    if (layer === undefined || layer === null) continue
    acc = mergeTwo(acc, layer, '', overrides)
  }
  return isPlainObject(acc) ? acc : {}
}

export function getByPointer(obj: unknown, ptr: string): unknown {
  if (ptr === '') return obj
  let cur: unknown = obj
  for (const seg of ptr.split('/').slice(1)) {
    const key = seg.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(cur)) cur = cur[Number(key)]
    else if (isPlainObject(cur)) cur = cur[key]
    else return undefined
  }
  return cur
}

/** 이전/다음 values에서 값이 달라진 locked pointer 목록을 반환한다 */
export function checkLockedFields(prev: unknown, next: unknown, lockedFields: string[]): string[] {
  return lockedFields.filter(ptr =>
    canonicalJson(getByPointer(prev, ptr) ?? null) !== canonicalJson(getByPointer(next, ptr) ?? null))
}

export const effectiveValuesDigest = (values: Record<string, unknown>): string =>
  sha256Hex(canonicalJson(values))

const coerceScalar = (s: string): unknown => {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  if (s !== '' && !Number.isNaN(Number(s))) return Number(s)
  return s
}

/** `--set a.b=v` 점 표기 표현식들을 중첩 객체로 변환한다 */
export function parseSetFlag(exprs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const expr of exprs) {
    const eq = expr.indexOf('=')
    if (eq <= 0) throw new PilotError(`--set 형식 오류: '${expr}'`, 'key.path=value 형식을 사용하세요')
    const segs = expr.slice(0, eq).split('.')
    let cur = out
    for (const seg of segs.slice(0, -1)) {
      if (!isPlainObject(cur[seg])) cur[seg] = {}
      cur = cur[seg] as Record<string, unknown>
    }
    cur[segs[segs.length - 1]!] = coerceScalar(expr.slice(eq + 1))
  }
  return out
}

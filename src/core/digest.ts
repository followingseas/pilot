import { createHash } from 'node:crypto'

export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

/** 객체 키를 재귀 정렬해 직렬화 — 같은 값이면 항상 같은 문자열(digest 결정성의 기반) */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function digestItems(items: { key: string; content: string }[]): string {
  const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const h = createHash('sha256')
  for (const it of sorted) {
    h.update(it.key, 'utf8'); h.update('\0')
    h.update(it.content, 'utf8'); h.update('\0')
  }
  return h.digest('hex')
}

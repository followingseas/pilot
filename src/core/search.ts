import MiniSearch from 'minisearch'
import type { SynthesisResult } from './synthesize.js'

export interface SearchHit { key: string; sourceId: string; title: string; snippet: string; score: number }

function titleOf(content: string, key: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1] ?? key
}
function snippetAround(content: string, terms: string[]): string {
  const lower = content.toLowerCase()
  const idx = terms.map(t => lower.indexOf(t.toLowerCase())).find(i => i >= 0) ?? 0
  const start = Math.max(0, idx - 60)
  return content.slice(start, start + 160).replace(/\s+/g, ' ').trim()
}

export function searchDocs(synthesis: SynthesisResult, query: string, limit = 10): SearchHit[] {
  const mini = new MiniSearch({
    fields: ['title', 'content'], storeFields: ['key', 'sourceId', 'title', 'content'],
    searchOptions: { boost: { title: 2 }, prefix: true }
  })
  mini.addAll(synthesis.items.map((it, i) => ({
    id: i, key: it.key, sourceId: it.sourceId, content: it.content, title: titleOf(it.content, it.key)
  })))
  return mini.search(query).slice(0, limit).map(r => ({
    key: r.key as string, sourceId: r.sourceId as string, title: r.title as string,
    snippet: snippetAround(r.content as string, query.split(/\s+/)), score: r.score
  }))
}

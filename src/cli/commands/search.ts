import type { Command } from 'commander'
import { loadAll } from '../load.js'
import { searchDocs } from '../../core/search.js'
import { PilotError } from '../../core/errors.js'

export function registerSearch(program: Command): void {
  program.command('search')
    .argument('<query>', '검색어')
    .option('--cwd <path>', '기준 디렉토리', process.cwd())
    .option('--limit <n>', '결과 개수', '10')
    .option('--json', 'JSON 출력')
    .action((query: string, opts: { cwd: string; limit: string; json?: boolean }) => {
      const limit = Number(opts.limit)
      if (!Number.isInteger(limit) || limit <= 0) throw new PilotError('limit은 양의 정수여야 합니다')
      const { synthesis } = loadAll(opts.cwd)
      const hits = searchDocs(synthesis, query, limit)
      if (opts.json) { console.log(JSON.stringify(hits, null, 2)); return }
      if (hits.length === 0) { console.log('검색 결과가 없습니다'); return }
      for (const h of hits) console.log(`  ${h.key} · ${h.title} (${h.sourceId})\n    ${h.snippet}`)
    })
}

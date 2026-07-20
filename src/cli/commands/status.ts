import type { Command } from 'commander'
import { loadConfig } from '../../core/config.js'
import { lastSyncAt } from '../../core/sync.js'

function relativeTime(ms: number | null): string {
  if (ms === null) return '동기화 기록 없음'
  const diffSec = Math.floor((Date.now() - ms) / 1000)
  if (diffSec < 60) return `${diffSec}초 전`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  return `${Math.floor(diffHour / 24)}일 전`
}

export function registerStatus(program: Command): void {
  program.command('status')
    .option('--json', 'JSON 출력')
    .action((opts: { json?: boolean }) => {
      const config = loadConfig()
      const rows = config.connections.map(c => ({
        id: c.id, kind: c.kind, location: c.location, priority: c.priority,
        lastSyncAt: c.kind === 'git' ? lastSyncAt(c.id) : null
      }))
      if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return }
      if (rows.length === 0) { console.log('연결된 source가 없습니다'); return }
      for (const r of rows) {
        const sync = r.kind === 'git' ? ` · 동기화: ${relativeTime(r.lastSyncAt)}` : ''
        const priority = r.priority !== undefined ? ` · priority ${r.priority}` : ''
        console.log(`  ${r.id} [${r.kind}] ${r.location}${priority}${sync}`)
      }
    })
}

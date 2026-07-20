import type { Command } from 'commander'
import { loadConfig } from '../../core/config.js'
import { syncNow } from '../../core/sync.js'

export function registerSync(program: Command): void {
  program.command('sync')
    .argument('[id]', 'source id (생략 시 전체 git source)')
    .option('--json', 'JSON 출력')
    .action((id: string | undefined, opts: { json?: boolean }) => {
      const config = loadConfig()
      const result = syncNow(config, id)
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); return }
      for (const s of result.synced) console.log(`동기화됨: ${s}`)
      for (const f of result.failed) console.error(`동기화 실패: ${f.id} — ${f.error}`)
      if (result.synced.length === 0 && result.failed.length === 0) console.log('동기화할 git source가 없습니다')
      if (result.failed.length > 0) process.exitCode = 1
    })
}

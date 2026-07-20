import { resolve } from 'node:path'
import type { Command } from 'commander'
import { loadConfig, saveConfig, type Connection } from '../../core/config.js'
import { loadSource, cloneSource } from '../../core/source.js'
import { PilotError } from '../../core/errors.js'
import { isGitUrl, hasEmbeddedCredentials, redactCredentials } from '../../core/git.js'

export function registerConnect(program: Command): void {
  program.command('connect')
    .argument('<location>', 'rutter 위치 (로컬 경로 또는 git URL)')
    .requiredOption('--id <id>', 'source id')
    .option('--priority <n>', 'scope 동률 시 우선순위')
    .option('--json', 'JSON 출력')
    .action((location: string, opts: { id: string; priority?: string; json?: boolean }) => {
      const kind: Connection['kind'] = isGitUrl(location) ? 'git' : 'local'
      if (kind === 'git' && hasEmbeddedCredentials(location)) {
        throw new PilotError('URL에 자격증명을 포함할 수 없습니다', 'git credential helper 또는 SSH 키를 사용하세요')
      }
      const conn: Connection = {
        id: opts.id, kind, location: kind === 'local' ? resolve(location) : location
      }
      if (opts.priority !== undefined) {
        const n = Number(opts.priority)
        if (!Number.isInteger(n)) throw new PilotError(`잘못된 priority: ${opts.priority}`)
        conn.priority = n
      }
      if (kind === 'git') cloneSource(conn)
      loadSource(conn) // manifest 파싱 확인 — 실패하면 여기서 throw되어 config에 저장되지 않는다

      const config = loadConfig()
      config.connections = [...config.connections.filter(c => c.id !== conn.id), conn]
      saveConfig(config)

      if (opts.json) { console.log(JSON.stringify({ ...conn, location: redactCredentials(conn.location) }, null, 2)); return }
      console.log(`연결됨: ${conn.id} (${conn.kind}) → ${redactCredentials(conn.location)}`)
    })
}

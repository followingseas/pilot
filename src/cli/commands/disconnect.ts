import { rmSync } from 'node:fs'
import type { Command } from 'commander'
import { loadConfig, saveConfig } from '../../core/config.js'
import { sourceCacheDir } from '../../core/paths.js'
import { PilotError } from '../../core/errors.js'

export function registerDisconnect(program: Command): void {
  program.command('disconnect')
    .argument('<id>', '연결 해제할 source id')
    .option('--keep-cache', 'git source의 캐시를 삭제하지 않음')
    .description('연결된 rutter source를 전역 설정에서 제거한다')
    .action((id: string, opts: { keepCache?: boolean }) => {
      const config = loadConfig()
      const conn = config.connections.find(c => c.id === id)
      if (!conn) {
        throw new PilotError(`연결 '${id}'가 없습니다`, 'pilot status 로 연결 목록을 확인하세요')
      }
      config.connections = config.connections.filter(c => c.id !== id)
      saveConfig(config)
      if (conn.kind === 'git' && !opts.keepCache) {
        rmSync(sourceCacheDir(id), { recursive: true, force: true })
      }
      console.log(`✓ '${id}' 연결 해제됨`)
    })
}

import type { Command } from 'commander'
import { PilotError } from '../../core/errors.js'

// TODO: 2026-07-21 init 구현은 Task 14 — 지금은 명령 등록만 하는 자리표시자
export function registerInit(program: Command): void {
  program.command('init')
    .action(() => {
      throw new PilotError('아직 구현되지 않은 명령입니다', '후속 버전에서 제공됩니다')
    })
}

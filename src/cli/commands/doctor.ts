import type { Command } from 'commander'
import { collectDiagnostics } from '../../core/diagnose.js'

export function registerDoctor(program: Command): void {
  program.command('doctor')
    .option('--cwd <path>', '기준 디렉토리', process.cwd())
    .option('--json', 'JSON 출력')
    .action((opts: { cwd: string; json?: boolean }) => {
      const { issues, warnings } = collectDiagnostics(opts.cwd)

      if (opts.json) { console.log(JSON.stringify({ issues, warnings }, null, 2)) }
      else if (issues.length === 0 && warnings.length === 0) { console.log('문제 없음') }
      else {
        for (const m of issues) console.log(`  [오류] ${m}`)
        for (const m of warnings) console.log(`  [경고] ${m}`)
      }
      // Task 13 승인 당시 시맨틱: TTL 초과·섀도잉 경고·스텁 부재 등 발견 사항이 있으면(오류든 경고든) exit 1
      if (issues.length > 0 || warnings.length > 0) process.exitCode = 1
    })
}

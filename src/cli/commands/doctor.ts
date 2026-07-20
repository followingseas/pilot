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
      if (issues.length > 0) process.exitCode = 1
    })
}

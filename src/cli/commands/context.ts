import type { Command } from 'commander'
import { loadAll } from '../load.js'

export function registerContext(program: Command): void {
  program.command('context')
    .option('--cwd <path>', '기준 디렉토리', process.cwd())
    .option('--json', 'JSON 출력')
    .action((opts: { cwd: string; json?: boolean }) => {
      const { project, synthesis } = loadAll(opts.cwd)
      if (opts.json) { console.log(JSON.stringify({ project, items: synthesis.items }, null, 2)); return }
      console.log(project
        ? `프로젝트: ${project.repoEntry?.entry.id ?? '(매칭 없음)'} (${project.remote ?? 'remote 없음'})`
        : '프로젝트 아님 — 공통 컨텍스트만 적용')
      for (const it of synthesis.items) {
        const shadow = it.shadows.length
          ? `  ← ${it.shadows.map(s => `${s.sourceId}(${s.scope}) 가림`).join(', ')}` : ''
        console.log(`  [${it.scope}] ${it.key} · ${it.sourceId}${shadow}`)
      }
      for (const w of synthesis.warnings) console.error(`경고: ${w}`)
    })
}

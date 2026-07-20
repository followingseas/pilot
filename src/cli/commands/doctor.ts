import { existsSync } from 'node:fs'
import type { Command } from 'commander'
import { loadConfig } from '../../core/config.js'
import { loadSource, loadProjectSource, type RutterSource } from '../../core/source.js'
import { identifyProject } from '../../core/identify.js'
import { synthesize } from '../../core/synthesize.js'
import { lastSyncAt, shouldRevalidate } from '../../core/sync.js'
import { ConflictError } from '../../core/errors.js'
import { pilotContextPath } from '../../core/stub.js'

interface DoctorIssue { level: 'error' | 'warning'; message: string }

export function registerDoctor(program: Command): void {
  program.command('doctor')
    .option('--cwd <path>', '기준 디렉토리', process.cwd())
    .option('--json', 'JSON 출력')
    .action((opts: { cwd: string; json?: boolean }) => {
      const issues: DoctorIssue[] = []
      const config = loadConfig()
      const sources: RutterSource[] = []

      // ① 각 source 로드 가능 여부, ② 캐시 나이(TTL 초과 경고)
      for (const conn of config.connections) {
        try {
          sources.push(loadSource(conn))
          if (conn.kind === 'git' && shouldRevalidate(lastSyncAt(conn.id), config.syncTtlHours, Date.now())) {
            issues.push({ level: 'warning', message: `source '${conn.id}' 캐시가 오래됐습니다 (TTL 초과) — pilot sync ${conn.id} 를 실행하세요` })
          }
        } catch (e) {
          issues.push({ level: 'error', message: `source '${conn.id}' 로드 실패 — ${(e as Error).message}` })
        }
      }

      const project = identifyProject(opts.cwd, sources)
      if (project) {
        const local = loadProjectSource(project.root)
        if (local) sources.push(local)
      }

      // ③ synthesis.warnings (섀도잉 등)
      let synthesis = null
      try {
        synthesis = synthesize(sources, project)
        for (const w of synthesis.warnings) issues.push({ level: 'warning', message: w })
      } catch (e) {
        if (e instanceof ConflictError) {
          issues.push({ level: 'error', message: `충돌: ${(e as Error).message}` })
        } else {
          throw e
        }
      }

      // ④ 프로젝트 스텁 존재 여부
      if (project && !existsSync(pilotContextPath(project.root))) {
        issues.push({ level: 'warning', message: '프로젝트 스텁(.pilot/context.md)이 없습니다 — pilot init 을 실행하세요' })
      }

      if (opts.json) { console.log(JSON.stringify({ issues }, null, 2)) }
      else if (issues.length === 0) { console.log('문제 없음') }
      else {
        for (const i of issues) console.log(`  [${i.level === 'error' ? '오류' : '경고'}] ${i.message}`)
      }
      if (issues.length > 0) process.exitCode = 1
    })
}

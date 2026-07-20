import { existsSync } from 'node:fs'
import { loadConfig } from './config.js'
import { loadSource, loadProjectSource, type RutterSource } from './source.js'
import { identifyProject } from './identify.js'
import { synthesize } from './synthesize.js'
import { lastSyncAt, shouldRevalidate } from './sync.js'
import { ConflictError } from './errors.js'
import { pilotContextPath } from './stub.js'

export interface Diagnostics {
  issues: string[]; warnings: string[]; connections: number; loaded: number
}

// doctor 진단 로직의 단일 출처 — CLI(pilot doctor)와 MCP(pilot_doctor)가 동등한 결과를 보도록 이 함수만 호출한다
export function collectDiagnostics(cwd: string): Diagnostics {
  const issues: string[] = []
  const warnings: string[] = []
  const config = loadConfig()
  const sources: RutterSource[] = []

  // ① 각 source 로드 가능 여부, ② 캐시 나이(TTL 초과 경고)
  for (const conn of config.connections) {
    try {
      sources.push(loadSource(conn))
      if (conn.kind === 'git' && shouldRevalidate(lastSyncAt(conn.id), config.syncTtlHours, Date.now())) {
        warnings.push(`source '${conn.id}' 캐시가 오래됐습니다 (TTL 초과) — pilot sync ${conn.id} 를 실행하세요`)
      }
    } catch (e) {
      issues.push(`source '${conn.id}' 로드 실패 — ${(e as Error).message}`)
    }
  }

  const project = identifyProject(cwd, sources)
  if (project) {
    const local = loadProjectSource(project.root)
    if (local) sources.push(local)
  }

  // ③ synthesis.warnings (섀도잉 등), 충돌은 issue로 편입
  try {
    const synthesis = synthesize(sources, project)
    warnings.push(...synthesis.warnings)
  } catch (e) {
    if (e instanceof ConflictError) {
      issues.push(`충돌: ${(e as Error).message}`)
    } else {
      throw e
    }
  }

  // ④ 프로젝트 스텁 존재 여부
  if (project && !existsSync(pilotContextPath(project.root))) {
    warnings.push('프로젝트 스텁(.pilot/context.md)이 없습니다 — pilot init 을 실행하세요')
  }

  return { issues, warnings, connections: config.connections.length, loaded: sources.length }
}

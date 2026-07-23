import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadAll } from '../cli/load.js'
import { searchDocs } from '../core/search.js'
import { lastSyncAt } from '../core/sync.js'
import { detectProject, redactCredentials } from '../core/git.js'
import { collectDiagnostics } from '../core/diagnose.js'
import { readRelease } from '../core/release.js'
import { readLock } from '../core/lock.js'
import { loadPolicySets, rulesForAgent } from '../core/policy.js'

const asText = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })

export function createServer(): McpServer {
  const server = new McpServer({ name: 'pilot', version: '0.1.0' })

  server.tool('pilot_get_context',
    '현재 프로젝트에 적용되는 규약·문서를 provenance와 함께 반환한다',
    { cwd: z.string().optional() },
    ({ cwd }) => {
      const { project, synthesis } = loadAll(cwd ?? process.cwd())
      return asText({ project, items: synthesis.items, warnings: synthesis.warnings })
    })

  server.tool('pilot_search_knowledge',
    '연결된 rutter의 문서를 검색한다',
    { query: z.string() },
    ({ query }) => asText(searchDocs(loadAll(process.cwd()).synthesis, query)))

  server.tool('pilot_list_sources', '연결된 rutter 소스 목록', {},
    () => {
      const { config } = loadAll(process.cwd())
      return asText(config.connections.map(c => ({
        ...c, location: redactCredentials(c.location), lastSyncAt: c.kind === 'git' ? lastSyncAt(c.id) : null
      })))
    })

  server.tool('pilot_doctor', '소스 상태 진단', {},
    () => asText(collectDiagnostics(process.cwd())))

  // v2 도구 — 응답 payload 형태는 고정 스키마다. 필드를 제거·개명하지 말 것 (agent들이 파싱한다)
  server.tool('pilot_resolve_release',
    '설치된 release와 lock의 해석 결과(revision·digest·locked field)를 반환한다',
    { cwd: z.string().optional() },
    ({ cwd }) => {
      const base = cwd ?? process.cwd()
      const detected = detectProject(base)
      const projectRoot = detected?.root ?? base
      const warnings: string[] = []
      if (!detected) warnings.push(`'${base}'는 git 프로젝트가 아니라 해당 경로를 그대로 project root로 사용했습니다`)
      const release = readRelease(projectRoot)
      const lock = readLock(projectRoot)
      if (!release && !lock) {
        return asText({ installed: false, warnings: [...warnings, 'release가 설치되지 않았습니다 — pilot release install 을 실행하세요'] })
      }
      if (!release || !lock) {
        // 부분 상태는 "미설치"와 다르다 — install을 다시 돌리라고 오도하지 않는다
        return asText({
          installed: false,
          warnings: [...warnings,
            `${release ? 'rutter.lock' : 'release.yaml'}이 없습니다 — 배포가 중단된 부분 상태일 수 있으니 pilot release upgrade 로 복구하세요`]
        })
      }
      if (release.metadata.revision !== lock.release.revision) {
        warnings.push(`release.yaml(revision ${release.metadata.revision})과 rutter.lock(revision ${lock.release.revision})이 일치하지 않습니다`)
      }
      return asText({
        installed: true,
        releaseName: release.metadata.name,
        revision: release.metadata.revision,
        status: release.metadata.status,
        package: release.spec.package,
        resolvedSources: lock.resolved.sources,
        resolvedDependencies: lock.resolved.dependencies,
        values: lock.values,
        lockedFields: lock.lockedFields,
        artifacts: release.artifacts,
        generatedAt: lock.generatedAt,
        warnings
      })
    })

  server.tool('pilot_get_policy',
    '지정한 agent에 적용되는 policy rule과 문서 provenance를 반환한다',
    { cwd: z.string().optional(), agent: z.enum(['claude', 'codex', 'copilot', 'generic']) },
    ({ cwd, agent }) => {
      const { sources, synthesis } = loadAll(cwd ?? process.cwd())
      const sets = sources.flatMap(s => loadPolicySets(s))
      const applied = sets.filter(s => s.appliesTo.agents.some(a => a === agent || a === 'generic' || a === '*'))
      return asText({
        agent,
        appliedPolicySets: applied.map(s => ({ name: s.name, version: s.version, sourceId: s.sourceId })),
        rules: rulesForAgent(sets, agent).map(r => ({
          id: r.id, level: r.level, category: r.category, statement: r.statement, rationale: r.rationale
        })),
        documents: synthesis.items.map(i => ({
          path: i.key, source: i.sourceId, shadowedBy: i.shadows.map(s => s.sourceId)
        }))
      })
    })

  return server
}

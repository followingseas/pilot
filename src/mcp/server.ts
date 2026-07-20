import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { loadAll } from '../cli/load.js'
import { searchDocs } from '../core/search.js'
import { lastSyncAt } from '../core/sync.js'

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
      return asText(config.connections.map(c => ({ ...c, lastSyncAt: c.kind === 'git' ? lastSyncAt(c.id) : null })))
    })

  server.tool('pilot_doctor', '소스 상태 진단', {},
    () => {
      const { config, sources, synthesis } = loadAll(process.cwd())
      return asText({
        connections: config.connections.length, loaded: sources.length,
        shadowWarnings: synthesis.warnings
      })
    })

  return server
}

import type { Command } from 'commander'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from '../../mcp/server.js'

export function registerMcp(program: Command): void {
  program.command('mcp').description('stdio MCP 서버 실행').action(async () => {
    await createServer().connect(new StdioServerTransport())
    console.error('pilot mcp 서버 시작')   // 로그는 stderr
  })
}

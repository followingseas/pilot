import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SynthesisResult } from './synthesize.js'

export const BEGIN_MARK = '<!-- pilot:begin -->'
export const END_MARK = '<!-- pilot:end -->'

export function upsertMarkedBlock(existing: string, block: string): string {
  const rendered = `${BEGIN_MARK}\n${block}\n${END_MARK}`
  const re = new RegExp(`${BEGIN_MARK}[\\s\\S]*?${END_MARK}`)
  if (re.test(existing)) return existing.replace(re, rendered)
  const sep = existing.endsWith('\n') || existing === '' ? '' : '\n'
  return `${existing}${sep}\n${rendered}\n`
}

export function renderContextFile(synthesis: SynthesisResult, rutterName: string): string {
  const head = `# ${rutterName} — Pilot 합성 컨텍스트\n\n> pilot sync가 재생성하는 파일. 직접 수정하지 마세요.\n`
  const body = synthesis.items.map(it =>
    `\n---\n<!-- source: ${it.sourceId} · scope: ${it.scope} · key: ${it.key} -->\n\n${it.content}`
  ).join('\n')
  return head + body + '\n'
}

export function writeStub(
  projectRoot: string, synthesis: SynthesisResult, rutterName: string
): { written: string[] } {
  const written: string[] = []
  const pilotDir = join(projectRoot, '.pilot')
  mkdirSync(pilotDir, { recursive: true })
  writeFileSync(join(pilotDir, '.gitignore'), '*\n')
  writeFileSync(join(pilotDir, 'context.md'), renderContextFile(synthesis, rutterName))
  written.push('.pilot/context.md')

  const claudeBlock = [
    `이 프로젝트는 ${rutterName}의 규약을 따른다. @.pilot/context.md`,
    `상세 규약·검색은 MCP 도구 pilot_get_context / pilot_search_knowledge 사용.`
  ].join('\n')
  const agentsBlock = [
    `이 프로젝트는 ${rutterName}의 규약을 따른다.`,
    `작업 시작 전 MCP 도구 pilot_get_context를 호출해 적용 규약을 로드하라.`
  ].join('\n')

  for (const [file, block] of [['CLAUDE.md', claudeBlock], ['AGENTS.md', agentsBlock]] as const) {
    const path = join(projectRoot, file)
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
    writeFileSync(path, upsertMarkedBlock(existing, block))
    written.push(file)
  }
  return { written }
}

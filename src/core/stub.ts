import { join } from 'node:path'
import type { SynthesisResult } from './synthesize.js'

export const BEGIN_MARK = '<!-- pilot:begin -->'
export const END_MARK = '<!-- pilot:end -->'

// lock·release.yaml은 커밋 대상(재현성 앵커) — applyArtifacts가 이 화이트리스트로 .pilot/.gitignore를 쓴다
export const PILOT_GITIGNORE = '*\n!rutter.lock\n!release.yaml\n'

export const pilotContextPath = (projectRoot: string): string => join(projectRoot, '.pilot', 'context.md')

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sanitizeBlock = (b: string): string =>
  b.replaceAll(BEGIN_MARK, '<!-- pilot:begin (escaped) -->')
   .replaceAll(END_MARK, '<!-- pilot:end (escaped) -->')

export function removeMarkedBlock(existing: string): string {
  const re = new RegExp(`\\n?${escapeRegExp(BEGIN_MARK)}[\\s\\S]*?${escapeRegExp(END_MARK)}\\n?`)
  return existing.replace(re, '')
}

export function upsertMarkedBlock(existing: string, block: string): string {
  const rendered = `${BEGIN_MARK}\n${sanitizeBlock(block)}\n${END_MARK}`
  const re = new RegExp(`${escapeRegExp(BEGIN_MARK)}[\\s\\S]*?${escapeRegExp(END_MARK)}`)
  if (re.test(existing)) return existing.replace(re, () => rendered)
  if (existing === '') return `${rendered}\n`
  const sep = existing.endsWith('\n') ? '' : '\n'
  return `${existing}${sep}\n${rendered}\n`
}

export function renderContextFile(synthesis: SynthesisResult, rutterName: string): string {
  const head = `# ${rutterName} — Pilot 합성 컨텍스트\n\n> pilot apply가 재생성하는 파일. 직접 수정하지 마세요.\n`
  const body = synthesis.items.map(it =>
    `\n---\n<!-- source: ${it.sourceId} · scope: ${it.scope} · key: ${it.key} -->\n\n${it.content}`
  ).join('\n')
  return head + body + '\n'
}

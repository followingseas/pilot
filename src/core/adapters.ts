import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { SynthesisResult } from './synthesize.js'
import type { AdaptersConfig } from './manifest.js'
import type { PolicyRule } from './policy.js'
import { renderContextFile, upsertMarkedBlock } from './stub.js'
import { sha256Hex } from './digest.js'

export interface RenderedArtifact {
  path: string
  /** wholeFile이면 파일 전체 내용, 아니면 marked block으로 삽입될 본문 */
  block: string
  wholeFile: boolean
  checksumSha256: string
}

export interface AdapterInput {
  rutterName: string
  packageName?: string
  packageVersion?: string
  releaseName?: string
  revision?: number
  synthesis: SynthesisResult
  rules: PolicyRule[]
  adapters: AdaptersConfig
  lockDigest?: string
}

export function renderRulesMarkdown(rules: PolicyRule[]): string {
  if (rules.length === 0) return ''
  const lines = rules.map(r => {
    const head = `- [${r.level}] ${r.statement}`
    return r.rationale ? `${head}\n  - Why: ${r.rationale}` : head
  })
  return lines.join('\n')
}

function provenance(input: AdapterInput): string {
  const lines = ['## Source provenance']
  if (input.packageName) {
    lines.push(`- package: ${input.packageName}${input.packageVersion ? `@${input.packageVersion}` : ''}`)
  }
  if (input.releaseName !== undefined && input.revision !== undefined) {
    lines.push(`- release: ${input.releaseName} · revision ${input.revision}`)
  }
  if (input.lockDigest) lines.push(`- digest: ${input.lockDigest}`)
  return lines.length > 1 ? lines.join('\n') : ''
}

const withSections = (...sections: string[]): string => sections.filter(Boolean).join('\n\n')

const artifact = (path: string, block: string, wholeFile = false): RenderedArtifact =>
  ({ path, block, wholeFile, checksumSha256: sha256Hex(block) })

/** 활성 어댑터별 산출물 렌더 — source of truth(policy IR·synthesis)에서 target별 표면을 만든다 */
export function renderArtifacts(input: AdapterInput): RenderedArtifact[] {
  const { adapters, rules, synthesis, rutterName } = input
  const context = renderContextFile(synthesis, rutterName)
  const rulesMd = renderRulesMarkdown(rules)
  const prov = provenance(input)
  const out: RenderedArtifact[] = [artifact('.pilot/context.md', context, true)]

  if (adapters.claude.enabled) {
    out.push(artifact(adapters.claude.output, withSections(
      [`이 프로젝트는 ${rutterName}의 규약을 따른다. @.pilot/context.md`,
        `상세 규약·검색은 MCP 도구 pilot_get_context / pilot_search_knowledge / pilot_get_policy 사용.`].join('\n'),
      rulesMd && `## 핵심 규칙\n\n${rulesMd}`,
      prov
    )))
  }
  if (adapters.codex.enabled) {
    out.push(artifact(adapters.codex.output, withSections(
      `이 프로젝트는 ${rutterName}의 규약을 따른다. 아래는 합성된 규약 전문이다.`,
      rulesMd && `## 핵심 규칙\n\n${rulesMd}`,
      context,
      prov
    )))
  }
  if (adapters.copilot.enabled) {
    out.push(artifact(adapters.copilot.output, withSections(
      `This repository follows the ${rutterName} policy package.`,
      rulesMd && `## Rules\n\n${rulesMd}`,
      `See \`.pilot/context.md\` for the full synthesized conventions.`,
      prov
    )))
  }
  return out
}

/** 산출물 적용 — wholeFile은 통째 기록, 블록형은 marked block으로 사용자 영역을 보존하며 삽입 */
export function applyArtifacts(projectRoot: string, artifacts: RenderedArtifact[]): string[] {
  const written: string[] = []
  const pilotDir = join(projectRoot, '.pilot')
  mkdirSync(pilotDir, { recursive: true })
  writeFileSync(join(pilotDir, '.gitignore'), '*\n!rutter.lock\n!release.yaml\n')
  for (const a of artifacts) {
    const path = join(projectRoot, a.path)
    mkdirSync(dirname(path), { recursive: true })
    if (a.wholeFile) {
      writeFileSync(path, a.block)
    } else {
      const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
      writeFileSync(path, upsertMarkedBlock(existing, a.block))
    }
    written.push(a.path)
  }
  return written
}

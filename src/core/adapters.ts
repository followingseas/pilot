import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { SynthesisResult } from './synthesize.js'
import type { AdaptersConfig } from './manifest.js'
import { rulesForAgent, type PolicyRule, type PolicySet } from './policy.js'
import { renderContextFile, upsertMarkedBlock, removeMarkedBlock, PILOT_GITIGNORE } from './stub.js'
import { sha256Hex } from './digest.js'
import { resolveWithin } from './paths.js'

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
  synthesis: SynthesisResult
  policySets: PolicySet[]
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

// revision은 bookkeeping(release.yaml)이라 렌더 파일엔 넣지 않는다 — 매 apply마다 문서가 churn하는 것을 막는다.
// 내용 출처는 package@version + digest로 충분하다
function provenance(input: AdapterInput): string {
  const lines = ['## Source provenance']
  if (input.packageName) {
    lines.push(`- package: ${input.packageName}${input.packageVersion ? `@${input.packageVersion}` : ''}`)
  }
  if (input.lockDigest) lines.push(`- digest: ${input.lockDigest}`)
  return lines.length > 1 ? lines.join('\n') : ''
}

const withSections = (...sections: string[]): string => sections.filter(Boolean).join('\n\n')

const artifact = (path: string, block: string, wholeFile = false): RenderedArtifact =>
  ({ path, block, wholeFile, checksumSha256: sha256Hex(block) })

/** 활성 어댑터별 산출물 렌더 — source of truth(policy IR·synthesis)에서 target별 표면을 만든다.
 *  rule은 agent별로 필터되므로 특정 agent 전용 PolicySet은 다른 표면에 새지 않는다 */
export function renderArtifacts(input: AdapterInput): RenderedArtifact[] {
  const { adapters, policySets, synthesis, rutterName } = input
  const context = renderContextFile(synthesis, rutterName)
  const prov = provenance(input)
  const rulesMd = (agent: string) => renderRulesMarkdown(rulesForAgent(policySets, agent))
  const out: RenderedArtifact[] = [artifact('.pilot/context.md', context, true)]

  if (adapters.claude.enabled) {
    const md = rulesMd('claude')
    out.push(artifact(adapters.claude.output, withSections(
      [`이 프로젝트는 ${rutterName}의 규약을 따른다. @.pilot/context.md`,
        `상세 규약·검색은 MCP 도구 pilot_get_context / pilot_search_knowledge / pilot_get_policy 사용.`].join('\n'),
      md && `## 핵심 규칙\n\n${md}`,
      prov
    )))
  }
  if (adapters.codex.enabled) {
    const md = rulesMd('codex')
    out.push(artifact(adapters.codex.output, withSections(
      `이 프로젝트는 ${rutterName}의 규약을 따른다. 아래는 합성된 규약 전문이다.`,
      md && `## 핵심 규칙\n\n${md}`,
      context,
      prov
    )))
  }
  if (adapters.copilot.enabled) {
    const md = rulesMd('copilot')
    out.push(artifact(adapters.copilot.output, withSections(
      `This repository follows the ${rutterName} policy package.`,
      md && `## Rules\n\n${md}`,
      `See \`.pilot/context.md\` for the full synthesized conventions.`,
      prov
    )))
  }
  return out
}

/** 산출물 적용 — wholeFile은 통째 기록, 블록형은 marked block으로 사용자 영역을 보존하며 삽입.
 *  경로는 manifest 유래(신뢰 불가)이므로 항상 projectRoot 안으로 강제한다 */
export function applyArtifacts(projectRoot: string, artifacts: RenderedArtifact[]): string[] {
  const written: string[] = []
  const pilotDir = join(projectRoot, '.pilot')
  mkdirSync(pilotDir, { recursive: true })
  writeFileSync(join(pilotDir, '.gitignore'), PILOT_GITIGNORE)
  for (const a of artifacts) {
    const path = resolveWithin(projectRoot, a.path)
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

/** 이전 revision에는 있었으나 이번에 사라진 산출물 정리 — 남겨두면 낡은 정책이 계속 소비된다.
 *  `.pilot/` 아래는 삭제, 사용자 파일은 marked block만 제거(본문이 비면 파일 삭제) */
export function removeStaleArtifacts(projectRoot: string, previousPaths: string[], currentPaths: string[]): string[] {
  const current = new Set(currentPaths)
  const removed: string[] = []
  for (const rel of previousPaths.filter(p => !current.has(p))) {
    let path: string
    try { path = resolveWithin(projectRoot, rel) }
    catch { continue }  // 과거 기록이 루트를 벗어나면 건드리지 않는다
    if (!existsSync(path)) continue
    if (rel.startsWith('.pilot/')) {
      rmSync(path, { force: true })
    } else {
      const stripped = removeMarkedBlock(readFileSync(path, 'utf8'))
      if (stripped.trim() === '') rmSync(path, { force: true })
      else writeFileSync(path, stripped)
    }
    removed.push(rel)
  }
  return removed
}

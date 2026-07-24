import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import type { RutterSource } from './source.js'
import { resolveWithin } from './paths.js'
import { PilotError } from './errors.js'
import { V2_API_VERSION } from './manifest.js'

export const RULE_LEVELS = ['error', 'warn', 'info'] as const
export type RuleLevel = (typeof RULE_LEVELS)[number]

const ruleSchema = z.object({
  id: z.string().min(1),
  level: z.enum(RULE_LEVELS),
  category: z.string().optional(),
  statement: z.string().min(1),
  rationale: z.string().optional(),
  examples: z.object({
    valid: z.array(z.string()).optional(),
    invalid: z.array(z.string()).optional()
  }).optional(),
  checks: z.array(z.object({
    kind: z.string(),
    target: z.string().optional(),
    pattern: z.string().optional(),
    heading: z.string().optional()
  })).optional(),
  remediation: z.array(z.object({
    type: z.string(),
    run: z.string().optional()
  })).optional()
})
export type PolicyRule = z.infer<typeof ruleSchema>

const policySetSchema = z.looseObject({
  apiVersion: z.literal(V2_API_VERSION),
  kind: z.literal('PolicySet'),
  metadata: z.object({
    name: z.string().min(1),
    version: z.string().optional()
  }),
  spec: z.object({
    appliesTo: z.object({
      agents: z.array(z.string()).default(['generic']),
      repositories: z.array(z.string()).default(['*']),
      paths: z.array(z.string()).default(['**'])
    }).default({ agents: ['generic'], repositories: ['*'], paths: ['**'] }),
    rules: z.array(ruleSchema).default([])
  })
})

export interface PolicySet {
  name: string
  version?: string
  appliesTo: { agents: string[]; repositories: string[]; paths: string[] }
  rules: PolicyRule[]
  sourceId: string
}

/** source의 policiesDir에서 `kind: PolicySet` YAML들을 로드한다. rule id는 source 내 전역 유일해야 한다 */
export function loadPolicySets(source: RutterSource): PolicySet[] {
  const dirRel = source.manifest.policiesDir
  if (!dirRel) return []
  const dir = resolveWithin(source.rootDir, dirRel)
  if (!existsSync(dir)) return []

  const sets: PolicySet[] = []
  const seenIds = new Map<string, string>()
  for (const name of readdirSync(dir).filter(n => /\.ya?ml$/i.test(n)).sort()) {
    const file = resolveWithin(source.rootDir, join(dirRel, name))
    let raw: unknown
    try { raw = parse(readFileSync(file, 'utf8')) }
    catch (e) { throw new PilotError(`${file}: PolicySet YAML 파싱 실패 — ${(e as Error).message}`) }
    const parsed = policySetSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new PilotError(`${file}: ${issue?.path.join('.') || '(root)'}: ${issue?.message}`)
    }
    const d = parsed.data
    for (const rule of d.spec.rules) {
      const prev = seenIds.get(rule.id)
      if (prev) throw new PilotError(`rule id '${rule.id}' 중복: ${prev}과 ${name}`, 'rule id는 패키지 내에서 유일해야 합니다')
      seenIds.set(rule.id, name)
    }
    sets.push({
      name: d.metadata.name, version: d.metadata.version,
      appliesTo: d.spec.appliesTo, rules: d.spec.rules, sourceId: source.id
    })
  }
  return sets
}

/** agent에 적용되는 rule만 추출한다. appliesTo.agents의 'generic' 또는 '*'는 모든 agent에 적용 */
export function rulesForAgent(sets: PolicySet[], agent: string): PolicyRule[] {
  return sets
    .filter(s => s.appliesTo.agents.some(a => a === agent || a === 'generic' || a === '*'))
    .flatMap(s => s.rules)
}

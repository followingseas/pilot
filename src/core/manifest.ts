import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { ManifestError } from './errors.js'

export const SCOPES = ['organization', 'repository', 'project-local', 'personal'] as const
export type Scope = (typeof SCOPES)[number]

export const V2_API_VERSION = 'rutter.followingseas.dev/v2alpha1'

export interface RepoEntry { id: string; remote: string }
export interface AdapterOut { enabled: boolean; output: string; mode?: string }
export interface AdaptersConfig { claude: AdapterOut; codex: AdapterOut; copilot: AdapterOut }
export interface DependencyDecl { name: string; version?: string; repository: string; alias?: string }
export interface MergeOverride { path: string; strategy: string }

/** v1·v2 공통 정규화 모델 — v1 소비자는 v1에 있던 필드만 사용해야 하며, v2 전용 필드는 v1 파싱 시 기본값으로 채워진다 */
export interface RutterManifest {
  formatVersion: 1 | 2
  name: string
  scope: Scope
  paths: { conventions?: string; charts?: string; wiki?: string[] }
  repositories: RepoEntry[]
  priority: number
  version?: string
  packageType: 'application' | 'library' | 'overlay'
  policiesDir?: string
  defaultsFile?: string
  lockedFields: string[]
  mergeOverrides: MergeOverride[]
  adapters: AdaptersConfig
  dependencies: DependencyDecl[]
}

export const defaultAdapters = (): AdaptersConfig => ({
  claude: { enabled: true, output: 'CLAUDE.md', mode: 'import' },
  codex: { enabled: true, output: 'AGENTS.md', mode: 'layered-inline' },
  copilot: { enabled: false, output: '.github/copilot-instructions.md' }
})

const repoSchema = z.array(z.object({ id: z.string(), remote: z.string() })).default([])

const v1Schema = z.looseObject({
  version: z.literal(1),
  name: z.string().min(1),
  scope: z.enum(SCOPES),
  paths: z.object({
    conventions: z.string().optional(),
    charts: z.string().optional(),
    wiki: z.array(z.string()).optional()
  }).default({}),
  repositories: repoSchema,
  priority: z.number().int().default(0)
}) // team, depends_on 등 예약 키 허용(무시)

const adapterOutSchema = z.object({
  enabled: z.boolean().optional(),
  output: z.string().optional(),
  mode: z.string().optional()
}).optional()

const v2Schema = z.looseObject({
  apiVersion: z.literal(V2_API_VERSION),
  kind: z.literal('Package'),
  metadata: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    displayName: z.string().optional(),
    description: z.string().optional()
  }),
  package: z.object({
    type: z.enum(['application', 'library', 'overlay']).default('application'),
    scope: z.enum(SCOPES)
  }),
  sources: z.object({
    docs: z.object({
      conventions: z.string().optional(),
      maps: z.string().optional(),
      wiki: z.array(z.string()).optional()
    }).optional(),
    policies: z.object({ dir: z.string() }).optional()
  }).optional(),
  dependencies: z.array(z.object({
    name: z.string().min(1),
    version: z.string().optional(),
    repository: z.string().min(1),
    alias: z.string().optional()
  })).default([]),
  repositories: repoSchema,
  values: z.object({
    defaultsFile: z.string().optional(),
    merge: z.object({
      overrides: z.array(z.object({ path: z.string(), strategy: z.string() })).optional()
    }).optional(),
    lockedFields: z.array(z.string()).optional()
  }).optional(),
  adapters: z.object({
    claude: adapterOutSchema,
    codex: adapterOutSchema,
    copilot: adapterOutSchema
  }).optional(),
  priority: z.number().int().default(0)
})

function normalizeV1(d: z.infer<typeof v1Schema>): RutterManifest {
  return {
    formatVersion: 1,
    name: d.name, scope: d.scope, paths: d.paths,
    repositories: d.repositories, priority: d.priority,
    packageType: 'application',
    lockedFields: [], mergeOverrides: [],
    adapters: defaultAdapters(), dependencies: []
  }
}

function normalizeV2(d: z.infer<typeof v2Schema>): RutterManifest {
  const docs = d.sources?.docs ?? {}
  const base = defaultAdapters()
  const merge = (dflt: AdapterOut, given?: { enabled?: boolean; output?: string; mode?: string }): AdapterOut => ({
    enabled: given?.enabled ?? dflt.enabled,
    output: given?.output ?? dflt.output,
    mode: given?.mode ?? dflt.mode
  })
  return {
    formatVersion: 2,
    name: d.metadata.name, scope: d.package.scope,
    // v2 canonical layout(docs/conventions, docs/maps)을 v1 paths로 정규화 — 합성 엔진 재사용
    paths: { conventions: docs.conventions, charts: docs.maps, wiki: docs.wiki },
    repositories: d.repositories, priority: d.priority,
    version: d.metadata.version,
    packageType: d.package.type,
    policiesDir: d.sources?.policies?.dir,
    defaultsFile: d.values?.defaultsFile,
    lockedFields: d.values?.lockedFields ?? [],
    mergeOverrides: d.values?.merge?.overrides ?? [],
    adapters: {
      claude: merge(base.claude, d.adapters?.claude),
      codex: merge(base.codex, d.adapters?.codex),
      copilot: merge(base.copilot, d.adapters?.copilot)
    },
    dependencies: d.dependencies
  }
}

// manifest가 가리키는 경로(어댑터 출력·policies·defaults)는 신뢰 경계 안이어야 한다.
// 절대경로·상위 탈출('..')은 파싱 시점에 거부한다 — 쓰기/읽기 지점의 resolveWithin 가드와 이중 방어
const isUnsafeRelPath = (p: string): boolean =>
  isAbsolute(p) || p.split(/[\\/]/).includes('..')

function validatePaths(file: string, m: RutterManifest): void {
  for (const [agent, cfg] of Object.entries(m.adapters)) {
    if (isUnsafeRelPath(cfg.output)) {
      throw new ManifestError(file, `adapters.${agent}.output: 프로젝트 상대 경로만 허용됩니다: '${cfg.output}'`)
    }
  }
  for (const [label, p] of [['policies dir', m.policiesDir], ['values.defaultsFile', m.defaultsFile]] as const) {
    if (p && isUnsafeRelPath(p)) {
      throw new ManifestError(file, `${label}: 패키지 루트 상대 경로만 허용됩니다: '${p}'`)
    }
  }
}

export function parseManifest(dir: string): RutterManifest {
  const file = join(dir, 'rutter.yaml')
  if (!existsSync(file)) throw new ManifestError(file, 'rutter.yaml이 없습니다')
  let raw: unknown
  try { raw = parse(readFileSync(file, 'utf8')) }
  catch (e) { throw new ManifestError(file, `YAML 파싱 실패: ${(e as Error).message}`) }

  const isV2 = !!raw && typeof raw === 'object' && 'apiVersion' in (raw as Record<string, unknown>)
  const parsed = isV2 ? v2Schema.safeParse(raw) : v1Schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ManifestError(file, `${issue?.path.join('.') || '(root)'}: ${issue?.message}`)
  }
  const manifest = isV2
    ? normalizeV2(parsed.data as z.infer<typeof v2Schema>)
    : normalizeV1(parsed.data as z.infer<typeof v1Schema>)
  validatePaths(file, manifest)
  return manifest
}

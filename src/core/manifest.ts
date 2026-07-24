import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { ManifestError } from './errors.js'

export const SCOPES = ['organization', 'repository', 'project-local', 'personal'] as const
export type Scope = (typeof SCOPES)[number]

// lock·release 등 pilot이 생성하는 상태 파일의 포맷 스탬프 (매니페스트가 아니라 내부 파일용)
export const API_VERSION = 'rutter.followingseas.dev/v1'

export interface RepoEntry { id: string; remote: string }
export interface AdapterOut { enabled: boolean; output: string; mode?: string }
export interface AdaptersConfig { claude: AdapterOut; codex: AdapterOut; copilot: AdapterOut }
export interface DependencyDecl { name: string; version?: string; repository: string; alias?: string }
export interface MergeOverride { path: string; strategy: string }

/** 내부 정규화 모델 — 다운스트림(synthesize/lock/engine/adapters)이 소비하는 형태 */
export interface RutterManifest {
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

const adapterInSchema = z.object({
  enabled: z.boolean().optional(),
  output: z.string().optional(),
  mode: z.string().optional()
}).optional()

// 평면 매니페스트 — package.json처럼 최상위에 name/version을 나란히 둔다.
// apiVersion·kind 같은 k8s 판별자 없음. 알 수 없는 키는 허용(전방 호환)
const schema = z.looseObject({
  name: z.string().min(1),
  version: z.string().optional(),
  scope: z.enum(SCOPES),
  type: z.enum(['application', 'library', 'overlay']).default('application'),
  docs: z.object({
    conventions: z.string().optional(),
    maps: z.string().optional(),
    wiki: z.array(z.string()).optional()
  }).optional(),
  policies: z.string().optional(),
  defaults: z.string().optional(),
  values: z.object({
    merge: z.object({
      overrides: z.array(z.object({ path: z.string(), strategy: z.string() })).optional()
    }).optional(),
    lockedFields: z.array(z.string()).optional()
  }).optional(),
  adapters: z.object({
    claude: adapterInSchema,
    codex: adapterInSchema,
    copilot: adapterInSchema
  }).optional(),
  dependencies: z.array(z.object({
    name: z.string().min(1),
    version: z.string().optional(),
    repository: z.string().min(1),
    alias: z.string().optional()
  })).optional(),
  repositories: z.array(z.object({ id: z.string(), remote: z.string() })).optional(),
  priority: z.number().int().default(0)
})

function normalize(d: z.infer<typeof schema>): RutterManifest {
  const base = defaultAdapters()
  const merge = (dflt: AdapterOut, given?: { enabled?: boolean; output?: string; mode?: string }): AdapterOut => ({
    enabled: given?.enabled ?? dflt.enabled,
    output: given?.output ?? dflt.output,
    mode: given?.mode ?? dflt.mode
  })
  return {
    name: d.name,
    scope: d.scope,
    paths: { conventions: d.docs?.conventions, charts: d.docs?.maps, wiki: d.docs?.wiki },
    repositories: d.repositories ?? [],
    priority: d.priority,
    version: d.version,
    packageType: d.type,
    policiesDir: d.policies,
    defaultsFile: d.defaults,
    lockedFields: d.values?.lockedFields ?? [],
    mergeOverrides: d.values?.merge?.overrides ?? [],
    adapters: {
      claude: merge(base.claude, d.adapters?.claude),
      codex: merge(base.codex, d.adapters?.codex),
      copilot: merge(base.copilot, d.adapters?.copilot)
    },
    dependencies: d.dependencies ?? []
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
  for (const [label, p] of [['policies', m.policiesDir], ['defaults', m.defaultsFile]] as const) {
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

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ManifestError(file, `${issue?.path.join('.') || '(root)'}: ${issue?.message}`)
  }
  const manifest = normalize(parsed.data)
  validatePaths(file, manifest)
  return manifest
}

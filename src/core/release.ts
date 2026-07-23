import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { V2_API_VERSION } from './manifest.js'
import { PilotError } from './errors.js'
import type { RenderedArtifact } from './adapters.js'

const releaseSchema = z.object({
  apiVersion: z.literal(V2_API_VERSION),
  kind: z.literal('Release'),
  metadata: z.object({
    name: z.string(),
    revision: z.number().int(),
    status: z.enum(['deployed', 'failed']),
    generatedAt: z.string().optional()
  }),
  spec: z.object({
    package: z.object({ name: z.string(), version: z.string().optional() }),
    lockFile: z.string(),
    adapters: z.array(z.string()).default([])
  }),
  artifacts: z.array(z.object({ path: z.string(), sha256: z.string() })).default([]),
  history: z.object({ previousRevision: z.number().int().nullable() })
})
export type PilotRelease = z.infer<typeof releaseSchema>

const artifactsSchema = z.object({
  artifacts: z.array(z.object({
    path: z.string(), block: z.string(), wholeFile: z.boolean(), checksumSha256: z.string()
  }))
})

export const releasePath = (projectRoot: string): string => join(projectRoot, '.pilot', 'release.yaml')
const historyDir = (projectRoot: string, revision: number): string =>
  join(projectRoot, '.pilot', 'history', String(revision))

export function readRelease(projectRoot: string): PilotRelease | null {
  const file = releasePath(projectRoot)
  if (!existsSync(file)) return null
  try { return releaseSchema.parse(parse(readFileSync(file, 'utf8'))) }
  catch (e) {
    throw new PilotError(`'${file}'이 손상되었습니다: ${(e as Error).message}`,
      'pilot release install 또는 upgrade 로 재생성하세요')
  }
}

export function writeRelease(projectRoot: string, release: PilotRelease): void {
  mkdirSync(join(projectRoot, '.pilot'), { recursive: true })
  writeFileSync(releasePath(projectRoot), stringify(release))
}

/** revision별 release 스냅샷·렌더 블록 원문·effective values·lock을 보존한다 — rollback과 locked-field 비교의 원본 */
export function saveHistory(
  projectRoot: string, release: PilotRelease, artifacts: RenderedArtifact[],
  values: Record<string, unknown>, lock?: unknown
): void {
  const dir = historyDir(projectRoot, release.metadata.revision)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'release.yaml'), stringify(release))
  writeFileSync(join(dir, 'artifacts.yaml'), stringify({ artifacts }))
  writeFileSync(join(dir, 'values.yaml'), stringify({ values }))
  if (lock !== undefined) writeFileSync(join(dir, 'lock.yaml'), stringify(lock))
}

/** 이전 revision의 effective values. history가 없으면(fresh clone 등) null — 빈 values와 구분해야
 *  locked-field 비교가 조작된 기준값으로 통과/실패하지 않는다 */
export function loadHistoryValues(projectRoot: string, revision: number): Record<string, unknown> | null {
  const file = join(historyDir(projectRoot, revision), 'values.yaml')
  if (!existsSync(file)) return null
  const parsed = parse(readFileSync(file, 'utf8')) as { values?: Record<string, unknown> } | null
  return parsed?.values ?? {}
}

export function loadHistoryLock(projectRoot: string, revision: number): unknown | null {
  const file = join(historyDir(projectRoot, revision), 'lock.yaml')
  return existsSync(file) ? parse(readFileSync(file, 'utf8')) : null
}

export function loadHistoryRelease(projectRoot: string, revision: number): PilotRelease {
  const file = join(historyDir(projectRoot, revision), 'release.yaml')
  if (!existsSync(file)) {
    throw new PilotError(`revision ${revision}의 history가 없습니다`, 'pilot release history <name> 로 revision을 확인하세요')
  }
  return releaseSchema.parse(parse(readFileSync(file, 'utf8')))
}

/** revision 목록 — 일부 revision이 손상돼도 목록 자체는 계속 제공한다(진단용 명령이므로) */
export function listHistory(projectRoot: string): { releases: PilotRelease[]; warnings: string[] } {
  const dir = join(projectRoot, '.pilot', 'history')
  if (!existsSync(dir)) return { releases: [], warnings: [] }
  const revisions = readdirSync(dir).map(Number).filter(Number.isInteger).sort((a, b) => a - b)
  const releases: PilotRelease[] = []
  const warnings: string[] = []
  for (const rev of revisions) {
    const file = join(historyDir(projectRoot, rev), 'release.yaml')
    if (!existsSync(file)) continue
    try { releases.push(releaseSchema.parse(parse(readFileSync(file, 'utf8')))) }
    catch (e) { warnings.push(`revision ${rev} 기록이 손상되어 건너뜀: ${(e as Error).message}`) }
  }
  return { releases, warnings }
}

export function loadHistoryArtifacts(projectRoot: string, revision: number): RenderedArtifact[] {
  const file = join(historyDir(projectRoot, revision), 'artifacts.yaml')
  if (!existsSync(file)) {
    throw new PilotError(`revision ${revision}의 history가 없습니다`, 'pilot release history <name> 로 revision을 확인하세요')
  }
  return artifactsSchema.parse(parse(readFileSync(file, 'utf8'))).artifacts
}

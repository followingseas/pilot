import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { ManifestError } from './errors.js'

export const SCOPES = ['organization', 'repository', 'project-local', 'personal'] as const
export type Scope = (typeof SCOPES)[number]

const schema = z.looseObject({
  version: z.literal(1),
  name: z.string().min(1),
  scope: z.enum(SCOPES),
  paths: z.object({
    conventions: z.string().optional(),
    charts: z.string().optional(),
    wiki: z.array(z.string()).optional()
  }).default({}),
  repositories: z.array(z.object({ id: z.string(), remote: z.string() })).default([]),
  priority: z.number().int().default(0)
}) // team, depends_on 등 예약 키 허용(무시)

export type RutterManifest = z.infer<typeof schema>
export type RepoEntry = RutterManifest['repositories'][number]

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
  return parsed.data
}

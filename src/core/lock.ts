import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import type { RutterSource } from './source.js'
import { synthesize } from './synthesize.js'
import { digestItems } from './digest.js'
import { runGit, redactCredentials } from './git.js'
import { V2_API_VERSION } from './manifest.js'

const lockSchema = z.object({
  apiVersion: z.literal(V2_API_VERSION),
  kind: z.literal('Lock'),
  release: z.object({
    name: z.string(),
    package: z.string(),
    version: z.string().optional(),
    revision: z.number().int()
  }),
  resolved: z.object({
    sources: z.array(z.object({
      id: z.string(), kind: z.string(), location: z.string(), digest: z.string()
    })),
    dependencies: z.array(z.object({
      name: z.string(), version: z.string().optional(), digest: z.string()
    })).default([])
  }),
  values: z.object({
    files: z.array(z.string()).default([]),
    effectiveDigest: z.string()
  }),
  lockedFields: z.array(z.string()).default([]),
  generatedAt: z.string()
})
export type RutterLock = z.infer<typeof lockSchema>

export const lockPath = (projectRoot: string): string => join(projectRoot, '.pilot', 'rutter.lock')

/**
 * source의 exact 상태 digest.
 * git source는 캐시 HEAD sha, 그 외에는 문서·manifest·defaults·policies 내용 기반 content digest.
 */
export function computeSourceDigest(source: RutterSource): string {
  if (source.kind === 'git') {
    try { return `git:${runGit(['rev-parse', 'HEAD'], { cwd: source.rootDir })}` }
    catch { /* git 메타데이터가 없는 캐시 — content digest로 폴백 */ }
  }
  const items = synthesize([source], null).items.map(i => ({ key: i.key, content: i.content }))
  // 문서 외 변경(manifest·defaults·policies)도 lock drift로 잡히도록 digest에 포함한다
  items.push({ key: 'rutter.yaml', content: readFileSync(join(source.rootDir, 'rutter.yaml'), 'utf8') })
  const m = source.manifest
  if (m.defaultsFile && existsSync(join(source.rootDir, m.defaultsFile))) {
    items.push({ key: m.defaultsFile, content: readFileSync(join(source.rootDir, m.defaultsFile), 'utf8') })
  }
  if (m.policiesDir && existsSync(join(source.rootDir, m.policiesDir))) {
    for (const name of readdirSync(join(source.rootDir, m.policiesDir)).filter(n => /\.ya?ml$/i.test(n))) {
      items.push({
        key: `${m.policiesDir}/${name}`,
        content: readFileSync(join(source.rootDir, m.policiesDir, name), 'utf8')
      })
    }
  }
  return `sha256:${digestItems(items)}`
}

export interface BuildLockInput {
  releaseName: string
  pkg: { name: string; version?: string }
  revision: number
  sources: { source: RutterSource; location: string }[]
  dependencies: { name: string; version?: string; digest: string }[]
  valuesFiles: string[]
  valuesDigest: string
  lockedFields: string[]
}

export function buildLock(input: BuildLockInput): RutterLock {
  return {
    apiVersion: V2_API_VERSION,
    kind: 'Lock',
    release: {
      name: input.releaseName, package: input.pkg.name,
      version: input.pkg.version, revision: input.revision
    },
    resolved: {
      sources: input.sources.map(({ source, location }) => ({
        id: source.id, kind: source.kind,
        location: redactCredentials(location),
        digest: computeSourceDigest(source)
      })),
      dependencies: input.dependencies
    },
    values: { files: input.valuesFiles, effectiveDigest: input.valuesDigest },
    lockedFields: input.lockedFields,
    generatedAt: new Date().toISOString()
  }
}

export function readLock(projectRoot: string): RutterLock | null {
  const file = lockPath(projectRoot)
  if (!existsSync(file)) return null
  return lockSchema.parse(parse(readFileSync(file, 'utf8')))
}

export function writeLock(projectRoot: string, lock: RutterLock): void {
  mkdirSync(join(projectRoot, '.pilot'), { recursive: true })
  writeFileSync(lockPath(projectRoot), stringify(lock))
}

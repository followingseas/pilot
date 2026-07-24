import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import type { RutterSource } from './source.js'
import { synthesize } from './synthesize.js'
import { digestItems } from './digest.js'
import { runGit, redactCredentials } from './git.js'
import { V2_API_VERSION } from './manifest.js'
import { resolveWithin } from './paths.js'
import { PilotError } from './errors.js'

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
  if (source.kind === 'git' && existsSync(join(source.rootDir, '.git'))) {
    // git 실행 실패를 삼키고 content digest로 폴백하면 환경에 따라 digest 형식이 갈라진다 — 실패는 실패로 보고
    try { return `git:${runGit(['rev-parse', 'HEAD'], { cwd: source.rootDir })}` }
    catch (e) {
      throw new PilotError(`source '${source.id}' git digest 계산 실패: ${redactCredentials((e as Error).message)}`)
    }
  }
  const items = synthesize([source], null).items.map(i => ({ key: i.key, content: i.content }))
  // 문서 외 변경(manifest·defaults·policies)도 lock drift로 잡히도록 digest에 포함한다.
  // manifest 유래 경로는 resolveWithin으로 소스 루트 안으로 강제한다
  items.push({ key: 'rutter.yaml', content: readFileSync(join(source.rootDir, 'rutter.yaml'), 'utf8') })
  const m = source.manifest
  if (m.defaultsFile) {
    const abs = resolveWithin(source.rootDir, m.defaultsFile)
    if (existsSync(abs)) items.push({ key: m.defaultsFile, content: readFileSync(abs, 'utf8') })
  }
  if (m.policiesDir) {
    const dir = resolveWithin(source.rootDir, m.policiesDir)
    if (existsSync(dir)) {
      for (const name of readdirSync(dir).filter(n => /\.ya?ml$/i.test(n))) {
        items.push({
          key: `${m.policiesDir}/${name}`,
          content: readFileSync(resolveWithin(source.rootDir, join(m.policiesDir, name)), 'utf8')
        })
      }
    }
  }
  return `sha256:${digestItems(items)}`
}

export interface BuildLockInput {
  releaseName: string
  pkg: { name: string; version?: string }
  revision: number
  /** digest를 이미 계산했으면 전달 — content digest는 synthesize 전체 패스라 재계산이 비싸다 */
  sources: { source: RutterSource; location: string; digest?: string }[]
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
      sources: input.sources.map(({ source, location, digest }) => ({
        id: source.id, kind: source.kind,
        location: redactCredentials(location),
        digest: digest ?? computeSourceDigest(source)
      })),
      dependencies: input.dependencies
    },
    values: { files: input.valuesFiles, effectiveDigest: input.valuesDigest },
    lockedFields: input.lockedFields,
    generatedAt: new Date().toISOString()
  }
}

export const parseLock = (data: unknown): RutterLock => lockSchema.parse(data)

export function readLock(projectRoot: string): RutterLock | null {
  const file = lockPath(projectRoot)
  if (!existsSync(file)) return null
  try { return lockSchema.parse(parse(readFileSync(file, 'utf8'))) }
  catch (e) {
    throw new PilotError(`'${file}'이 손상되었습니다: ${(e as Error).message}`,
      'pilot release install 또는 upgrade 로 재생성하세요')
  }
}

export function writeLock(projectRoot: string, lock: RutterLock): void {
  mkdirSync(join(projectRoot, '.pilot'), { recursive: true })
  writeFileSync(lockPath(projectRoot), stringify(lock))
}

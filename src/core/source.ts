import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Connection } from './config.js'
import { parseManifest, type RutterManifest } from './manifest.js'
import { sourceCacheDir } from './paths.js'
import { PilotError } from './errors.js'
import { redactCredentials } from './git.js'

export interface RutterSource {
  id: string; kind: 'local' | 'git' | 'project'
  rootDir: string; manifest: RutterManifest; priority: number
}

export function loadSource(conn: Connection): RutterSource {
  const rootDir = conn.kind === 'local' ? conn.location : sourceCacheDir(conn.id)
  if (!existsSync(rootDir)) {
    throw new PilotError(`source '${conn.id}' 캐시가 없습니다`, `pilot sync ${conn.id} 를 실행하세요`)
  }
  const manifest = parseManifest(rootDir)
  return { id: conn.id, kind: conn.kind, rootDir, manifest, priority: conn.priority ?? manifest.priority }
}

export function cloneSource(conn: Connection): void {
  const dest = sourceCacheDir(conn.id)
  if (existsSync(dest)) return
  const tmp = `${dest}.tmp-${process.pid}`
  mkdirSync(dirname(dest), { recursive: true })
  try {
    execFileSync('git', ['clone', '--depth', '1', conn.location, tmp], { stdio: ['ignore', 'ignore', 'pipe'] })
    renameSync(tmp, dest)   // 성공 시에만 원자적으로 캐시 반영
  } catch (e) {
    throw new PilotError(`source clone 실패: ${redactCredentials((e as Error).message)}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function fetchSource(conn: Connection): void {
  const dest = sourceCacheDir(conn.id)
  if (!existsSync(dest)) { cloneSource(conn); return }
  try {
    // fetch 성공 후에만 reset — 실패하면 기존 캐시 불변
    execFileSync('git', ['fetch', '--depth', '1', 'origin'], { cwd: dest, stdio: ['ignore', 'ignore', 'pipe'] })
    execFileSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: dest, stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    throw new PilotError(`source fetch 실패: ${redactCredentials((e as Error).message)}`)
  }
}

export function loadProjectSource(projectRoot: string): RutterSource | null {
  const dir = join(projectRoot, '.rutter')
  if (!existsSync(join(dir, 'rutter.yaml'))) return null
  const manifest = parseManifest(dir)
  return { id: 'project-local', kind: 'project', rootDir: dir, manifest, priority: manifest.priority }
}

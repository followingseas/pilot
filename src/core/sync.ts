import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { PilotConfig } from './config.js'
import { fetchSource } from './source.js'
import { sourceCacheDir, cacheDir } from './paths.js'

const stampFile = (id: string) => join(sourceCacheDir(id), '.pilot-synced-at')

export function lastSyncAt(id: string): number | null {
  const f = stampFile(id)
  if (!existsSync(f)) return null
  const n = Number(readFileSync(f, 'utf8'))
  return Number.isFinite(n) ? n : null
}

export function shouldRevalidate(lastMs: number | null, ttlHours: number, nowMs: number): boolean {
  return lastMs === null || nowMs - lastMs > ttlHours * 3600_000
}

export function syncNow(config: PilotConfig, id?: string) {
  const targets = config.connections.filter(c => c.kind === 'git' && (!id || c.id === id))
  const synced: string[] = []
  const failed: { id: string; error: string }[] = []
  if (id && targets.length === 0) {
    failed.push({ id, error: '해당 id의 git source가 없습니다' })
    return { synced, failed }
  }
  for (const conn of targets) {
    try {
      fetchSource(conn)
      writeFileSync(stampFile(conn.id), String(Date.now()))
      synced.push(conn.id)
    } catch (e) {
      failed.push({ id: conn.id, error: (e as Error).message })  // 실패해도 캐시 보존, 다음 소스 계속
    }
  }
  return { synced, failed }
}

export function maybeRevalidateInBackground(config: PilotConfig): void {
  if (config.syncPolicy !== 'auto') return
  const stale = config.connections.some(c =>
    c.kind === 'git' && shouldRevalidate(lastSyncAt(c.id), config.syncTtlHours, Date.now()))
  if (!stale) return
  const lock = join(cacheDir(), 'sync.lock')
  mkdirSync(cacheDir(), { recursive: true })
  if (existsSync(lock)) {
    if (Date.now() - statSync(lock).mtimeMs < 10 * 60_000) return
    rmSync(lock, { force: true })
  }
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }) }
  catch { return }   // 다른 프로세스가 선점

  const entry = process.argv[1]
  if (!entry) return                       // 엔트리 불명이면 spawn하지 않음
  const child = spawn(process.execPath, [...process.execArgv, entry, 'sync'], {
    detached: true, stdio: 'ignore'
  })
  child.unref()
}

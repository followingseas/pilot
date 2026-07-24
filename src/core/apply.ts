import { mkdirSync, existsSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectProject } from './git.js'
import { resolveRelease, type ResolvedRelease } from './engine.js'
import { applyArtifacts, removeStaleArtifacts, type RenderedArtifact } from './adapters.js'
import { writeLock, readLock, type RutterLock } from './lock.js'
import { readRelease, writeRelease, saveHistory, loadHistoryValues, type PilotRelease } from './release.js'
import { checkLockedFields } from './values.js'
import { API_VERSION } from './manifest.js'
import { PilotError } from './errors.js'

export interface ApplyOptions {
  valuesFiles?: string[]
  set?: string[]
  approveLockedFieldChange?: boolean
}

export interface ApplyResult {
  release: PilotRelease
  written: string[]
  removed: string[]
  warnings: string[]
  revision: number
  created: boolean
}

export function buildReleaseState(
  revision: number, previousRevision: number | null, resolved: ResolvedRelease
): PilotRelease {
  return {
    apiVersion: API_VERSION,
    kind: 'Release',
    metadata: { name: resolved.releaseName, revision, status: 'deployed', generatedAt: new Date().toISOString() },
    spec: {
      package: { name: resolved.pkg.manifest.name, version: resolved.pkg.manifest.version },
      lockFile: '.pilot/rutter.lock',
      adapters: (['claude', 'codex', 'copilot'] as const).filter(a => resolved.pkg.manifest.adapters[a].enabled)
    },
    artifacts: resolved.artifacts.map(a => ({ path: a.path, sha256: a.checksumSha256 })),
    history: { previousRevision }
  }
}

// 쓰기 순서: history 스냅샷 → 산출물 → stale 정리 → lock·release(상태 파일 마지막).
// 중간 실패 시 상태 파일은 이전 revision을 유지하므로 재실행으로 복구된다.
// 이 순서는 crash-recovery 보장을 인코딩하므로 apply와 rollback이 반드시 이 함수 하나를 공유한다
export function commitRelease(
  projectRoot: string, release: PilotRelease, artifacts: RenderedArtifact[],
  values: Record<string, unknown>, lock: RutterLock, previousArtifactPaths: string[] | null
): { written: string[]; removed: string[] } {
  saveHistory(projectRoot, release, artifacts, values, lock)
  const written = applyArtifacts(projectRoot, artifacts)
  const removed = previousArtifactPaths
    ? removeStaleArtifacts(projectRoot, previousArtifactPaths, release.artifacts.map(a => a.path))
    : []
  writeLock(projectRoot, lock)
  writeRelease(projectRoot, release)
  return { written, removed }
}

/** 이전 revision의 values 이력과 대조해 locked field 변경을 막는다.
 *  fresh clone 등으로 이력이 없으면 이전 lock의 effective digest로 폴백한다 */
function guardLockedFields(resolved: ResolvedRelease, prev: PilotRelease, approve: boolean): void {
  if (resolved.lockedFields.length === 0) return
  const prevValues = loadHistoryValues(resolved.projectRoot, prev.metadata.revision)
  if (prevValues !== null) {
    const changed = checkLockedFields(prevValues, resolved.values, resolved.lockedFields)
    if (changed.length > 0 && !approve) {
      throw new PilotError(`locked field가 변경되었습니다: ${changed.join(', ')}`,
        '--approve-locked-field-change 로 명시 승인 후 다시 실행하세요')
    }
    return
  }
  const prevLock = readLock(resolved.projectRoot)
  const unchanged = prevLock !== null && prevLock.values.effectiveDigest === resolved.valuesDigest
  if (!unchanged && !approve) {
    throw new PilotError(
      `values가 변경되었으나 이전 revision의 values 이력이 없어 locked field(${resolved.lockedFields.join(', ')}) 변경 여부를 확인할 수 없습니다`,
      '변경 내용을 확인한 뒤 --approve-locked-field-change 로 승인하세요')
  }
}

const APPLY_LOCK_STALE_MS = 60_000

// read-revision → commit 사이를 프로젝트 스코프로 직렬화한다 — 동시 apply 두 개가 같은 revision을
// 읽어 서로의 산출물·lock·release를 뒤섞는 것을 막는다(best-effort, 단일 머신 기준)
function acquireApplyLock(projectRoot: string): string {
  const pilotDir = join(projectRoot, '.pilot')
  mkdirSync(pilotDir, { recursive: true })
  const lock = join(pilotDir, 'apply.lock')
  if (existsSync(lock)) {
    if (Date.now() - statSync(lock).mtimeMs < APPLY_LOCK_STALE_MS) {
      throw new PilotError('다른 apply가 진행 중입니다',
        '완료를 기다리거나, 중단된 apply라면 .pilot/apply.lock 을 삭제하세요')
    }
    rmSync(lock, { force: true }) // 오래된 락은 회수
  }
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }) }
  catch { throw new PilotError('다른 apply가 방금 시작되었습니다 — 잠시 후 다시 시도하세요') }
  return lock
}

/**
 * 릴리스를 프로젝트에 적용한다 — install이든 upgrade든 멱등하게 revision을 증가시킨다.
 * 이전 release가 있으면 locked-field 게이트를 거친다. pilot apply와 pilot init이 공유한다.
 * read-revision부터 commit까지 apply.lock으로 직렬화한다.
 */
export function applyRelease(cwd: string, opts: ApplyOptions): ApplyResult {
  const detected = detectProject(cwd)
  if (!detected) throw new PilotError('git 프로젝트가 아닙니다', 'git repo 루트에서 실행하세요')
  const lock = acquireApplyLock(detected.root)
  try {
    const prev = readRelease(detected.root)
    const revision = (prev?.metadata.revision ?? 0) + 1

    const resolved = resolveRelease(cwd, {
      valuesFiles: opts.valuesFiles, set: opts.set, revision, releaseName: prev?.metadata.name
    })
    if (prev) guardLockedFields(resolved, prev, opts.approveLockedFieldChange ?? false)

    const release = buildReleaseState(revision, prev?.metadata.revision ?? null, resolved)
    try {
      const { written, removed } = commitRelease(
        resolved.projectRoot, release, resolved.artifacts, resolved.values, resolved.lock,
        prev ? prev.artifacts.map(a => a.path) : null)
      return { release, written, removed, warnings: resolved.warnings, revision, created: !prev }
    } catch (e) {
      throw new PilotError(
        `적용 중 실패 — 프로젝트 파일이 부분적으로 갱신되었을 수 있습니다: ${(e as Error).message}`,
        '원인 해결 후 pilot apply 를 다시 실행하면 상태가 복구됩니다')
    }
  } finally {
    rmSync(lock, { force: true })
  }
}

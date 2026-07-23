import type { Command } from 'commander'
import { resolveRelease, type ResolvedRelease } from '../../core/engine.js'
import { applyArtifacts, removeStaleArtifacts, type RenderedArtifact } from '../../core/adapters.js'
import { writeLock, readLock, parseLock } from '../../core/lock.js'
import {
  readRelease, writeRelease, saveHistory, listHistory,
  loadHistoryArtifacts, loadHistoryValues, loadHistoryRelease, loadHistoryLock, type PilotRelease
} from '../../core/release.js'
import { checkLockedFields } from '../../core/values.js'
import { V2_API_VERSION } from '../../core/manifest.js'
import { detectProject } from '../../core/git.js'
import { PilotError } from '../../core/errors.js'

const collect = (v: string, prev: string[]): string[] => [...prev, v]

function projectRootOf(cwd: string): string {
  const detected = detectProject(cwd)
  if (!detected) throw new PilotError('git 프로젝트가 아닙니다', 'git repo 루트에서 실행하세요')
  return detected.root
}

function requireInstalled(projectRoot: string, name: string): PilotRelease {
  const release = readRelease(projectRoot)
  if (!release) throw new PilotError('설치된 release가 없습니다', 'pilot release install 을 먼저 실행하세요')
  if (release.metadata.name !== name) {
    throw new PilotError(`설치된 release는 '${release.metadata.name}'입니다 — '${name}'이 아닙니다`,
      `pilot release <command> ${release.metadata.name} 으로 실행하세요`)
  }
  return release
}

const printWarnings = (warnings: string[]): void => {
  for (const w of warnings) console.error(`경고: ${w}`)
}

interface ResolveFlags { values: string[]; set: string[] }

function buildReleaseState(
  name: string, revision: number, previousRevision: number | null, resolved: ResolvedRelease
): PilotRelease {
  return {
    apiVersion: V2_API_VERSION,
    kind: 'Release',
    metadata: { name, revision, status: 'deployed', generatedAt: new Date().toISOString() },
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
// 중간 실패 시 상태 파일은 이전 revision을 유지하므로 재실행으로 복구된다
function deploy(
  name: string, revision: number, previous: PilotRelease | null, resolved: ResolvedRelease
): void {
  printWarnings(resolved.warnings)
  const release = buildReleaseState(name, revision, previous?.metadata.revision ?? null, resolved)
  try {
    saveHistory(resolved.projectRoot, release, resolved.artifacts, resolved.values, resolved.lock)
    const written = applyArtifacts(resolved.projectRoot, resolved.artifacts)
    const removed = previous
      ? removeStaleArtifacts(resolved.projectRoot, previous.artifacts.map(a => a.path), release.artifacts.map(a => a.path))
      : []
    writeLock(resolved.projectRoot, resolved.lock)
    writeRelease(resolved.projectRoot, release)
    console.log(`✓ release '${name}' revision ${revision} 배포`)
    console.log(`✓ 산출물: ${written.join(', ')}`)
    if (removed.length > 0) console.log(`✓ 이전 revision 산출물 정리: ${removed.join(', ')}`)
  } catch (e) {
    throw new PilotError(
      `release 배포 중 실패 — 프로젝트 파일이 부분적으로 갱신되었을 수 있습니다: ${(e as Error).message}`,
      '원인 해결 후 pilot release install/upgrade 를 다시 실행하면 상태가 복구됩니다')
  }
}

export function registerRelease(program: Command): void {
  const release = program.command('release').description('정책 릴리스 라이프사이클 (install/template/upgrade/rollback/history)')

  release.command('install <name>')
    .description('릴리스 최초 설치 — 렌더·lock·release 기록')
    .option('--values <file>', 'values 파일 (반복 가능)', collect, [] as string[])
    .option('--set <k=v>', '값 오버라이드 (반복 가능)', collect, [] as string[])
    .action((name: string, opts: ResolveFlags) => {
      const resolved = resolveRelease(process.cwd(), name, { valuesFiles: opts.values, set: opts.set, revision: 1 })
      const existing = readRelease(resolved.projectRoot)
      if (existing) {
        throw new PilotError(`release '${existing.metadata.name}'가 이미 설치되어 있습니다 (revision ${existing.metadata.revision})`,
          'pilot release upgrade 를 사용하세요')
      }
      deploy(name, 1, null, resolved)
    })

  release.command('template <name>')
    .description('dry-run 렌더 — 파일을 쓰지 않고 산출물을 출력')
    .option('--values <file>', 'values 파일 (반복 가능)', collect, [] as string[])
    .option('--set <k=v>', '값 오버라이드 (반복 가능)', collect, [] as string[])
    .action((name: string, opts: ResolveFlags) => {
      const cwd = process.cwd()
      const probe = readRelease(projectRootOf(cwd))
      const revision = (probe?.metadata.revision ?? 0) + 1
      const resolved = resolveRelease(cwd, name, { valuesFiles: opts.values, set: opts.set, revision })
      printWarnings(resolved.warnings)
      for (const a of resolved.artifacts) {
        console.log(`--- ${a.path} (sha256:${a.checksumSha256.slice(0, 12)}) ---`)
        console.log(a.block)
        console.log()
      }
    })

  release.command('upgrade <name>')
    .description('릴리스 업데이트 — revision 증가, locked field 변경은 승인 필요')
    .option('--values <file>', 'values 파일 (반복 가능)', collect, [] as string[])
    .option('--set <k=v>', '값 오버라이드 (반복 가능)', collect, [] as string[])
    .option('--approve-locked-field-change', 'locked field 변경 승인')
    .action((name: string, opts: ResolveFlags & { approveLockedFieldChange?: boolean }) => {
      const prev = requireInstalled(projectRootOf(process.cwd()), name)
      const revision = prev.metadata.revision + 1
      const resolved = resolveRelease(process.cwd(), name, { valuesFiles: opts.values, set: opts.set, revision })

      const prevValues = loadHistoryValues(resolved.projectRoot, prev.metadata.revision)
      if (prevValues !== null) {
        const changed = checkLockedFields(prevValues, resolved.values, resolved.lockedFields)
        if (changed.length > 0 && !opts.approveLockedFieldChange) {
          throw new PilotError(`locked field가 변경되었습니다: ${changed.join(', ')}`,
            '--approve-locked-field-change 로 명시 승인 후 다시 실행하세요')
        }
      } else if (resolved.lockedFields.length > 0) {
        // fresh clone 등으로 values history가 없으면 개별 필드 비교가 불가능하다.
        // 이전 lock의 effective digest와 같으면 locked field도 변하지 않은 것이므로 통과
        const prevLock = readLock(resolved.projectRoot)
        const unchanged = prevLock !== null && prevLock.values.effectiveDigest === resolved.valuesDigest
        if (!unchanged && !opts.approveLockedFieldChange) {
          throw new PilotError(
            `values가 변경되었으나 이전 revision의 values 이력이 없어 locked field(${resolved.lockedFields.join(', ')}) 변경 여부를 확인할 수 없습니다`,
            '변경 내용을 확인한 뒤 --approve-locked-field-change 로 승인하세요')
        }
      }
      deploy(name, revision, prev, resolved)
    })

  release.command('rollback <name>')
    .description('이전 revision의 산출물·lock 복원 (새 revision으로 기록)')
    .requiredOption('--to-revision <n>', '복원할 revision')
    .action((name: string, opts: { toRevision: string }) => {
      const projectRoot = projectRootOf(process.cwd())
      const current = requireInstalled(projectRoot, name)
      const target = Number(opts.toRevision)
      if (!Number.isInteger(target) || target < 1) throw new PilotError(`잘못된 revision: ${opts.toRevision}`)

      // 복원에 필요한 기록을 전부 읽은 뒤에만 상태를 바꾼다 — 누락된 기록은 부분 롤백 대신 즉시 실패
      const artifacts: RenderedArtifact[] = loadHistoryArtifacts(projectRoot, target)
      const targetRelease = loadHistoryRelease(projectRoot, target)
      const rawLock = loadHistoryLock(projectRoot, target)
      const targetValues = loadHistoryValues(projectRoot, target)
      if (!rawLock || targetValues === null) {
        throw new PilotError(`revision ${target}의 lock/values 기록이 없어 롤백할 수 없습니다`,
          'pilot release history 로 온전한 revision을 확인하세요')
      }
      const lock = parseLock(rawLock)
      const revision = current.metadata.revision + 1
      lock.release.revision = revision

      const release: PilotRelease = {
        ...targetRelease,
        metadata: { ...targetRelease.metadata, revision, generatedAt: new Date().toISOString() },
        history: { previousRevision: current.metadata.revision }
      }
      try {
        saveHistory(projectRoot, release, artifacts, targetValues, lock)
        applyArtifacts(projectRoot, artifacts)
        removeStaleArtifacts(projectRoot, current.artifacts.map(a => a.path), release.artifacts.map(a => a.path))
        writeLock(projectRoot, lock)
        writeRelease(projectRoot, release)
      } catch (e) {
        throw new PilotError(
          `rollback 중 실패 — 프로젝트 파일이 부분적으로 갱신되었을 수 있습니다: ${(e as Error).message}`,
          '원인 해결 후 다시 실행하면 상태가 복구됩니다')
      }
      console.log(`✓ revision ${target}의 산출물로 롤백 — 새 revision ${revision}`)
    })

  release.command('history <name>')
    .description('revision 목록')
    .action((name: string) => {
      const projectRoot = projectRootOf(process.cwd())
      const installed = readRelease(projectRoot)
      if (installed && installed.metadata.name !== name) {
        throw new PilotError(`설치된 release는 '${installed.metadata.name}'입니다 — '${name}'이 아닙니다`)
      }
      const { releases, warnings } = listHistory(projectRoot)
      printWarnings(warnings)
      if (releases.length === 0) { console.log('history가 없습니다'); return }
      for (const r of releases) {
        const pkg = `${r.spec.package.name}${r.spec.package.version ? `@${r.spec.package.version}` : ''}`
        console.log(`${r.metadata.revision}\t${pkg}\t${r.metadata.status}\tprev=${r.history.previousRevision ?? '-'}`)
      }
    })
}

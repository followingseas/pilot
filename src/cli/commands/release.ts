import type { Command } from 'commander'
import { resolveRelease, type ResolvedRelease } from '../../core/engine.js'
import { applyArtifacts, type RenderedArtifact } from '../../core/adapters.js'
import { writeLock, parseLock } from '../../core/lock.js'
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

function deploy(name: string, revision: number, previousRevision: number | null, resolved: ResolvedRelease): void {
  const release = buildReleaseState(name, revision, previousRevision, resolved)
  const written = applyArtifacts(resolved.projectRoot, resolved.artifacts)
  writeLock(resolved.projectRoot, resolved.lock)
  writeRelease(resolved.projectRoot, release)
  saveHistory(resolved.projectRoot, release, resolved.artifacts, resolved.values, resolved.lock)
  console.log(`✓ release '${name}' revision ${revision} 배포`)
  console.log(`✓ 산출물: ${written.join(', ')}`)
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
      const prev = readRelease(projectRootOf(process.cwd()))
      if (!prev) throw new PilotError('설치된 release가 없습니다', 'pilot release install 을 먼저 실행하세요')
      const revision = prev.metadata.revision + 1
      const resolved = resolveRelease(process.cwd(), name, { valuesFiles: opts.values, set: opts.set, revision })

      const prevValues = loadHistoryValues(resolved.projectRoot, prev.metadata.revision)
      const changed = checkLockedFields(prevValues, resolved.values, resolved.lockedFields)
      if (changed.length > 0 && !opts.approveLockedFieldChange) {
        throw new PilotError(`locked field가 변경되었습니다: ${changed.join(', ')}`,
          '--approve-locked-field-change 로 명시 승인 후 다시 실행하세요')
      }
      deploy(name, revision, prev.metadata.revision, resolved)
    })

  release.command('rollback <name>')
    .description('이전 revision의 산출물·lock 복원 (새 revision으로 기록)')
    .requiredOption('--to-revision <n>', '복원할 revision')
    .action((name: string, opts: { toRevision: string }) => {
      const projectRoot = projectRootOf(process.cwd())
      const current = readRelease(projectRoot)
      if (!current) throw new PilotError('설치된 release가 없습니다', 'pilot release install 을 먼저 실행하세요')
      const target = Number(opts.toRevision)
      if (!Number.isInteger(target) || target < 1) throw new PilotError(`잘못된 revision: ${opts.toRevision}`)
      const artifacts: RenderedArtifact[] = loadHistoryArtifacts(projectRoot, target)
      const targetRelease = loadHistoryRelease(projectRoot, target)
      const revision = current.metadata.revision + 1

      applyArtifacts(projectRoot, artifacts)
      const rawLock = loadHistoryLock(projectRoot, target)
      if (rawLock) {
        const lock = parseLock(rawLock)
        lock.release.revision = revision
        writeLock(projectRoot, lock)
      }
      const release: PilotRelease = {
        ...targetRelease,
        metadata: { ...targetRelease.metadata, revision, generatedAt: new Date().toISOString() },
        history: { previousRevision: current.metadata.revision }
      }
      writeRelease(projectRoot, release)
      saveHistory(projectRoot, release, artifacts, loadHistoryValues(projectRoot, target), rawLock ?? undefined)
      console.log(`✓ revision ${target}의 산출물로 롤백 — 새 revision ${revision}`)
    })

  release.command('history <name>')
    .description('revision 목록')
    .action(() => {
      const rows = listHistory(projectRootOf(process.cwd()))
      if (rows.length === 0) { console.log('history가 없습니다'); return }
      for (const r of rows) {
        const pkg = `${r.spec.package.name}${r.spec.package.version ? `@${r.spec.package.version}` : ''}`
        console.log(`${r.metadata.revision}\t${pkg}\t${r.metadata.status}\tprev=${r.history.previousRevision ?? '-'}`)
      }
    })
}

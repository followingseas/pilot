import type { Command } from 'commander'
import { resolveRelease } from '../../core/engine.js'
import { applyRelease, commitRelease, type ApplyResult } from '../../core/apply.js'
import { type RenderedArtifact } from '../../core/adapters.js'
import { parseLock } from '../../core/lock.js'
import {
  readRelease, listHistory,
  loadHistoryArtifacts, loadHistoryValues, loadHistoryRelease, loadHistoryLock, type PilotRelease
} from '../../core/release.js'
import { detectProject } from '../../core/git.js'
import { PilotError } from '../../core/errors.js'

const collect = (v: string, prev: string[]): string[] => [...prev, v]
const printWarnings = (warnings: string[]): void => { for (const w of warnings) console.error(`경고: ${w}`) }

function projectRootOf(cwd: string): string {
  const detected = detectProject(cwd)
  if (!detected) throw new PilotError('git 프로젝트가 아닙니다', 'git repo 루트에서 실행하세요')
  return detected.root
}

function reportApply(r: ApplyResult): void {
  printWarnings(r.warnings)
  const verb = r.created ? '설치' : '갱신'
  console.log(`✓ '${r.release.metadata.name}' ${verb} — revision ${r.revision}`)
  console.log(`✓ 산출물: ${r.written.join(', ')}`)
  if (r.removed.length > 0) console.log(`✓ 이전 산출물 정리: ${r.removed.join(', ')}`)
}

interface ResolveFlags { values: string[]; set: string[] }

export function registerApply(program: Command): void {
  program.command('apply')
    .description('rutter를 프로젝트에 적용 — 렌더·lock·release 기록 (설치/갱신 겸용, 멱등)')
    .option('--values <file>', 'values 파일 (반복 가능)', collect, [] as string[])
    .option('--set <k=v>', '값 오버라이드 (반복 가능)', collect, [] as string[])
    .option('--approve-locked-field-change', 'locked field 변경 승인')
    .action((opts: ResolveFlags & { approveLockedFieldChange?: boolean }) => {
      reportApply(applyRelease(process.cwd(), {
        valuesFiles: opts.values, set: opts.set, approveLockedFieldChange: opts.approveLockedFieldChange
      }))
    })

  program.command('diff')
    .description('dry-run 렌더 — 파일을 쓰지 않고 산출물을 출력')
    .option('--values <file>', 'values 파일 (반복 가능)', collect, [] as string[])
    .option('--set <k=v>', '값 오버라이드 (반복 가능)', collect, [] as string[])
    .action((opts: ResolveFlags) => {
      const cwd = process.cwd()
      const prev = readRelease(projectRootOf(cwd))
      const revision = (prev?.metadata.revision ?? 0) + 1
      const resolved = resolveRelease(cwd, {
        valuesFiles: opts.values, set: opts.set, revision, releaseName: prev?.metadata.name
      })
      printWarnings(resolved.warnings)
      for (const a of resolved.artifacts) {
        console.log(`--- ${a.path} (sha256:${a.checksumSha256.slice(0, 12)}) ---`)
        console.log(a.block)
        console.log()
      }
    })

  program.command('rollback')
    .description('이전 revision의 산출물·lock 복원 (새 revision으로 기록)')
    .requiredOption('--to-revision <n>', '복원할 revision')
    .action((opts: { toRevision: string }) => {
      const projectRoot = projectRootOf(process.cwd())
      const current = readRelease(projectRoot)
      if (!current) throw new PilotError('적용된 release가 없습니다', 'pilot apply 를 먼저 실행하세요')
      const target = Number(opts.toRevision)
      if (!Number.isInteger(target) || target < 1) throw new PilotError(`잘못된 revision: ${opts.toRevision}`)

      // 복원에 필요한 기록을 전부 읽은 뒤에만 상태를 바꾼다 — 누락 시 부분 롤백 대신 즉시 실패
      const artifacts: RenderedArtifact[] = loadHistoryArtifacts(projectRoot, target)
      const targetRelease = loadHistoryRelease(projectRoot, target)
      const rawLock = loadHistoryLock(projectRoot, target)
      const targetValues = loadHistoryValues(projectRoot, target)
      if (!rawLock || targetValues === null) {
        throw new PilotError(`revision ${target}의 lock/values 기록이 없어 롤백할 수 없습니다`,
          'pilot history 로 온전한 revision을 확인하세요')
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
        commitRelease(projectRoot, release, artifacts, targetValues, lock, current.artifacts.map(a => a.path))
      } catch (e) {
        throw new PilotError(
          `rollback 중 실패 — 프로젝트 파일이 부분적으로 갱신되었을 수 있습니다: ${(e as Error).message}`,
          '원인 해결 후 다시 실행하면 상태가 복구됩니다')
      }
      console.log(`✓ revision ${target}의 산출물로 롤백 — 새 revision ${revision}`)
    })

  program.command('history')
    .description('revision 목록')
    .action(() => {
      const { releases, warnings } = listHistory(projectRootOf(process.cwd()))
      printWarnings(warnings)
      if (releases.length === 0) { console.log('history가 없습니다'); return }
      for (const r of releases) {
        const pkg = `${r.spec.package.name}${r.spec.package.version ? `@${r.spec.package.version}` : ''}`
        console.log(`${r.metadata.revision}\t${pkg}\t${r.metadata.status}\tprev=${r.history.previousRevision ?? '-'}`)
      }
    })
}

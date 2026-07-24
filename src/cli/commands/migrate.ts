import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { Command } from 'commander'
import { parseManifest, V2_API_VERSION, type RutterManifest } from '../../core/manifest.js'
import { PilotError } from '../../core/errors.js'

interface PlannedFile { path: string; content: string; overwrite: boolean }

/** v1 manifest 기반으로 v2 패키지 스켈레톤 파일 목록을 만든다 — 기존 문서는 건드리지 않는다 */
export function planMigration(dir: string): PlannedFile[] {
  const m: RutterManifest = parseManifest(dir)
  if (m.formatVersion !== 1) throw new PilotError('이미 v2 패키지입니다', '마이그레이션이 필요 없습니다')

  const manifest = {
    apiVersion: V2_API_VERSION,
    kind: 'Package',
    metadata: { name: m.name, version: '2.0.0' },
    package: { type: 'application', scope: m.scope },
    sources: {
      docs: {
        // 기존 디렉터리를 그대로 참조 — 문서 이동 없이 v2로 전환된다
        ...(m.paths.conventions ? { conventions: m.paths.conventions } : {}),
        ...(m.paths.charts ? { maps: m.paths.charts } : {}),
        ...(m.paths.wiki ? { wiki: m.paths.wiki } : {})
      },
      policies: { dir: 'policies' }
    },
    ...(m.repositories.length > 0 ? { repositories: m.repositories } : {}),
    values: { defaultsFile: 'defaults.yaml' },
    adapters: { claude: { enabled: true }, codex: { enabled: true }, copilot: { enabled: false } },
    priority: m.priority
  }

  const legacyPolicy = {
    apiVersion: V2_API_VERSION,
    kind: 'PolicySet',
    metadata: { name: 'legacy-import', version: '0.1.0' },
    spec: {
      appliesTo: { agents: ['generic'] },
      rules: [{
        id: 'legacy.review.needed',
        level: 'info',
        statement: 'v1에서 이관된 패키지입니다 — 기존 Markdown 규약을 PolicySet rule로 옮기세요.',
        rationale: '기계 검증 가능한 rule(statement+rationale+checks)로 옮겨야 validator·adapter가 활용할 수 있다.'
      }]
    }
  }

  // 비파괴 파일을 먼저, 덮어쓰는 rutter.yaml을 마지막에 — 중간 실패 시 v1 상태가 보존되어 재시도 가능
  return [
    { path: 'defaults.yaml', content: 'profile: {}\n', overwrite: false },
    { path: 'policies/legacy-import.yaml', content: stringify(legacyPolicy), overwrite: false },
    { path: 'rutter.yaml', content: stringify(manifest), overwrite: true }
  ]
}

export function registerMigrate(program: Command): void {
  const migrate = program.command('migrate').description('v1 → v2 마이그레이션 도구')
  migrate.command('package [dir]')
    .description('v1 rutter.yaml에서 v2 패키지 스켈레톤 생성 (--write 없이는 dry-run)')
    .option('--write', '파일을 실제로 기록')
    .action((dir: string | undefined, opts: { write?: boolean }) => {
      const target = dir ?? process.cwd()
      const planned = planMigration(target)
      console.log('주의: v1 rutter.yaml의 예약 키(team, depends_on 등)와 주석은 변환에서 보존되지 않습니다')
      if (!opts.write) {
        console.log('dry-run — --write 시 생성/갱신될 파일:')
        for (const f of planned) console.log(`  ${f.overwrite ? '갱신' : '생성'}: ${f.path}`)
        return
      }
      for (const f of planned) {
        const abs = join(target, f.path)
        if (!f.overwrite && existsSync(abs)) { console.log(`= 유지: ${f.path} (이미 존재)`); continue }
        mkdirSync(join(abs, '..'), { recursive: true })
        writeFileSync(abs, f.content)
        console.log(`✓ ${f.path}`)
      }
      console.log('✓ v2 전환 완료 — pilot package lint 로 확인하세요')
    })
}

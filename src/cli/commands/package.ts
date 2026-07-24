import { existsSync, readFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { parse } from 'yaml'
import type { Command } from 'commander'
import { parseManifest } from '../../core/manifest.js'
import { loadPolicySets } from '../../core/policy.js'
import { PilotError } from '../../core/errors.js'
import type { RutterSource } from '../../core/source.js'

/** 패키지 구조·schema·policy 검사 — errors가 있으면 CLI는 exit 1 */
export function lintPackage(dir: string): { errors: string[]; warnings: string[]; infos: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const infos: string[] = []

  let source: RutterSource
  try {
    source = { id: 'lint', kind: 'local', rootDir: dir, manifest: parseManifest(dir), priority: 0 }
  } catch (e) {
    if (!(e instanceof PilotError)) throw e   // 예상 밖 버그는 lint 결과로 둔갑시키지 않는다
    return { errors: [e.message], warnings, infos }
  }
  const m = source.manifest

  if (m.defaultsFile) {
    const abs = join(dir, m.defaultsFile)
    if (!existsSync(abs)) errors.push(`defaults '${m.defaultsFile}'이 없습니다`)
    else {
      try {
        const parsed = parse(readFileSync(abs, 'utf8'))
        if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
          errors.push(`'${m.defaultsFile}'은 YAML 객체여야 합니다`)
        }
      } catch (e) { errors.push(`'${m.defaultsFile}' 파싱 실패: ${(e as Error).message}`) }
    }
  }

  try {
    const sets = loadPolicySets(source)
    infos.push(`PolicySet ${sets.length}개 · rule ${sets.reduce((n, s) => n + s.rules.length, 0)}개`)
  } catch (e) {
    if (!(e instanceof PilotError)) throw e
    errors.push(e.message)
  }

  for (const [agent, cfg] of Object.entries(m.adapters)) {
    if (isAbsolute(cfg.output) || cfg.output.split(/[\\/]/).includes('..')) {
      errors.push(`adapters.${agent}.output '${cfg.output}'은 프로젝트 상대 경로여야 합니다`)
    }
  }

  for (const [rel, label] of [
    [m.paths.conventions, 'docs.conventions'],
    [m.paths.charts, 'docs.maps']
  ] as const) {
    if (rel && !existsSync(join(dir, rel))) warnings.push(`${label} 디렉터리 '${rel}'이 없습니다`)
  }

  if (m.packageType === 'library') infos.push('library 패키지 — 단독 release 불가, dependency 전용')
  return { errors, warnings, infos }
}

export function registerPackage(program: Command): void {
  const pkg = program.command('package').description('rutter 패키지 authoring 도구')
  pkg.command('lint [dir]')
    .description('패키지 구조·schema·policy 검사')
    .action((dir?: string) => {
      const target = dir ?? process.cwd()
      const { errors, warnings, infos } = lintPackage(target)
      for (const i of infos) console.log(`ℹ ${i}`)
      for (const w of warnings) console.log(`⚠ ${w}`)
      for (const e of errors) console.error(`✗ ${e}`)
      if (errors.length > 0) process.exit(1)
      console.log('✓ lint 통과')
    })
}

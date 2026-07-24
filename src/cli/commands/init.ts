import type { Command } from 'commander'
import confirm from '@inquirer/confirm'
import { loadConfig, saveConfig } from '../../core/config.js'
import { readDeclaration, writeDeclaration, declarationStatus, approveDeclaration } from '../../core/declaration.js'
import { detectProject, hasEmbeddedCredentials, isGitUrl } from '../../core/git.js'
import { cloneSource, loadSource } from '../../core/source.js'
import { applyRelease } from '../../core/apply.js'
import { PilotError } from '../../core/errors.js'

export function registerInit(program: Command): void {
  program.command('init')
    .description('프로젝트 온보딩 — 선언 생성/승인 후 rutter를 적용(apply)한다')
    .option('--source <location>', '연결할 rutter (git URL 또는 로컬 경로)')
    .option('--yes', '승인 프롬프트 생략')
    .action(async (opts: { source?: string; yes?: boolean }) => {
      const detected = detectProject(process.cwd())
      if (!detected) throw new PilotError('git 프로젝트가 아닙니다', 'git repo 루트에서 실행하세요')

      let config = loadConfig()
      let decl = readDeclaration(detected.root)
      if (decl) {
        // 남이 만든 선언 파일일 수 있으므로, 승인·연결 전에 자격증명 포함 여부를 반드시 검사한다
        if (isGitUrl(decl.source) && hasEmbeddedCredentials(decl.source)) {
          throw new PilotError('URL에 자격증명을 포함할 수 없습니다', 'git credential helper 또는 SSH 키를 사용하세요')
        }
        if (opts.source && opts.source !== decl.source) {
          console.error(`경고: .rutter.yaml이 이미 '${decl.source}'을 선언하고 있어 --source를 무시합니다`)
        }
      } else {
        if (!opts.source) throw new PilotError('.rutter.yaml이 없습니다', 'pilot init --source <url|path> 로 시작하세요')
        // .rutter.yaml(커밋 대상 파일)에 기록되기 전에 검사 — 기록 후 거부하면 자격증명이 이미 파일에 남는다
        if (isGitUrl(opts.source) && hasEmbeddedCredentials(opts.source)) {
          throw new PilotError('URL에 자격증명을 포함할 수 없습니다', 'git credential helper 또는 SSH 키를 사용하세요')
        }
        writeDeclaration(detected.root, opts.source)
        decl = { source: opts.source }
        console.log('✓ .rutter.yaml 생성')
      }

      if (declarationStatus(decl, config) === 'needs-approval') {
        const ok = opts.yes || await confirm({ message: `'${decl.source}' rutter를 연결할까요?` })
        if (!ok) throw new PilotError('연결이 승인되지 않았습니다')
        config = approveDeclaration(decl, config)
        const conn = config.connections[config.connections.length - 1]!
        if (conn.kind === 'git') cloneSource(conn)
        loadSource(conn) // manifest 파싱 확인 — 실패하면 여기서 throw되어 config에 저장되지 않는다
        saveConfig(config)
        console.log(`✓ '${conn.id}' 연결됨`)
      }

      // 온보딩 후 apply와 동일한 렌더 파이프라인을 탄다 — init과 apply가 같은 산출물을 낸다
      const result = applyRelease(process.cwd(), {})
      console.log(`✓ 적용: ${result.written.join(', ')}`)
    })
}

import type { Command } from 'commander'
import confirm from '@inquirer/confirm'
import { loadConfig, saveConfig } from '../../core/config.js'
import { readDeclaration, writeDeclaration, declarationStatus, approveDeclaration } from '../../core/declaration.js'
import { detectProject, hasEmbeddedCredentials, isGitUrl } from '../../core/git.js'
import { cloneSource, loadSource } from '../../core/source.js'
import { writeStub } from '../../core/stub.js'
import { loadAll } from '../load.js'
import { PilotError } from '../../core/errors.js'

export function registerInit(program: Command): void {
  program.command('init')
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
      // 방금 승인/연결한 source의 id — 스텁 문구에 그 manifest name을 우선 사용하기 위함
      // (sources 배열의 순서는 합성 강도순이 아닐 수 있어 sources[0]만으로는 의도한 소스가 아닐 수 있다)
      let connectedId: string | null = null
      if (declarationStatus(decl, config) === 'needs-approval') {
        const ok = opts.yes || await confirm({ message: `'${decl.source}' rutter를 연결할까요?` })
        if (!ok) throw new PilotError('연결이 승인되지 않았습니다')
        config = approveDeclaration(decl, config)
        const conn = config.connections[config.connections.length - 1]!
        if (conn.kind === 'git') cloneSource(conn)
        loadSource(conn) // manifest 파싱 확인 — 실패하면 여기서 throw되어 config에 저장되지 않는다
        saveConfig(config)
        connectedId = conn.id
        console.log(`✓ '${conn.id}' 연결됨`)
      }
      const { sources, synthesis } = loadAll(detected.root)
      const name = sources.find(s => s.id === connectedId)?.manifest.name ?? sources[0]?.manifest.name ?? 'rutter'
      const { written } = writeStub(detected.root, synthesis, name)
      console.log(`✓ 스텁 갱신: ${written.join(', ')}`)
    })
}

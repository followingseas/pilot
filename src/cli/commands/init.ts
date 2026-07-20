import type { Command } from 'commander'
import confirm from '@inquirer/confirm'
import { loadConfig, saveConfig } from '../../core/config.js'
import { readDeclaration, writeDeclaration, declarationStatus, approveDeclaration } from '../../core/declaration.js'
import { detectProject } from '../../core/git.js'
import { cloneSource } from '../../core/source.js'
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
      if (!decl) {
        if (!opts.source) throw new PilotError('.rutter.yaml이 없습니다', 'pilot init --source <url|path> 로 시작하세요')
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

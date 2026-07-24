import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { normalizeRemoteUrl, isGitUrl } from './git.js'
import type { PilotConfig, Connection } from './config.js'

const schema = z.object({ source: z.string().min(1) })
export type Declaration = z.infer<typeof schema>

const declKey = (d: Declaration) => isGitUrl(d.source) ? normalizeRemoteUrl(d.source) : resolve(d.source)
// 연결의 위치를 선언 key와 같은 방식으로 정규화 — 같은 source를 다른 id로 연결한 중복을 알아본다
const connKey = (c: Connection) => isGitUrl(c.location) ? normalizeRemoteUrl(c.location) : resolve(c.location)
const findByLocation = (config: PilotConfig, key: string): Connection | undefined =>
  config.connections.find(c => connKey(c) === key)

export function readDeclaration(projectRoot: string): Declaration | null {
  const file = join(projectRoot, '.rutter.yaml')
  if (!existsSync(file)) return null
  return schema.parse(parse(readFileSync(file, 'utf8')))
}
export function writeDeclaration(projectRoot: string, source: string): void {
  writeFileSync(join(projectRoot, '.rutter.yaml'), stringify({ source }))
}

// 승인 이력에 있거나, 같은 위치가 이미 연결돼 있으면(다른 id·직접 connect 포함) connected로 본다
export function declarationStatus(decl: Declaration, config: PilotConfig): 'connected' | 'needs-approval' {
  const key = declKey(decl)
  if (config.approvedDeclarations.includes(key)) return 'connected'
  return findByLocation(config, key) ? 'connected' : 'needs-approval'
}

/** 선언을 승인·연결한다. 같은 위치가 이미 연결돼 있으면 중복 connection을 만들지 않고 재사용한다 */
export function approveDeclaration(decl: Declaration, config: PilotConfig): PilotConfig {
  const key = declKey(decl)
  const approvedDeclarations = config.approvedDeclarations.includes(key)
    ? config.approvedDeclarations
    : [...config.approvedDeclarations, key]

  const existing = findByLocation(config, key)
  if (existing) {
    // 이미 연결된 source — 승인 이력만 기록하고 connection은 그대로 둔다
    return { ...config, approvedDeclarations }
  }

  let id = basename(key).toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/^[-_]+/, '')
  if (!id) id = 'source'
  id = id.slice(0, 64)
  while (config.connections.some(c => c.id === id)) id = `${id}-2`
  return {
    ...config,
    approvedDeclarations,
    connections: [...config.connections, {
      id, kind: isGitUrl(decl.source) ? 'git' : 'local',
      location: isGitUrl(decl.source) ? decl.source : resolve(decl.source)
    }]
  }
}

/** 선언에 대응하는 이미 연결된 connection (init이 스텁 문구·apply에 그 id를 쓰기 위함) */
export function connectionForDeclaration(decl: Declaration, config: PilotConfig): Connection | undefined {
  return findByLocation(config, declKey(decl))
}

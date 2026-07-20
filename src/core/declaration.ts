import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { normalizeRemoteUrl, isGitUrl } from './git.js'
import type { PilotConfig } from './config.js'

const schema = z.object({ source: z.string().min(1) })
export type Declaration = z.infer<typeof schema>
const declKey = (d: Declaration) => isGitUrl(d.source) ? normalizeRemoteUrl(d.source) : resolve(d.source)

export function readDeclaration(projectRoot: string): Declaration | null {
  const file = join(projectRoot, '.rutter.yaml')
  if (!existsSync(file)) return null
  return schema.parse(parse(readFileSync(file, 'utf8')))
}
export function writeDeclaration(projectRoot: string, source: string): void {
  writeFileSync(join(projectRoot, '.rutter.yaml'), stringify({ source }))
}
export function declarationStatus(decl: Declaration, config: PilotConfig): 'connected' | 'needs-approval' {
  return config.approvedDeclarations.includes(declKey(decl)) ? 'connected' : 'needs-approval'
}
export function approveDeclaration(decl: Declaration, config: PilotConfig): PilotConfig {
  const key = declKey(decl)
  let id = basename(key)
  while (config.connections.some(c => c.id === id)) id = `${id}-2`
  return {
    ...config,
    approvedDeclarations: [...config.approvedDeclarations, key],
    connections: [...config.connections, {
      id, kind: isGitUrl(decl.source) ? 'git' : 'local',
      location: isGitUrl(decl.source) ? decl.source : resolve(decl.source)
    }]
  }
}

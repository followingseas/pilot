import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { configDir } from './paths.js'

const schema = z.object({
  connections: z.array(z.object({
    id: z.string(), kind: z.enum(['local', 'git']), location: z.string(),
    priority: z.number().int().optional()
  })).default([]),
  approvedDeclarations: z.array(z.string()).default([]),
  syncPolicy: z.enum(['auto', 'manual']).default('auto'),
  syncTtlHours: z.number().default(24)
})
export type PilotConfig = z.infer<typeof schema>
export type Connection = PilotConfig['connections'][number]

const file = () => join(configDir(), 'config.json')

export function loadConfig(): PilotConfig {
  if (!existsSync(file())) return schema.parse({})
  return schema.parse(JSON.parse(readFileSync(file(), 'utf8')))
}
export function saveConfig(c: PilotConfig): void {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(file(), JSON.stringify(c, null, 2))
}

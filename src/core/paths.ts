import { realpathSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join, dirname, sep } from 'node:path'
import { PilotError } from './errors.js'

export function configDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'pilot')
    : join(homedir(), '.config', 'pilot')
}
export function cacheDir(): string {
  return process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, 'pilot')
    : join(homedir(), '.cache', 'pilot')
}
export function sourceCacheDir(id: string): string {
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id)) throw new PilotError(`잘못된 source id: ${id}`)
  return join(cacheDir(), 'sources', id)
}

/** root 밖(.. 또는 symlink 경유)을 가리키면 throw. 존재하는 조상까지 realpath로 검증한다. */
export function resolveWithin(root: string, relative: string): string {
  const rootReal = realpathSync(resolve(root))
  const target = resolve(root, relative)
  let probe = target
  while (!existsSync(probe)) probe = dirname(probe)
  const probeReal = realpathSync(probe)

  // target이 존재하면 정규화, 없으면 probe의 정규화 결과를 기반으로 계산
  let targetReal: string
  if (existsSync(target)) {
    targetReal = realpathSync(target)
  } else {
    const suffix = target.substring(probe.length)
    targetReal = probeReal + suffix
  }

  const ok = (p: string) => p === rootReal || p.startsWith(rootReal + sep)
  if (!ok(targetReal) || !ok(probeReal)) {
    throw new PilotError(`경로가 source 루트를 벗어납니다: ${relative}`)
  }
  return target
}

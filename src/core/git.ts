import { execFileSync } from 'node:child_process'

export const isGitUrl = (s: string): boolean => /^(https?:\/\/|git@|ssh:\/\/)/.test(s)

export function normalizeRemoteUrl(url: string): string {
  let s = url.trim()
  const scp = s.match(/^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/](.+)$/)
  if (s.startsWith('http://') || s.startsWith('https://')) {
    s = s.replace(/^https?:\/\//, '')
  } else if (scp) {
    s = `${scp[1]}/${scp[2]}`
  }
  return s.replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase()
}

export function runGit(args: string[], opts: { cwd: string }): string {
  return execFileSync('git', args, { cwd: opts.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

export function detectProject(cwd: string): { root: string; remote: string | null } | null {
  try {
    const root = runGit(['rev-parse', '--show-toplevel'], { cwd })
    let remote: string | null = null
    try {
      remote = normalizeRemoteUrl(runGit(['remote', 'get-url', 'origin'], { cwd: root }))
    } catch {
      remote = null
    }
    return { root, remote }
  } catch {
    return null
  }
}

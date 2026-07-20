import { execFileSync } from 'node:child_process'

export const isGitUrl = (s: string): boolean => /^(https?:\/\/|git@|ssh:\/\/)/.test(s)

// https://user:token@host 형태의 자격증명 포함 URL을 감지한다.
// 관례적인 ssh://git@host, scheme://git@host (예: https://git@host — GitHub App 토큰 관례)는 허용한다.
export const hasEmbeddedCredentials = (url: string): boolean =>
  /^[a-z+]+:\/\/[^@/\s]+@/i.test(url) && !/^ssh:\/\/git@/i.test(url) && !/^[a-z+]+:\/\/git@/i.test(url)

// 에러 메시지·표시 문자열에 git URL의 자격증명(예: https://user:token@host)이 노출되지 않도록 마스킹
export const redactCredentials = (text: string): string => text.replace(/\/\/[^@/\s]+@/g, '//***@')

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

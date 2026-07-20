import { detectProject, normalizeRemoteUrl } from './git.js'
import type { RutterSource } from './source.js'
import type { RepoEntry } from './manifest.js'

export interface ProjectMatch {
  root: string
  remote: string | null
  repoEntry: { sourceId: string; entry: RepoEntry } | null
}

export function identifyProject(cwd: string, sources: RutterSource[]): ProjectMatch | null {
  const detected = detectProject(cwd)
  if (!detected) return null
  let repoEntry: ProjectMatch['repoEntry'] = null
  if (detected.remote) {
    for (const s of sources) {
      const hit = s.manifest.repositories.find(r => normalizeRemoteUrl(r.remote) === detected.remote)
      if (hit) { repoEntry = { sourceId: s.id, entry: hit }; break }
    }
  }
  return { root: detected.root, remote: detected.remote, repoEntry }
}

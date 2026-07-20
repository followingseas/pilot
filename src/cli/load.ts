import { loadConfig, type PilotConfig } from '../core/config.js'
import { loadSource, loadProjectSource, type RutterSource } from '../core/source.js'
import { identifyProject, type ProjectMatch } from '../core/identify.js'
import { synthesize, type SynthesisResult } from '../core/synthesize.js'
import { maybeRevalidateInBackground } from '../core/sync.js'

export function loadAll(cwd: string): {
  config: PilotConfig; sources: RutterSource[]; project: ProjectMatch | null; synthesis: SynthesisResult
} {
  const config = loadConfig()
  maybeRevalidateInBackground(config)
  const sources: RutterSource[] = []
  for (const conn of config.connections) {
    try { sources.push(loadSource(conn)) }
    catch (e) { console.error(`경고: source '${conn.id}' 로드 실패 — ${(e as Error).message}`) }
  }
  const project = identifyProject(cwd, sources)
  if (project) {
    const local = loadProjectSource(project.root)
    if (local) sources.push(local)
  }
  return { config, sources, project, synthesis: synthesize(sources, project) }
}

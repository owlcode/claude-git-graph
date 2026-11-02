import type { Run } from './run'

export type Repo = { root: string; commonDir: string }

const resolved = new Map<string, Repo>()

/** The repository a directory belongs to; looked up once per directory (null outside a repository). */
export async function resolveRepo(run: Run, cwd: string): Promise<Repo | null> {
  const known = resolved.get(cwd)
  if (known) return known
  const top = await run(['git', 'rev-parse', '--show-toplevel'], cwd)
  if (top.exitCode !== 0) return null
  const common = await run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  const repo: Repo = { root: top.stdout.trim(), commonDir: common.exitCode === 0 ? common.stdout.trim() : '' }
  resolved.set(cwd, repo)
  return repo
}

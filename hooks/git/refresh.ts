import type { GitGraphData, GitGraphScope } from '../../types'
import { readWorktreeBases } from './bases'
import { readLog } from './log'
import { resolveRepo } from './repo'
import type { Run } from './run'
import { parseStatus, readWorktrees } from './worktrees'

export type RefreshOptions = { scope: GitGraphScope; limit: number }

const EMPTY = { worktrees: [], worktreeBases: [], commits: [], headHash: null, uncommitted: 0, hasMore: false }

/** One snapshot of the repository the session's cwd is in; failures become `error` so the pane can say why. */
export async function snapshot(run: Run, cwd: string, options: RefreshOptions): Promise<GitGraphData> {
  try {
    const repo = await resolveRepo(run, cwd)
    if (repo === null) return { ...EMPTY, cwd, repoRoot: null, error: null }
    const [worktrees, log, head, status] = await Promise.all([
      readWorktrees(run, repo.root),
      readLog(run, repo.root, { isAll: options.scope === 'all', limit: options.limit }),
      run(['git', 'rev-parse', 'HEAD'], repo.root),
      run(['git', 'status', '--porcelain'], cwd),
    ])
    const worktreeBases = await readWorktreeBases(run, repo.root, worktrees, new Set(log.commits.map(one => one.hash)))
    const counts = parseStatus(status.exitCode === 0 ? status.stdout : '')
    return {
      cwd,
      repoRoot: repo.root,
      worktrees,
      worktreeBases,
      commits: log.commits,
      hasMore: log.hasMore,
      headHash: head.exitCode === 0 ? head.stdout.trim() : null,
      uncommitted: counts.modified + counts.untracked,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...EMPTY, cwd, repoRoot: null, error: message }
  }
}

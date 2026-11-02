import type { WorktreeBase, WorktreeInfo } from '../../types'
import { resolveBase } from './cleanup'
import type { Run } from './run'

/**
 * For each linked worktree whose HEAD is among the loaded commits: the merge-base of the default
 * branch and that HEAD, kept when it is a loaded commit other than the HEAD itself.
 */
export async function readWorktreeBases(
  run: Run,
  repoDir: string,
  worktrees: readonly WorktreeInfo[],
  loaded: ReadonlySet<string>,
): Promise<WorktreeBase[]> {
  const candidates = worktrees.filter(one => !one.isMain && !one.isBare && !one.isPrunable && loaded.has(one.head))
  if (candidates.length === 0) return []
  let ref: string
  try {
    ref = (await resolveBase(run, repoDir)).ref
  } catch {
    return []
  }
  const found = await Promise.all(
    candidates.map(async (one): Promise<WorktreeBase | null> => {
      const result = await run(['git', 'merge-base', ref, one.head], repoDir)
      const base = result.stdout.trim()
      return result.exitCode === 0 && base !== one.head && loaded.has(base) ? { path: one.path, base } : null
    }),
  )
  return found.filter((one): one is WorktreeBase => one !== null)
}

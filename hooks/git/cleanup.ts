import type { CleanupItem, CleanupPlan, CleanupSkipped, WorktreeInfo } from '../../types'
import type { Run } from './run'
import { readWorktrees } from './worktrees'

const AGENT_MARK = '/.claude/worktrees/'

export const isAgentPath = (path: string): boolean => path.includes(AGENT_MARK)

export type CleanupInput = {
  base: string
  /** Local branches reported by `git branch --merged <base>`. */
  merged: readonly string[]
  worktrees: readonly WorktreeInfo[]
  /** The branch checked out where the session runs, if any. */
  currentBranch: string | null
  /** The session's own worktree path. */
  ownPath: string | null
}

/**
 * What Clean up would do, from a snapshot. Only `git branch -d` (never -D or --force) and
 * `git worktree remove` without --force, so git itself still refuses anything unsafe.
 */
export function buildCleanupPlan(input: CleanupInput): CleanupPlan {
  const merged = new Set(input.merged)
  const reason = `merged into ${input.base}`
  const pruneWorktrees: CleanupItem[] = []
  const removeWorktrees: CleanupItem[] = []
  const skipped: CleanupSkipped[] = []

  for (const one of input.worktrees) {
    if (one.isMain || one.isBare) continue
    const isAgent = isAgentPath(one.path)
    if (one.isPrunable) {
      pruneWorktrees.push({
        id: `prune:${one.path}`,
        kind: 'prune',
        label: one.path,
        reason: 'directory missing',
        isAgent,
        commands: [['git', 'worktree', 'prune']],
      })
      continue
    }
    const branch = one.branch
    if (branch === null || branch === input.base || !merged.has(branch)) continue
    const skip = (why: string): number => skipped.push({ label: one.path, reason: why, isAgent })
    if (one.path === input.ownPath) skip('the session runs here')
    else if (one.isLocked) skip('locked')
    else if (one.modified > 0 || one.untracked > 0) skip('has uncommitted changes')
    else {
      removeWorktrees.push({
        id: `worktree:${one.path}`,
        kind: 'worktree',
        label: one.path,
        reason,
        isAgent,
        commands: [
          ['git', 'worktree', 'remove', one.path],
          ['git', 'branch', '-d', branch],
        ],
      })
    }
  }

  // A branch checked out in any worktree (even a stale one) is not deleted on its own.
  const checkedOut = new Set(input.worktrees.map(one => one.branch).filter((name): name is string => name !== null))
  const deleteBranches: CleanupItem[] = [...merged]
    .filter(name => name !== input.base && name !== input.currentBranch && !checkedOut.has(name))
    .sort()
    .map(name => ({
      id: `branch:${name}`,
      kind: 'branch',
      label: name,
      reason,
      isAgent: false,
      commands: [['git', 'branch', '-d', name]],
    }))

  return { base: input.base, pruneWorktrees, removeWorktrees, deleteBranches, skipped }
}

export const allItems = (plan: CleanupPlan): CleanupItem[] => [
  ...plan.pruneWorktrees,
  ...plan.removeWorktrees,
  ...plan.deleteBranches,
]

/** `origin/HEAD`'s branch, else `main`, else `master` (whichever exists locally or on origin). */
export async function resolveBase(run: Run, cwd: string): Promise<{ base: string; ref: string }> {
  const exists = async (ref: string): Promise<boolean> => (await run(['git', 'rev-parse', '--verify', '--quiet', ref], cwd)).exitCode === 0
  const head = await run(['git', 'symbolic-ref', 'refs/remotes/origin/HEAD'], cwd)
  const candidates = [
    ...(head.exitCode === 0 && head.stdout.trim() !== '' ? [head.stdout.trim().replace(/^refs\/remotes\/origin\//, '')] : []),
    'main',
    'master',
  ]
  for (const base of candidates) {
    if (await exists(`refs/heads/${base}`)) return { base, ref: base }
    if (await exists(`refs/remotes/origin/${base}`)) return { base, ref: `origin/${base}` }
  }
  throw new Error('no main or master branch to compare with')
}

export async function collectPlan(run: Run, repoDir: string, cwd: string): Promise<CleanupPlan> {
  const { base, ref } = await resolveBase(run, repoDir)
  const [worktrees, merged, current] = await Promise.all([
    readWorktrees(run, repoDir),
    run(['git', 'branch', '--merged', ref, '--format=%(refname:short)'], repoDir),
    run(['git', 'branch', '--show-current'], cwd),
  ])
  if (merged.exitCode !== 0) throw new Error(merged.stderr.trim() || 'git branch --merged failed')
  const own = worktrees
    .filter(one => cwd === one.path || cwd.startsWith(`${one.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return buildCleanupPlan({
    base,
    merged: merged.stdout.split('\n').filter(name => name !== ''),
    worktrees,
    currentBranch: current.exitCode === 0 && current.stdout.trim() !== '' ? current.stdout.trim() : null,
    ownPath: own?.path ?? null,
  })
}

export type CleanupOutcome = { done: number; failure: string | null }

/** Runs the items' commands one by one in order and stops at the first failure (stderr in `failure`). */
export async function runCleanup(run: Run, repoDir: string, items: readonly CleanupItem[]): Promise<CleanupOutcome> {
  let done = 0
  let pruned = false
  for (const item of items) {
    for (const argv of item.commands) {
      if (item.kind === 'prune') {
        if (pruned) continue // one `git worktree prune` covers every stale entry
        pruned = true
      }
      const result = await run(argv, repoDir)
      if (result.exitCode !== 0) {
        return { done, failure: `${argv.join(' ')}\n${result.stderr.trim() || `exit ${result.exitCode}`}` }
      }
    }
    done += 1
  }
  return { done, failure: null }
}

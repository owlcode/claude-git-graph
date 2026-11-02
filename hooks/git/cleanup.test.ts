import { expect, test } from 'claude-code/testing'

import type { WorktreeInfo } from '../../types'
import { allItems, buildCleanupPlan, runCleanup } from './cleanup'
import type { RunResult } from './run'

const wt = (path: string, branch: string | null, extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  path,
  head: 'h',
  branch,
  isDetached: branch === null,
  isBare: false,
  isMain: false,
  isLocked: false,
  isPrunable: false,
  ahead: null,
  behind: null,
  modified: 0,
  untracked: 0,
  ...extra,
})

const main = wt('/r', 'main', { isMain: true })

test('a merged, clean worktree is removed together with its branch; agent paths are tagged', () => {
  const plan = buildCleanupPlan({
    base: 'main',
    merged: ['main', 'done', 'agent-done'],
    worktrees: [main, wt('/r-done', 'done'), wt('/r/.claude/worktrees/a', 'agent-done')],
    currentBranch: 'main',
    ownPath: '/r',
  })
  expect(plan.removeWorktrees.map(one => [one.label, one.isAgent, one.reason])).toEqual([
    ['/r-done', false, 'merged into main'],
    ['/r/.claude/worktrees/a', true, 'merged into main'],
  ])
  expect(plan.removeWorktrees[0]?.commands).toEqual([
    ['git', 'worktree', 'remove', '/r-done'],
    ['git', 'branch', '-d', 'done'],
  ])
  // Their branches go with the worktree, not as separate branch deletions.
  expect(plan.deleteBranches).toEqual([])
})

test('dirty, locked and own worktrees are skipped with the reason', () => {
  const plan = buildCleanupPlan({
    base: 'main',
    merged: ['main', 'dirty', 'locked', 'own'],
    worktrees: [
      main,
      wt('/r-dirty', 'dirty', { modified: 1 }),
      wt('/r-untracked', 'dirty2', { untracked: 2 }),
      wt('/r-locked', 'locked', { isLocked: true }),
      wt('/r-own', 'own'),
    ],
    currentBranch: 'own',
    ownPath: '/r-own',
  })
  expect(plan.removeWorktrees).toEqual([])
  expect(plan.skipped.map(one => [one.label, one.reason])).toEqual([
    ['/r-dirty', 'has uncommitted changes'],
    ['/r-locked', 'locked'],
    ['/r-own', 'the session runs here'],
  ])
})

test('branches: only merged ones without a worktree, never the base or the current branch', () => {
  const plan = buildCleanupPlan({
    base: 'main',
    merged: ['main', 'old', 'current', 'in-tree'],
    worktrees: [main, wt('/r-x', 'in-tree', { modified: 1 })],
    currentBranch: 'current',
    ownPath: '/r',
  })
  expect(plan.deleteBranches.map(one => one.label)).toEqual(['old'])
  expect(plan.deleteBranches[0]?.commands).toEqual([['git', 'branch', '-d', 'old']])
})

test('stale worktrees are listed for pruning; nothing ever forces', () => {
  const plan = buildCleanupPlan({
    base: 'main',
    merged: ['main', 'a'],
    worktrees: [main, wt('/gone', 'a', { isPrunable: true })],
    currentBranch: 'main',
    ownPath: '/r',
  })
  expect(plan.pruneWorktrees.map(one => [one.label, one.reason])).toEqual([['/gone', 'directory missing']])
  const flags = allItems(plan).flatMap(one => one.commands.flat())
  expect(flags).not.toContain('-D')
  expect(flags).not.toContain('--force')
  expect(flags).not.toContain('-f')
})

test('running stops at the first failure and reports stderr; prune runs once', async () => {
  const plan = buildCleanupPlan({
    base: 'main',
    merged: ['main', 'a', 'b', 'c'],
    worktrees: [main, wt('/g1', 'x', { isPrunable: true }), wt('/g2', 'y', { isPrunable: true })],
    currentBranch: 'main',
    ownPath: '/r',
  })
  const calls: string[] = []
  const run = async (argv: readonly string[]): Promise<RunResult> => {
    calls.push(argv.join(' '))
    return argv.join(' ') === 'git branch -d b'
      ? { exitCode: 1, stdout: '', stderr: 'error: not fully merged\n' }
      : { exitCode: 0, stdout: '', stderr: '' }
  }
  const outcome = await runCleanup(run, '/r', allItems(plan))
  expect(calls).toEqual(['git worktree prune', 'git branch -d a', 'git branch -d b'])
  expect(outcome.done).toBe(3)
  expect(outcome.failure).toBe('git branch -d b\nerror: not fully merged')
})

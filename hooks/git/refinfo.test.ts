import { expect, test } from 'claude-code/testing'

import type { WorktreeInfo } from '../../types'
import { refInfo } from './refinfo'

const wt = (path: string, branch: string | null, extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  path, head: 'h', branch, isDetached: branch === null, isBare: false, isMain: false, isLocked: false, isPrunable: false,
  ahead: null, behind: null, modified: 0, untracked: 0, ...extra,
})

test('each ref says what it is, untruncated; worktrees name their branch, status and path', () => {
  const long = 'claude/outgoing-call-label-layout-019b09'
  const lines = refInfo(
    [
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main', isCurrent: true },
      { kind: 'remote', name: 'main', remote: 'origin' },
      { kind: 'branch', name: long },
      { kind: 'remote', name: 'HEAD', remote: 'origin' },
      { kind: 'tag', name: 'v1' },
    ],
    [
      { path: '/r/wt', name: 'wt', kind: 'at', isOwn: false },
      { path: '/r/old', name: 'old', kind: 'from', isOwn: false },
    ],
    [wt('/r', 'main'), wt('/r/wt', long, { modified: 2, ahead: 1, behind: 0 }), wt('/r/old', 'old-branch')],
  )
  expect(lines).toEqual([
    { kind: 'Local branch', name: 'main', detail: 'current branch (HEAD) · checked out in worktree r · same commit on origin' },
    { kind: 'Local branch', name: long, detail: 'checked out in worktree wt' },
    { kind: 'Remote branch', name: 'origin/HEAD', detail: 'on remote origin' },
    { kind: 'Tag', name: 'v1', detail: '' },
    { kind: 'Worktree', name: 'wt', detail: `on ${long} · 2 modified, ↑1 ↓0 · /r/wt` },
    { kind: 'Worktree start', name: 'old', detail: 'old-branch left the default branch here · /r/old' },
  ])
})

test('a lone HEAD is a detached checkout, and a branch no worktree has says so', () => {
  expect(refInfo([{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'x' }], [], [])).toEqual([
    { kind: 'HEAD', name: 'HEAD', detail: 'detached: no branch checked out' },
    { kind: 'Local branch', name: 'x', detail: 'not checked out in any worktree' },
  ])
})

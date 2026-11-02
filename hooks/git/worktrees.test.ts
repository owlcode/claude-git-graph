import { expect, test } from 'claude-code/testing'

import { parseAheadBehind, parseStatus, parseWorktreePorcelain } from './worktrees'

const PORCELAIN = `worktree /repo
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /repo-wt
HEAD 2222222222222222222222222222222222222222
branch refs/heads/demo
locked because

worktree /repo-gone
HEAD 4444444444444444444444444444444444444444
branch refs/heads/old
prunable gitdir file points to non-existent location

worktree /repo-detached
HEAD 3333333333333333333333333333333333333333
detached
`

test('worktree porcelain is parsed into branches, detached heads and locks', () => {
  const list = parseWorktreePorcelain(PORCELAIN)
  expect(list.map(one => one.path)).toEqual(['/repo', '/repo-wt', '/repo-gone', '/repo-detached'])
  expect(list[0]?.branch).toBe('main')
  expect(list[1]?.isLocked).toBe(true)
  expect(list[2]?.isPrunable).toBe(true)
  expect(list[3]?.isDetached).toBe(true)
  expect(list[3]?.branch).toBe(null)
})

test('status counts modified and untracked entries', () => {
  expect(parseStatus(' M a.ts\nA  b.ts\n?? c.ts\n?? d.ts\n')).toEqual({ modified: 2, untracked: 2 })
  expect(parseStatus('')).toEqual({ modified: 0, untracked: 0 })
})

test('ahead/behind is read from the left-right count', () => {
  expect(parseAheadBehind('3\t1\n')).toEqual({ ahead: 3, behind: 1 })
  expect(parseAheadBehind('fatal')).toBe(null)
})

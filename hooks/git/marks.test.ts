import { expect, test } from 'claude-code/testing'

import type { WorktreeInfo } from '../../types'
import { worktreeMarks } from './marks'

const wt = (path: string, head: string, isMain = false): WorktreeInfo => ({
  path, head, branch: 'b', isDetached: false, isBare: false, isMain, isLocked: false, isPrunable: false,
  ahead: null, behind: null, modified: 0, untracked: 0,
})

test('a worktree is marked where its HEAD is and where its branch started', () => {
  const marks = worktreeMarks(
    [wt('/r', 'm3', true), wt('/r-demo', 'd2'), wt('/r-other', 'm3')],
    [{ path: '/r-demo', base: 'm1' }],
    '/r',
  )
  expect(marks.get('m3')?.map(one => [one.name, one.kind, one.isOwn])).toEqual([
    ['r', 'at', true],
    ['r-other', 'at', false],
  ])
  expect(marks.get('d2')?.map(one => [one.name, one.kind])).toEqual([['r-demo', 'at']])
  expect(marks.get('m1')?.map(one => [one.name, one.kind])).toEqual([['r-demo', 'from']])
  expect(marks.get('nothing')).toBeUndefined()
})

import { expect, test } from 'claude-code/testing'

import type { WorktreeInfo } from '../../types'
import { readWorktreeBases } from './bases'
import type { RunResult } from './run'

const wt = (path: string, head: string, extra: Partial<WorktreeInfo> = {}): WorktreeInfo => ({
  path, head, branch: 'b', isDetached: false, isBare: false, isMain: false, isLocked: false, isPrunable: false,
  ahead: null, behind: null, modified: 0, untracked: 0, ...extra,
})

test('merge-bases are kept only when loaded and different from the worktree HEAD', async () => {
  const run = async (argv: readonly string[]): Promise<RunResult> => {
    const joined = argv.join(' ')
    if (joined.includes('symbolic-ref')) return { exitCode: 1, stdout: '', stderr: '' }
    if (joined.includes('rev-parse')) return { exitCode: joined.endsWith('refs/heads/main') ? 0 : 1, stdout: '', stderr: '' }
    const head = argv[argv.length - 1]
    const base = { h1: 'm1', h2: 'h2', h3: 'gone' }[head ?? ''] ?? ''
    return { exitCode: 0, stdout: `${base}\n`, stderr: '' }
  }
  const bases = await readWorktreeBases(
    run,
    '/r',
    [wt('/r', 'm9', { isMain: true }), wt('/a', 'h1'), wt('/b', 'h2'), wt('/c', 'h3'), wt('/d', 'unloaded')],
    new Set(['m9', 'm1', 'h1', 'h2', 'h3']),
  )
  // /b is at its own merge-base, /c's base is not loaded, /d's HEAD is not loaded.
  expect(bases).toEqual([{ path: '/a', base: 'm1' }])
})

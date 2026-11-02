import { expect, test } from 'claude-code/testing'

import type { GitGraphData } from '../types'

const BAND = {
  plugin: 'git-graph',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

const DATA: GitGraphData = {
  cwd: '/repo',
  repoRoot: '/repo',
  headHash: 'a'.repeat(40),
  uncommitted: 2,
  worktreeBases: [],
  hasMore: false,
  commits: [],
  error: null,
  worktrees: [
    { path: '/repo', head: 'a'.repeat(40), branch: 'main', isDetached: false, isBare: false, isMain: true, isLocked: false, isPrunable: false, ahead: 1, behind: 3, modified: 2, untracked: 0 },
    { path: '/repo-wt', head: 'b'.repeat(40), branch: 'demo', isDetached: false, isBare: false, isMain: false, isLocked: false, isPrunable: false, ahead: null, behind: null, modified: 0, untracked: 0 },
  ],
}

const holding = (data: GitGraphData | null, isOpen = false) => (_: unknown, e: { key: string }) => ({
  value:
    e.key === 'data' && data !== null
      ? { value: { shape: 'data-3', value: data }, version: 1 }
      : e.key === 'isOpen'
        ? { value: { shape: 'open-1', value: isOpen }, version: 1 }
        : { value: undefined, version: 0 },
})

test('the band shows the branch, sync, changes and worktree count, on every surface', async ($, on) => {
  on('state.get', holding(DATA))

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Button', key: 'git-graph' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /main/ }))?.text).toBe('main  ↑1 ↓3  2 changed  2 worktrees')
    await ui.unmount()
  }
})

test('outside a repository the band has no button', async ($, on) => {
  on('state.get', holding({ ...DATA, repoRoot: null, worktrees: [] }))
  const outside = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await outside.find({ type: 'Button' })).toBeUndefined()
  expect(await outside.find({ type: 'Text', text: /no repository/ })).toBeDefined()
  await outside.unmount()
})

test('before the first snapshot the band is the button alone', async ($, on) => {
  on('state.get', holding(null))
  const loading = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await loading.find({ type: 'Button', key: 'git-graph' })).toBeDefined()
  expect(await loading.find({ type: 'Text', text: /worktrees/ })).toBeUndefined()
  await loading.unmount()
})

test('pressing the button opens the pane; session.start alone opens nothing', async ($, on) => {
  on('state.get', holding(DATA))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'gitgraph' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'x', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.cwd', () => ({ value: '/repo' }))
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual([])

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'git-graph' })
  expect(opened).toEqual(['git-graph'])
  await ui.unmount()
})

import { expect, test } from 'claude-code/testing'

import type { GitGraphData } from '../types'

type TestBody = Parameters<typeof test>[1]
type TestFn = Extract<TestBody, (...args: never[]) => unknown>
type TestOn = Parameters<TestFn>[1]

const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'git-graph',
  props: { title: 'Git graph', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const wt = (path: string, branch: string, head: string, isMain = false) => ({
  path, head, branch, isDetached: false, isBare: false, isMain, isLocked: false, isPrunable: false,
  ahead: null, behind: null, modified: 0, untracked: 0,
})

/** `uncommitted` counts changed tracked files in the session's worktree; `untracked` adds files git does not track. */
const data = (uncommitted: number, isDemoHeld = true, untracked = 0): GitGraphData => ({
  cwd: '/repo',
  repoRoot: '/repo',
  headHash: 'b'.repeat(40),
  uncommitted: uncommitted + untracked,
  hasMore: false,
  worktreeBases: [],
  error: null,
  worktrees: [{ ...wt('/repo', 'main', 'b'.repeat(40), true), modified: uncommitted, untracked }, ...(isDemoHeld ? [wt('/repo-wt', 'demo', 'a'.repeat(40))] : [])],
  commits: [
    { hash: 'a'.repeat(40), parents: ['b'.repeat(40)], refs: [{ kind: 'branch', name: 'demo' }], subject: 'work', author: 'Ann', date: 'now' },
    { hash: 'b'.repeat(40), parents: [], refs: [{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'main', isCurrent: true }], subject: 'first', author: 'Ann', date: 'now' },
  ],
})

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

/** Git as the refresh sees it, so a refresh after an action rebuilds the same two-commit repository. */
function fakeGit(argv: readonly string[]): { exitCode: number; stdout: string; stderr: string } {
  const joined = argv.join(' ')
  const out = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
  if (joined.includes('--show-toplevel')) return out('/repo\n')
  if (joined.includes('--git-common-dir')) return out('/repo/.git\n')
  if (joined.includes('worktree list')) {
    return out(`worktree /repo\nHEAD ${B}\nbranch refs/heads/main\n\nworktree /repo-wt\nHEAD ${A}\nbranch refs/heads/demo\n`)
  }
  if (argv.includes('log')) {
    return out(
      `${A}\x1f${B}\x1fdemo\x1fAnn\x1fnow\x1fwork\x1e${B}\x1f\x1fHEAD -> main\x1fAnn\x1fnow\x1ffirst\x1e`,
    )
  }
  if (joined.endsWith('rev-parse HEAD')) return out(`${B}\n`)
  return out('')
}

/** The snapshot is seeded through `state.get` until the pane writes its own; other keys fall to the kit's in-memory `$.state`. */
function seed(on: TestOn, uncommitted: number, isDemoHeld = true, untracked = 0) {
  let isWritten = false
  on('state.set', (_, e, next) => {
    if (e.key === 'data') isWritten = true
    return next(e)
  })
  on('state.get', (_, e, next) =>
    e.key === 'data' && !isWritten ? { value: { value: { shape: 'data-3', value: data(uncommitted, isDemoHeld, untracked) }, version: 1 } } : next(e),
  )
}

function standIns(on: TestOn, run: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string }) {
  const calls: string[] = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    calls.push(e.argv.join(' '))
    return { value: { ...run(e.argv), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return calls
}

const rightClick = (ui: { pointer: (event: { type: 'down'; x: number; y: number; button: 'right'; in: string }) => Promise<void> }, hash: string) =>
  ui.pointer({ type: 'down', x: 3, y: 0, button: 'right', in: `row:${hash}` })

const MERGE_DEMO = `m:${A}:w:/repo-wt:merge`

test('a right-click on a row opens its context menu with the commit, branch and worktree; again closes it', async ($, on) => {
  seed(on, 0)
  standIns(on, fakeGit)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: `m:${A}:copy` })).toBeUndefined()
    await rightClick(ui, A)
    expect(await ui.find({ type: 'Button', key: `m:${A}:copy` })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: `m:${A}:merge` }))?.text).toBe('Merge aaaaaaa into main')
    expect((await ui.find({ type: 'Button', key: `m:${A}:b:demo:merge` }))?.text).toBe('Merge demo into main')
    expect((await ui.find({ type: 'Button', key: MERGE_DEMO }))?.text).toBe('Merge demo into main')
    expect(await ui.find({ type: 'Button', key: `m:${A}:w:/repo-wt:remove` })).toBeDefined()
    await rightClick(ui, A)
    expect(await ui.find({ type: 'Button', key: `m:${A}:copy` })).toBeUndefined()
    await ui.unmount()
  }
})

test('a left click selects the row and its Actions… button opens the same menu', async ($, on) => {
  seed(on, 0)
  standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  await ui.post({ isPressed: true }, { in: `icon:actions:${A}` })
  expect(await ui.find({ type: 'Button', key: MERGE_DEMO })).toBeDefined()
  await ui.unmount()
})

test('Merge is refused while the session worktree has changes', async ($, on) => {
  seed(on, 2)
  const calls = standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await rightClick(ui, A)
  await ui.press({ key: MERGE_DEMO })
  expect(await ui.find({ type: 'Text', text: /2 tracked files have changes here: commit or stash them first/ })).toBeDefined()
  expect(calls.filter(one => one.includes('merge'))).toEqual([])
  await ui.unmount()
})

test('untracked files alone do not stop a merge: git refuses by itself if one would be overwritten', async ($, on) => {
  seed(on, 0, true, 1)
  const calls = standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await rightClick(ui, A)
  await ui.press({ key: MERGE_DEMO })
  expect(calls).toContain('git merge --no-edit demo')
  await ui.unmount()
})

test('a conflicting merge shows git’s output with an abort button', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, argv =>
    argv.includes('--no-edit')
      ? { exitCode: 1, stdout: 'CONFLICT (content): Merge conflict in a.txt', stderr: '' }
      : fakeGit(argv),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await rightClick(ui, A)
  await ui.press({ key: MERGE_DEMO })
  expect(calls).toContain('git merge --no-edit demo')
  expect(await ui.find({ type: 'Text', text: /CONFLICT/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'm:abort' })).toBeDefined()
  await ui.press({ key: 'm:abort' })
  expect(calls).toContain('git merge --abort')
  expect(await ui.find({ type: 'Button', key: 'm:abort' })).toBeUndefined()
  await ui.unmount()
})

test('the session’s own branch and worktree offer no merge', async ($, on) => {
  seed(on, 0)
  standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await rightClick(ui, B)
  expect(await ui.find({ type: 'Button', key: `m:${B}:merge` })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `m:${B}:b:main:merge` })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: `m:${B}:b:main:copy` })).toBeDefined()
  await ui.unmount()
})

test('Rebase onto current asks first, keeps a backup ref, then rebases in the worktree that has the branch', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await rightClick(ui, A)
  expect((await ui.find({ type: 'Button', key: `m:${A}:b:demo:rebase` }))?.text).toBe('Rebase demo onto main')
  await ui.press({ key: `m:${A}:b:demo:rebase` })
  expect(calls.filter(one => one.includes('rebase'))).toEqual([])
  expect(await ui.find({ type: 'Text', text: /old tip is kept as refs\/git-graph\/backup\/demo/ })).toBeDefined()
  await ui.press({ key: 'm:rebase:yes' })
  expect(calls).toContain('git update-ref refs/git-graph/backup/demo refs/heads/demo')
  expect(calls).toContain('git rebase main')
  expect(calls.some(one => one.startsWith('git worktree add'))).toBe(false)
  await ui.unmount()
})

test('a rebase that stops on conflicts offers git rebase --abort', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, argv =>
    argv.join(' ') === 'git rebase main' ? { exitCode: 1, stdout: 'CONFLICT (content): a.txt', stderr: '' } : fakeGit(argv),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await rightClick(ui, A)
  await ui.press({ key: `m:${A}:w:/repo-wt:rebase` })
  await ui.press({ key: 'm:rebase:yes' })
  expect(await ui.find({ type: 'Text', text: /CONFLICT/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'm:abort' }))?.text).toBe('git rebase --abort')
  await ui.press({ key: 'm:abort' })
  expect(calls).toContain('git rebase --abort')
  await ui.unmount()
})

test('Pull & Fetch fetches every remote, then fast-forwards this branch', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, argv => (argv.join(' ').includes('@{upstream}') ? { exitCode: 0, stdout: 'origin/main\n', stderr: '' } : fakeGit(argv)))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.post({ isPressed: true }, { in: 'icon:sync' })
  expect(calls).toContain('git fetch --all --prune')
  expect(calls).toContain('git pull --ff-only')
  await ui.unmount()
})

test('Pull & Fetch only fetches while this worktree has changes', async ($, on) => {
  seed(on, 3)
  const calls = standIns(on, argv => (argv.join(' ').includes('@{upstream}') ? { exitCode: 0, stdout: 'origin/main\n', stderr: '' } : fakeGit(argv)))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.post({ isPressed: true }, { in: 'icon:sync' })
  expect(calls).toContain('git fetch --all --prune')
  expect(calls.some(one => one.startsWith('git pull'))).toBe(false)
  await ui.unmount()
})

test('an unfolded row shows the full message, author with e-mail and date, and what it changed', async ($, on) => {
  seed(on, 0)
  standIns(on, argv => {
    const joined = argv.join(' ')
    if (joined.startsWith('git show -s'))
      return { exitCode: 0, stdout: [A, 'Ann', 'ann@x.io', '2026-11-01T14:03:22+01:00', '2 hours ago', 'Ann', 'ann@x.io', '2026-11-01T14:03:22+01:00', B, 'work', 'Why this matters.\nSecond line.\n\nCo-Authored-By: Bo <bo@x.io>'].join('\x1f'), stderr: '' }
    if (joined.startsWith('git show --shortstat')) return { exitCode: 0, stdout: ' 2 files changed, 5 insertions(+)\n', stderr: '' }
    return fakeGit(argv)
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  expect(await ui.find({ type: 'Text', text: 'Ann <ann@x.io>  ·  2026-11-01 14:03 (2 hours ago)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Why this matters\.\nSecond line\./ })).toBeDefined()
  // Trailers are drawn apart, dim, after the message.
  expect(await ui.find({ type: 'Text', text: 'Why this matters.\nSecond line.' })).toBeDefined()
  expect(JSON.stringify(await ui.find({ type: 'Text', text: 'Co-Authored-By: Bo <bo@x.io>' }))).toContain('dimColor')
  expect(await ui.find({ type: 'Text', text: '2 files changed, 5 insertions(+)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: A })).toBeDefined()
  await ui.unmount()
})

test('an unfolded commit offers merge, rebase-current and delete per branch, and suggests deleting a merged one', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, argv =>
    argv.join(' ').startsWith('git show -s')
      ? { exitCode: 0, stdout: [A, 'Ann', 'a@x.io', '2026-11-01T14:03:22+01:00', 'now', 'Ann', 'a@x.io', '2026-11-01T14:03:22+01:00', B, 'work', ''].join('\x1f'), stderr: '' }
      : fakeGit(argv),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  const icons: string[] = []
  const walk = (node: { type?: string; props?: Record<string, unknown>; children?: unknown[] }): void => {
    if (node.type === 'Client' && String(node.props?.key).startsWith('icon:')) icons.push(String(node.props?.key))
    for (const child of node.children ?? []) if (typeof child === 'object' && child !== null) walk(child as typeof node)
  }
  walk((await ui.drawn()) as unknown as Parameters<typeof walk>[0])
  expect(icons).toContain('icon:merge:demo')
  expect(icons).toContain('icon:rebasecur:demo')
  expect(icons).toContain('icon:delete:demo')
  // The fake git says every commit is in main: demo is merged, so deleting it is suggested.
  expect(await ui.find({ type: 'Text', text: 'merged into main: safe to delete' })).toBeDefined()

  await ui.post({ isHovered: true }, { in: 'icon:delete:demo' })
  expect(await ui.find({ type: 'Text', text: /^Delete demo: asks first/ })).toBeDefined()
  // Shown at the end of demo's own row, in place of the merged hint: no line is added below it.
  expect(await ui.find({ type: 'Box', key: 'tip-line:act:demo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'merged into main: safe to delete' })).toBeUndefined()
  await ui.post({ isHovered: true }, { in: `icon:copy:${A}` })
  expect(await ui.find({ type: 'Text', text: 'Copy the full hash' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Delete demo: asks first/ })).toBeUndefined()

  await ui.post({ isPressed: true }, { in: 'icon:delete:demo' })
  expect(await ui.find({ type: 'Text', text: 'Delete branch demo?' })).toBeDefined()
  expect(calls.some(one => one.includes('branch -d'))).toBe(false)
  await ui.press({ key: 'confirm:yes' })
  expect(calls).toContain('git branch -d demo')
  expect(calls.some(one => one.includes('push'))).toBe(false)
  await ui.unmount()
})

/** The fake repo with demo checked out nowhere, so this worktree may switch to it. */
const demoFree = (argv: readonly string[]) =>
  argv.join(' ').includes('worktree list')
    ? { exitCode: 0, stdout: `worktree /repo\nHEAD ${B}\nbranch refs/heads/main\n`, stderr: '' }
    : fakeGit(argv)

test('checkout of a branch another worktree has copies its cd and switches nothing', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  await ui.post({ isHovered: true }, { in: 'icon:checkout:demo' })
  expect(await ui.find({ type: 'Text', text: 'demo is checked out in /repo-wt: copies its cd' })).toBeDefined()
  await ui.post({ isPressed: true }, { in: 'icon:checkout:demo' })
  expect(calls.some(one => one.startsWith('git switch'))).toBe(false)
  await ui.unmount()
})

test('checkout switches a branch here at once while this worktree is clean', async ($, on) => {
  seed(on, 0, false)
  const calls = standIns(on, demoFree)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  await ui.post({ isPressed: true }, { in: 'icon:checkout:demo' })
  expect(calls).toContain('git switch demo')
  await ui.unmount()
})

test('checkout with changes here asks first, and can stash them before switching', async ($, on) => {
  seed(on, 3, false)
  const calls = standIns(on, demoFree)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  await ui.post({ isPressed: true }, { in: 'icon:checkout:demo' })
  expect(await ui.find({ type: 'Text', text: 'Check out demo here?' })).toBeDefined()
  expect(calls.some(one => one.startsWith('git switch'))).toBe(false)
  await ui.press({ key: 'confirm:stash' })
  await ui.press({ key: 'confirm:yes' })
  const stash = calls.findIndex(one => one.startsWith('git stash push -m'))
  expect(stash).toBeGreaterThan(-1)
  expect(calls.indexOf('git switch demo')).toBeGreaterThan(stash)
  await ui.unmount()
})

test('a detached checkout of a commit always asks first', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  await ui.post({ isPressed: true }, { in: `icon:checkout:${A}` })
  expect(await ui.find({ type: 'Text', text: `Check out ${A.slice(0, 7)} here, detached?` })).toBeDefined()
  await ui.press({ key: 'confirm:yes' })
  expect(calls).toContain(`git switch --detach ${A}`)
  await ui.unmount()
})

test('rebase current onto a branch asks first, keeps a backup of the current branch, then rebases here', async ($, on) => {
  seed(on, 0)
  const calls = standIns(on, fakeGit)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${A}` })
  await ui.post({ isPressed: true }, { in: 'icon:rebasecur:demo' })
  expect(await ui.find({ type: 'Text', text: 'Rebase main onto demo?' })).toBeDefined()
  await ui.press({ key: 'confirm:yes' })
  expect(calls).toContain('git update-ref refs/git-graph/backup/main refs/heads/main')
  expect(calls).toContain('git rebase demo')
  await ui.unmount()
})

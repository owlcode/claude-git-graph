import { expect, test } from 'claude-code/testing'

import type { GitGraphData } from '../types'

const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'git-graph',
  props: {
    title: 'Git graph',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const DATA: GitGraphData = {
  cwd: '/repo',
  repoRoot: '/repo',
  headHash: 'b'.repeat(40),
  uncommitted: 2,
  worktreeBases: [{ path: '/repo-wt', base: 'b'.repeat(40) }],
  hasMore: false,
  error: null,
  worktrees: [
    { path: '/repo', head: 'b'.repeat(40), branch: 'main', isDetached: false, isBare: false, isMain: true, isLocked: false, isPrunable: false, ahead: 1, behind: 0, modified: 2, untracked: 0 },
    { path: '/repo-wt', head: 'a'.repeat(40), branch: 'demo', isDetached: false, isBare: false, isMain: false, isLocked: false, isPrunable: false, ahead: null, behind: null, modified: 0, untracked: 1 },
  ],
  commits: [
    { hash: 'a'.repeat(40), parents: ['b'.repeat(40)], refs: [{ kind: 'branch', name: 'demo' }], subject: 'work on demo', author: 'Ann', date: '1 hour ago' },
    { hash: 'b'.repeat(40), parents: [], refs: [{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'main', isCurrent: true }], subject: 'first commit', author: 'Ann', date: '2 hours ago' },
  ],
}

const seeded = (_: unknown, e: { key: string }) => ({
  value: e.key === 'data' ? { value: { shape: 'data-3', value: DATA }, version: 1 } : { value: undefined, version: 0 },
})

test('the pane draws commit rows with no column titles and no Worktrees section, on the terminal and desktop', async ($, on) => {
  on('state.get', seeded)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const title of ['Graph', 'Description', 'Date', 'Author', 'Commit']) {
      expect(await ui.find({ type: 'Text', text: new RegExp(`^${title}$`) })).toBeUndefined()
    }
    expect((await rowProps(() => ui.drawn(), 'a'.repeat(40)))?.subject).toBe('work on demo')
    expect(await ui.find({ type: 'Text', text: 'Worktrees' })).toBeUndefined()
    await ui.unmount()
  }
})

type Drawn = { type?: string; key?: string; props?: Record<string, unknown>; children?: Drawn[] }

const walk = (node: Drawn, visit: (one: Drawn) => void): void => {
  visit(node)
  for (const child of node.children ?? []) if (typeof child === 'object') walk(child, visit)
}

test('commit rows sit flush: no gap on their column and no Box height on the row', async ($, on) => {
  on('state.get', (_, e) => ({
    value: e.key === 'data' ? { value: { shape: 'data-3', value: DATA }, version: 1 } : { value: undefined, version: 0 },
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const tree = (await ui.drawn()) as unknown as Drawn
    let column: Drawn | undefined
    let row: Drawn | undefined
    walk(tree, one => {
      const hit = (one.children ?? []).find(child => typeof child === 'object' && child.props?.key === 'a'.repeat(40))
      if (hit !== undefined) {
        column = one
        row = hit.children?.[0]
      }
    })
    expect(column).toBeDefined()
    expect(column?.props?.gap).toBeUndefined()
    // Box height is in character cells on every surface; the row is as tall as its Svg (pixels).
    expect(row?.props?.height).toBeUndefined()
    await ui.unmount()
  }
})

import type { CleanupCard, CleanupItem } from '../types'

const item = (kind: CleanupItem['kind'], label: string, extra: Partial<CleanupItem> = {}): CleanupItem => ({
  id: `${kind}:${label}`,
  kind,
  label,
  reason: kind === 'prune' ? 'directory missing' : 'merged into main',
  isAgent: false,
  commands: [['git', 'noop']],
  ...extra,
})

const holdingCard = (card: CleanupCard) => (_: unknown, e: { key: string }) => ({
  value:
    e.key === 'data'
      ? { value: { shape: 'data-3', value: DATA }, version: 1 }
      : e.key === 'cleanup'
        ? { value: { shape: 'cleanup-1', value: card }, version: 1 }
        : { value: undefined, version: 0 },
})

test('the Clean up card lists its groups and Remove counts only the included items', async ($, on) => {
  on(
    'state.get',
    holdingCard({
      isOpen: true,
      isBusy: false,
      error: null,
      excluded: ['branch:old'],
      plan: {
        base: 'main',
        pruneWorktrees: [item('prune', '/gone')],
        removeWorktrees: [item('worktree', '/r/.claude/worktrees/a', { isAgent: true })],
        deleteBranches: [item('branch', 'old'), item('branch', 'older')],
        skipped: [{ label: '/r-dirty', reason: 'has uncommitted changes', isAgent: false }],
      },
    }),
  )

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const title of ['Clean up', 'Prune stale worktrees', 'Remove merged worktrees', 'Delete merged branches']) {
      expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: / agent / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /skipped \/r-dirty: has uncommitted changes/ })).toBeDefined()
    // Four items, one switched off.
    expect(await ui.find({ type: 'Text', text: ' Remove 3 ' })).toBeDefined()
    await ui.unmount()
  }
})

test('an empty plan says so and offers only Cancel', async ($, on) => {
  on(
    'state.get',
    holdingCard({
      isOpen: true,
      isBusy: false,
      error: null,
      excluded: [],
      plan: { base: 'main', pruneWorktrees: [], removeWorktrees: [], deleteBranches: [], skipped: [] },
    }),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Nothing to clean up' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'confirm' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'cancel' })).toBeDefined()
  await ui.unmount()
})

type RowPropsSeen = { chips: { text: string; isDim: boolean }[]; subject: string; author: string; authorWidth: number }

const rowProps = async (drawn: () => Promise<unknown>, hash: string): Promise<RowPropsSeen | undefined> => {
  let props: RowPropsSeen | undefined
  walk((await drawn()) as Drawn, one => {
    if (one.type === 'Client' && one.props?.key === `row:${hash}`) props = one.props.props as RowPropsSeen
  })
  return props
}

test('refs and worktrees are chips: text in the terminal row, a rounded tinted Svg before the row on desktop', async ($, on) => {
  on('state.get', seeded)
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const first = await rowProps(() => terminal.drawn(), 'b'.repeat(40))
  // The demo worktree started at the first commit: a dim `⤴` chip there.
  expect(first?.chips.map(chip => chip.text)).toEqual(['HEAD → main', '▤ repo ✦', '▤ repo-wt ⤴'])
  expect(first?.chips[2]?.isDim).toBe(true)
  const work = await rowProps(() => terminal.drawn(), 'a'.repeat(40))
  expect(work?.chips.map(chip => chip.text)).toEqual(['demo', '▤ repo-wt'])
  expect(work?.author).toBe('Ann')
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await rowProps(() => desktop.drawn(), 'b'.repeat(40)))?.chips).toEqual([])
  const sources: string[] = []
  walk((await desktop.drawn()) as Drawn, one => {
    if (one.type === 'Svg') sources.push(String(one.props?.source))
  })
  const chips = sources.find(source => source.includes('HEAD → ')) ?? ''
  expect(chips).toContain('rx="5"')
  expect(chips).toContain('text-anchor="middle"')
  expect(chips).toContain('▤ repo-wt ⤴')
  // Every Svg in a row is the graph's height, so rows stay one Svg tall.
  // Rows' Svgs (not the 16-unit toolbar icons and loupe) are the graph's height.
  expect(sources.filter(source => !source.includes('viewBox="0 0 16 16"')).every(source => source.includes('height="30"'))).toBe(true)
  await desktop.unmount()
})

test('the lane Svg sits unsqueezed in a graph column that clips it', async ($, on) => {
  on('state.get', seeded)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const slots: Drawn[] = []
  walk((await ui.drawn()) as unknown as Drawn, one => {
    if (one.type === 'Box' && (one.children ?? []).some(child => typeof child === 'object' && child.type === 'Svg')) slots.push(one)
  })
  expect(slots.length).toBeGreaterThan(0)
  expect(slots.every(slot => slot.props?.flexShrink === 0)).toBe(true)
  await ui.unmount()
})

test('dragging a column edge sets its width, and Columns hides one', async ($, on) => {
  on('state.get', (_, e, next) => (e.key === 'data' ? { value: { value: { shape: 'data-3', value: DATA }, version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.post({ column: 'author', width: 30 }, { in: `row:${'a'.repeat(40)}` })
  expect((await rowProps(() => ui.drawn(), 'a'.repeat(40)))?.authorWidth).toBe(30)
  await ui.post({ isPressed: true }, { in: 'icon:columns' })
  await ui.press({ key: 'column:author' })
  expect((await rowProps(() => ui.drawn(), 'a'.repeat(40)))?.authorWidth).toBe(0)
  await ui.unmount()
})

test('the graph edge and a row’s right-hand edges drag to resize', async ($, on) => {
  on('state.get', (_, e, next) => (e.key === 'data' ? { value: { value: { shape: 'data-3', value: DATA }, version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const A = 'a'.repeat(40)
  const graphWidth = async (): Promise<number> => {
    let width = 0
    walk((await ui.drawn()) as Drawn, one => {
      if (one.type === 'Client' && one.props?.key === 'resize:graph') width = (one.props.props as { width: number }).width
    })
    return width
  }
  const before = await graphWidth()
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'resize:graph' })
  await ui.pointer({ type: 'move', x: 5, y: 0, button: 'left', in: 'resize:graph' })
  await ui.pointer({ type: 'up', x: 5, y: 0, button: 'left', in: 'resize:graph' })
  expect(await graphWidth()).toBe(before + 5)
  // The commit column (8 wide) starts at 60 - 9: dragging its edge left by 4 widens it to 12.
  const row = `row:${A}`
  await ui.resize({ columns: 60, rows: 1, in: row })
  await ui.pointer({ type: 'down', x: 51, y: 0, button: 'left', in: row })
  await ui.pointer({ type: 'move', x: 47, y: 0, button: 'left', in: row })
  await ui.pointer({ type: 'up', x: 47, y: 0, button: 'left', in: row })
  let commitWidth = 0
  walk((await ui.drawn()) as Drawn, one => {
    if (one.type === 'Client' && one.props?.key === row) commitWidth = (one.props.props as { commitWidth: number }).commitWidth
  })
  expect(commitWidth).toBe(12)
  await ui.unmount()
})

test('a right-click on desktop opens the menu as an overlay at the click', async ($, on) => {
  on('state.get', (_, e, next) => (e.key === 'data' ? { value: { value: { shape: 'data-3', value: DATA }, version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 10, y: 0, button: 'right', in: `row:${'a'.repeat(40)}` })
  let list: Drawn | undefined
  walk((await ui.drawn()) as Drawn, one => {
    if ((one.children ?? []).some(child => typeof child === 'object' && child.props?.key === 'dropdown')) list = one
  })
  // Drawn after every row so no later row paints over it, under the clicked row: the uncommitted row and it, 60px / 20px lines.
  const children = list?.children ?? []
  const dropdown = children[children.length - 1]
  expect(dropdown?.props?.key).toBe('dropdown')
  expect(dropdown?.props?.position).toBe('absolute')
  expect(dropdown?.props?.top).toBe(3)
  let card: Drawn | undefined
  walk(dropdown as Drawn, one => {
    if (one.type === 'Box' && one.props?.borderStyle === 'round') card ??= one
  })
  expect(card?.props?.backgroundColor).toBe('#ffffff')
  await ui.unmount()
})

test('a selected row keeps the lanes going past its detail line, dotted', async ($, on) => {
  on('state.get', (_, e, next) => (e.key === 'data' ? { value: { value: { shape: 'data-3', value: DATA }, version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: `row:${'a'.repeat(40)}` })
  const sources: string[] = []
  walk((await ui.drawn()) as Drawn, one => {
    if (one.type === 'Svg') sources.push(String(one.props?.source))
  })
  expect(sources.some(source => source.includes('<line') && source.includes('stroke-dasharray="2 3"'))).toBe(true)
  // The desktop drops an Svg with an empty alt, so every Svg here says what it is.
  const alts: string[] = []
  walk((await ui.drawn()) as Drawn, one => {
    if (one.type === 'Svg') alts.push(String(one.props?.alt ?? ''))
  })
  expect(alts.every(alt => alt.trim() !== '')).toBe(true)
  await ui.unmount()
})

test('the toolbar is bare icons whose description shows under them on hover; no title or Refresh; a loupe filter', async ($, on) => {
  on('state.get', (_, e, next) => (e.key === 'data' ? { value: { value: { shape: 'data-3', value: DATA }, version: 1 } } : next(e)))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Git graph$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeUndefined()
  const icons: string[] = []
  const tips: Drawn[] = []
  const alts: string[] = []
  walk((await ui.drawn()) as unknown as Drawn, one => {
    if (one.type === 'Client' && String(one.props?.key).startsWith('icon:')) icons.push(String(one.props?.key))
    if (one.type === 'Box' && one.props?.display === 'none') tips.push(one)
    if (one.type === 'Svg') alts.push(String(one.props?.alt))
  })
  expect(icons).toEqual(['icon:sync', 'icon:cleanup', 'icon:columns'])
  // Only the chips' cards of the two commits hide until hovered; icons say what they do in the flow.
  expect(tips.length).toBe(2)
  expect(await ui.find({ type: 'Text', text: /merged into the default branch/ })).toBeUndefined()
  // The description's line is there before any hover, so showing one moves nothing.
  expect(await ui.find({ type: 'Box', key: 'caption:toolbar' })).toBeDefined()
  await ui.post({ isHovered: true }, { in: 'icon:cleanup' })
  expect(await ui.find({ type: 'Text', text: /merged into the default branch/ })).toBeDefined()
  await ui.post({ isHovered: false }, { in: 'icon:cleanup' })
  expect(await ui.find({ type: 'Text', text: /merged into the default branch/ })).toBeUndefined()
  expect(alts).toContain('Filter')
  await ui.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const sync = await terminal.find({ type: 'Button', key: 'sync' })
  expect(JSON.stringify(sync)).toContain('Pull & Fetch')
  await terminal.unmount()
})

test('however many commits are loaded, the desktop pane stays under the 262144 characters it draws at most', async ($, on) => {
  const many = Array.from({ length: 600 }, (_, at) => {
    const hash = at.toString(16).padStart(40, '0')
    const parent = (at + 1).toString(16).padStart(40, '0')
    return {
      hash,
      parents: at % 7 === 0 ? [parent, (at + 3).toString(16).padStart(40, '0')] : [parent],
      refs: at % 5 === 0 ? [{ kind: 'branch' as const, name: `claude/some-long-branch-name-${at}` }] : [],
      subject: `feat(area): a fairly long commit subject that says what changed in number ${at}`,
      author: 'Ann Example',
      date: '13 godzin temu',
    }
  })
  const big = { ...DATA, commits: many, worktreeBases: [], hasMore: true }
  on('state.get', (_, e, next) =>
    e.key === 'data'
      ? { value: { value: { shape: 'data-3', value: big }, version: 1 } }
      : e.key === 'limit'
        ? { value: { value: { shape: 'limit-1', value: 5000 }, version: 1 } }
        : next(e),
  )
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(262144)
  expect(await ui.find({ type: 'Text', text: /all the pane can hold/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'more' })).toBeUndefined()
  await ui.unmount()
})

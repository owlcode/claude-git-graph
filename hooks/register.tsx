import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { AbortPlan, CheckoutMode, CommitDetail, DetailConfirm, CleanupCard, CleanupItem, ColumnId, ColumnsConfig, Commit, GitGraphData, GitGraphScope, RowMenu, WorktreeInfo } from '../types'
import { allItems, collectPlan, resolveBase, runCleanup } from './git/cleanup'
import { LANE_COLORS, UNCOMMITTED_HASH, asciiLanes, layoutGraph, withUncommitted } from './git/graph'
import type { GraphRow } from './git/graph'
import { ICONS } from './git/icons'
import { GRID_X, ROW_HEIGHT, color, laneAreaWidth, laneFiller, rowSvg } from './git/lanesvg'
import { chipText, chipsFor } from './git/pills'
import { chipsSvg } from './git/svgchips'
import { refInfo } from './git/refinfo'
import { readDetail } from './git/detail'
import type { IconHover, IconPress } from './icon'
import { snapshot } from './git/refresh'
import type { Run } from './git/run'
import { worktreeMarks } from './git/marks'
import type { WorktreeMark } from './git/marks'
import { ownWorktree } from './git/worktrees'
import type { ResizeMove, RowChip, RowPress } from './row'

const PANE = 'git-graph'
const BASE_LIMIT = 200
const PAGE = 50
/** About one character cell of the desktop pane in CSS pixels: how many cells the lane Svg needs. */
const PX_PER_CELL = 7
const MAX_DEFAULT_GRAPH = 14
const MAX_CHIP = 28
/** About how wide the context menu draws, so it is not placed past the pane's right edge. */
const MENU_WIDTH = 56
/** The desktop pane's line height in px (`--cds-leading-body`, 1.25rem): what one cell of `top` moves. */
const LINE_PX = 20
/** A selected row's detail line: as tall as its buttons, so the dotted lanes beside it span it whole. */
const DETAIL_HEIGHT = 36
/** Cells for the labels of an unfolded row's facts (Message, Author, Commit…). */
const FACT_LABEL = 10
/** Room after the last chip, before the subject. */
const CHIP_TRAIL = 8
/** Serialized characters the commit rows may take: the desktop draws nothing for a pane past 262144. */
const ROWS_BUDGET = 190_000
/** Toolbar icons, 16-unit stroke drawings: Pull & Fetch (into the tray), Clean up (a bin), Columns. */
const TOOLBAR: readonly string[] = ['sync', 'cleanup', 'columns']

/** The ref card a row's chips show on hover. */
const CARD_WIDTH = 60
/** The filter's loupe: a ring and its handle. */
const LOUPE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="#8a8a84" stroke-width="1.6"/><path d="M10 10l4 4" stroke="#8a8a84" stroke-width="1.6" stroke-linecap="round"/></svg>'

const EMPTY: GitGraphData = {
  cwd: '',
  worktreeBases: [],
  repoRoot: null,
  headHash: null,
  uncommitted: 0,
  hasMore: false,
  worktrees: [],
  commits: [],
  error: null,
}

const COLUMN_IDS: readonly ColumnId[] = ['graph', 'date', 'author', 'commit']
const COLUMN_TITLES: Record<ColumnId, string> = { graph: 'Graph', date: 'Date', author: 'Author', commit: 'Commit' }
const DEFAULT_COLUMNS: ColumnsConfig = {
  visible: { graph: true, date: true, author: true, commit: true },
  widths: { graph: null, date: 14, author: 16, commit: 8 },
}

// Change a tag when the shape it guards changes: it declines what an earlier version stored.
const dataAtom = atom({ plugin: 'git-graph', key: 'data' } as const, EMPTY, { shape: 'data-3' })
const scopeAtom = atom({ plugin: 'git-graph', key: 'scope' } as const, 'all' satisfies GitGraphScope, {
  shape: 'scope-1',
})
const filterAtom = atom({ plugin: 'git-graph', key: 'filter' } as const, '', { shape: 'filter-1' })
const limitAtom = atom({ plugin: 'git-graph', key: 'limit' } as const, 0, { shape: 'limit-1' })
const columnsAtom = atom({ plugin: 'git-graph', key: 'columns' } as const, DEFAULT_COLUMNS, { shape: 'columns-1' })
const configuringAtom = atom({ plugin: 'git-graph', key: 'isConfiguring' } as const, false, { shape: 'configuring-1' })
// Whether the person has the pane open: a reload reopens it only then.
const isOpenAtom = atom({ plugin: 'git-graph', key: 'isOpen' } as const, false, { shape: 'open-1' })
const CLOSED_CARD: CleanupCard = { isOpen: false, isBusy: false, plan: null, excluded: [], error: null }
const cleanupAtom = atom({ plugin: 'git-graph', key: 'cleanup' } as const, CLOSED_CARD, { shape: 'cleanup-1' })
const menuAtom = atom({ plugin: 'git-graph', key: 'menu' } as const, null as RowMenu | null, { shape: 'menu-5' })
const isDarkAtom = atom({ plugin: 'git-graph', key: 'isDark' } as const, false, { shape: 'dark-1' })
const detailAtom = atom({ plugin: 'git-graph', key: 'detail' } as const, null as CommitDetail | null, { shape: 'detail-1' })
const hoveredAtom = atom({ plugin: 'git-graph', key: 'hoveredIcon' } as const, '', { shape: 'hovered-1' })
const confirmAtom = atom({ plugin: 'git-graph', key: 'confirm' } as const, null as DetailConfirm | null, { shape: 'confirm-2' })
const syncingAtom = atom({ plugin: 'git-graph', key: 'isSyncing' } as const, false, { shape: 'syncing-1' })
const selectedAtom = atom({ plugin: 'git-graph', key: 'selected' } as const, '', { shape: 'selected-1' })

const runner =
  ($: EngineInterface): Run =>
  async (argv, cwd) => {
    const { exitCode, stdout, stderr } = await $.process.run(argv, { cwd })
    return { exitCode, stdout, stderr }
  }

async function refresh($: EngineInterface): Promise<void> {
  const scope = await read($, scopeAtom)
  const limit = await read($, limitAtom)
  const cwd = await $.session.cwd()
  const data = await snapshot(runner($), cwd, { scope, limit: BASE_LIMIT + limit })
  await update($, dataAtom, () => data)
  const isDark = await isDarkAppearance($).catch(() => false)
  if ((await read($, isDarkAtom)) !== isDark) await update($, isDarkAtom, () => isDark)
}

/** Builds the plan and shows the confirmation card; nothing is run until the person presses Remove. */
async function openCleanup($: EngineInterface, only: string | null): Promise<void> {
  await update($, cleanupAtom, () => ({ ...CLOSED_CARD, isOpen: true, isBusy: true }))
  try {
    const data = await read($, dataAtom)
    const plan = await collectPlan(runner($), data.worktrees[0]?.path ?? data.repoRoot ?? '', await $.session.cwd())
    if (only === null) {
      await update($, cleanupAtom, () => ({ ...CLOSED_CARD, isOpen: true, plan }))
      return
    }
    // From a worktree's menu: only that worktree is included, or the card says why it cannot be.
    const items = allItems(plan)
    const mine = items.filter(one => one.label === only)
    const why = plan.skipped.find(one => one.label === only)?.reason ?? `its branch is not merged into ${plan.base}`
    await update($, cleanupAtom, () => ({
      ...CLOSED_CARD,
      isOpen: true,
      plan,
      excluded: items.filter(one => one.label !== only).map(one => one.id),
      error: mine.length === 0 ? `${only} is not removed by Clean up: ${why}` : null,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, cleanupAtom, () => ({ ...CLOSED_CARD, isOpen: true, error: message }))
  }
}

const closeMenu = ($: EngineInterface) => update($, menuAtom, () => null)

const setMenuError = ($: EngineInterface, error: string, abort: AbortPlan | null) =>
  update($, menuAtom, menu => (menu === null ? menu : { ...menu, error, abort, confirmRebase: null }))

const said = (result: { exitCode: number; stdout: string; stderr: string }, what: string): string =>
  `${result.stdout.trim()}\n${result.stderr.trim()}`.trim() || `${what} exited ${result.exitCode}`

/** Merges a branch, remote branch or commit into the branch the session is on, unless its worktree has changes. */
async function mergeRef($: EngineInterface, ref: string): Promise<void> {
  const data = await read($, dataAtom)
  const current = ownWorktree(data.worktrees, data.cwd)?.branch ?? null
  if (current === null) return
  if (data.uncommitted > 0) {
    await setMenuError($, 'Commit or stash the changes in this worktree first.', null)
    return
  }
  const cwd = await $.session.cwd()
  const result = await runner($)(['git', 'merge', '--no-edit', ref], cwd)
  await refresh($)
  if (result.exitCode === 0) {
    await closeMenu($)
    $.ui.toast(`Merged ${ref} into ${current}`)
    return
  }
  await setMenuError($, said(result, 'git merge'), { label: 'git merge --abort', steps: [{ argv: ['git', 'merge', '--abort'], cwd }] })
}

/** Runs a stopped merge's or rebase's way back, step by step; stops at the first failure. */
async function runAbort($: EngineInterface, plan: AbortPlan): Promise<void> {
  for (const step of plan.steps) {
    const result = await runner($)(step.argv, step.cwd)
    if (result.exitCode !== 0) {
      await refresh($)
      await setMenuError($, said(result, step.argv.join(' ')), plan)
      return
    }
  }
  await refresh($)
  await closeMenu($)
}

/**
 * Rebases a local branch onto the session's current branch. Where a worktree has it checked out,
 * the rebase runs there; else in a temporary worktree, so the session's own checkout never moves.
 * The old tip is kept first as `refs/git-graph/backup/<branch>`.
 */
async function rebaseOnto($: EngineInterface, branch: string): Promise<void> {
  const data = await read($, dataAtom)
  const current = ownWorktree(data.worktrees, data.cwd)?.branch ?? null
  if (current === null || branch === current) return
  const run = runner($)
  const cwd = await $.session.cwd()
  const tree = data.worktrees.find(one => one.branch === branch)
  if (tree !== undefined && (tree.modified > 0 || tree.untracked > 0)) {
    await setMenuError($, `${tree.path} has uncommitted changes: commit or stash them first.`, null)
    return
  }
  const backup = await run(['git', 'update-ref', `refs/git-graph/backup/${branch}`, `refs/heads/${branch}`], cwd)
  if (backup.exitCode !== 0) {
    await setMenuError($, said(backup, 'git update-ref'), null)
    return
  }
  let where = tree?.path
  let made: string | null = null
  if (where === undefined) {
    const temp = await run(['mktemp', '-d', '-t', 'git-graph-rebase'], cwd)
    made = temp.stdout.trim()
    const added = await run(['git', 'worktree', 'add', made, branch], cwd)
    if (temp.exitCode !== 0 || added.exitCode !== 0) {
      await setMenuError($, said(added, 'git worktree add'), null)
      return
    }
    where = made
  }
  const result = await run(['git', 'rebase', current], where)
  if (result.exitCode === 0) {
    if (made !== null) await run(['git', 'worktree', 'remove', made], cwd)
    await refresh($)
    await closeMenu($)
    $.ui.toast(`Rebased ${branch} onto ${current}`)
    return
  }
  await refresh($)
  const steps = [{ argv: ['git', 'rebase', '--abort'], cwd: where }]
  if (made !== null) steps.push({ argv: ['git', 'worktree', 'remove', made], cwd })
  await setMenuError($, said(result, 'git rebase'), { label: 'git rebase --abort', steps })
}

/** Whether the app is dark: the theme setting, or for `auto` the system appearance macOS reports. */
async function isDarkAppearance($: EngineInterface): Promise<boolean> {
  const theme = String((await $.config.list()).find(row => row.key === 'theme')?.value ?? 'auto')
  if (theme.includes('dark')) return true
  if (theme.includes('light')) return false
  const said = await $.process.run(['defaults', 'read', '-g', 'AppleInterfaceStyle'], {})
  return said.exitCode === 0 && said.stdout.trim() === 'Dark'
}

/** Opens a row's context menu where it was right-clicked, or closes it when it is the one already open. */
async function openMenu($: EngineInterface, hash: string, x: number): Promise<void> {
  const isOpen = (await read($, menuAtom))?.hash === hash
  if (isOpen) {
    await closeMenu($)
    return
  }
  const isDark = await isDarkAppearance($).catch(() => false)
  await update($, menuAtom, () => ({ hash, x, isDark, error: null, abort: null, confirmRebase: null }))
}

/** Selects a row (or unselects it) and loads its full message and who/when for the unfolded row. */
async function toggleSelected($: EngineInterface, hash: string): Promise<void> {
  const was = await read($, selectedAtom)
  const next = was === hash ? '' : hash
  await update($, selectedAtom, () => next)
  await update($, confirmAtom, () => null)
  if (next === '' || next === UNCOMMITTED_HASH) return
  await loadDetail($, next)
}

/** The selected commit in full, and whether the default branch already has it (then its branches can go). */
async function loadDetail($: EngineInterface, hash: string): Promise<void> {
  const data = await read($, dataAtom)
  const run = runner($)
  const dir = data.repoRoot ?? (await $.session.cwd())
  const detail = await readDetail(run, dir, hash).catch(() => null)
  if (detail !== null) {
    const { base, ref } = await resolveBase(run, dir).catch(() => ({ base: '', ref: '' }))
    const isIn = ref !== '' && (await run(['git', 'merge-base', '--is-ancestor', hash, ref], dir)).exitCode === 0
    detail.mergedInto = isIn ? base : null
  }
  if ((await read($, selectedAtom)) === hash) await update($, detailAtom, () => detail)
}

const setConfirm = ($: EngineInterface, change: Partial<DetailConfirm>) =>
  update($, confirmAtom, now => (now === null ? now : { ...now, ...change }))

/**
 * Deletes a branch from an unfolded commit: `git branch -d` (refused by git while unmerged or
 * checked out, never forced) and, when the box is ticked, `git push <remote> --delete`.
 */
async function deleteBranch($: EngineInterface): Promise<void> {
  const ask = await read($, confirmAtom)
  if (ask === null || ask.kind !== 'delete' || ask.isBusy) return
  await setConfirm($, { isBusy: true, error: null })
  const data = await read($, dataAtom)
  const run = runner($)
  const dir = data.repoRoot ?? (await $.session.cwd())
  const done: string[] = []
  if (ask.hasLocal) {
    const local = await run(['git', 'branch', '-d', ask.branch], dir)
    if (local.exitCode !== 0) {
      await setConfirm($, { isBusy: false, error: said(local, 'git branch -d') })
      return
    }
    done.push(ask.branch)
  }
  if (ask.alsoRemote && ask.remote !== null) {
    const remote = await run(['git', 'push', ask.remote, '--delete', ask.branch], dir)
    if (remote.exitCode !== 0) {
      await refresh($)
      await setConfirm($, { isBusy: false, hasLocal: false, error: said(remote, 'git push --delete') })
      return
    }
    done.push(`${ask.remote}/${ask.branch}`)
  }
  await update($, confirmAtom, () => null)
  await refresh($)
  $.ui.toast(`Deleted ${done.join(' and ')}`)
}

/** Rebases the session's branch onto another: asks first, keeps a backup ref, refused with changes. */
async function rebaseCurrentOnto($: EngineInterface): Promise<void> {
  const ask = await read($, confirmAtom)
  if (ask === null || ask.kind !== 'rebaseCurrent' || ask.isBusy) return
  const data = await read($, dataAtom)
  const current = ownWorktree(data.worktrees, data.cwd)?.branch ?? null
  if (current === null) return
  if (data.uncommitted > 0) {
    await setConfirm($, { error: 'Commit or stash the changes in this worktree first.' })
    return
  }
  await setConfirm($, { isBusy: true, error: null })
  const run = runner($)
  const cwd = await $.session.cwd()
  const backup = await run(['git', 'update-ref', `refs/git-graph/backup/${current}`, `refs/heads/${current}`], cwd)
  if (backup.exitCode !== 0) {
    await setConfirm($, { isBusy: false, error: said(backup, 'git update-ref') })
    return
  }
  const result = await run(['git', 'rebase', ask.branch], cwd)
  await refresh($)
  if (result.exitCode === 0) {
    await update($, confirmAtom, () => null)
    $.ui.toast(`Rebased ${current} onto ${ask.branch}`)
    return
  }
  await setConfirm($, { isBusy: false, error: said(result, 'git rebase'), canAbort: true })
}

/** Opens the confirmation for a delete or a rebase of the current branch, from the unfolded commit. */
async function askFromDetail($: EngineInterface, verb: string, branch: string, hash: string): Promise<void> {
  const data = await read($, dataAtom)
  const commit = data.commits.find(one => one.hash === hash)
  const local = commit?.refs.some(ref => ref.kind === 'branch' && ref.name === branch) ?? false
  const slash = branch.indexOf('/')
  const asRemote = commit?.refs.find(ref => ref.kind === 'remote' && `${ref.remote ?? ''}/${ref.name}` === branch)
  const name = local ? branch : (asRemote?.name ?? branch.slice(slash + 1))
  const remote = commit?.refs.find(ref => ref.kind === 'remote' && ref.name === name)?.remote ?? null
  await update($, confirmAtom, () => ({
    kind: verb === 'delete' ? ('delete' as const) : ('rebaseCurrent' as const),
    branch: verb === 'delete' ? name : branch,
    hasLocal: local,
    remote,
    // A branch only on the remote: deleting it means deleting it there.
    alsoRemote: !local && remote !== null,
    isBusy: false,
    error: null,
    canAbort: false,
    mode: 'switch' as const,
    stash: false,
    changed: 0,
  }))
}

/**
 * Checkout from the unfolded commit, in the session's own worktree. A branch another worktree has
 * checked out cannot be switched to (git refuses), so its `cd` is copied instead. Clean and a
 * branch: it switches at once. Changed files, or a detached checkout: it asks first, offering to
 * stash the changes.
 */
async function checkoutFromDetail($: EngineInterface, ref: string, hash: string, surface: RenderSurface): Promise<void> {
  const data = await read($, dataAtom)
  const commit = data.commits.find(one => one.hash === hash)
  const own = ownWorktree(data.worktrees, data.cwd)
  const local = commit?.refs.find(one => one.kind === 'branch' && one.name === ref)
  const remote = commit?.refs.find(one => one.kind === 'remote' && `${one.remote ?? ''}/${one.name}` === ref)
  const mode: CheckoutMode = ref === hash ? 'detach' : local !== undefined ? 'switch' : remote !== undefined ? 'track' : 'switch'
  const holder = mode === 'switch' ? data.worktrees.find(one => one.branch === ref && one.path !== own?.path) : undefined
  if (holder !== undefined) {
    const done = await $.ui.copy({ text: `cd ${holder.path}`, surface })
    $.ui.toast(done.isCopied ? `${ref} is checked out in ${holder.path}: copied its cd` : `${ref} is checked out in ${holder.path}`)
    return
  }
  const ask: DetailConfirm = {
    kind: 'checkout',
    branch: ref,
    hasLocal: local !== undefined,
    remote: remote?.remote ?? null,
    alsoRemote: false,
    isBusy: false,
    error: null,
    canAbort: false,
    mode,
    stash: false,
    changed: data.uncommitted,
  }
  await update($, confirmAtom, () => ask)
  if (mode !== 'detach' && data.uncommitted === 0) await runCheckout($)
}

const checkoutArgv = (ask: DetailConfirm): string[] =>
  ask.mode === 'detach' ? ['git', 'switch', '--detach', ask.branch] : ask.mode === 'track' ? ['git', 'switch', '--track', ask.branch] : ['git', 'switch', ask.branch]

/** Runs the asked checkout; a stash made for it is popped back when the switch fails. */
async function runCheckout($: EngineInterface): Promise<void> {
  const ask = await read($, confirmAtom)
  if (ask === null || ask.kind !== 'checkout' || ask.isBusy) return
  await setConfirm($, { isBusy: true, error: null })
  const run = runner($)
  const cwd = await $.session.cwd()
  const label = ask.mode === 'detach' ? ask.branch.slice(0, 7) : ask.branch
  if (ask.stash) {
    const stashed = await run(['git', 'stash', 'push', '--include-untracked', '-m', `git-graph: before checking out ${label}`], cwd)
    if (stashed.exitCode !== 0) {
      await setConfirm($, { isBusy: false, error: said(stashed, 'git stash') })
      return
    }
  }
  let result = await run(checkoutArgv(ask), cwd)
  // --track refuses when a local branch of that name already exists elsewhere: switch to that one.
  if (result.exitCode !== 0 && ask.mode === 'track' && /already exists/.test(result.stderr)) {
    result = await run(['git', 'switch', ask.branch.slice(ask.branch.indexOf('/') + 1)], cwd)
  }
  if (result.exitCode !== 0) {
    const back = ask.stash ? await run(['git', 'stash', 'pop'], cwd) : null
    await refresh($)
    const kept = back !== null && back.exitCode !== 0 ? ' Your changes are still in the stash: git stash pop.' : ''
    await setConfirm($, { isBusy: false, error: `${said(result, 'git switch')}${kept}` })
    return
  }
  await update($, confirmAtom, () => null)
  await refresh($)
  $.ui.toast(ask.stash ? `Checked out ${label}; your changes are stashed (git stash pop brings them back)` : `Checked out ${label}`)
}

/** Merge into the current branch from the unfolded commit; what stopped it is said in a toast. */
async function mergeFromDetail($: EngineInterface, ref: string): Promise<void> {
  const data = await read($, dataAtom)
  const current = ownWorktree(data.worktrees, data.cwd)?.branch ?? null
  if (current === null) return
  if (data.uncommitted > 0) {
    $.ui.toast('Commit or stash the changes in this worktree first.')
    return
  }
  const result = await runner($)(['git', 'merge', '--no-edit', ref], await $.session.cwd())
  await refresh($)
  if (result.exitCode === 0) $.ui.toast(`Merged ${ref} into ${current}`)
  else $.ui.toast(`Merge stopped: ${firstLine(result.stdout) || firstLine(result.stderr)}; git merge --abort undoes it`)
}

async function abortRebaseHere($: EngineInterface): Promise<void> {
  const result = await runner($)(['git', 'rebase', '--abort'], await $.session.cwd())
  await refresh($)
  if (result.exitCode === 0) await update($, confirmAtom, () => null)
  else await setConfirm($, { error: said(result, 'git rebase --abort') })
}

/** The last commit asked about and when: one press can arrive twice, and a second prompt is noise. */
let lastAsk = { hash: '', at: 0 }

function askClaude($: EngineInterface, hash: string): void {
  const now = Date.now()
  if (lastAsk.hash === hash && now - lastAsk.at < 3000) return
  lastAsk = { hash, at: now }
  void $.prompt.submit({ text: `Explain commit ${hash} in this repo` })
}

const firstLine = (text: string): string => text.trim().split('\n')[0] ?? ''

/**
 * Pull & Fetch: fetches every remote (pruning gone branches), then fast-forwards the session's
 * branch from its upstream when the worktree is clean. Never merges or rebases on its own.
 */
async function fetchAndPull($: EngineInterface): Promise<void> {
  if (await read($, syncingAtom)) return
  await update($, syncingAtom, () => true)
  try {
    const run = runner($)
    const data = await read($, dataAtom)
    const cwd = await $.session.cwd()
    $.ui.toast('Fetching…')
    const fetched = await run(['git', 'fetch', '--all', '--prune'], data.repoRoot ?? cwd)
    if (fetched.exitCode !== 0) {
      $.ui.toast(`Fetch failed: ${firstLine(fetched.stderr) || `exit ${fetched.exitCode}`}`)
      return
    }
    const own = ownWorktree(data.worktrees, data.cwd)
    const upstream = await run(['git', 'rev-parse', '--abbrev-ref', '@{upstream}'], cwd)
    if (own?.branch == null || upstream.exitCode !== 0) {
      $.ui.toast('Fetched; this branch has no upstream to pull from')
    } else if (data.uncommitted > 0) {
      $.ui.toast(`Fetched; not pulled: ${data.uncommitted} changed files here`)
    } else {
      const pulled = await run(['git', 'pull', '--ff-only'], cwd)
      $.ui.toast(
        pulled.exitCode === 0
          ? `Fetched and pulled ${own.branch}: ${firstLine(pulled.stdout) || 'up to date'}`
          : `Fetched; pull refused: ${firstLine(pulled.stderr) || `exit ${pulled.exitCode}`}`,
      )
    }
  } finally {
    await update($, syncingAtom, () => false)
    await refresh($)
  }
}

/** Runs the included items one by one; stops at the first failure and keeps its stderr on the card. */
async function confirmCleanup($: EngineInterface): Promise<void> {
  const card = await read($, cleanupAtom)
  if (card.plan === null || card.isBusy) return
  const items = allItems(card.plan).filter(one => !card.excluded.includes(one.id))
  await update($, cleanupAtom, current => ({ ...current, isBusy: true, error: null }))
  const data = await read($, dataAtom)
  const repoDir = data.worktrees[0]?.path ?? data.repoRoot ?? ''
  const outcome = await runCleanup(runner($), repoDir, items)
  await refresh($)
  if (outcome.failure === null) {
    await update($, cleanupAtom, () => CLOSED_CARD)
    $.ui.toast(`Removed ${outcome.done}`)
    return
  }
  try {
    const plan = await collectPlan(runner($), repoDir, await $.session.cwd())
    await update($, cleanupAtom, () => ({ ...CLOSED_CARD, isOpen: true, plan, error: outcome.failure }))
  } catch {
    await update($, cleanupAtom, () => ({ ...CLOSED_CARD, isOpen: true, error: outcome.failure }))
  }
}

async function open($: EngineInterface, focus: boolean): Promise<void> {
  await update($, isOpenAtom, () => true)
  if (focus) await $.ui.open({ id: PANE, title: 'Git graph', focus: true })
  else await $.ui.open({ id: PANE, title: 'Git graph' })
}

const ellipsise = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const markText = (mark: WorktreeMark): string =>
  mark.kind === 'at' ? `▤ ${mark.name}${mark.isOwn ? ' ✦' : ''}` : `▤ ${mark.name} ⤴`

/**
 * The rows that fit the desktop's limit on one pane (256 KB serialized, else it draws nothing):
 * newest first, up to ROWS_BUDGET characters, so Load more can never blank the pane.
 */
function fitRows<T>(rows: readonly T[]): { rows: T[]; isFull: boolean } {
  const out: T[] = []
  let total = 0
  for (const row of rows) {
    total += JSON.stringify(row).length
    if (total > ROWS_BUDGET && out.length > 0) return { rows: out, isFull: true }
    out.push(row)
  }
  return { rows: out, isFull: false }
}

/** `2026-11-01T14:03:22+01:00` as `2026-11-01 14:03`. */
const when = (iso: string): string => iso.replace('T', ' ').slice(0, 16)

function matches(commit: Commit, needle: string): boolean {
  if (needle === '') return true
  const text = needle.toLowerCase()
  return (
    commit.subject.toLowerCase().includes(text) ||
    commit.author.toLowerCase().includes(text) ||
    commit.hash.startsWith(text)
  )
}

function worktreeStatus(one: WorktreeInfo): string {
  if (one.modified === 0 && one.untracked === 0) return 'clean'
  return [one.modified > 0 ? `${one.modified} modified` : '', one.untracked > 0 ? `${one.untracked} untracked` : '']
    .filter(Boolean)
    .join(', ')
}

const isColumn = (value: unknown): value is ColumnId => typeof value === 'string' && (COLUMN_IDS as readonly string[]).includes(value)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gitgraph', description: 'Open the git graph pane' })
    // The pane opens on demand; only a reload of an open pane brings it back.
    if (await read($, isOpenAtom)) void open($, false)
    void refresh($)
    $.clock.every(5000, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'gitgraph' }, async $ => {
    await open($, true)
    void refresh($)
    return { text: 'Git graph pane opened.' }
  })

  // Only watches: a failure here never keeps the pane from closing.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, isOpenAtom, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A row's Client says which button went down over it; a column edge says the width it is dragged to.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const data = e.data
    if (e.element.startsWith('icon:') && typeof e.data === 'object' && e.data !== null && 'isHovered' in e.data) {
      const id = e.element.slice(5)
      const isOn = (e.data as IconHover).isHovered === true
      await update($, hoveredAtom, now => (isOn ? id : now === id ? '' : now))
      return {}
    }
    if (e.element.startsWith('icon:') && typeof e.data === 'object' && e.data !== null && (e.data as IconPress).isPressed === true) {
      const which = e.element.slice(5)
      const [verb = '', ...rest] = which.split(':')
      const arg = rest.join(':')
      const hash = await read($, selectedAtom)
      if (which === 'sync') void fetchAndPull($)
      else if (which === 'cleanup') void openCleanup($, null)
      else if (which === 'columns') await update($, configuringAtom, is => !is)
      else if (verb === 'copy') {
        const done = await $.ui.copy({ text: arg, surface: e.surface })
        $.ui.toast(done.isCopied ? `Copied ${arg.slice(0, 7)}` : 'Clipboard unavailable')
      } else if (verb === 'ask') askClaude($, arg)
      else if (verb === 'checkout') await checkoutFromDetail($, arg, hash, e.surface)
      else if (verb === 'actions') await openMenu($, arg, 0)
      else if (verb === 'merge') void mergeFromDetail($, arg)
      else if (verb === 'rebasecur' || verb === 'delete') await askFromDetail($, verb, arg, hash)
      return {}
    }
    const isEdge = e.element.startsWith('resize:')
    if ((!e.element.startsWith('row:') && !isEdge) || typeof data !== 'object' || data === null) return next(e)
    const hash = e.element.slice(4)
    if ('width' in data) {
      const { column, width } = data as ResizeMove
      if (!isColumn(column) || typeof width !== 'number' || !Number.isFinite(width)) return {}
      const cells = Math.max(column === 'graph' ? 2 : 4, Math.min(200, Math.round(width)))
      const now = await read($, columnsAtom)
      if (now.widths[column] !== cells) await update($, columnsAtom, current => ({ ...current, widths: { ...current.widths, [column]: cells } }))
      return {}
    }
    if ('button' in data && !isEdge) {
      const { button, x } = data as RowPress
      if (button === 'right') await openMenu($, hash, typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0)
      else if (button === 'left') {
        await closeMenu($)
        await toggleSelected($, hash)
      }
      return {}
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const data = await read($, dataAtom)
    const isOpen = await read($, isOpenAtom)

    if (data.cwd !== '' && data.repoRoot === null) {
      return (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>⎇ no repository</Text>
        </Box>
      )
    }
    const launcher = (
      <Button key="git-graph" plain dimColor={isOpen} onPress={() => void open($, true)}>
        {isOpen ? '⎇ Git graph ·' : '⎇ Git graph'}
      </Button>
    )
    if (data.cwd === '') return <Box flexDirection="row" gap={1}>{launcher}</Box>

    const own = ownWorktree(data.worktrees, data.cwd)
    const branch = own?.branch ?? (own ? `(detached ${own.head.slice(0, 7)})` : '')
    const sync = own && own.ahead !== null && own.behind !== null ? `↑${own.ahead} ↓${own.behind}` : ''
    const changed = data.uncommitted === 0 ? 'clean' : `${data.uncommitted} changed`
    const columns = e.viewport?.columns
    const summary = [ellipsise(branch, columns === undefined ? 40 : Math.max(12, Math.min(40, columns - 40))), sync, changed, `${data.worktrees.length} worktrees`]
      .filter(part => part !== '')
      .join('  ')
    return (
      <Box flexDirection="row" gap={1}>
        {launcher}
        <Text dimColor wrap="truncate-end">{summary}</Text>
      </Box>
    )
  })

  // Only watches (a command may have moved a branch): a failure here never blocks or changes a Bash call.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
  }).catch(($, e, next) => next(e))

  // A drawing that throws leaves the pane blank; this says why in the pane instead.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
      return await next(e)
    } catch (error) {
      const { Box, Text } = $.ui.resolve(e)
      const said = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="#ee7b7b">Git graph could not draw this pane.</Text>
          <Text dimColor wrap="wrap">{said}</Text>
        </Box>
      )
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // The mobile surface has no Input or Select; the engine draws its own there.
    if (e.surface === 'mobile') return next(e)
    const t = $.ui.resolve(e)
    const { Box, Text, Button, Input, Select } = t
    const svg = 'Svg' in t ? t.Svg : undefined
    // VS Code has no Client: rows fall back to a Button, and the menu opens from the row's detail.
    const Client = 'Client' in t ? t.Client : undefined

    const data = await read($, dataAtom)
    const scope = await read($, scopeAtom)
    const filter = await read($, filterAtom)
    const limit = await read($, limitAtom)
    const selected = await read($, selectedAtom)
    const card = await read($, cleanupAtom)
    const menu = await read($, menuAtom)
    const columns = await read($, columnsAtom)
    const isConfiguring = await read($, configuringAtom)
    const isTerminal = e.surface === 'terminal'
    const isDark = await read($, isDarkAtom)
    const detail = await read($, detailAtom)
    const confirm = await read($, confirmAtom)

    const rows = filter === '' ? withUncommitted(data.commits, data.headHash, data.uncommitted) : data.commits
    const layout = layoutGraph(rows)
    const rowOf = new Map(layout.map(row => [row.hash, row]))
    const maxLanes = layout.reduce((most, row) => Math.max(most, row.laneCount), 1)
    const laneArea = laneAreaWidth(maxLanes)

    const here = ownWorktree(data.worktrees, data.cwd)
    const current = here?.branch ?? null
    const marks = worktreeMarks(data.worktrees, data.worktreeBases, here?.path ?? null)

    const visible = rows.filter(commit => commit.hash === UNCOMMITTED_HASH || matches(commit, filter))
    const perPage = Math.max(8, (e.viewport?.rows ?? 30) - 8)
    const shown = visible.slice(0, perPage + limit)
    const shownHashes = new Set(shown.map(one => one.hash))
    const outOfView = data.worktrees.filter(one => !shownHashes.has(one.head))
    const notInView =
      outOfView.length === 0
        ? ''
        : `${outOfView.length} worktree${outOfView.length === 1 ? '' : 's'} not in view: ${outOfView.map(one => one.path.split('/').filter(Boolean).pop() ?? one.path).join(', ')}`

    const show = columns.visible
    // The graph column fits its lanes until the person drags it narrower or wider.
    // Capped, so a history with many parallel lanes still leaves the text its room until dragged wider.
    const fitGraph = Math.min(MAX_DEFAULT_GRAPH, isTerminal ? maxLanes * 2 + 1 : Math.ceil(laneArea / PX_PER_CELL) + 1)
    const graphWidth = columns.widths.graph ?? fitGraph
    const widthOf = (id: Exclude<ColumnId, 'graph'>): number => (show[id] ? columns.widths[id] : 0)

    const refreshNow = (): void => void refresh($)
    // The row text starts right after the graph column; keep the dropdown's left edge inside the pane.
    const menuLeft = (x: number): number =>
      Math.max(0, Math.min((show.graph ? graphWidth + 1 : 0) + x, (e.props.bodyColumns ?? 80) - MENU_WIDTH))

    const isSyncing = await read($, syncingAtom)
    const hovered = await read($, hoveredAtom)
    // The description of the icon under the pointer, as a line under its row: in the flow, so nothing
    // drawn later covers it and no box clips it (a floating card can be both).
    // The description of the hovered icon, at the end of its own row of icons: nothing below it moves.
    // `target` is what the icon ids of that row end in (`merge:<target>`, `delete:<target>`…).
    const inlineTip = (key: string, target: string) => {
      const at = hovered.indexOf(':')
      return at > 0 && hovered.slice(at + 1) === target && tips.has(hovered) ? (
        // Width 0 and grow: it only fills what the row leaves over, so showing it never moves the name or
        // the icons; a moved icon would lose the pointer, hide the text, and get it back, blinking.
        <Box key={`tip-line:${key}`} width={0} minWidth={0} flexGrow={1} overflow="hidden">
          <Text color={ink} wrap="truncate-end">{tips.get(hovered)}</Text>
        </Box>
      ) : null
    }
    const ink = isDark ? '#c9ccd1' : '#5b5e66'
    // A bare icon, no button chrome: its Svg with an invisible press area over it, and a hover tooltip.
    const tips = new Map<string, string>()
    const icon = (id: string, paths: string, tip: string, onTerminal: () => void, terminalLabel: string) => {
      tips.set(id, tip)
      // The terminal's table answers Svg with an empty Box, so it gets a labelled Button instead.
      return svg && Client && !isTerminal ? (
        <Box key={`tip:${id}`} position="relative" flexShrink={0}>
          {svg({
            source: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`,
            alt: tip,
            width: 18,
            height: 18,
          })}
          <Box position="absolute" top={0} left={0} right={0} bottom={0}>
            <Client key={`icon:${id}`} module="./icon.tsx" width="100%" height="100%" />
          </Box>
        </Box>
      ) : (
        <Button key={id} label={terminalLabel} onPress={onTerminal} />
      )
    }

    const header = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
        <Box gap={2} alignItems="center">
          <Select
            key="scope"
            options={[
              { value: 'all', label: 'All branches' },
              { value: 'current', label: 'Current branch' },
            ]}
            value={scope}
            onSelect={value => {
              void update($, scopeAtom, () => (value === 'current' ? 'current' : 'all')).then(refreshNow)
            }}
          />
          {icon(
            'sync',
            ICONS.sync,
            isSyncing ? 'Fetching…' : 'Pull & Fetch: fetch all remotes, fast-forward this branch if clean',
            () => void fetchAndPull($),
            isSyncing ? 'Fetching…' : 'Pull & Fetch',
          )}
          {icon(
            'cleanup',
            ICONS.cleanup,
            'Clean up what is merged into the default branch (lists it, asks first)',
            () => void openCleanup($, null),
            'Clean up',
          )}
          {icon('columns', ICONS.columns, 'Columns: show or hide Graph, Date, Author, Commit', () => void update($, configuringAtom, is => !is), 'Columns')}
          <Box gap={1} alignItems="center" flexGrow={1} minWidth={30}>
            {svg && !isTerminal ? (
              <Box key="loupe" flexShrink={0}>
                {svg({ source: LOUPE, alt: 'Filter', width: 16, height: 16 })}
              </Box>
            ) : (
              <Text dimColor>⌕</Text>
            )}
            <Box flexGrow={1}>
              <Input
                key="filter"
                placeholder="Filter commits"
                value={filter}
                onInput={value => void update($, filterAtom, () => value)}
                onSubmit={value => void update($, filterAtom, () => value)}
              />
            </Box>
          </Box>
        </Box>
        {/* One status line under the toolbar, always there so hovering never moves the list: the hovered
            icon's description, else the worktrees whose commit is not loaded. */}
        {svg && Client && !isTerminal && (
          <Box key="caption:toolbar" height={1} flexShrink={0} overflow="hidden">
            {hovered !== '' && TOOLBAR.includes(hovered) ? (
              <Text color={ink} wrap="truncate-end">{tips.get(hovered) ?? ' '}</Text>
            ) : (
              <Text dimColor wrap="truncate-end">{notInView === '' ? ' ' : notInView}</Text>
            )}
          </Box>
        )}
        </Box>
        {isConfiguring && (
          <Box gap={2} alignItems="center">
            <Text dimColor>Show</Text>
            {COLUMN_IDS.map(id => (
              <Button
                key={`column:${id}`}
                plain
                dimColor={!show[id]}
                onPress={() =>
                  void update($, columnsAtom, now => ({ ...now, visible: { ...now.visible, [id]: !now.visible[id] } }))
                }
              >
                {`${show[id] ? '✓' : '–'} ${COLUMN_TITLES[id]}`}
              </Button>
            ))}
            <Button key="columns:reset" label="Reset widths" onPress={() => void update($, columnsAtom, now => ({ ...now, widths: DEFAULT_COLUMNS.widths }))} />
          </Box>
        )}
      </Box>
    )

    const toggleRow = (item: CleanupItem) => {
      const isOn = !card.excluded.includes(item.id)
      return (
        <Button
          key={`toggle:${item.id}`}
          plain
          dimColor={!isOn}
          onPress={() =>
            void update($, cleanupAtom, current => ({
              ...current,
              excluded: current.excluded.includes(item.id)
                ? current.excluded.filter(id => id !== item.id)
                : [...current.excluded, item.id],
            }))
          }
        >
          <Text>{isOn ? '✓' : '–'}</Text>
          <Text>{item.label}</Text>
          {item.isAgent && <Text backgroundColor="#2c3a4d" color="#c9d8ee"> agent </Text>}
          <Text dimColor>{item.reason}</Text>
        </Button>
      )
    }
    const group = (title: string, items: CleanupItem[]) =>
      items.length === 0 ? null : (
        <Box key={title} flexDirection="column">
          <Text bold dimColor>{title}</Text>
          {items.map(toggleRow)}
        </Box>
      )
    const included = card.plan === null ? 0 : allItems(card.plan).filter(one => !card.excluded.includes(one.id)).length
    const cancel = <Button key="cancel" label="Cancel" onPress={() => void update($, cleanupAtom, () => CLOSED_CARD)} />
    const cleanupCard = !card.isOpen ? null : (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Box gap={1}>
          <Text bold>Clean up</Text>
          {card.plan !== null && <Text dimColor>{`merged into ${card.plan.base}`}</Text>}
        </Box>
        {card.isBusy && <Text dimColor>Working…</Text>}
        {!card.isBusy && card.plan !== null && allItems(card.plan).length === 0 && (
          <Text>Nothing to clean up</Text>
        )}
        {card.plan !== null && group('Prune stale worktrees', card.plan.pruneWorktrees)}
        {card.plan !== null && group('Remove merged worktrees', card.plan.removeWorktrees)}
        {card.plan !== null && group('Delete merged branches', card.plan.deleteBranches)}
        {card.plan?.skipped.map(one => (
          <Text dimColor>{`skipped ${one.label}: ${one.reason}`}</Text>
        ))}
        {card.error !== null && <Text color="#ee7b7b">{card.error}</Text>}
        {!card.isBusy && (
          <Box gap={2}>
            {included > 0 && (
              <Button key="confirm" onPress={() => void confirmCleanup($)}>
                <Text backgroundColor="#c0504d" color="#ffffff">{` Remove ${included} `}</Text>
              </Button>
            )}
            {cancel}
          </Box>
        )}
      </Box>
    )

    const copy = (text: string, said: string) => (press: { surface: Parameters<typeof $.ui.copy>[0]['surface'] }) => {
      void $.ui.copy({ text, surface: press.surface }).then(done => $.ui.toast(done.isCopied ? said : 'Clipboard unavailable'))
      void closeMenu($)
    }

    /** The context menu of one row: the commit, then each branch, remote, tag and worktree on it. */
    const contextMenu = (commit: Commit, trees: readonly WorktreeMark[]) => {
      if (menu === null || menu.hash !== commit.hash) return null
      const hash = commit.hash
      const short = hash.slice(0, 7)
      const isHead = hash === data.headHash
      const mergeButton = (key: string, ref: string, label: string) =>
        current === null ? null : <Button key={key} label={`Merge ${label} into ${current}`} onPress={() => void mergeRef($, ref)} />
      // Rewrites the branch's commits, so it asks first.
      const rebaseButton = (key: string, branch: string) =>
        current === null ? null : (
          <Button
            key={key}
            label={`Rebase ${branch} onto ${current}`}
            onPress={() => void update($, menuAtom, now => (now === null ? now : { ...now, confirmRebase: branch, error: null }))}
          />
        )
      const section = (key: string, title: string, buttons: (JSX.Element | null)[]) => (
        <Box key={key} flexDirection="column">
          <Text bold>{title}</Text>
          <Box gap={2}>{buttons}</Box>
        </Box>
      )
      const branches = commit.refs.filter(ref => ref.kind === 'branch')
      const remotes = commit.refs.filter(ref => ref.kind === 'remote')
      const tags = commit.refs.filter(ref => ref.kind === 'tag')
      const atTrees = [...new Map(trees.map(mark => [mark.path, mark])).values()]
      return (
        // Solid: the dropdown sits over the rows and must hide them.
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={menu.isDark ? '#5a5d66' : '#b9bcc4'}
          backgroundColor={menu.isDark ? '#25272c' : '#ffffff'}
          paddingX={1}
          gap={1}
          flexShrink={0}
        >
          {section(`m:${hash}:commit`, `Commit ${short}  ${ellipsise(commit.subject, 60)}`, [
            <Button key={`m:${hash}:copy`} label="Copy hash" onPress={copy(hash, `Copied ${short}`)} />,
            <Button
              key={`m:${hash}:ask`}
              label="Ask Claude"
              onPress={() => {
                void closeMenu($)
                askClaude($, hash)
              }}
            />,
            isHead ? null : mergeButton(`m:${hash}:merge`, hash, short),
          ])}
          {branches.map(ref =>
            section(`m:${hash}:b:${ref.name}`, `⎇ ${ref.name}`, [
              ref.name === current ? null : mergeButton(`m:${hash}:b:${ref.name}:merge`, ref.name, ref.name),
              ref.name === current ? null : rebaseButton(`m:${hash}:b:${ref.name}:rebase`, ref.name),
              <Button key={`m:${hash}:b:${ref.name}:copy`} label="Copy name" onPress={copy(ref.name, `Copied ${ref.name}`)} />,
            ]),
          )}
          {remotes.map(ref => {
            const name = `${ref.remote ?? ''}/${ref.name}`
            return section(`m:${hash}:r:${name}`, `☁ ${name}`, [
              ref.name === 'HEAD' ? null : mergeButton(`m:${hash}:r:${name}:merge`, name, name),
              <Button key={`m:${hash}:r:${name}:copy`} label="Copy name" onPress={copy(name, `Copied ${name}`)} />,
            ])
          })}
          {tags.map(ref =>
            section(`m:${hash}:t:${ref.name}`, `◇ ${ref.name}`, [
              <Button key={`m:${hash}:t:${ref.name}:copy`} label="Copy name" onPress={copy(ref.name, `Copied ${ref.name}`)} />,
            ]),
          )}
          {atTrees.map(mark => {
            const tree = data.worktrees.find(one => one.path === mark.path)
            if (tree === undefined) return null
            const branch = tree.branch
            const sync = tree.ahead === null || tree.behind === null ? '' : `  ↑${tree.ahead} ↓${tree.behind}`
            const blocked =
              tree.path === here?.path
                ? 'this is the session worktree'
                : branch === null
                  ? 'detached HEAD'
                  : branch === current
                    ? `${branch} is checked out here`
                    : null
            return section(
              `m:${hash}:w:${tree.path}`,
              `▤ ${mark.name}  ${branch ?? '(detached)'}  ${worktreeStatus(tree)}${sync}${mark.kind === 'from' ? '  (started here)' : ''}`,
              [
                blocked === null && branch !== null
                  ? mergeButton(`m:${hash}:w:${tree.path}:merge`, branch, branch)
                  : <Text key={`m:${hash}:w:${tree.path}:why`} dimColor>{`no merge or rebase: ${blocked ?? ''}`}</Text>,
                blocked === null && branch !== null ? rebaseButton(`m:${hash}:w:${tree.path}:rebase`, branch) : null,
                <Button key={`m:${hash}:w:${tree.path}:copy`} label="Copy path" onPress={copy(tree.path, 'Copied path')} />,
                tree.isMain ? null : (
                  <Button
                    key={`m:${hash}:w:${tree.path}:remove`}
                    label="Remove worktree…"
                    onPress={() => {
                      void closeMenu($)
                      void openCleanup($, tree.path)
                    }}
                  />
                ),
              ],
            )
          })}
          {menu.confirmRebase !== null && (
            <Box flexDirection="column">
              <Text bold>{`Rebase ${menu.confirmRebase} onto ${current ?? ''}?`}</Text>
              <Text dimColor>{`Its commits are rewritten; the old tip is kept as refs/git-graph/backup/${menu.confirmRebase}.`}</Text>
              <Box gap={2}>
                <Button key="m:rebase:yes" variant="primary" label="Rebase" onPress={() => void rebaseOnto($, menu.confirmRebase ?? '')} />
                <Button key="m:rebase:no" label="Cancel" onPress={() => void update($, menuAtom, now => (now === null ? now : { ...now, confirmRebase: null }))} />
              </Box>
            </Box>
          )}
          {menu.error !== null && <Text color="#ee7b7b">{menu.error}</Text>}
          <Box gap={2}>
            {menu.abort !== null && <Button key="m:abort" label={menu.abort.label} onPress={() => void (menu.abort === null ? undefined : runAbort($, menu.abort))} />}
            <Button key="m:close" label="Close" onPress={() => void closeMenu($)} />
          </Box>
        </Box>
      )
    }

    if (data.repoRoot === null) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          {data.error !== null && <Text color="#ed93b1">{data.error}</Text>}
          <Text dimColor>{data.cwd === '' ? 'Loading…' : 'Not inside a git repository.'}</Text>
        </Box>
      )
    }

    // The desktop dropdown is drawn after every row, so nothing drawn later paints over it; `y` finds its row.
    let y = 0
    const placed: { dropdown: { top: number; left: number; card: ReturnType<typeof contextMenu> } | null } = { dropdown: null }
    const commitRows = shown.map(commit => {
      const row = rowOf.get(commit.hash)
      const laneColor = color(row?.color ?? 0)
      const isUncommitted = commit.hash === UNCOMMITTED_HASH
      const isHead = commit.hash === data.headHash
      const trees = marks.get(commit.hash) ?? []
      const isSelected = selected === commit.hash
      const chips: RowChip[] = [
        ...chipsFor(commit.refs, laneColor).map(chip => ({
          text: ellipsise(chipText(chip), MAX_CHIP),
          color: chip.border,
          isDim: chip.isDim,
          isBold: chip.parts.some(part => part.isBold === true),
        })),
        ...trees.map(mark => ({ text: ellipsise(markText(mark), MAX_CHIP), color: laneColor, isDim: mark.kind === 'from', isBold: mark.isOwn })),
      ]
      // Desktop chips are an Svg of their own (rounded, bordered, tinted) so the row stays as tall as the graph.
      const drawnChips = isTerminal || !svg ? null : chipsSvg(
        [
          ...chipsFor(commit.refs, laneColor).map(chip => ({ ...chip, title: chipText(chip) })),
          ...trees.map(mark => ({
            id: `wt:${mark.kind}:${mark.path}`,
            parts: [{ text: markText(mark), color: laneColor, isBold: mark.isOwn }],
            border: laneColor,
            isDim: mark.kind === 'from',
            title: `${markText(mark)} (${mark.path})`,
          })),
        ],
        0,
      )
      // Hovering the chips shows every ref on the commit in full: what it is and, for a worktree, where.
      const infos = refInfo(commit.refs, trees, data.worktrees)
      const chipsCell =
        drawnChips === null || drawnChips.count === 0 || !svg ? null : (
          <Box key={`chips:${commit.hash}`} flexShrink={0} position="relative">
            <Box
              position="absolute"
              top={2}
              left={0}
              display="none"
              hover={{ display: 'flex' }}
              flexDirection="column"
              borderStyle="round"
              borderColor={isDark ? '#5a5d66' : '#b9bcc4'}
              backgroundColor={isDark ? '#25272c' : '#ffffff'}
              paddingX={1}
              width={CARD_WIDTH}
            >
              {infos.map((info, at) => (
                <Box key={`info:${at}`} flexDirection="column">
                  <Box gap={1}>
                    <Text dimColor>{info.kind}</Text>
                    <Text bold wrap="wrap">{info.name}</Text>
                  </Box>
                  {info.detail !== '' && <Text dimColor wrap="wrap">{info.detail}</Text>}
                </Box>
              ))}
            </Box>
            {svg({
              // CHIP_TRAIL px of empty room after the last chip, before the subject.
              source: `<svg xmlns="http://www.w3.org/2000/svg" width="${drawnChips.width + CHIP_TRAIL}" height="${ROW_HEIGHT}" viewBox="0 0 ${drawnChips.width + CHIP_TRAIL} ${ROW_HEIGHT}">${drawnChips.markup}</svg>`,
              alt: chips.map(chip => chip.text).join(', '),
              width: drawnChips.width + CHIP_TRAIL,
              height: ROW_HEIGHT,
              // An image, not an interactive frame: 200 frames loading is what made chips show up late.
            })}
          </Box>
        )
      const chipsCells = drawnChips === null ? 0 : Math.ceil((drawnChips.width + 6) / PX_PER_CELL)
      // With a filter on, rows are not neighbours any more, so no transition line is drawn.
      const at = rows.indexOf(commit)
      const ascii = isTerminal && row ? asciiLanes(row, filter === '' ? layout[at + 1] : undefined, maxLanes, isHead) : undefined
      const graphCell = !show.graph ? null : (
        <Box key="graph" width={graphWidth} flexShrink={0} overflow="hidden">
          {isTerminal ? (
            <Text color={laneColor} wrap="truncate-end">{ascii?.commit ?? ''}</Text>
          ) : svg && row ? (
            // Never squeezed: a shrunk Svg would be scaled down; the column clips it instead.
            <Box flexShrink={0}>
              {svg({
                source: rowSvg(row, isHead, laneArea),
                alt: isUncommitted ? 'uncommitted changes' : `commit ${commit.hash.slice(0, 7)}`,
                width: laneArea,
                height: ROW_HEIGHT,
              })}
            </Box>
          ) : null}
        </Box>
      )
      const text = Client ? (
        <Client
          key={`row:${commit.hash}`}
          module="./row.tsx"
          flexGrow={1}
          props={{
            chips: drawnChips === null ? chips : [],
            subject: commit.subject,
            isBold: isHead,
            isDim: commit.parents.length > 1 || isUncommitted,
            isSelected,
            isDark,
            date: isUncommitted ? '' : commit.date,
            author: isUncommitted ? '' : commit.author,
            hash: isUncommitted ? '' : commit.hash.slice(0, 7),
            dateWidth: widthOf('date'),
            authorWidth: widthOf('author'),
            commitWidth: widthOf('commit'),
          }}
        />
      ) : (
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Button key={`row:${commit.hash}`} plain onPress={() => void toggleSelected($, commit.hash)}>
            <Text wrap="truncate-end" bold={isHead}>
              {[...chips.map(chip => `[${chip.text}]`), commit.subject].join(' ')}
            </Text>
          </Button>
        </Box>
      )
      const indent = show.graph ? graphWidth + 1 : 0
      const opened = menu?.hash === commit.hash ? contextMenu(commit, trees) : null
      // The unfolded row: the full message and who wrote it, when, where it sits and what it changed.
      const full = isSelected && detail?.hash === commit.hash ? detail : null
      const facts: [string, string][] = !isSelected
        ? []
        : [
            ['Message', full?.subject ?? commit.subject],
            ['Author', full === null ? commit.author : `${full.authorName} <${full.authorEmail}>  ·  ${when(full.authorDate)} (${full.authorAgo})`],
            ...(full !== null && (full.committerName !== full.authorName || full.committerEmail !== full.authorEmail)
              ? [['Committer', `${full.committerName} <${full.committerEmail}>  ·  ${when(full.committerDate)}`] as [string, string]]
              : []),
            ['Commit', commit.hash],
            ...(commit.parents.length > 0 ? [['Parents', commit.parents.map(one => one.slice(0, 7)).join('  ')] as [string, string]] : []),
            ...(full !== null && full.stat !== '' ? [['Changes', full.stat] as [string, string]] : []),
            ...(infos.length > 0 ? [['On', infos.map(info => `${info.kind === 'Worktree' || info.kind === 'Worktree start' ? '▤ ' : ''}${info.name}`).join(', ')] as [string, string]] : []),
          ]
      // Per branch on the unfolded commit: merge or rebase onto it, delete it (suggested once merged).
      const remoteOnly = commit.refs.filter(
        ref => ref.kind === 'remote' && ref.name !== 'HEAD' && !commit.refs.some(one => one.kind === 'branch' && one.name === ref.name),
      )
      const branchActs = !isSelected
        ? []
        : [
            ...commit.refs
              .filter(ref => ref.kind === 'branch')
              .map(ref => ({
                ref: ref.name,
                isRemote: false,
                canMerge: current !== null && ref.name !== current,
                canDelete: ref.name !== current && ref.name !== full?.mergedInto,
                isMerged: full?.mergedInto != null && ref.name !== current && ref.name !== full.mergedInto,
                canCheckout: ref.name !== current,
                holder: data.worktrees.find(one => one.branch === ref.name && one.path !== here?.path)?.path ?? null,
              })),
            ...remoteOnly.map(ref => ({
              ref: `${ref.remote ?? ''}/${ref.name}`,
              isRemote: true,
              canMerge: current !== null,
              canDelete: ref.name !== full?.mergedInto,
              isMerged: full?.mergedInto != null && ref.name !== full.mergedInto,
              canCheckout: true,
              holder: null as string | null,
            })),
          ]
      // The message's closing trailers (Co-Authored-By:, Signed-off-by:…) are drawn dim, after the rest.
      const bodyParts = (full?.body ?? '').split(/\n\s*\n/)
      const last = bodyParts[bodyParts.length - 1] ?? ''
      const isTrailers = last !== '' && last.split('\n').every(line => /^[A-Za-z][A-Za-z-]*: \S/.test(line))
      const trailers = isTrailers ? last : ''
      const fullBody = (isTrailers ? bodyParts.slice(0, -1) : bodyParts).join('\n\n').trim()
      // Estimated in lines of the pane's text, so the dotted lanes beside it reach its bottom.
      const textColumns = Math.max(20, (e.props.bodyColumns ?? 80) - (show.graph ? graphWidth + 1 : 0) - FACT_LABEL - 1)
      const lineCount = (text: string): number => text.split('\n').reduce((sum, one) => sum + Math.max(1, Math.ceil(one.length / textColumns)), 0)
      const detailHeight = !isSelected
        ? 0
        : (facts.reduce((sum, [, value]) => sum + lineCount(value), 0) + (fullBody === '' ? 0 : lineCount(fullBody)) + (trailers === '' ? 0 : lineCount(trailers) + 1) + 2) * LINE_PX +
          DETAIL_HEIGHT +
          (branchActs.length > 0 ? (branchActs.length + 1) * LINE_PX : 0) +
          (confirm !== null ? 6 * LINE_PX : 0)
      // Desktop rows are one lane Svg tall, and so is a selected row's detail line.
      y += ROW_HEIGHT
      if (opened !== null && !isTerminal) placed.dropdown = { top: Math.round(y / LINE_PX), left: menuLeft(chipsCells + (menu?.x ?? 0)), card: opened }
      if (isSelected && !isUncommitted) y += detailHeight
      return (
        <Box key={commit.hash} flexDirection="column" position="relative">
          <Box alignItems="center" flexShrink={0} overflow="hidden">
            {graphCell}
            {/* The gap the list's one graph-edge handle lies over. */}
            {show.graph && <Box key="edge" width={1} flexShrink={0} />}
            {chipsCell}
            {text}
          </Box>
          {show.graph &&
            ascii?.transitions.map(line => (
              <Box width={graphWidth} overflow="hidden">
                <Text dimColor wrap="truncate-end">{line}</Text>
              </Box>
            ))}
          {opened !== null &&
            (isTerminal ? (
              // The terminal paints in tree order, so later rows would cover an overlay: the menu flows under the row.
              <Box paddingLeft={indent}>{opened}</Box>
            ) : null)}
          {isSelected && !isUncommitted && (
            <Box alignItems="flex-start" position="relative">
              {show.graph &&
                (svg && row ? (
                  // The lanes that go on below this commit carry on, dotted, past its details. Laid over the row and
                  // clipped to it, so the details alone decide its height and a long estimate leaves no gap.
                  <Box key="lanes" position="absolute" top={0} left={0} bottom={0} width={graphWidth + 1} overflow="hidden">
                    <Box flexShrink={0}>
                      {svg({ source: laneFiller(row, laneArea, detailHeight), alt: 'lanes', width: laneArea, height: detailHeight })}
                    </Box>
                  </Box>
                ) : null)}
              {show.graph && <Box key="lanes:room" width={graphWidth + 1} flexShrink={0} />}
              <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" paddingTop={1} paddingBottom={1}>
                {facts.map(([label, value]) => (
                  <Box key={`fact:${label}`} gap={1}>
                    <Box width={FACT_LABEL} flexShrink={0}>
                      <Text dimColor>{label}</Text>
                    </Box>
                    <Box flexShrink={1}>
                      <Text wrap="wrap" bold={label === 'Message'}>{value}</Text>
                    </Box>
                  </Box>
                ))}
                {fullBody !== '' && (
                  <Box gap={1}>
                    <Box width={FACT_LABEL} flexShrink={0} />
                    <Box flexShrink={1}>
                      <Text wrap="wrap">{fullBody}</Text>
                    </Box>
                  </Box>
                )}
                {trailers !== '' && (
                  <Box key="trailers" gap={1} paddingTop={fullBody === '' ? 0 : 1}>
                    <Box width={FACT_LABEL} flexShrink={0} />
                    <Box flexShrink={1}>
                      <Text dimColor wrap="wrap">{trailers}</Text>
                    </Box>
                  </Box>
                )}
                <Box gap={2} paddingTop={1} alignItems="center">
                  {!isHead &&
                    icon(`checkout:${commit.hash}`, ICONS.checkout, `Check out this commit here, detached (git switch --detach; asks first)`, () => void checkoutFromDetail($, commit.hash, commit.hash, 'terminal'), 'Check out')}
                  {icon(`copy:${commit.hash}`, ICONS.copy, 'Copy the full hash', () => void $.ui.copy({ text: commit.hash, surface: 'terminal' }), 'Copy hash')}
                  {current !== null && !isHead &&
                    icon(`merge:${commit.hash}`, ICONS.merge, `Merge this commit into ${current}`, () => void mergeFromDetail($, commit.hash), 'Merge')}
                  {icon(`ask:${commit.hash}`, ICONS.ask, 'Ask Claude about this commit', () => askClaude($, commit.hash), 'Ask Claude')}
                  {icon(`actions:${commit.hash}`, ICONS.more, 'More: every action for this commit and its refs', () => void openMenu($, commit.hash, 0), 'Actions…')}
                  {inlineTip(`commit:${commit.hash}`, commit.hash)}
                </Box>
                {branchActs.map((act, at) => (
                  <Box key={`act:${act.ref}`} gap={2} alignItems="center" paddingTop={at === 0 ? 1 : 0}>
                    <Box flexShrink={1} overflow="hidden">
                      <Text bold wrap="truncate-end">{`${act.isRemote ? '☁' : '⎇'} ${act.ref}`}</Text>
                    </Box>
                    {act.canCheckout &&
                      icon(
                        `checkout:${act.ref}`,
                        ICONS.checkout,
                        act.holder !== null
                          ? `${act.ref} is checked out in ${act.holder}: copies its cd`
                          : act.isRemote
                            ? `Check out ${act.ref} here as a local branch tracking it (git switch --track)${data.uncommitted > 0 ? '; asks about your changes' : ''}`
                            : `Check out ${act.ref} here (git switch)${data.uncommitted > 0 ? '; asks about your changes' : ''}`,
                        () => void checkoutFromDetail($, act.ref, commit.hash, 'terminal'),
                        act.holder !== null ? 'Copy cd' : 'Check out',
                      )}
                    {act.canMerge && icon(`merge:${act.ref}`, ICONS.merge, `Merge ${act.ref} into ${current ?? ''} (git merge --no-edit)`, () => void mergeFromDetail($, act.ref), 'Merge')}
                    {act.canMerge &&
                      icon(`rebasecur:${act.ref}`, ICONS.rebase, `Rebase ${current ?? ''} onto ${act.ref}: asks first and keeps a backup of ${current ?? ''}`, () => void askFromDetail($, 'rebasecur', act.ref, commit.hash), 'Rebase onto')}
                    {act.canDelete && icon(`delete:${act.ref}`, ICONS.delete, act.isRemote ? `Delete ${act.ref} on the remote: asks first` : `Delete ${act.ref}: asks first, never forced, and can delete it on the remote too`, () => void askFromDetail($, 'delete', act.ref, commit.hash), 'Delete…')}
                    {inlineTip(`act:${act.ref}`, act.ref) ??
                      (act.isMerged && (
                        <Box width={0} minWidth={0} flexGrow={1} overflow="hidden">
                          <Text color="#5dcaa5" wrap="truncate-end">{`merged into ${full?.mergedInto ?? ''}: safe to delete`}</Text>
                        </Box>
                      ))}
                  </Box>
                ))}
                {confirm !== null && (
                  <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
                    <Text bold>
                      {confirm.kind === 'checkout'
                        ? confirm.mode === 'detach'
                          ? `Check out ${confirm.branch.slice(0, 7)} here, detached?`
                          : `Check out ${confirm.branch} here?`
                        : confirm.kind === 'delete'
                        ? confirm.hasLocal
                          ? `Delete branch ${confirm.branch}?`
                          : `Delete ${confirm.remote ?? ''}/${confirm.branch} on the remote?`
                        : `Rebase ${current ?? ''} onto ${confirm.branch}?`}
                    </Text>
                    <Text dimColor wrap="wrap">
                      {confirm.kind === 'checkout'
                        ? `${checkoutArgv(confirm).join(' ')}${confirm.mode === 'detach' ? ': no branch is checked out afterwards; new commits need a branch to keep them.' : '.'}${
                            confirm.changed > 0 && !confirm.stash ? ` Your ${confirm.changed} changed files come along; git refuses if they clash.` : ''
                          }`
                        : confirm.kind === 'delete'
                        ? confirm.hasLocal
                          ? 'git branch -d: git refuses a branch that is not merged or is checked out in a worktree.'
                          : `git push ${confirm.remote ?? ''} --delete ${confirm.branch}: removes it for everyone.`
                        : `Its commits are rewritten; the old tip is kept as refs/git-graph/backup/${current ?? ''}.`}
                    </Text>
                    {confirm.kind === 'checkout' && confirm.changed > 0 && (
                      <Button key="confirm:stash" plain onPress={() => void setConfirm($, { stash: !confirm.stash })}>
                        {`${confirm.stash ? '☑' : '☐'} Stash the ${confirm.changed} changes first (git stash -u; put back if the switch fails)`}
                      </Button>
                    )}
                    {confirm.kind === 'delete' && confirm.hasLocal && confirm.remote !== null && (
                      <Button key="confirm:remote" plain onPress={() => void setConfirm($, { alsoRemote: !confirm.alsoRemote })}>
                        {`${confirm.alsoRemote ? '☑' : '☐'} Also delete ${confirm.remote}/${confirm.branch} on the remote`}
                      </Button>
                    )}
                    {confirm.error !== null && <Text color="#ee7b7b" wrap="wrap">{confirm.error}</Text>}
                    <Box gap={2}>
                      {confirm.isBusy ? (
                        <Text dimColor>Working…</Text>
                      ) : (
                        <Button
                          key="confirm:yes"
                          variant="primary"
                          label={confirm.kind === 'delete' ? 'Delete' : confirm.kind === 'checkout' ? 'Check out' : 'Rebase'}
                          onPress={() => void (confirm.kind === 'delete' ? deleteBranch($) : confirm.kind === 'checkout' ? runCheckout($) : rebaseCurrentOnto($))}
                        />
                      )}
                      {confirm.canAbort && <Button key="confirm:abort" label="git rebase --abort" onPress={() => void abortRebaseHere($)} />}
                      <Button key="confirm:no" label="Cancel" onPress={() => void update($, confirmAtom, () => null)} />
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Box>
      )
    })

    const fitted = fitRows(commitRows)
    return (
      <Box flexDirection="column" gap={1}>
        {cleanupCard}
        {header}
        {data.error !== null && <Text color="#ed93b1">{data.error}</Text>}
        {isTerminal && notInView !== '' && <Text dimColor wrap="truncate-end">{notInView}</Text>}
        {fitted.rows.length === 0 ? (
          <Text dimColor>No commits.</Text>
        ) : (
          // No gap here: the rows' own height is the only spacing, so lane lines meet at the row edges.
          <Box flexDirection="column">
            {fitted.rows}
            {show.graph && Client && (
              // One handle over every row's gap after the graph column, not one per row: rows stay small.
              <Box key="graph-edge" position="absolute" top={0} bottom={0} left={graphWidth}>
                <Client key="resize:graph" module="./resize.tsx" props={{ column: 'graph', width: graphWidth, sign: 1 }} width={1} height="100%" />
              </Box>
            )}
            {placed.dropdown !== null && (
              <Box key="dropdown" position="absolute" top={placed.dropdown.top} left={placed.dropdown.left}>
                {placed.dropdown.card}
              </Box>
            )}
          </Box>
        )}
        {fitted.isFull ? (
          <Text dimColor>{`Showing the newest ${fitted.rows.length} commits, all the pane can hold; filter to find older ones.`}</Text>
        ) : (
          (visible.length > shown.length || data.hasMore) && (
            <Button key="more" label="Load more" onPress={() => void update($, limitAtom, n => n + PAGE).then(refreshNow)} />
          )
        )}
      </Box>
    )
  })
}

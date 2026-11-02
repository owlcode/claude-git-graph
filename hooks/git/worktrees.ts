import type { WorktreeInfo } from '../../types'
import type { Run } from './run'

export type RawWorktree = {
  path: string
  head: string
  branch: string | null
  isDetached: boolean
  isBare: boolean
  isLocked: boolean
  isPrunable: boolean
}

/** Parses `git worktree list --porcelain`: blocks of `key value` lines split by a blank line. */
export function parseWorktreePorcelain(out: string): RawWorktree[] {
  const list: RawWorktree[] = []
  for (const block of out.split(/\n\s*\n/)) {
    let current: RawWorktree | null = null
    for (const line of block.split('\n')) {
      const space = line.indexOf(' ')
      const key = space === -1 ? line : line.slice(0, space)
      const value = space === -1 ? '' : line.slice(space + 1)
      if (key === 'worktree') {
        current = { path: value, head: '', branch: null, isDetached: false, isBare: false, isLocked: false, isPrunable: false }
        list.push(current)
      } else if (current === null) {
        continue
      } else if (key === 'HEAD') {
        current.head = value
      } else if (key === 'branch') {
        current.branch = value.replace(/^refs\/heads\//, '')
      } else if (key === 'detached') {
        current.isDetached = true
      } else if (key === 'bare') {
        current.isBare = true
      } else if (key === 'locked') {
        current.isLocked = true
      } else if (key === 'prunable') {
        current.isPrunable = true
      }
    }
  }
  return list
}

export type StatusCounts = { modified: number; untracked: number }

/** Counts `git status --porcelain` lines: `??` is untracked, any other entry is modified. */
export function parseStatus(out: string): StatusCounts {
  const counts: StatusCounts = { modified: 0, untracked: 0 }
  for (const line of out.split('\n')) {
    if (line.length < 3) continue
    if (line.startsWith('??')) counts.untracked += 1
    else if (!line.startsWith('!!')) counts.modified += 1
  }
  return counts
}

export type AheadBehind = { ahead: number; behind: number }

/** Parses `git rev-list --left-right --count a...b` (`<left>\t<right>`). */
export function parseAheadBehind(out: string): AheadBehind | null {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(out)
  return match ? { ahead: Number(match[1]), behind: Number(match[2]) } : null
}

export async function readWorktrees(run: Run, cwd: string): Promise<WorktreeInfo[]> {
  const listed = await run(['git', 'worktree', 'list', '--porcelain'], cwd)
  if (listed.exitCode !== 0) throw new Error(listed.stderr.trim() || 'git worktree list failed')
  const raw = parseWorktreePorcelain(listed.stdout)

  return Promise.all(
    raw.map(async (one, index): Promise<WorktreeInfo> => {
      let counts: StatusCounts = { modified: 0, untracked: 0 }
      let diverge: AheadBehind | null = null
      if (!one.isBare) {
        const status = await run(['git', 'status', '--porcelain'], one.path)
        if (status.exitCode === 0) counts = parseStatus(status.stdout)
        if (one.branch !== null) {
          const range = await run(
            ['git', 'rev-list', '--left-right', '--count', `${one.branch}...${one.branch}@{upstream}`],
            one.path,
          )
          if (range.exitCode === 0) diverge = parseAheadBehind(range.stdout)
        }
      }
      return {
        ...one,
        isMain: index === 0,
        ahead: diverge?.ahead ?? null,
        behind: diverge?.behind ?? null,
        modified: counts.modified,
        untracked: counts.untracked,
      }
    }),
  )
}


/** The worktree the session runs in: the deepest worktree path holding the cwd. */
export function ownWorktree(worktrees: readonly WorktreeInfo[], cwd: string): WorktreeInfo | undefined {
  return worktrees
    .filter(one => cwd === one.path || cwd.startsWith(`${one.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

import type { WorktreeBase, WorktreeInfo } from '../../types'

/** A worktree chip on a commit: `at` where its HEAD is, `from` where its branch left the default branch. */
export type WorktreeMark = { path: string; name: string; kind: 'at' | 'from'; isOwn: boolean }

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

export function worktreeMarks(
  worktrees: readonly WorktreeInfo[],
  bases: readonly WorktreeBase[],
  ownPath: string | null,
): Map<string, WorktreeMark[]> {
  const marks = new Map<string, WorktreeMark[]>()
  const add = (hash: string, mark: WorktreeMark): void => {
    marks.set(hash, [...(marks.get(hash) ?? []), mark])
  }
  for (const one of worktrees) {
    add(one.head, { path: one.path, name: basename(one.path), kind: 'at', isOwn: one.path === ownPath })
  }
  for (const base of bases) {
    add(base.base, { path: base.path, name: basename(base.path), kind: 'from', isOwn: base.path === ownPath })
  }
  return marks
}

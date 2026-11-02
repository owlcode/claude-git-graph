import type { GitRef, WorktreeInfo } from '../../types'
import type { WorktreeMark } from './marks'

/** One line of a commit's ref card: what the ref is, its full name, and what more there is to say. */
export type RefInfo = { kind: string; name: string; detail: string }

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

function status(one: WorktreeInfo): string {
  const changes =
    one.modified === 0 && one.untracked === 0
      ? 'clean'
      : [one.modified > 0 ? `${one.modified} modified` : '', one.untracked > 0 ? `${one.untracked} untracked` : '']
          .filter(Boolean)
          .join(', ')
  const sync = one.ahead === null || one.behind === null ? '' : `, ↑${one.ahead} ↓${one.behind}`
  return `${changes}${sync}`
}

/**
 * Every ref and worktree on one commit, untruncated, each saying what it is: a local branch (and
 * the worktree that has it checked out), a remote branch, a tag, a detached HEAD, a worktree.
 */
export function refInfo(
  refs: readonly GitRef[],
  marks: readonly WorktreeMark[],
  worktrees: readonly WorktreeInfo[],
): RefInfo[] {
  const out: RefInfo[] = []
  const remotes = refs.filter(ref => ref.kind === 'remote')
  if (refs.some(ref => ref.kind === 'head') && !refs.some(ref => ref.kind === 'branch' && ref.isCurrent)) {
    out.push({ kind: 'HEAD', name: 'HEAD', detail: 'detached: no branch checked out' })
  }
  for (const ref of refs.filter(one => one.kind === 'branch')) {
    const tree = worktrees.find(one => one.branch === ref.name)
    const also = remotes.filter(one => one.name === ref.name).map(one => one.remote ?? '')
    const parts = [
      ref.isCurrent ? 'current branch (HEAD)' : '',
      tree === undefined ? 'not checked out in any worktree' : `checked out in worktree ${basename(tree.path)}`,
      also.length > 0 ? `same commit on ${also.join(', ')}` : '',
    ]
    out.push({ kind: 'Local branch', name: ref.name, detail: parts.filter(Boolean).join(' · ') })
  }
  const branchNames = new Set(refs.filter(one => one.kind === 'branch').map(one => one.name))
  for (const ref of remotes.filter(one => !branchNames.has(one.name))) {
    out.push({ kind: 'Remote branch', name: `${ref.remote ?? ''}/${ref.name}`, detail: `on remote ${ref.remote ?? ''}` })
  }
  for (const ref of refs.filter(one => one.kind === 'tag')) out.push({ kind: 'Tag', name: ref.name, detail: '' })
  for (const mark of marks) {
    const tree = worktrees.find(one => one.path === mark.path)
    const branch = tree?.branch ?? (tree === undefined ? '' : 'detached HEAD')
    if (mark.kind === 'from') {
      out.push({ kind: 'Worktree start', name: mark.name, detail: `${branch === '' ? '' : `${branch} `}left the default branch here · ${mark.path}` })
    } else {
      const parts = [mark.isOwn ? 'this session' : '', branch === '' ? '' : `on ${branch}`, tree === undefined ? '' : status(tree), mark.path]
      out.push({ kind: 'Worktree', name: mark.name, detail: parts.filter(Boolean).join(' · ') })
    }
  }
  return out
}

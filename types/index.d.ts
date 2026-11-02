export type RefKind = 'head' | 'branch' | 'remote' | 'tag'

/** A decoration. A remote ref has `remote` set and `name` the branch (`origin/main` is `origin` + `main`). */
export type GitRef = { kind: RefKind; name: string; remote?: string; isCurrent?: true }

export type Commit = {
  hash: string
  parents: string[]
  refs: GitRef[]
  subject: string
  author: string
  date: string
}

export type WorktreeInfo = {
  path: string
  head: string
  branch: string | null
  isDetached: boolean
  isBare: boolean
  isMain: boolean
  isLocked: boolean
  /** The worktree's directory is gone (stale); `git worktree prune` would remove it. */
  isPrunable: boolean
  ahead: number | null
  behind: number | null
  modified: number
  untracked: number
}

/** Where a worktree's branch left the default branch: the merge-base commit, when it is a loaded one. */
export type WorktreeBase = { path: string; base: string }

export type GitGraphData = {
  cwd: string
  /** The repository's top-level directory; null when cwd is not inside a repository. */
  repoRoot: string | null
  headHash: string | null
  /** Changed files in the session's worktree (status lines). */
  uncommitted: number
  /** The log had more commits than the limit. */
  hasMore: boolean
  worktrees: WorktreeInfo[]
  worktreeBases: WorktreeBase[]
  commits: Commit[]
  error: string | null
}

export type GitGraphScope = 'all' | 'current'

export type CleanupKind = 'prune' | 'worktree' | 'branch'

/** One thing Clean up would do; `commands` are the git argvs it runs, in order. */
export type CleanupItem = {
  id: string
  kind: CleanupKind
  /** The worktree path or the branch name. */
  label: string
  reason: string
  /** The worktree lives under `.claude/worktrees/`. */
  isAgent: boolean
  commands: string[][]
}

export type CleanupSkipped = { label: string; reason: string; isAgent: boolean }

export type CleanupPlan = {
  base: string
  pruneWorktrees: CleanupItem[]
  removeWorktrees: CleanupItem[]
  deleteBranches: CleanupItem[]
  skipped: CleanupSkipped[]
}

/** The confirmation card: closed, or open on a plan with the ids the person switched off. */
export type CleanupCard = {
  isOpen: boolean
  isBusy: boolean
  plan: CleanupPlan | null
  excluded: string[]
  /** What the last attempt printed on stderr, or why a plan could not be built. */
  error: string | null
}

/** The context menu of a commit row: which row, and what the last action in it said. */
export type RowMenu = {
  hash: string
  /** Where in the row it was right-clicked, in cells from the row text's left edge. */
  x: number
  /** The app was dark when it opened: the dropdown's solid background follows. */
  isDark: boolean
  error: string | null
  /** The last merge or rebase stopped on conflicts: the button that backs it out. */
  abort: AbortPlan | null
  /** The branch whose rebase onto the current branch waits for the person's confirmation. */
  confirmRebase: string | null
}

/** A commit in full, as its unfolded row shows it. */
export type CommitDetail = {
  hash: string
  subject: string
  /** The message after the subject line, trimmed; empty when there is none. */
  body: string
  authorName: string
  authorEmail: string
  /** ISO 8601. */
  authorDate: string
  authorAgo: string
  committerName: string
  committerEmail: string
  committerDate: string
  parents: string[]
  /** `git show --shortstat`: "3 files changed, 20 insertions(+), 4 deletions(-)"; empty for none. */
  stat: string
  /** The default branch (origin/HEAD's, else main or master) when this commit is already in it. */
  mergedInto: string | null
}

/** A git action from an unfolded commit that waits for the person's word, and what it last said. */
export type DetailConfirm = {
  kind: 'delete' | 'rebaseCurrent' | 'checkout'
  branch: string
  /** A local branch of that name exists (delete: `git branch -d` it). */
  hasLocal: boolean
  /** The remote holding a branch of that name, if any: delete offers to remove it there too. */
  remote: string | null
  alsoRemote: boolean
  isBusy: boolean
  error: string | null
  /** A stopped rebase: `git rebase --abort` backs it out. */
  canAbort: boolean
  /** Checkout only: switch to a local branch, make the local branch tracking a remote one, or detach at a commit. */
  mode: CheckoutMode
  /** Checkout only: stash this worktree's changes (untracked too) before switching. */
  stash: boolean
  /** Checkout only: changed files in this worktree when it was asked. */
  changed: number
}

/** How a checkout switches the session's worktree: `git switch <branch>`, `git switch --track <remote>/<branch>`, `git switch --detach <hash>`. */
export type CheckoutMode = 'switch' | 'track' | 'detach'

/** One git command and the directory it runs in. */
export type GitStep = { argv: string[]; cwd: string }

/** How to back out of a stopped merge or rebase: its label and the commands, in order. */
export type AbortPlan = { label: string; steps: GitStep[] }

/** The columns besides Description, which is always shown. */
export type ColumnId = 'graph' | 'date' | 'author' | 'commit'

/** Which columns show and how wide each is, in character cells; a null graph width fits the lanes. */
export type ColumnsConfig = {
  visible: Record<ColumnId, boolean>
  widths: { graph: number | null; date: number; author: number; commit: number }
}

declare module 'claude-code' {
  interface PluginState {
    'git-graph': {
      data: Shaped<GitGraphData>
      scope: Shaped<GitGraphScope>
      filter: Shaped<string>
      limit: Shaped<number>
      selected: Shaped<string>
      isDark: Shaped<boolean>
      detail: Shaped<CommitDetail | null>
      isSyncing: Shaped<boolean>
      confirm: Shaped<DetailConfirm | null>
      hoveredIcon: Shaped<string>
      columns: Shaped<ColumnsConfig>
      isConfiguring: Shaped<boolean>
      isOpen: Shaped<boolean>
      cleanup: Shaped<CleanupCard>
      menu: Shaped<RowMenu | null>
    }
  }
}

# Changelog

## 1.0.0

First public release.

- A Git Graph pane beside the chat (`/gitgraph`): coloured commit lanes, curved fork and merge lines, and chips for branches, remote branches, tags and worktrees, with hover cards that name each one in full.
- Resizable, hideable Graph, Date, Author and Commit columns; a filter; Pull & Fetch; refreshes every 5 seconds and after each `Bash` call.
- Click a commit to unfold its full message, people, hash, parents and changes, with icons to check out, copy, merge, ask Claude and open every action.
- Per branch: check out (stashing first if you like), merge into the current branch, rebase the current branch onto it, delete (optionally on the remote too), with *merged into main: safe to delete* once it is.
- Right-click menu for a commit, its branches, tags and worktrees, including rebasing a worktree's branch in place and removing a worktree.
- Clean up: prunes stale worktrees and removes merged worktrees and branches, after showing the plan.
- Never forces anything; asks before anything that rewrites or deletes.
- Terminal fallback with ASCII lanes and labelled buttons.

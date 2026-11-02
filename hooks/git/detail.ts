import type { CommitDetail } from '../../types'
import type { Run } from './run'

const FIELD = '\x1f'

export const DETAIL_FORMAT = ['%H', '%an', '%ae', '%aI', '%ar', '%cn', '%ce', '%cI', '%P', '%s', '%b'].join('%x1f')

/** Parses `git show -s --format=DETAIL_FORMAT` and the `--shortstat` line that follows. */
export function parseDetail(out: string, stat: string): CommitDetail | null {
  const [hash = '', authorName = '', authorEmail = '', authorDate = '', authorAgo = '', committerName = '', committerEmail = '', committerDate = '', parents = '', subject = '', body = ''] =
    out.split(FIELD)
  if (hash.trim() === '') return null
  return {
    hash: hash.trim(),
    subject,
    body: body.trim(),
    authorName,
    authorEmail,
    authorDate,
    authorAgo,
    committerName,
    committerEmail,
    committerDate,
    parents: parents.split(' ').filter(Boolean),
    stat: stat.trim(),
    mergedInto: null,
  }
}

/** The full message and the who, when and how much of one commit. */
export async function readDetail(run: Run, cwd: string, hash: string): Promise<CommitDetail | null> {
  const [show, stat] = await Promise.all([
    run(['git', 'show', '-s', `--format=${DETAIL_FORMAT}`, hash], cwd),
    run(['git', 'show', '--shortstat', '--format=', hash], cwd),
  ])
  if (show.exitCode !== 0) return null
  return parseDetail(show.stdout, stat.exitCode === 0 ? stat.stdout : '')
}

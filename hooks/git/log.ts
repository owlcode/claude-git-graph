import type { Commit, GitRef } from '../../types'
import type { Run } from './run'

const FIELD = '\x1f'
const RECORD = '\x1e'

export const LOG_FORMAT = ['%H', '%P', '%D', '%an', '%ar', '%s'].join('%x1f') + '%x1e'

/** Parses the `%D` decoration list (`HEAD -> main, origin/main, tag: v1`). */
export function parseRefs(decoration: string, remotes: readonly string[]): GitRef[] {
  const refs: GitRef[] = []
  for (const part of decoration.split(',')) {
    const text = part.trim()
    if (text === '') continue
    if (text.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: text.slice(5) })
    } else if (text.startsWith('HEAD -> ')) {
      refs.push({ kind: 'head', name: 'HEAD' })
      refs.push({ kind: 'branch', name: text.slice(8), isCurrent: true })
    } else if (text === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' })
    } else {
      // `origin/HEAD -> origin/main` is kept as the remote ref `origin/HEAD`.
      const name = text.split(' -> ')[0] ?? text
      const remote = remotes.find(one => name.startsWith(`${one}/`))
      if (remote !== undefined) refs.push({ kind: 'remote', name: name.slice(remote.length + 1), remote })
      else refs.push({ kind: 'branch', name })
    }
  }
  return refs
}

export function parseLog(out: string, remotes: readonly string[]): Commit[] {
  const commits: Commit[] = []
  for (const record of out.split(RECORD)) {
    const text = record.replace(/^\n/, '')
    if (text.trim() === '') continue
    const [hash = '', parents = '', refs = '', author = '', date = '', subject = ''] = text.split(FIELD)
    commits.push({
      hash,
      parents: parents.split(' ').filter(parent => parent !== ''),
      refs: parseRefs(refs, remotes),
      subject,
      author,
      date,
    })
  }
  return commits
}

export type LogOptions = { isAll: boolean; limit: number }

export type LogResult = { commits: Commit[]; hasMore: boolean }

/** Git Graph's argv: all branches, tags and remotes plus HEAD, or HEAD alone; one extra row says if more exist. */
export function logArgv(options: LogOptions): string[] {
  return [
    'git',
    '-c',
    'log.showSignature=false',
    'log',
    `--max-count=${options.limit + 1}`,
    `--format=${LOG_FORMAT}`,
    '--date-order',
    '--decorate=short',
    ...(options.isAll ? ['--branches', '--tags', '--remotes'] : []),
    'HEAD',
    '--',
  ]
}

export async function readLog(run: Run, cwd: string, options: LogOptions): Promise<LogResult> {
  const remoteList = await run(['git', 'remote'], cwd)
  const remotes = remoteList.stdout.split('\n').filter(name => name !== '')
  const result = await run(logArgv(options), cwd)
  if (result.exitCode !== 0) {
    // A repository with no commits yet has an empty graph, not an error.
    if (/does not have any commits|unknown revision|bad default revision|ambiguous argument 'HEAD'/.test(result.stderr)) {
      return { commits: [], hasMore: false }
    }
    throw new Error(result.stderr.trim() || 'git log failed')
  }
  const all = parseLog(result.stdout, remotes)
  return { commits: all.slice(0, options.limit), hasMore: all.length > options.limit }
}

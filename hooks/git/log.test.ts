import { expect, test } from 'claude-code/testing'

import { logArgv, parseLog, parseRefs } from './log'

test('decorations split into head, local, remote and tag refs', () => {
  expect(parseRefs('HEAD -> main, origin/main, origin/HEAD -> origin/main, tag: v1, feature/x', ['origin'])).toEqual([
    { kind: 'head', name: 'HEAD' },
    { kind: 'branch', name: 'main', isCurrent: true },
    { kind: 'remote', name: 'main', remote: 'origin' },
    { kind: 'remote', name: 'HEAD', remote: 'origin' },
    { kind: 'tag', name: 'v1' },
    { kind: 'branch', name: 'feature/x' },
  ])
})

test('log records are parsed into commits', () => {
  const out = 'h1\x1fp1 p2\x1fHEAD -> main\x1fAnn\x1f2 hours ago\x1fmerge it\x1e\nh2\x1f\x1f\x1fBob\x1f1 day ago\x1froot\x1e'
  const commits = parseLog(out, [])
  expect(commits.map(one => [one.hash, one.parents.length, one.subject])).toEqual([
    ['h1', 2, 'merge it'],
    ['h2', 0, 'root'],
  ])
})

test('the log argv follows Git Graph', () => {
  const all = logArgv({ isAll: true, limit: 10 })
  expect(all).toContain('--max-count=11')
  expect(all).toContain('--date-order')
  expect(all.slice(-5)).toEqual(['--branches', '--tags', '--remotes', 'HEAD', '--'].slice(0, 5))
  expect(logArgv({ isAll: false, limit: 10 })).not.toContain('--branches')
  expect(all).not.toContain('--all')
})

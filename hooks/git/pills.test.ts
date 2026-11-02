import { expect, test } from 'claude-code/testing'

import { chipText, chipsFor } from './pills'

const LANE = '#5dcaa5'

test('remote refs on their own keep the remote name; only equal hashes join a local branch', () => {
  // `origin/main` and `origin/HEAD` one commit below `main`: no local branch here.
  const below = chipsFor(
    [
      { kind: 'remote', name: 'main', remote: 'origin' },
      { kind: 'remote', name: 'HEAD', remote: 'origin' },
    ],
    LANE,
  )
  expect(below.map(chipText)).toEqual(['origin/main', 'origin/HEAD'])
  expect(below.every(chip => chip.isDim)).toBe(true)
})

test('chips come in order: HEAD → branch | remote, other branches, lone remotes, tags', () => {
  const chips = chipsFor(
    [
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main', isCurrent: true },
      { kind: 'remote', name: 'main', remote: 'origin' },
      { kind: 'branch', name: 'feature/x' },
      { kind: 'remote', name: 'HEAD', remote: 'origin' },
      { kind: 'tag', name: 'v0.9.2' },
    ],
    LANE,
  )
  expect(chips.map(chipText)).toEqual(['HEAD → main | origin', 'feature/x', 'origin/HEAD', '◇ v0.9.2'])
  const first = chips[0]!
  expect(first.parts.map(part => [part.text, part.color, part.isDim ?? false, part.isBold ?? false])).toEqual([
    ['HEAD → ', '#7fb0f0', false, true],
    ['main', LANE, false, false],
    [' | origin', LANE, true, false],
  ])
  expect(chips.map(chip => chip.border)).toEqual([LANE, LANE, '#8a8a84', '#e4b05a'])
})

test('a detached HEAD gets a chip of its own in the accent colour', () => {
  const chips = chipsFor([{ kind: 'head', name: 'HEAD' }, { kind: 'branch', name: 'other' }], LANE)
  expect(chips.map(chipText)).toEqual(['HEAD', 'other'])
  expect(chips[0]?.border).toBe('#7fb0f0')
})

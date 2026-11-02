import { expect, test } from 'claude-code/testing'

import type { Commit } from '../../types'
import { UNCOMMITTED_HASH, asciiLanes, layoutGraph, withUncommitted } from './graph'
import type { GraphRow, Segment } from './graph'


const commit = (hash: string, ...parents: string[]): Commit => ({
  hash,
  parents,
  refs: [],
  subject: hash,
  author: 'a',
  date: 'now',
})

const lanes = (commits: Commit[]): number[] => layoutGraph(commits).map(row => row.lane)

test('linear history stays in lane 0', () => {
  const rows = layoutGraph([commit('c', 'b'), commit('b', 'a'), commit('a')])
  expect(rows.map(row => row.lane)).toEqual([0, 0, 0])
  expect(rows.map(row => row.color)).toEqual([0, 0, 0])
  expect(rows.every(row => row.laneCount === 1)).toBe(true)
  // The root commit has no line below it.
  expect(rows[2]?.segments.some(seg => seg.to.at === 'bottom')).toBe(false)
})

test('a fork that merges back opens a second lane in its own colour', () => {
  // d and c both descend from b.
  const rows = layoutGraph([commit('d', 'b'), commit('c', 'b'), commit('b', 'a'), commit('a')])
  expect(rows.map(row => row.lane)).toEqual([0, 1, 0, 0])
  expect(rows.map(row => row.color)).toEqual([0, 1, 0, 0])
  // The lane shift sits in the upper half of the row where it joins (the line is not locked to c).
  const join = rows[2]?.segments.find(seg => seg.from.lane === 1 && seg.to.lane === 0)
  expect(join?.from.at).toBe('top')
  expect(join?.to.at).toBe('node')
})

test('a merge forks its second parent into a new lane', () => {
  const rows = layoutGraph([commit('m', 'p1', 'p2'), commit('p1', 'base'), commit('p2', 'base'), commit('base')])
  expect(rows.map(row => row.lane)).toEqual([0, 0, 1, 0])
  const fork = rows[0]?.segments.find(seg => seg.from.at === 'node' && seg.to.lane === 1)
  expect(fork?.to.at).toBe('bottom')
  expect(rows[0]?.laneCount).toBe(2)
})

test('a merge whose second parent is already placed links to that lane', () => {
  // n (a tip) already holds the lane that b1 sits on when m merges b1.
  const rows = layoutGraph([
    commit('n', 'b1'),
    commit('m', 'a1', 'b1'),
    commit('a1', 'base'),
    commit('b1', 'base'),
    commit('base'),
  ])
  expect(rows.map(row => row.lane)).toEqual([0, 1, 1, 0, 0])
  // m links down to lane 0 and the line reaches b1's row.
  const toLaneZero = rows[2]?.segments.filter(seg => seg.to.lane === 0 || seg.from.lane === 0) ?? []
  expect(toLaneZero.length).toBeGreaterThan(0)
  expect(rows[3]?.segments.some(seg => seg.from.lane === 0 && seg.from.at === 'top')).toBe(true)
})

test('three feature branches merged in turn reuse a lane, and a colour only after it has ended', () => {
  const rows = layoutGraph([
    commit('m3', 'm2', 'f3'),
    commit('f3', 'm2'),
    commit('m2', 'm1', 'f2'),
    commit('f2', 'm1'),
    commit('m1', 'b', 'f1'),
    commit('f1', 'b'),
    commit('b'),
  ])
  const byHash = new Map(rows.map(row => [row.hash, row]))
  expect(['m3', 'm2', 'm1', 'b'].map(hash => byHash.get(hash)?.lane)).toEqual([0, 0, 0, 0])
  expect(['f3', 'f2', 'f1'].map(hash => byHash.get(hash)?.lane)).toEqual([1, 1, 1])
  // f3's branch ends on the row of m2, so f2 (starting on that same row) takes a new colour;
  // f1 starts after f2's branch ended and takes f3's colour back.
  expect(['f3', 'f2', 'f1'].map(hash => byHash.get(hash)?.color)).toEqual([1, 2, 1])
})

test('a parent outside the loaded window runs off the bottom', () => {
  const rows = layoutGraph([commit('c', 'b'), commit('b', 'missing')])
  expect(rows.map(row => row.lane)).toEqual([0, 0])
  expect(rows[1]?.segments.some(seg => seg.from.at === 'node' && seg.to.at === 'bottom')).toBe(true)
  expect(lanes([commit('x', 'gone'), commit('y', 'gone')])).toEqual([0, 1])
})

test('uncommitted changes add a dashed grey row on top of HEAD', () => {
  const list = withUncommitted([commit('head', 'a'), commit('a')], 'head', 3)
  expect(list[0]?.hash).toBe(UNCOMMITTED_HASH)
  expect(list[0]?.subject).toBe('Uncommitted changes (3)')
  expect(withUncommitted([commit('head')], 'head', 0)).toHaveLength(1)
  const rows = layoutGraph(list)
  expect(rows.map(row => row.lane)).toEqual([0, 0, 0])
  expect(rows[0]?.color).toBe(0)
  expect(rows[0]?.segments.every(seg => seg.isDashed)).toBe(true)
  expect(rows[1]?.segments.find(seg => seg.to.at === 'node')?.isDashed).toBe(true)
  expect(rows[1]?.segments.find(seg => seg.to.at === 'bottom')?.isDashed).toBe(false)
})

test('ascii: a fork joins on a transition line under its last row', () => {
  const rows = layoutGraph([commit('d', 'b'), commit('c', 'b'), commit('b', 'a'), commit('a')])
  expect(asciiLanes(rows[0]!, rows[1], 2)).toEqual({ commit: '●   ', transitions: [] })
  expect(asciiLanes(rows[1]!, rows[2], 2)).toEqual({ commit: '│ ● ', transitions: ['│╱  '] })
  expect(asciiLanes(rows[2]!, rows[3], 2)).toEqual({ commit: '●   ', transitions: [] })
})

test('ascii: a second parent that starts at the node is drawn on the commit line', () => {
  const rows = layoutGraph([commit('m', 'p1', 'p2'), commit('p1', 'base'), commit('p2', 'base'), commit('base')])
  expect(asciiLanes(rows[0]!, rows[1], 2).commit).toBe('●─┐ ')
})

test('ascii: HEAD and uncommitted nodes use their own glyphs', () => {
  const rows = layoutGraph(withUncommitted([commit('head')], 'head', 1))
  expect(asciiLanes(rows[0]!, rows[1], 1).commit).toBe('○ ')
  expect(asciiLanes(rows[1]!, undefined, 1, true).commit).toBe('◯ ')
})

test('ascii: three lines shifting one lane left at once do not collide', () => {
  const seg = (a: number, aAt: 'top' | 'node' | 'bottom', b: number, bAt: 'top' | 'node' | 'bottom'): Segment => ({
    from: { lane: a, at: aAt },
    to: { lane: b, at: bAt },
    color: 0,
    isDashed: false,
  })
  const through = (lane: number): Segment[] => [seg(lane, 'top', lane, 'node'), seg(lane, 'node', lane, 'bottom')]
  // Row with its commit on lane 0 and lines on lanes 2, 3 and 4 passing through...
  const row: GraphRow = {
    hash: 'x',
    lane: 0,
    color: 0,
    laneCount: 5,
    segments: [...through(0), ...through(2), ...through(3), ...through(4)],
  }
  // ...and the next row, where those lines each arrive one lane further left.
  const below: GraphRow = {
    hash: 'y',
    lane: 0,
    color: 0,
    laneCount: 4,
    segments: [seg(0, 'top', 0, 'node'), seg(2, 'top', 1, 'node'), seg(3, 'top', 2, 'node'), seg(4, 'top', 3, 'node')],
  }
  expect(asciiLanes(row, below, 5)).toEqual({ commit: '●   │ │ │ ', transitions: ['│  ╱ ╱ ╱  '] })
})

const seg = (a: number, aAt: 'top' | 'node' | 'bottom', b: number, bAt: 'top' | 'node' | 'bottom'): Segment => ({
  from: { lane: a, at: aAt },
  to: { lane: b, at: bAt },
  color: 0,
  isDashed: false,
})
const gridRow = (lane: number, segments: Segment[]): GraphRow => ({ hash: 'x', lane, color: 0, laneCount: 6, segments })
const through = (lane: number): Segment[] => [seg(lane, 'top', lane, 'node'), seg(lane, 'node', lane, 'bottom')]

test('ascii: five lines moving 1, 1, 1, 4 and 2 lanes take four transition lines (row 28 of a real history)', () => {
  const row = gridRow(0, [0, 1, 2, 3, 4, 5].flatMap(through))
  const below = gridRow(0, [
    seg(0, 'top', 0, 'node'),
    seg(1, 'top', 0, 'node'),
    seg(2, 'top', 1, 'node'),
    seg(3, 'top', 2, 'node'),
    seg(4, 'top', 0, 'node'),
    seg(5, 'top', 3, 'node'),
  ])
  expect(asciiLanes(row, below, 6).transitions).toEqual([
    '│╱ ╱ ╱ ╱ ╱  ',
    '│ │ │╱ ╱    ',
    '│ │╱│ │     ',
    '│╱│ │ │     ',
  ])
})

test('ascii: a right-moving line draws ╲', () => {
  const row = gridRow(0, through(0))
  const below = gridRow(1, [seg(0, 'top', 1, 'node')])
  expect(asciiLanes(row, below, 2).transitions).toEqual([' ╲  '])
})

test('ascii: a left- and a right-mover sharing a cell draw ╳', () => {
  const row = gridRow(0, [...through(0), ...through(1)])
  const below = gridRow(0, [seg(1, 'top', 0, 'node'), seg(0, 'top', 1, 'node')])
  expect(asciiLanes(row, below, 2).transitions).toEqual([' ╳  '])
})

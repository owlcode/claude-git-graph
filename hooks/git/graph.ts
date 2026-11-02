import type { Commit } from '../../types'

/** lane0 (main) grey, then branch colours; the pane picks `LANE_COLORS[index % length]`. */
export const LANE_COLORS = [
  '#9a9a92',
  '#5dcaa5',
  '#afa9ec',
  '#f0997b',
  '#ed93b1',
  '#85b7eb',
  '#e4b05a',
  '#ee7b7b',
] as const

/** The synthetic first row for uncommitted changes. */
export const UNCOMMITTED_HASH = 'UNCOMMITTED'

export type Anchor = 'top' | 'node' | 'bottom'

/**
 * A piece of a branch line inside one row. Equal lanes draw straight; different lanes draw a
 * curve, which always has one `node` end (the lane shift happens in the half-row beside it).
 */
export type Segment = {
  from: { lane: number; at: Anchor }
  to: { lane: number; at: Anchor }
  color: number
  isDashed: boolean
}

export type GraphRow = {
  hash: string
  lane: number
  color: number
  segments: Segment[]
  /** Highest lane column used in this row, plus one. */
  laneCount: number
}

type Point = { x: number; y: number }
type Line = { p1: Point; p2: Point; colour: number; isCommitted: boolean; lockedFirst: boolean }
type Branch = { colour: number }
type Connection = { connectsTo: Vertex; onBranch: Branch }

/** One commit, after Git Graph's `Vertex`: `id` is the row (0 = newest), `x` the lane. */
type Vertex = {
  id: number
  x: number
  parents: Vertex[]
  nextParent: number
  branch: Branch | null
  isCommitted: boolean
  /** Next free lane slot on this row. */
  nextX: number
  connections: (Connection | undefined)[]
}

const NULL_VERTEX_ID = -1

const newVertex = (id: number, isCommitted: boolean): Vertex => ({
  id,
  x: 0,
  parents: [],
  nextParent: 0,
  branch: null,
  isCommitted,
  nextX: 0,
  connections: [],
})

/** A parent that is not in the loaded window: its line runs off the bottom. */
const NULL_VERTEX: Vertex = newVertex(NULL_VERTEX_ID, true)

const nextParentOf = (vertex: Vertex): Vertex | null => vertex.parents[vertex.nextParent] ?? null
const pointOf = (vertex: Vertex): Point => ({ x: vertex.x, y: vertex.id })
const nextPointOf = (vertex: Vertex): Point => ({ x: vertex.nextX, y: vertex.id })

function pointConnectingTo(vertex: Vertex, to: Vertex, branch: Branch): Point | null {
  const index = vertex.connections.findIndex(one => one?.connectsTo === to && one.onBranch === branch)
  return index === -1 ? null : { x: index, y: vertex.id }
}

/** Only advances `nextX` when the requested slot is the next free one, as Git Graph does. */
function registerUnavailablePoint(vertex: Vertex, x: number, connectsTo: Vertex, onBranch: Branch): void {
  if (x === vertex.nextX) {
    vertex.nextX = x + 1
    vertex.connections[x] = { connectsTo, onBranch }
  }
}

/** Prepends the synthetic uncommitted row (parent = HEAD) when the worktree has changes. */
export function withUncommitted(commits: readonly Commit[], headHash: string | null, count: number): Commit[] {
  if (count <= 0 || headHash === null) return [...commits]
  const row: Commit = {
    hash: UNCOMMITTED_HASH,
    parents: [headHash],
    refs: [],
    subject: `Uncommitted changes (${count})`,
    author: '',
    date: '',
  }
  return [row, ...commits]
}

/**
 * Assigns every commit (children first) a lane and the segments to draw in its row, following
 * `Graph.loadCommits` / `determinePath` of vscode-git-graph (web/graph.ts).
 */
export function layoutGraph(commits: readonly Commit[]): GraphRow[] {
  const lookup = new Map<string, number>()
  commits.forEach((commit, index) => lookup.set(commit.hash, index))
  const vertices: Vertex[] = commits.map((commit, index) => newVertex(index, commit.hash !== UNCOMMITTED_HASH))
  const vertexAt = (index: number): Vertex => {
    const vertex = vertices[index]
    if (vertex === undefined) throw new Error(`no vertex at row ${index}`)
    return vertex
  }
  commits.forEach((commit, index) => {
    vertexAt(index).parents = commit.parents.map(hash => {
      const parent = lookup.get(hash)
      return parent !== undefined && parent > index ? vertexAt(parent) : NULL_VERTEX
    })
  })

  const lines: Line[] = []
  const availableColours: number[] = []
  const getAvailableColour = (startAt: number): number => {
    for (let colour = 0; colour < availableColours.length; colour += 1) {
      if (startAt > (availableColours[colour] ?? 0)) return colour
    }
    availableColours.push(0)
    return availableColours.length - 1
  }
  const addToBranch = (vertex: Vertex, branch: Branch, x: number): void => {
    if (vertex.branch === null) {
      vertex.branch = branch
      vertex.x = x
    }
  }

  const determinePath = (startAt: number): void => {
    let i = startAt
    let vertex = vertexAt(i)
    let parentVertex = nextParentOf(vertex)
    let lastPoint = vertex.branch === null ? nextPointOf(vertex) : pointOf(vertex)

    if (
      parentVertex !== null &&
      parentVertex.id !== NULL_VERTEX_ID &&
      vertex.parents.length > 1 &&
      vertex.branch !== null &&
      parentVertex.branch !== null
    ) {
      // A merge between two vertices that are both placed already: link to the parent's lane.
      const parentBranch = parentVertex.branch
      let foundPointToParent = false
      for (i = startAt + 1; i < vertices.length; i += 1) {
        const current = vertexAt(i)
        const point = pointConnectingTo(current, parentVertex, parentBranch) ?? nextPointOf(current)
        lines.push({
          p1: lastPoint,
          p2: point,
          colour: parentBranch.colour,
          isCommitted: vertex.isCommitted,
          lockedFirst: !foundPointToParent && current !== parentVertex ? lastPoint.x < point.x : true,
        })
        registerUnavailablePoint(current, point.x, parentVertex, parentBranch)
        lastPoint = point
        if (current === parentVertex) {
          foundPointToParent = true
          break
        }
      }
      vertex.nextParent += 1
      return
    }

    const branch: Branch = { colour: getAvailableColour(startAt) }
    if (vertex.branch === null) {
      addToBranch(vertex, branch, lastPoint.x)
      registerUnavailablePoint(vertex, lastPoint.x, vertex, branch)
    }
    if (parentVertex === null) {
      // A root commit: nothing below it.
      availableColours[branch.colour] = startAt
      return
    }
    for (i = startAt + 1; i < vertices.length; i += 1) {
      const current = vertexAt(i)
      const point = parentVertex === current && current.branch !== null ? pointOf(current) : nextPointOf(current)
      lines.push({
        p1: lastPoint,
        p2: point,
        colour: branch.colour,
        isCommitted: vertex.isCommitted,
        lockedFirst: lastPoint.x < point.x,
      })
      registerUnavailablePoint(current, point.x, parentVertex, branch)
      lastPoint = point
      if (parentVertex === current) {
        // The parent was reached: it joins this branch unless it is on one already.
        vertex.nextParent += 1
        const wasOnBranch = current.branch !== null
        addToBranch(current, branch, point.x)
        vertex = current
        parentVertex = nextParentOf(vertex)
        if (parentVertex === null || wasOnBranch) break
      }
    }
    if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_VERTEX_ID) {
      // The parent is outside the window: the line runs off the bottom.
      vertex.nextParent += 1
      lines.push({
        p1: lastPoint,
        p2: { x: lastPoint.x, y: i },
        colour: branch.colour,
        isCommitted: vertex.isCommitted,
        lockedFirst: true,
      })
    }
    availableColours[branch.colour] = i
  }

  let row = 0
  while (row < vertices.length) {
    const vertex = vertexAt(row)
    if (nextParentOf(vertex) !== null || vertex.branch === null) determinePath(row)
    else row += 1
  }

  const segments: Segment[][] = vertices.map(() => [])
  const push = (index: number, segment: Segment): void => {
    segments[index]?.push(segment)
  }
  for (const line of lines) {
    const { p1, p2, colour, isCommitted, lockedFirst } = line
    const isDashed = !isCommitted
    const make = (a: Segment['from'], b: Segment['to']): Segment => ({ from: a, to: b, color: colour, isDashed })
    if (p1.x === p2.x) {
      push(p1.y, make({ lane: p1.x, at: 'node' }, { lane: p1.x, at: 'bottom' }))
      push(p2.y, make({ lane: p2.x, at: 'top' }, { lane: p2.x, at: 'node' }))
    } else if (lockedFirst) {
      push(p1.y, make({ lane: p1.x, at: 'node' }, { lane: p2.x, at: 'bottom' }))
      push(p2.y, make({ lane: p2.x, at: 'top' }, { lane: p2.x, at: 'node' }))
    } else {
      push(p1.y, make({ lane: p1.x, at: 'node' }, { lane: p1.x, at: 'bottom' }))
      push(p2.y, make({ lane: p1.x, at: 'top' }, { lane: p2.x, at: 'node' }))
    }
  }

  return commits.map((commit, index) => {
    const vertex = vertexAt(index)
    // Lines that converge on one parent share a lane; draw the shared piece once.
    const own = (segments[index] ?? []).filter(
      (seg, at, all) =>
        all.findIndex(
          one =>
            one.from.lane === seg.from.lane &&
            one.from.at === seg.from.at &&
            one.to.lane === seg.to.lane &&
            one.to.at === seg.to.at &&
            one.color === seg.color &&
            one.isDashed === seg.isDashed,
        ) === at,
    )
    const laneCount = own.reduce((most, seg) => Math.max(most, seg.from.lane + 1, seg.to.lane + 1), vertex.x + 1)
    return { hash: commit.hash, lane: vertex.x, color: vertex.branch?.colour ?? 0, segments: own, laneCount }
  })
}

export type AsciiRow = {
  /** Verticals, the node and the horizontals of second parents that start at the node. */
  commit: string
  /**
   * Lines changing lane between this row and the next, as `git log --graph` chains `|/ /` rows:
   * each line has every moving line step one lane, until none has to move. Empty when nothing moves.
   */
  transitions: string[]
}

type Shift = { start: number; end: number }

/** Lanes (at node height) a row's lines pass through, with whether every line there is dashed. */
function nodeLevelLanes(row: GraphRow): Map<number, boolean> {
  const lanes = new Map<number, boolean>()
  for (const seg of row.segments) {
    const lane = seg.to.at === 'node' ? seg.to.lane : seg.from.at === 'node' ? seg.from.lane : null
    if (lane === null) continue
    lanes.set(lane, (lanes.get(lane) ?? true) && seg.isDashed)
  }
  return lanes
}

/** Where each line leaves this row's commit line and where it sits in the next row, one entry per line. */
function shiftsBetween(row: GraphRow, next: GraphRow): Shift[] {
  const shifts: Shift[] = []
  for (const down of row.segments.filter(seg => seg.to.at === 'bottom')) {
    // A second-parent line that starts at the node has already moved on the commit line.
    const start = down.from.lane === row.lane ? down.to.lane : down.from.lane
    for (const up of next.segments.filter(seg => seg.from.at === 'top' && seg.from.lane === down.to.lane)) {
      if (!shifts.some(one => one.start === start && one.end === up.to.lane)) shifts.push({ start, end: up.to.lane })
    }
  }
  return shifts
}

/**
 * ASCII lanes for the terminal, as `git log --graph` draws them: two cells per lane column, a
 * commit line, and a transition line under it when lines change lane before the next row.
 */
export function asciiLanes(row: GraphRow, next: GraphRow | undefined, columns: number, isHead = false): AsciiRow {
  const width = columns * 2
  const cells: string[] = Array.from({ length: width }, () => ' ')
  const put = (line: string[], cell: number, char: string): void => {
    if (cell >= 0 && cell < line.length) line[cell] = char
  }

  for (const [lane, isDashed] of nodeLevelLanes(row)) put(cells, lane * 2, isDashed ? '┊' : '│')
  for (const seg of row.segments) {
    if (seg.from.at !== 'node' || seg.to.at !== 'bottom' || seg.from.lane !== row.lane || seg.to.lane === row.lane) continue
    for (let cell = Math.min(row.lane, seg.to.lane) * 2 + 1; cell < Math.max(row.lane, seg.to.lane) * 2; cell += 1) {
      put(cells, cell, '─')
    }
    put(cells, seg.to.lane * 2, seg.to.lane > row.lane ? '┐' : '┌')
  }
  put(cells, row.lane * 2, row.hash === UNCOMMITTED_HASH ? '○' : isHead ? '◯' : '●')

  const shifts = next === undefined ? [] : shiftsBetween(row, next)
  const moving = shifts.map(shift => ({ at: shift.start, target: shift.end }))
  const transitions: string[] = []
  while (moving.some(one => one.at !== one.target)) {
    const line: string[] = Array.from({ length: width }, () => ' ')
    for (const one of moving) {
      if (one.at === one.target) {
        put(line, one.at * 2, '│')
        continue
      }
      // Left-movers draw ╱ in the odd cell before their lane, right-movers ╲ in the one after it.
      const isLeft = one.target < one.at
      const cell = isLeft ? one.at * 2 - 1 : one.at * 2 + 1
      const held = line[cell]
      put(line, cell, held === ' ' || held === (isLeft ? '╱' : '╲') ? (isLeft ? '╱' : '╲') : '╳')
    }
    for (const one of moving) one.at += one.target < one.at ? -1 : one.target > one.at ? 1 : 0
    transitions.push(line.join(''))
  }
  return { commit: cells.join(''), transitions }
}

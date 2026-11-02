import { LANE_COLORS, UNCOMMITTED_HASH } from './graph'
import type { GraphRow, Segment } from './graph'

/** A commit row's height in px: one lane Svg tall. */
export const ROW_HEIGHT = 30
/** Px between lanes. */
export const GRID_X = 16
export const NODE_RADIUS = 4

export const color = (index: number): string => LANE_COLORS[index % LANE_COLORS.length] ?? LANE_COLORS[0]

const laneX = (lane: number, step: number): number => 8 + lane * step
const anchorY = (at: Segment['from']['at']): number => (at === 'top' ? 0 : at === 'node' ? ROW_HEIGHT / 2 : ROW_HEIGHT)

/** A straight line, or a cubic curve whose control points sit 0.8 of the span off each end (Git Graph's `d`). */
function segmentPath(seg: Segment, step: number): string {
  const x1 = laneX(seg.from.lane, step)
  const x2 = laneX(seg.to.lane, step)
  const y1 = anchorY(seg.from.at)
  const y2 = anchorY(seg.to.at)
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`
  const d = 0.8 * (y2 - y1)
  return `M${x1} ${y1}C${x1} ${y1 + d} ${x2} ${y2 - d} ${x2} ${y2}`
}

/** The lane area's width in px: every row draws the same, so the graph column has one width. */
export const laneAreaWidth = (lanes: number): number => 8 + lanes * GRID_X

/** One row of lane lines and its node; the graph column clips it to the width the person set. */
export function rowSvg(row: GraphRow, isHead: boolean, width: number): string {
  // One path per colour (and dash): the desktop takes a pane of 256 KB at most, so every row is kept small.
  const byStroke = new Map<string, string>()
  for (const seg of row.segments) {
    const stroke = `${color(seg.color)}${seg.isDashed ? ' d' : ''}`
    byStroke.set(stroke, `${byStroke.get(stroke) ?? ''}${segmentPath(seg, GRID_X)}`)
  }
  const paths = [...byStroke]
    .map(([stroke, d]) => {
      const [hex, dashed] = stroke.split(' ')
      return `<path d="${d}" stroke="${hex}"${dashed === undefined ? '' : ' stroke-dasharray="3 3"'}/>`
    })
    .join('')
  const cx = laneX(row.lane, GRID_X)
  const cy = ROW_HEIGHT / 2
  const fill = color(row.color)
  const node =
    row.hash === UNCOMMITTED_HASH
      ? `<circle cx="${cx}" cy="${cy}" r="${NODE_RADIUS}" fill="none" stroke="${fill}" stroke-width="2" stroke-dasharray="2 2"/>`
      : isHead
        ? `<circle cx="${cx}" cy="${cy}" r="${NODE_RADIUS}" fill="none" stroke="${fill}" stroke-width="2"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${NODE_RADIUS}" fill="${fill}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${ROW_HEIGHT}"><g fill="none" stroke-width="2">${paths}</g>${node}</svg>`
}

/** Dotted vertical lines for every lane that leaves this row downwards: drawn beside its detail line. */
export function laneFiller(row: GraphRow, width: number, height: number): string {
  const lanes = new Map<number, number>()
  for (const seg of row.segments) if (seg.to.at === 'bottom') lanes.set(seg.to.lane, seg.color)
  const lines = [...lanes]
    .map(
      ([lane, colour]) =>
        `<line x1="${laneX(lane, GRID_X)}" y1="0" x2="${laneX(lane, GRID_X)}" y2="${height}" stroke="${color(colour)}" stroke-width="2" stroke-dasharray="2 3"/>`,
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${lines}</svg>`
}


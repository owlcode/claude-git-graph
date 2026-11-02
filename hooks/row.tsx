import type { ClientModule } from 'claude-code'

/** A ref or worktree chip as the terminal row draws it: text on a coloured ground, or coloured text when dim. */
export type RowChip = { text: string; color: string; isDim: boolean; isBold: boolean }

/** What the pane hands each commit row: everything right of the graph column. */
export type RowProps = {
  /** Terminal only: the desktop draws chips as an Svg before the row, so rows stay as tall as the graph. */
  chips: RowChip[]
  subject: string
  isBold: boolean
  isDim: boolean
  isSelected: boolean
  /** Picks the selected row's faint band for the pane's light or dark ground. */
  isDark: boolean
  date: string
  author: string
  hash: string
  /** Cell widths of the right-hand columns; 0 hides one. */
  dateWidth: number
  authorWidth: number
  commitWidth: number
}

/** What a row posts: which button went down where, or a column edge dragged to a new width. */
export type RowPress = { button: 'left' | 'middle' | 'right'; x: number }
export type ResizeMove = { column: string; width: number }

type Edge = { column: string; x: number; width: number; sign: 1 | -1 }
type Drag = { column: string; startX: number; base: number; sign: 1 | -1 }
type RowState = { hover: string | null; drag: Drag | null }

/** The width last sent while dragging: moves within one cell post nothing. */
let lastPosted = 0

const INK = '#10161f'
const EDGE_LIT = 'suggestion'

/**
 * The edges this row can be resized by: the cell before each right-hand column sizes that column
 * (dragging left widens it). The graph column's edge is its own Client (resize.tsx).
 */
function edges(props: RowProps, columns: number): Edge[] {
  const out: Edge[] = []
  let right = columns
  for (const [column, width] of [
    ['commit', props.commitWidth],
    ['author', props.authorWidth],
    ['date', props.dateWidth],
  ] as const) {
    if (width === 0) continue
    right -= width + 1
    out.push({ column, x: right, width, sign: -1 })
  }
  return out
}

/**
 * One commit row's text columns. It owns the pointer over them, so a right-click is told apart
 * from a left one (left selects, right opens the context menu) and its edge cells resize columns.
 */
const Row: ClientModule<RowProps, RowState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const state: RowState = surface.state ?? { hover: null, drag: null }
  const all = edges(props, surface.columns)

  surface.onPointer(event => {
    const now: RowState = surface.state ?? { hover: null, drag: null }
    const drag = now.drag
    if (drag !== null) {
      if (event.type === 'move' && event.button !== undefined) {
        const width = Math.max(1, Math.round(drag.base + drag.sign * (event.x - drag.startX)))
        // Only a new width is worth a redraw of the whole pane.
        if (width !== lastPosted) surface.post({ column: drag.column, width } satisfies ResizeMove)
        lastPosted = width
      } else if (event.type === 'up') {
        surface.setState({ hover: null, drag: null })
      }
      return
    }
    const edge = all.find(one => one.x === event.x)
    if (event.type === 'down' && event.button === 'left' && edge !== undefined) {
      lastPosted = edge.width
      surface.setState({ hover: edge.column, drag: { column: edge.column, startX: event.x, base: edge.width, sign: edge.sign } })
      return
    }
    if (event.type === 'down' && event.button !== undefined) {
      surface.post({ button: event.button, x: event.x } satisfies RowPress)
      return
    }
    const hover = event.type === 'leave' ? null : (edge?.column ?? null)
    if (hover !== now.hover) surface.setState({ hover, drag: null })
  })

  const edgeCell = (column: string) => (
    <Box key={`edge:${column}`} width={1} flexShrink={0}>
      <Text color={state.hover === column ? EDGE_LIT : undefined}>{state.hover === column ? '┃' : ' '}</Text>
    </Box>
  )
  const cell = (column: string, width: number, text: string) =>
    width === 0 ? null : (
      <Box key={column} flexDirection="row" flexShrink={0}>
        {edgeCell(column)}
        <Box width={width} flexShrink={0} overflow="hidden">
          <Text dimColor wrap="truncate-end">{text}</Text>
        </Box>
      </Box>
    )
  return (
    <Box flexDirection="row" alignItems="center" backgroundColor={props.isSelected ? (props.isDark ? '#2a2d33' : '#eef0f4') : undefined}>
      {/* Width 0 and grow: the description takes what is left, never its text's width, so columns line up. */}
      <Box width={0} minWidth={0} flexGrow={1} flexShrink={1} flexDirection="row" gap={1} overflow="hidden">
        {props.chips.map((chip, at) => (
          <Box key={`chip:${at}`} flexShrink={0}>
            {chip.isDim ? (
              <Text color={chip.color} bold={chip.isBold} wrap="truncate-end">{chip.text}</Text>
            ) : (
              <Text color={INK} backgroundColor={chip.color} bold={chip.isBold} wrap="truncate-end">{` ${chip.text} `}</Text>
            )}
          </Box>
        ))}
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end" bold={props.isBold} dimColor={props.isDim}>
            {props.subject}
          </Text>
        </Box>
      </Box>
      {cell('date', props.dateWidth, props.date)}
      {cell('author', props.authorWidth, props.author)}
      {cell('commit', props.commitWidth, props.hash)}
    </Box>
  )
}

export default Row

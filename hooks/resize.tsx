import type { ClientModule } from 'claude-code'

/** A column edge: which column it sizes, its width now, and +1 when dragging right widens it. */
export type ResizeProps = { column: string; width: number; sign: 1 | -1 }

/** The width last sent while dragging: moves within one cell post nothing. */
let lastPosted = 0

type EdgeState = { isLit: boolean; drag: { startX: number; base: number } | null }

/** The one-cell drag handle after the graph column, the list's full height: it lights up under the pointer and while dragged. */
const Resize: ClientModule<ResizeProps, EdgeState> = (props, surface) => {
  const { Text } = surface.elements
  const state: EdgeState = surface.state ?? { isLit: false, drag: null }
  surface.onPointer(event => {
    const now: EdgeState = surface.state ?? { isLit: false, drag: null }
    if (event.type === 'down' && event.button === 'left') {
      lastPosted = props.width
      surface.setState({ isLit: true, drag: { startX: event.x, base: props.width } })
    } else if (event.type === 'move' && now.drag !== null && event.button !== undefined) {
      const width = Math.max(1, Math.round(now.drag.base + props.sign * (event.x - now.drag.startX)))
      // Only a new width is worth a redraw of the whole pane.
      if (width !== lastPosted) surface.post({ column: props.column, width })
      lastPosted = width
    } else if (event.type === 'up' && now.drag !== null) {
      surface.setState({ isLit: false, drag: null })
    } else if ((event.type === 'enter' || event.type === 'move') && !now.isLit) {
      surface.setState({ isLit: true, drag: null })
    } else if (event.type === 'leave' && now.isLit && now.drag === null) {
      surface.setState({ isLit: false, drag: null })
    }
  })
  // One handle spans every row: lit, it is a line the region's whole height.
  const lines = Math.max(1, surface.rows)
  return <Text color={state.isLit ? 'suggestion' : undefined}>{state.isLit ? Array(lines).fill('┃').join('\n') : ' '}</Text>
}

export default Resize

import type { ClientModule } from 'claude-code'

/** What an icon posts: it was pressed, or the pointer came onto it or left it. */
export type IconPress = { isPressed: true }
export type IconHover = { isHovered: boolean }

/**
 * An invisible press area laid over an icon's Svg: the mod API has no pressable image and a
 * Button draws its own chrome, so this is what makes a bare icon clickable. It also says when the
 * pointer is on it, so the pane can show the icon's description beside it.
 */
const Icon: ClientModule<Record<string, never>> = (_, surface) => {
  const { Box } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') surface.post({ isPressed: true } satisfies IconPress)
    else if (event.type === 'enter') surface.post({ isHovered: true } satisfies IconHover)
    else if (event.type === 'leave') surface.post({ isHovered: false } satisfies IconHover)
  })
  return <Box width="100%" height="100%" />
}

export default Icon

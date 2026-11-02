import type { Chip, ChipPart } from './pills'

/** Width of one character of the chip font (`ui-monospace`, 11px), measured once. */
export const CHAR_WIDTH = 6.6
export const CHIP_PADDING = 12
export const CHIP_HEIGHT = 18
export const CHIP_GAP = 6
export const MAX_CHIPS = 4
export const MAX_NAME = 28
/** The chips strip never grows past this, so the whole Svg always fits its slot unscaled. */
export const MAX_STRIP = 360
const FONT = 'ui-monospace, Menlo, Consolas, monospace'
const INK_STYLE = '<style>.ink{fill:#1f2328}@media (prefers-color-scheme: dark){.ink{fill:#e6e8eb}}</style>'

export type SvgChip = Chip & {
  /** Hover text: the full, untruncated chip text. */
  title: string
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Cuts a chip's parts to `max` characters in all, ending in `…`; later parts are dropped. */
export function truncateParts(parts: readonly ChipPart[], max: number = MAX_NAME): ChipPart[] {
  const total = parts.reduce((sum, part) => sum + part.text.length, 0)
  if (total <= max) return [...parts]
  const out: ChipPart[] = []
  let left = max - 1
  for (const part of parts) {
    if (left <= 0) break
    if (part.text.length <= left) {
      out.push(part)
      left -= part.text.length
    } else {
      out.push({ ...part, text: `${part.text.slice(0, left)}…` })
      left = 0
    }
  }
  return out
}

export const chipChars = (parts: readonly ChipPart[]): number => parts.reduce((sum, part) => sum + part.text.length, 0)
export const chipWidth = (parts: readonly ChipPart[]): number => Math.round(CHIP_PADDING + chipChars(parts) * CHAR_WIDTH)

export type ChipsSvg = { markup: string; width: number; count: number }

/** Chips as SVG groups starting at `x0`: at most four, the rest one dim `+N` chip. */
export function chipsSvg(chips: readonly SvgChip[], x0: number): ChipsSvg {
  const more = (count: number): SvgChip => ({
    id: 'more',
    parts: [{ text: `+${count}`, color: '#8a8a84', isDim: true }],
    border: '#8a8a84',
    isDim: true,
    title: chips.slice(chips.length - count).map(one => one.title).join(', '),
  })
  const widthOf = (list: readonly SvgChip[]): number =>
    list.reduce((sum, one) => sum + chipWidth(truncateParts(one.parts)), 0) + Math.max(0, list.length - 1) * CHIP_GAP
  // Pack left to right while they fit (and at most four); what is left becomes one `+N` chip.
  let n = Math.min(chips.length, MAX_CHIPS)
  const fits = (count: number): boolean => {
    const rest = chips.length - count
    const list = rest > 0 ? [...chips.slice(0, count), more(rest)] : chips.slice(0, count)
    return widthOf(list) <= MAX_STRIP
  }
  while (n > 0 && !fits(n)) n -= 1
  const shown: SvgChip[] = chips.slice(0, n)
  if (chips.length > n) shown.push(more(chips.length - n))
  let x = x0
  let markup = ''
  for (const chip of shown) {
    const parts = truncateParts(chip.parts)
    const width = chipWidth(parts)
    // Text in the theme's ink (light or dark by the app's colour scheme), not the lane colour, for contrast on the tint.
    const spans = parts
      .map(
        part =>
          `<tspan class="ink"${part.isDim ? ' fill-opacity="0.6"' : ''}${part.isBold ? ' font-weight="700"' : ''}>${escapeXml(part.text)}</tspan>`,
      )
      .join('')
    // A rounded box: a thin lane-coloured border on a light tint of the same colour; text centred in it.
    markup +=
      `<g><title>${escapeXml(chip.title)}</title>` +
      `<rect x="${x + 0.5}" y="6" width="${width - 1}" height="${CHIP_HEIGHT}" rx="5" ry="5" fill="${chip.border}" fill-opacity="${chip.isDim ? 0.06 : 0.16}" stroke="${chip.border}" stroke-width="1.25"${chip.isDim ? ' stroke-opacity="0.55"' : ''}/>` +
      `<text x="${x + width / 2}" y="15.5" text-anchor="middle" font-size="11" font-family="${FONT}" dominant-baseline="middle" xml:space="preserve">${spans}</text></g>`
    x += width + CHIP_GAP
  }
  if (shown.length > 0) markup = `${INK_STYLE}${markup}`
  return { markup, width: shown.length === 0 ? 0 : x - CHIP_GAP - x0, count: shown.length }
}

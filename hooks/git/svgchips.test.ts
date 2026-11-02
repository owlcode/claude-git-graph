import { expect, test } from 'claude-code/testing'

import { chipText } from './pills'
import type { Chip } from './pills'
import { CHAR_WIDTH, chipWidth, chipsSvg, truncateParts } from './svgchips'
import type { SvgChip } from './svgchips'

const chip = (text: string, extra: Partial<Chip> = {}): SvgChip => {
  const base: Chip = { id: text, parts: [{ text, color: '#5dcaa5' }], border: '#5dcaa5', isDim: false, ...extra }
  return { ...base, title: chipText(base) }
}

test('a chip is a rounded rect plus text, 12px wider than its characters', () => {
  const { markup, width, count } = chipsSvg([chip('main')], 80)
  expect(count).toBe(1)
  expect(width).toBe(Math.round(12 + 4 * CHAR_WIDTH))
  expect(markup).toContain('rx="5" ry="5"')
  expect(markup).toContain('text-anchor="middle"')
  expect(markup).toContain('height="18" ')
  expect(markup).toContain('<title>main</title>')
  expect(markup).toContain('>main</tspan>')
})

test('chips are 6px apart, and a long name is cut at 28 characters with the full name in the title', () => {
  const name = 'claude/outgoing-call-label-layout-019b09'
  const parts = truncateParts([{ text: name, color: '#fff' }])
  expect(parts.map(part => part.text).join('')).toBe('claude/outgoing-call-label-…')
  expect(parts[0]!.text.length).toBe(28)
  const { markup, width } = chipsSvg([chip(name), chip('main')], 0)
  expect(markup).toContain(`<title>${name}</title>`)
  expect(markup).toContain('claude/outgoing-call-label-…')
  expect(width).toBe(chipWidth(truncateParts([{ text: name, color: '#fff' }])) + 6 + chipWidth([{ text: 'main', color: '#fff' }]))
})

test('more than four chips become four plus one +N chip', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => chip(name))
  const { markup, count } = chipsSvg(six, 0)
  expect(count).toBe(5)
  expect(markup).toContain('>+2</tspan>')
  expect(markup).toContain('<title>e, f</title>')
  expect(markup.match(/<rect /g)).toHaveLength(5)
})

test('dim parts and dim chips are drawn faded; text is escaped', () => {
  const { markup } = chipsSvg(
    [chip('x', { parts: [{ text: 'a<b', color: '#fff' }, { text: ' | origin', color: '#fff', isDim: true }], isDim: true })],
    0,
  )
  expect(markup).toContain('a&lt;b')
  expect(markup).toContain('fill-opacity="0.6"')
  expect(markup).toContain('stroke-opacity="0.55"')
})

test('a strip of long refs is packed to 360px and the rest becomes +N', () => {
  const long = ['a', 'b', 'c', 'd'].map(letter => chip(`${letter}`.repeat(28)))
  const { markup, width, count } = chipsSvg(long, 0)
  expect(width).toBeLessThanOrEqual(360)
  // Two 28-character chips (197px each) cannot both fit with a +N chip; one does.
  expect(count).toBe(2)
  expect(markup).toContain('>+3</tspan>')
  expect(chipsSvg([chip('x'.repeat(28))], 0).width).toBeLessThanOrEqual(360)
})

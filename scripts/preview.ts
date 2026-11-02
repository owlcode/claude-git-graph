/**
 * Draws the README's preview images from the mod's own drawing code (lanes, nodes, chips, icons)
 * over a made-up history, so the pictures match what the pane draws and hold nobody's real work.
 *
 *   bun scripts/preview.ts        writes docs/preview-light.svg and docs/preview-dark.svg
 */
import { writeFileSync } from 'node:fs'

import type { Commit } from '../types'
import { UNCOMMITTED_HASH, layoutGraph, withUncommitted } from '../hooks/git/graph'
import { ICONS } from '../hooks/git/icons'
import { ROW_HEIGHT, color, laneAreaWidth, laneFiller, rowSvg } from '../hooks/git/lanesvg'
import { chipText, chipsFor } from '../hooks/git/pills'
import { chipsSvg } from '../hooks/git/svgchips'

type Theme = { name: string; ground: string; ink: string; dim: string; band: string; field: string; border: string; green: string }

const THEMES: Theme[] = [
  { name: 'light', ground: '#ffffff', ink: '#1f2328', dim: '#6b6f76', band: '#eef0f4', field: '#ffffff', border: '#d6d8dc', green: '#2f9c7a' },
  { name: 'dark', ground: '#1e1f22', ink: '#e6e8eb', dim: '#9a9ea6', band: '#2a2d33', field: '#26282c', border: '#3a3d43', green: '#5dcaa5' },
]

const h = (n: number): string => n.toString(16).padStart(40, '0')
const c = (n: number, parents: number[], subject: string, author: string, date: string, refs: Commit['refs'] = []): Commit => ({
  hash: h(n),
  parents: parents.map(h),
  refs,
  subject,
  author,
  date,
})

// Newest first, as `git log --topo-order` gives them.
const HISTORY: Commit[] = [
  c(4, [3], 'feat(theme): dark mode tokens for every surface', 'Kai Ito', '20 minutes ago', [{ kind: 'branch', name: 'feat/dark-mode' }]),
  c(1, [2, 5], "Merge branch 'feat/search'", 'Ana Lopez', '1 hour ago', [
    { kind: 'head', name: 'HEAD' },
    { kind: 'branch', name: 'main', isCurrent: true },
    { kind: 'remote', name: 'main', remote: 'origin' },
  ]),
  c(2, [3], 'fix(api): retry idempotent requests once', 'Ana Lopez', '2 hours ago'),
  c(3, [6], 'feat(ui): keyboard shortcuts for the sidebar', 'Sam Chen', '5 hours ago'),
  c(5, [7], 'feat(search): rank exact matches first', 'Noor Haddad', 'yesterday', [{ kind: 'branch', name: 'feat/search' }]),
  c(7, [6], 'feat(search): index titles and tags', 'Noor Haddad', 'yesterday'),
  c(6, [8], 'chore(release): 1.4.0', 'Ana Lopez', '2 days ago', [{ kind: 'tag', name: 'v1.4.0' }]),
  c(8, [9], 'test: stop the upload test depending on wall time', 'Sam Chen', '3 days ago', [
    { kind: 'remote', name: 'fix/flaky-upload', remote: 'origin' },
  ]),
  c(9, [], 'docs: how the cache keys are built', 'Kai Ito', '3 days ago'),
]

/** Worktrees as the pane marks them: on the commit each has checked out. */
const WORKTREES = new Map<string, { text: string; isOwn: boolean }>([
  [h(1), { text: '▤ acme ✦', isOwn: true }],
  [h(4), { text: '▤ acme-dark-mode', isOwn: false }],
])

const SELECTED = h(5)
const WIDTH = 900
const TOP = 64
const LINE = 20
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
const CHAR = 7.1

const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cut = (text: string, px: number): string => {
  const max = Math.max(4, Math.floor(px / CHAR))
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
const at = (svg: string, x: number, y: number): string => svg.replace('<svg ', `<svg x="${x}" y="${y}" `)
const text = (x: number, y: number, body: string, fill: string, extra = ''): string =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${SANS}" font-size="13" dominant-baseline="middle"${extra}>${esc(body)}</text>`
const icon = (x: number, y: number, paths: string, stroke: string): string =>
  `<svg x="${x}" y="${y}" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

function draw(theme: Theme): string {
  const commits = withUncommitted(HISTORY, h(1), 3)
  const rows = layoutGraph(commits)
  const lanes = Math.max(...rows.map(row => row.lane + 1), ...rows.flatMap(row => row.segments.map(seg => seg.to.lane + 1)))
  const graphWidth = laneAreaWidth(lanes)
  const left = graphWidth + 12
  const dateX = WIDTH - 250
  const authorX = WIDTH - 130
  let out = ''

  // The toolbar: scope picker, bare icons, the filter behind its loupe.
  out += `<rect x="12" y="14" width="128" height="30" rx="7" fill="${theme.field}" stroke="${theme.border}"/>`
  out += text(26, 29, 'All branches', theme.ink)
  out += `<path d="M118 26l4 4 4-4" fill="none" stroke="${theme.dim}" stroke-width="1.5"/>`
  out += icon(156, 20, ICONS.sync, theme.dim) + icon(186, 20, ICONS.cleanup, theme.dim) + icon(216, 20, ICONS.columns, theme.dim)
  out += icon(248, 20, '<circle cx="6.8" cy="6.8" r="4.3"/><path d="M10 10l3.8 3.8"/>', theme.dim)
  out += `<rect x="274" y="14" width="260" height="30" rx="7" fill="${theme.field}" stroke="${theme.border}"/>`
  out += text(288, 29, 'Filter commits', theme.dim)

  let y = TOP
  rows.forEach((row, index) => {
    const commit = commits[index]
    if (commit === undefined) return
    const isSelected = commit.hash === SELECTED
    const isUncommitted = commit.hash === UNCOMMITTED_HASH
    const isHead = commit.hash === h(1)
    if (isSelected) out += `<rect x="${left - 6}" y="${y}" width="${WIDTH - left}" height="${ROW_HEIGHT}" fill="${theme.band}"/>`
    out += at(rowSvg(row, isHead, graphWidth), 0, y)
    const lane = color(row.color)
    const tree = WORKTREES.get(commit.hash)
    const chips = chipsSvg(
      [
        ...chipsFor(commit.refs, lane).map(chip => ({ ...chip, title: chipText(chip) })),
        ...(tree === undefined ? [] : [{ id: 'wt', parts: [{ text: tree.text, color: lane, isBold: tree.isOwn }], border: lane, isDim: false, title: tree.text }]),
      ],
      0,
    )
    if (chips.count > 0) {
      const markup = chips.markup.replace(/<style>.*?<\/style>/, `<style>.ink{fill:${theme.ink}}</style>`)
      out += `<svg x="${left}" y="${y}" width="${chips.width + 2}" height="${ROW_HEIGHT}">${markup}</svg>`
    }
    const subjectX = left + (chips.count > 0 ? chips.width + 10 : 0)
    const subjectFill = isUncommitted || commit.parents.length > 1 ? theme.dim : theme.ink
    out += text(subjectX, y + ROW_HEIGHT / 2, cut(commit.subject, dateX - subjectX - 16), subjectFill, isHead ? ' font-weight="600"' : '')
    if (!isUncommitted) {
      out += text(dateX, y + ROW_HEIGHT / 2, commit.date, theme.dim)
      out += text(authorX, y + ROW_HEIGHT / 2, cut(commit.author, WIDTH - authorX - 10), theme.dim)
    }
    y += ROW_HEIGHT

    if (isSelected) {
      // The unfolded commit: its facts, message, trailers, icons and a row per branch.
      const facts: [string, string][] = [
        ['Message', commit.subject],
        ['Author', `${commit.author} <noor@example.com>  ·  2026-11-02 18:40 (${commit.date})`],
        ['Commit', '5e1f0c2a9b7d4e8f6a3c1b0d9e8f7a6b5c4d3e2f'],
        ['Parents', '7a0c3e1'],
        ['Changes', '4 files changed, 96 insertions(+), 12 deletions(-)'],
        ['On', 'feat/search'],
      ]
      const body = ['Exact title matches now sort above partial ones; ties keep', 'their previous order.']
      const height = (facts.length + body.length + 1 + 1 + 4) * LINE
      out += at(laneFiller(row, graphWidth, height), 0, y)
      let line = y + LINE + LINE / 2
      for (const [label, value] of facts) {
        out += text(left, line, label, theme.dim) + text(left + 80, line, value, theme.ink, label === 'Message' ? ' font-weight="600"' : '')
        line += LINE
      }
      for (const one of body) {
        out += text(left + 80, line, one, theme.ink)
        line += LINE
      }
      line += LINE
      out += text(left + 80, line, 'Co-Authored-By: Kai Ito <kai@example.com>', theme.dim)
      line += LINE + 6
      ;[ICONS.checkout, ICONS.copy, ICONS.merge, ICONS.ask, ICONS.more].forEach((paths, n) => {
        out += icon(left + n * 34, line - 9, paths, theme.dim)
      })
      line += LINE + 10
      out += text(left, line, '⎇ feat/search', theme.ink, ' font-weight="600"')
      ;[ICONS.checkout, ICONS.merge, ICONS.rebase, ICONS.delete].forEach((paths, n) => {
        out += icon(left + 120 + n * 34, line - 9, paths, theme.dim)
      })
      out += text(left + 270, line, 'merged into main: safe to delete', theme.green)
      y += height
    }
  })

  const total = y + 12
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${total}" viewBox="0 0 ${WIDTH} ${total}">` +
    `<rect width="${WIDTH}" height="${total}" rx="10" fill="${theme.ground}"/>${out}</svg>\n`
  )
}

for (const theme of THEMES) writeFileSync(new URL(`../docs/preview-${theme.name}.svg`, import.meta.url), draw(theme))

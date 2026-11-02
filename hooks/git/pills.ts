import type { GitRef } from '../../types'

export const HEAD_RING = '#7fb0f0'
export const TAG_COLOR = '#e4b05a'
const REMOTE_COLOR = '#8a8a84'

/** A piece of text in a chip; the pane draws it in `color`, dim or bold as marked. */
export type ChipPart = { text: string; color: string; isDim?: boolean; isBold?: boolean }

/** One ref as a chip: its text parts and the border colour. */
export type Chip = { id: string; parts: ChipPart[]; border: string; isDim: boolean }

/**
 * Chips for a commit's refs, in drawing order: a lone HEAD, branches (HEAD → joins the current
 * one, a remote on the same commit joins its branch as `| origin`), lone remotes, tags.
 */
export function chipsFor(refs: readonly GitRef[], lane: string): Chip[] {
  const chips: Chip[] = []
  const remotes = refs.filter(ref => ref.kind === 'remote')
  const branches = refs.filter(ref => ref.kind === 'branch')
  if (refs.some(ref => ref.kind === 'head') && !branches.some(ref => ref.isCurrent)) {
    chips.push({ id: 'head', parts: [{ text: 'HEAD', color: HEAD_RING, isBold: true }], border: HEAD_RING, isDim: false })
  }
  const joined = new Set<GitRef>()
  for (const branch of branches) {
    const same = remotes.filter(ref => ref.name === branch.name)
    same.forEach(ref => joined.add(ref))
    const parts: ChipPart[] = []
    if (branch.isCurrent) parts.push({ text: 'HEAD → ', color: HEAD_RING, isBold: true })
    parts.push({ text: branch.name, color: lane })
    for (const ref of same) parts.push({ text: ` | ${ref.remote ?? ''}`, color: lane, isDim: true })
    chips.push({ id: `branch:${branch.name}`, parts, border: lane, isDim: false })
  }
  for (const ref of remotes.filter(one => !joined.has(one))) {
    const name = `${ref.remote ?? ''}/${ref.name}`
    chips.push({ id: `remote:${name}`, parts: [{ text: name, color: REMOTE_COLOR, isDim: true }], border: REMOTE_COLOR, isDim: true })
  }
  for (const ref of refs.filter(one => one.kind === 'tag')) {
    chips.push({ id: `tag:${ref.name}`, parts: [{ text: `◇ ${ref.name}`, color: TAG_COLOR }], border: TAG_COLOR, isDim: false })
  }
  return chips
}

/** The chip's text in one line, as the terminal's bracket form shows it. */
export const chipText = (chip: Chip): string => chip.parts.map(part => part.text).join('')

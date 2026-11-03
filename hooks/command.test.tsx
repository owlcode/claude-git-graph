import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'git-graph',
  component: 'Pane',
  requestId: 'git-graph',
  props: { title: 'Git graph', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('/gitgraph opens the pane; session.start alone opens nothing', async ($, on) => {
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  on('clock.every', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'gitgraph' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'x', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.cwd', () => ({ value: '/repo' }))
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })

  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual([])

  await $.command.run({ command: 'gitgraph', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(opened).toEqual(['git-graph'])

  // The pane it opened draws, which also lets the refresh the command started finish inside the test.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text' })).toBeDefined()
  await ui.unmount()
})

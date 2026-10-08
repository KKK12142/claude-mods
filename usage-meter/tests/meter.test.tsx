import { test, expect } from 'claude-code/testing'

const HINT = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

test('one line: model, effort, context and 5-hour limit; weekly hidden; toggles', async ($, on) => {
  on('clock.now', () => ({ value: Date.parse('2026-10-08T10:00:00Z') }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: {} }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  await $.session.measure({
    context: { tokens: 120_000, window: 200_000, percent: 60 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-08T12:30:00Z' },
      { kind: 'seven_day', percentUsed: 91.5, resetsAt: '2026-10-11T10:00:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)) void _

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-meter', surface, ...HINT })
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '· high' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '60%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '↻2h30m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '92%' })).toBeUndefined()
    await ui.unmount()
  }

  // 좁은 화면: 짧은 라벨로 한 줄에 맞춘다
  const narrow = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...HINT, viewport: { columns: 70, rows: 30 } } as never)
  expect(await narrow.find({ type: 'Text', text: 'ctx' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: '컨텍스트' })).toBeUndefined()
  await narrow.unmount()

  const tiny = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...HINT, viewport: { columns: 50, rows: 30 } } as never)
  expect(await tiny.find({ type: 'Text', text: '60%' })).toBeDefined()
  expect(await tiny.find({ type: 'Text', text: '↻2h30m' })).toBeUndefined()
  await tiny.unmount()

  const off = await $.command.run({ command: 'usage-meter', args: 'off' } as never)
  expect(off.text).toBe('usage-meter 숨김')
  const hidden = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', ...HINT })
  expect(await hidden.find({ type: 'Text', text: '60%' })).toBeUndefined()
  await hidden.unmount()
})

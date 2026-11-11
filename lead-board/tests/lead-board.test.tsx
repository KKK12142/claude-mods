import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'lead-board',
  component: 'Pane',
  requestId: 'lead-board',
  surface: 'terminal',
  props: {
    title: '대장 현황',
    isFocused: false,
    bodyColumns: 56,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 50 },
    view: {},
  },
} as const

const HOME = '/home/t'
const CWD = '/home/t/projects/demo'
const NOW = Date.parse('2026-11-08T13:00:00Z')
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

const assistant = (id: string, minutesAgo: number, content: unknown[], usage: unknown) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(minutesAgo), message: { id, model: 'm', content, usage } })

const SECRET = 'do-not-show-this-sentence'

const WORKER_LOG = [
  'partial first line',
  JSON.stringify({ type: 'user', message: { content: SECRET } }),
  assistant(
    'a',
    70,
    [{ type: 'tool_use', name: 'Edit', input: { file_path: `${CWD}/content/old.yaml` } }],
    { input_tokens: 1, cache_read_input_tokens: 90, cache_creation_input_tokens: 9, cache_creation: { ephemeral_1h_input_tokens: 9 } },
  ),
  assistant(
    'b',
    10,
    [
      { type: 'text', text: SECRET },
      { type: 'tool_use', name: 'Bash', input: { command: `echo ${SECRET}` } },
    ],
    { input_tokens: 0, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
  ),
  '',
].join('\n')

const LEDGER = [
  '| # | 날짜 | 원문 | 해석 | 맡은 곳 | 상태 |',
  '|---|---|---|---|---|---|',
  '| 10 | 11-08 | 원문 | 끝난 일 | 대장 | 끝 |',
  '| 11 | 11-08 | 원문 | 커밋한 일 | 대장 | 71641c3 |',
  '| 12 | 11-08 | 원문 | 맡긴 일 | 내용수정(본문) | 맡김 |',
  '| 13 | 11-08 | 원문 | 보고 받은 일 | 기능개발 | 보고함 |',
].join('\n')

const stubs = (on: any) => {
  on('command.register', () => ({ value: { command: 'lead-board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'lead-id' }))
  on('env.get', () => ({ value: HOME }))
  on('session.usage', (_: unknown, e: { breakdown?: string }) => ({
    value: {
      startedAt: NOW,
      context: {
        tokens: 68_000,
        window: 400_000,
        percent: 17,
        breakdown:
          e.breakdown === 'summary'
            ? {
                totalTokens: 68_800,
                rawMaxTokens: 400_000,
                percentage: 17,
                categories: [
                  { name: 'System prompt', tokens: 4_400, color: 'promptBorder', isDeferred: false, kind: 'used' },
                  { name: 'MCP tools', tokens: 70_100, color: 'cyan_FOR_SUBAGENTS_ONLY', isDeferred: true, kind: 'deferred' },
                  { name: 'Custom agents', tokens: 297, color: 'permission', isDeferred: false, kind: 'used' },
                  { name: 'Messages', tokens: 64_103, color: 'purple_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
                  { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
                  { name: 'Free space', tokens: 298_200, color: 'promptBorder', isDeferred: false, kind: 'free' },
                ],
              }
            : undefined,
      },
      cost: 0,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 31, resetsAt: new Date(NOW + 192 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 92, resetsAt: new Date(NOW + 86_400_000).toISOString() },
      ],
    },
  }))
  on('fs.list', () => ({
    value: [
      { name: '1.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false },
      { name: '2.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false },
      { name: '3.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false },
    ],
  }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 5, isLink: false } }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    const session = (pid: number, name: string, sessionId: string, status: string) =>
      JSON.stringify({ pid, name, sessionId, status, cwd: CWD, kind: 'interactive', statusUpdatedAt: NOW - 120_000 })
    if (e.path.endsWith('/1.json')) return { value: session(1, '대장', 'lead-id', 'busy') }
    if (e.path.endsWith('/2.json')) return { value: session(2, '내용수정', 'worker-id', 'busy') }
    if (e.path.endsWith('/3.json')) return { value: session(3, '죽은세션', 'dead-id', 'idle') }
    return { value: LEDGER }
  })
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    if (e.argv[0] === 'ps') return { value: { exitCode: 0, stdout: ' 1\n 2\n', stderr: '' } }
    const isWorker = e.argv.at(-1)?.includes('worker-id')
    return { value: { exitCode: 0, stdout: isWorker ? WORKER_LOG : '', stderr: '' } }
  })
}

const texts = async (ui: any): Promise<string> => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')

test('세션, 고친 파일, 캐시, 열린 임무, 사용량을 그리고 대화 글은 그리지 않는다', async ($, on) => {
  stubs(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lead-board', args: '' } as never)

  const ui = await $.ui.mount(PANE)
  const all = await texts(ui)

  expect(all).toContain('대장')
  expect(all).toContain('내용수정')
  expect(all).not.toContain('죽은세션')
  expect(all).toContain('content/old.yaml')
  expect(all).toContain('50분 남음')
  expect(all).toContain('적중')
  expect(all).toContain('열림 2 · 끝 2')
  expect(all).toContain('맡긴 일')
  expect(all).not.toContain('끝난 일')
  expect(all).toContain('5시간')
  expect(all).toContain('92%')
  expect(all).toContain('3시간 12분 뒤')
  expect(all).not.toContain(SECRET)
  await ui.unmount()
})

test('컨텍스트를 /context의 종류별 색으로 채우고 지연 로드 도구는 뺀다', async ($, on) => {
  stubs(on)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'lead-board', args: '' } as never)

  const ui = await $.ui.mount(PANE)
  const all = await texts(ui)
  expect(all).toContain('컨텍스트')
  expect(all).toContain('69k / 400k · 17%')
  expect(all).toContain('메시지 64k')
  expect(all).toContain('여유 298k')
  expect(all).toContain('자동 압축 33k')
  expect(all).not.toContain('MCP 70k')
  expect(all).toContain('에이전트 0.3k')

  const nodes = await ui.findAll({ type: 'Text' })
  const segments = nodes.filter((t: any) => /^[━─╌]+$/.test(t.text) && t.text.length > 0 && !['success', 'warning', 'error', 'subtle'].includes(t.props.color))
  const colors = segments.map((t: any) => t.props.color)
  expect(colors).toEqual(['promptBorder', 'permission', 'purple_FOR_SUBAGENTS_ONLY', 'promptBorder', 'inactive'])
  expect(segments.map((t: any) => t.text.length).reduce((a: number, b: number) => a + b, 0)).toBe(54)
  expect(segments[1]?.text.length).toBe(1)
  expect(segments[4]?.text[0]).toBe('╌')
  await ui.unmount()
})

test('/lead-board off는 칸을 닫고 꺼짐을 남기며, 모르는 말은 그대로 두고, on은 다시 켜고 연다', async ($, on) => {
  stubs(on)
  const stored: Record<string, unknown> = {}
  const closed: string[] = []
  on('store.get', (_: unknown, e: { key: string }) => ({ value: stored[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

  const off: any = await $.command.run({ command: 'lead-board', args: 'off' } as never)
  expect(off.text).toContain('닫았습니다')
  expect(closed).toEqual(['lead-board'])
  expect(stored.enabled).toBe(false)

  const unknown: any = await $.command.run({ command: 'lead-board', args: 'dark' } as never)
  expect(unknown.text).toContain('on 또는 off')
  expect(stored.enabled).toBe(false)

  const back: any = await $.command.run({ command: 'lead-board', args: 'on' } as never)
  expect(back.text).toContain('열었습니다')
  expect(stored.enabled).toBe(true)
})

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'
import type { CacheInfo, ContextPart, ContextView, SessionRow, Snapshot, TaskRow, UsageRow } from '../types'

const PANE = 'lead-board'
const TITLE = '대장 현황'
const LEAD_NAME = '대장'
const LEDGER_FILE = 'memory/ax-science-request-ledger.md'
/** $.store에 남기는 켜짐·꺼짐. 끄면 새 세션에서도 /lead-board on 전까지 저절로 열리지 않는다. */
const ENABLED_STORE = 'enabled'
const POLL_MS = 10_000
const TAIL_BYTES = 400_000
const HIT_TURNS = 20
const RECENT_EDIT_MS = 30 * 60_000
const DEFAULT_TTL_MS = 60 * 60_000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const EMPTY: Snapshot = { takenAt: 0, sessions: [], hasLedger: false, tasks: [], doneCount: 0, usage: [] }
const snapshot = atom({ plugin: 'lead-board', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-1' })

type Edit = { path: string; at: number }
type Activity = { mtimeMs: number; tool?: string; edits: Edit[]; cache?: CacheInfo }
type Usage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}
type Block = { type?: string; name?: string; input?: { file_path?: unknown; notebook_path?: unknown } }
type AssistantRow = {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { id?: string; model?: string; usage?: Usage; content?: Block[] | string }
}
type SessionFile = {
  cwd?: string
  kind?: string
  name?: string
  pid?: number
  sessionId?: string
  status?: string
  statusUpdatedAt?: number | string
  updatedAt?: number | string
}

// 기록 파일은 90 MB까지 커지므로 바뀐 세션의 끝부분만 읽고, 결과는 여기에 남긴다.
const activity = new Map<string, Activity>()
let ledgerCache: { mtimeMs: number; tasks: TaskRow[]; doneCount: number } | undefined
let refreshing = false

const toMs = (value: number | string | undefined): number => {
  if (typeof value === 'number') return value
  const parsed = Date.parse(value ?? '')
  return Number.isNaN(parsed) ? 0 : parsed
}

/** 대화 글은 읽지 않는다. 도구 이름, 파일 경로, 토큰 수, 시각만 꺼낸다. */
export const parseTail = (text: string, mtimeMs: number, prior?: Activity): Activity => {
  const lines = text.split('\n').slice(1)
  const seen = new Set<string>()
  const edits = new Map<string, number>()
  let tool: string | undefined
  let lastAt = 0
  let ttlMs: number | undefined
  let contextTokens = 0
  let hits = 0
  let total = 0

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line?.includes('"type":"assistant"')) continue
    let row: AssistantRow
    try {
      row = JSON.parse(line) as AssistantRow
    } catch {
      continue
    }
    if (row.type !== 'assistant' || row.isSidechain || row.message?.model === '<synthetic>') continue

    const at = toMs(row.timestamp)
    const content = Array.isArray(row.message?.content) ? row.message.content : []
    for (const block of content) {
      if (block.type !== 'tool_use' || !block.name) continue
      tool ??= block.name
      if (!EDIT_TOOLS.has(block.name)) continue
      const path = block.input?.file_path ?? block.input?.notebook_path
      if (typeof path === 'string' && !edits.has(path)) edits.set(path, at)
    }

    const id = row.message?.id
    const usage = row.message?.usage
    if (!id || !usage || seen.has(id)) continue
    seen.add(id)
    if (lastAt === 0) {
      lastAt = at
      contextTokens =
        (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    }
    if (ttlMs === undefined) {
      if ((usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0) ttlMs = 60 * 60_000
      else if ((usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) > 0) ttlMs = 5 * 60_000
    }
    if (seen.size <= HIT_TURNS) {
      hits += usage.cache_read_input_tokens ?? 0
      total +=
        (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    }
  }

  const found = [...edits].map(([path, at]) => ({ path, at }))
  return {
    mtimeMs,
    tool: tool ?? prior?.tool,
    edits: found.length > 0 ? found : (prior?.edits ?? []),
    cache:
      lastAt > 0
        ? {
            lastAt,
            ttlMs: ttlMs ?? prior?.cache?.ttlMs ?? DEFAULT_TTL_MS,
            hitPercent: total > 0 ? Math.round((hits / total) * 100) : 0,
            contextTokens,
          }
        : prior?.cache,
  }
}

const isDone = (status: string): boolean =>
  /끝|보류|기록|배포/.test(status) || /(^|[^0-9a-z])[0-9a-f]{7}([^0-9a-z]|$)/.test(status)

const stateOf = (status: string): TaskRow['state'] => {
  if (/보고|확인 전/.test(status)) return 'review'
  if (/대기|답을|묻/.test(status)) return 'waiting'
  return 'doing'
}

const plain = (cell: string): string =>
  cell
    .replace(/\*\*|`/g, '')
    .replace(/\\\|/g, '|')
    .replace(/\s+/g, ' ')
    .trim()

export const parseLedger = (text: string): { tasks: TaskRow[]; doneCount: number } => {
  const tasks: TaskRow[] = []
  let doneCount = 0
  for (const line of text.split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map(plain)
    const status = cells.at(-1) ?? ''
    if (isDone(status)) {
      doneCount++
      continue
    }
    const rawOwner = (cells.at(-2) ?? '').split(/[(（]/)[0]?.trim() ?? ''
    tasks.push({
      id: cells[0] ?? '',
      title: (cells.length >= 6 ? cells[3] : cells[2]) ?? '',
      owner: rawOwner === '-' || [...rawOwner].length > 10 ? '' : rawOwner,
      state: stateOf(status),
    })
  }
  tasks.sort((a, b) => Number(b.id) - Number(a.id))
  return { tasks, doneCount }
}

const slugOf = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

const liveSessions = async ($: EngineInterface, home: string): Promise<SessionFile[]> => {
  const dir = `${home}/.claude/sessions`
  const files: SessionFile[] = []
  for (const entry of await $.fs.list(dir)) {
    if (!entry.name.endsWith('.json')) continue
    try {
      files.push(JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as SessionFile)
    } catch {}
  }
  const candidates = files.filter(f => f.sessionId && f.pid && f.kind === 'interactive')
  try {
    const pids = candidates.map(f => f.pid).join(',')
    const { exitCode, stdout } = await $.process.run(['ps', '-o', 'pid=', '-p', pids], { timeoutMs: 3000 })
    // 다른 pid가 없을 때 ps는 1로 끝난다. 출력이 비어 있을 때만 판단을 미룬다.
    if (exitCode === 0 || stdout.trim()) {
      const alive = new Set(stdout.split(/\s+/).filter(Boolean).map(Number))
      return candidates.filter(f => alive.has(f.pid as number))
    }
  } catch {}
  return candidates
}

const activityOf = async ($: EngineInterface, home: string, file: SessionFile): Promise<Activity | undefined> => {
  const id = file.sessionId as string
  const path = `${home}/.claude/projects/${slugOf(file.cwd ?? '')}/${id}.jsonl`
  const prior = activity.get(id)
  try {
    const { mtimeMs } = await $.fs.stat(path)
    if (prior && prior.mtimeMs === mtimeMs) return prior
    const { stdout } = await $.process.run(['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: 5000 })
    const next = parseTail(stdout, mtimeMs, prior)
    activity.set(id, next)
    return next
  } catch {
    return prior
  }
}

const homeOf = async ($: EngineInterface): Promise<string> =>
  (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''

const rowOf = (file: SessionFile, found: Activity | undefined, selfId: string, now: number): SessionRow => {
  const edits = found?.edits ?? []
  const first = edits[0]
  const status = file.status === 'busy' || file.status === 'waiting' ? file.status : 'idle'
  return {
    id: file.sessionId as string,
    name: file.name ?? (file.sessionId as string).slice(0, 8),
    status,
    isSelf: file.sessionId === selfId,
    since: toMs(file.statusUpdatedAt ?? file.updatedAt),
    tool: found?.tool,
    edit: first ? { path: relativeTo(first.path, file.cwd ?? ''), at: first.at } : undefined,
    moreEdits: edits.slice(1).filter(e => now - e.at < RECENT_EDIT_MS).length,
    cache: found?.cache,
  }
}

const relativeTo = (path: string, cwd: string): string => (cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path)

const statusRank = { waiting: 0, busy: 1, idle: 2 } as const

const PART_RANK = { used: 0, free: 1, buffer: 2 } as const

const contextOf = (context: SessionContextUsage): ContextView | undefined => {
  const breakdown = context.breakdown
  if (breakdown) {
    const parts: ContextPart[] = []
    for (const { name, tokens, color, kind } of breakdown.categories) {
      if (kind !== 'deferred' && tokens > 0) parts.push({ name, tokens, color, kind })
    }
    // 엔진 목록은 자동 압축 몫이 여유보다 앞이지만 /context 격자는 쓰는 양, 여유, 자동 압축 순으로 그린다.
    parts.sort((a, b) => PART_RANK[a.kind] - PART_RANK[b.kind])
    return { tokens: breakdown.totalTokens, window: breakdown.rawMaxTokens, percent: breakdown.percentage, parts }
  }
  if (context.tokens === undefined) return undefined
  return {
    tokens: context.tokens,
    window: context.window,
    percent: context.percent ?? Math.round((context.tokens / context.window) * 100),
    parts: [],
  }
}

const refresh = async ($: EngineInterface): Promise<void> => {
  if (refreshing) return
  refreshing = true
  try {
    const [home, cwd, selfId, now] = await Promise.all([homeOf($), $.session.cwd(), $.session.id(), $.clock.now()])
    const files = await liveSessions($, home).catch(() => [] as SessionFile[])

    const sessions: SessionRow[] = []
    for (const file of files) sessions.push(rowOf(file, await activityOf($, home, file), selfId, now))
    sessions.sort(
      (a, b) =>
        Number(b.isSelf) - Number(a.isSelf) ||
        statusRank[a.status] - statusRank[b.status] ||
        a.name.localeCompare(b.name, 'ko'),
    )

    const ledgerPath = `${home}/.claude/projects/${slugOf(cwd)}/${LEDGER_FILE}`
    let hasLedger = false
    try {
      const { mtimeMs } = await $.fs.stat(ledgerPath)
      if (ledgerCache?.mtimeMs !== mtimeMs) ledgerCache = { mtimeMs, ...parseLedger(await $.fs.read(ledgerPath)) }
      hasLedger = true
    } catch {
      ledgerCache = undefined
    }

    let usage: UsageRow[] = []
    let context: ContextView | undefined
    try {
      // summary는 로컬 추정이라 API를 부르지 않는다. full은 도구마다 요청을 보내므로 10초 주기에 쓰지 않는다.
      const now = await $.session.usage({ breakdown: 'summary' })
      usage = now.rateLimits
        .filter(r => r.kind === 'five_hour' || r.kind === 'seven_day')
        .map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
      context = contextOf(now.context)
    } catch {}

    await update($, snapshot, () => ({
      takenAt: now,
      sessions,
      hasLedger,
      tasks: ledgerCache?.tasks ?? [],
      doneCount: ledgerCache?.doneCount ?? 0,
      usage,
      context,
    }))
  } finally {
    refreshing = false
  }
}

const cellsOf = (text: string): number => {
  let cells = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xff60)
    cells += wide ? 2 : 1
  }
  return cells
}

/** 경로는 끝이 중요하므로 앞을 줄인다. */
const shortPath = (path: string, room: number): string => {
  if (cellsOf(path) <= room) return path
  const parts = path.split('/')
  let kept = parts.pop() ?? ''
  while (parts.length > 0) {
    const next = `${parts.at(-1)}/${kept}`
    if (cellsOf(next) + 2 > room) break
    kept = next
    parts.pop()
  }
  return `…/${kept}`
}

const ago = (ms: number): string => {
  if (ms < 60_000) return '방금'
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전`
  return `${Math.floor(ms / 86_400_000)}일 전`
}

const tokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return n < 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`
}

const pad2 = (n: number): string => String(n).padStart(2, '0')
const clockOf = (at: number): string => {
  const d = new Date(at)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const untilOf = (kind: string, resetsAt: string | undefined, now: number): string => {
  if (!resetsAt) return ''
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  if (kind === 'seven_day') return `${'일월화수목금토'[new Date(at).getDay()]} ${clockOf(at)}`
  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 뒤` : `${minutes}분 뒤`
}

const CONTEXT_LABEL: Record<string, string> = {
  'System prompt': '시스템',
  'System tools': '도구',
  'MCP tools': 'MCP',
  'MCP server instructions': 'MCP 안내',
  'Custom agents': '에이전트',
  'Memory files': '메모리',
  Skills: '스킬',
  Messages: '메시지',
  'Free space': '여유',
  'Autocompact buffer': '자동 압축',
}

const CONTEXT_GLYPH = { used: '━', free: '─', buffer: '╌' } as const

const legendOf = (part: ContextPart): string => `${CONTEXT_LABEL[part.name] ?? part.name} ${tokens(part.tokens)}`

/** 표시 표지(2칸)와 글자 폭을 재서 범례를 폭 안의 줄로 나눈다. */
const legendLines = (parts: ContextPart[], width: number): ContextPart[][] => {
  const lines: ContextPart[][] = []
  let used = 0
  for (const part of parts) {
    const cells = 2 + cellsOf(legendOf(part))
    const line = lines.at(-1)
    if (line && used + 2 + cells <= width) {
      line.push(part)
      used += 2 + cells
    } else {
      lines.push([part])
      used = cells
    }
  }
  return lines
}

/** 막대 칸을 양에 비례해 나눈다. /context처럼 쓰인 종류는 아무리 작아도 한 칸을 받는다. */
const segmentsOf = (parts: ContextPart[], width: number): number[] => {
  const total = parts.reduce((sum, part) => sum + part.tokens, 0)
  if (total <= 0) return parts.map(() => 0)
  const exact = parts.map(part => (part.tokens / total) * width)
  const cells = parts.map((part, i) => Math.max(part.kind === 'used' ? 1 : 0, Math.floor(exact[i] ?? 0)))
  let spare = width - cells.reduce((sum, n) => sum + n, 0)
  const byRest = cells.map((n, i) => ({ i, rest: (exact[i] ?? 0) - n })).sort((a, b) => b.rest - a.rest)
  for (let k = 0; spare > 0; k = (k + 1) % byRest.length, spare--) {
    const slot = byRest[k]
    if (slot) cells[slot.i] = (cells[slot.i] ?? 0) + 1
  }
  for (; spare < 0; spare++) {
    const biggest = cells.indexOf(Math.max(...cells))
    cells[biggest] = (cells[biggest] ?? 0) - 1
  }
  return cells
}

const loadColor = (percent: number): string => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success')
const leftColor = (share: number): string => (share <= 0.15 ? 'error' : share <= 0.5 ? 'warning' : 'success')

const STATUS = {
  busy: { mark: '●', color: 'suggestion', label: '작업 중' },
  waiting: { mark: '▲', color: 'warning', label: '확인 필요' },
  idle: { mark: '○', color: 'inactive', label: '쉼' },
} as const

const TASK_MARK = {
  doing: { mark: '●', color: 'suggestion' },
  review: { mark: '◐', color: 'warning' },
  waiting: { mark: '○', color: 'inactive' },
} as const

// 엔진이 터미널 폭의 45%로 자르므로 넉넉히 요청해 언제나 상한까지 쓴다.
const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, columns: 200 })

const isEnabled = async ($: EngineInterface): Promise<boolean> => {
  try {
    return (await $.store.get(ENABLED_STORE)) !== false
  } catch {
    return true
  }
}

const setEnabled = async ($: EngineInterface, on: boolean): Promise<void> => {
  try {
    await $.store.set(ENABLED_STORE, on)
  } catch {
    // 저장하지 못하면 이 세션에서만 따른다.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'lead-board', description: '대장 현황 패널을 열고 닫습니다. 인자: on | off' })
    $.clock.every(POLL_MS, () => {
      void (async () => {
        const up = (await $.ui.panes()).some(pane => pane.id === PANE)
        if (up) await refresh($)
      })()
    })
    // 세션 이름은 시작 직후에야 파일에 적히므로 조금 기다린다. 대장 세션에서만, 꺼 두지 않았을 때만 저절로 연다.
    $.clock.after(3000, () => {
      void (async () => {
        if (!(await isEnabled($))) return
        const [home, selfId] = await Promise.all([homeOf($), $.session.id()])
        const files = await liveSessions($, home).catch(() => [] as SessionFile[])
        if (files.find(f => f.sessionId === selfId)?.name !== LEAD_NAME) return
        await openPane($)
        await refresh($)
      })()
    })
    return result
  })

  on('command.run', { command: 'lead-board' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLowerCase()
    if (word === 'off') {
      await setEnabled($, false)
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: '대장 현황을 닫았습니다. /lead-board on을 치기 전까지 새 세션에서도 저절로 열리지 않습니다.' }
    }
    if (word !== '' && word !== 'on') {
      return { text: '/lead-board 뒤에는 on 또는 off만 씁니다. 아무것도 쓰지 않으면 엽니다.' }
    }
    await setEnabled($, true)
    const { isPlaced } = await openPane($)
    await refresh($)
    return {
      text: isPlaced
        ? '대장 현황을 열었습니다.'
        : '터미널 폭이 좁아 아직 칸을 놓지 못했습니다. 창을 넓히면 나타납니다.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const inner = Math.max(24, e.props.bodyColumns - 2)
    const rows = e.props.scroll.bodyRows
    const now = snap.takenAt

    if (now === 0) {
      return (
        <Box paddingX={1}>
          <Text color="inactive">불러오는 중입니다</Text>
        </Box>
      )
    }

    const counts = { busy: 0, waiting: 0, idle: 0 }
    for (const s of snap.sessions) counts[s.status]++
    const summary = [
      counts.busy > 0 ? `작업 ${counts.busy}` : '',
      counts.waiting > 0 ? `확인 ${counts.waiting}` : '',
      counts.idle > 0 ? `쉼 ${counts.idle}` : '',
    ]
      .filter(Boolean)
      .join(' · ')

    const bar = (share: number, width: number, color: string) => {
      const filled = Math.min(width, Math.round(Math.max(0, share) * width))
      return (
        <Box width={width}>
          <Text color={color}>{'━'.repeat(filled)}</Text>
          <Text color="subtle">{'─'.repeat(width - filled)}</Text>
        </Box>
      )
    }

    const section = (label: string, note: string) => (
      <Box marginTop={1} justifyContent="space-between">
        <Text bold>{label}</Text>
        <Text color="inactive">{note}</Text>
      </Box>
    )

    const barWidth = Math.min(16, Math.max(8, inner - 26))

    const context = snap.context
    const contextParts = (context?.parts ?? []) as ContextPart[]
    const legend = legendLines(contextParts, inner)
    const segments = segmentsOf(contextParts, inner)
    const usageRows = snap.usage.length + (context ? 2 + legend.length : 0)
    const fixedRows = 2 + 2 + snap.sessions.length * 3 + 2 + (usageRows > 0 ? usageRows + 2 : 0) + 2
    const spare = rows - fixedRows
    const roomy = spare >= Math.min(snap.tasks.length, 6) + snap.sessions.length - 1
    const taskRoom = Math.max(3, roomy ? spare - (snap.sessions.length - 1) : spare)
    const shownTasks = snap.tasks.slice(0, snap.tasks.length > taskRoom ? taskRoom - 1 : taskRoom)

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color="claude">
            {TITLE}
          </Text>
          <Text color="inactive">{`${clockOf(now)} 기준`}</Text>
        </Box>

        {section('세션', summary)}
        {snap.sessions.map((s, i) => {
          const status = STATUS[s.status]
          const elapsed = s.since > 0 ? ago(now - s.since) : ''
          const detail = [status.label, s.status === 'idle' ? '' : (s.tool ?? ''), elapsed].filter(Boolean).join(' · ')
          const editAge = s.edit ? ago(now - s.edit.at) : ''
          const more = s.moreEdits > 0 ? ` +${s.moreEdits}` : ''
          const pathRoom = Math.max(8, inner - 2 - cellsOf(editAge) - cellsOf(more) - 1)
          const left = s.cache ? s.cache.ttlMs - (now - s.cache.lastAt) : 0
          const leftMinutes = Math.ceil(left / 60_000)
          return (
            <Box key={s.id} flexDirection="column" marginTop={roomy && i > 0 ? 1 : 0}>
              <Box justifyContent="space-between">
                <Box>
                  <Box width={2}>
                    <Text color={status.color}>{status.mark}</Text>
                  </Box>
                  <Text bold>{s.name}</Text>
                  {s.isSelf ? <Text color="inactive"> 이 세션</Text> : null}
                </Box>
                <Text color="inactive">{detail}</Text>
              </Box>
              <Box paddingLeft={2} justifyContent="space-between">
                {s.edit ? (
                  <Text>{`${shortPath(s.edit.path, pathRoom)}${more}`}</Text>
                ) : (
                  <Text color="inactive">최근 고친 파일 없음</Text>
                )}
                <Text color="inactive">{editAge}</Text>
              </Box>
              <Box paddingLeft={2}>
                {s.cache === undefined ? (
                  <Text color="inactive">캐시 기록 없음</Text>
                ) : left > 0 ? (
                  <Box>
                    {bar(left / s.cache.ttlMs, barWidth, leftColor(left / s.cache.ttlMs))}
                    <Text color="inactive">{` ${leftMinutes}분 남음 · 적중 ${s.cache.hitPercent}%`}</Text>
                  </Box>
                ) : (
                  <Box>
                    {bar(0, barWidth, 'inactive')}
                    <Text color="inactive">{` 만료 · 다시 쓸 양 ${tokens(s.cache.contextTokens)}`}</Text>
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}

        {section('임무', snap.hasLedger ? `열림 ${snap.tasks.length} · 끝 ${snap.doneCount}` : '')}
        {snap.hasLedger ? null : <Text color="inactive">요청 원장을 찾지 못했습니다</Text>}
        {shownTasks.map(t => {
          const mark = TASK_MARK[t.state]
          const ownerWidth = t.owner ? Math.min(10, cellsOf(t.owner)) + 1 : 0
          const titleWidth = Math.max(8, inner - 2 - 5 - ownerWidth)
          return (
            <Box key={t.id}>
              <Box width={2}>
                <Text color={mark.color}>{mark.mark}</Text>
              </Box>
              <Box width={5}>
                <Text color="inactive">{t.id}</Text>
              </Box>
              <Box width={titleWidth}>
                <Text wrap="truncate-end">{t.title}</Text>
              </Box>
              {t.owner ? (
                <Box width={ownerWidth} justifyContent="flex-end">
                  <Text color="inactive" wrap="truncate-end">
                    {t.owner}
                  </Text>
                </Box>
              ) : null}
            </Box>
          )
        })}
        {snap.tasks.length > shownTasks.length ? (
          <Box paddingLeft={2}>
            <Text color="inactive">{`외 ${snap.tasks.length - shownTasks.length}건`}</Text>
          </Box>
        ) : null}

        {usageRows > 0 ? section('사용량', '') : null}
        {context ? (
          <Box flexDirection="column">
            <Box justifyContent="space-between">
              <Text color="inactive">컨텍스트</Text>
              <Text>{`${tokens(context.tokens)} / ${tokens(context.window)} · ${Math.round(context.percent)}%`}</Text>
            </Box>
            {contextParts.length > 0 ? (
              <Box width={inner}>
                {contextParts.map((part, i) => (
                  <Text key={part.name} color={part.color}>
                    {CONTEXT_GLYPH[part.kind].repeat(segments[i] ?? 0)}
                  </Text>
                ))}
              </Box>
            ) : (
              bar(context.percent / 100, inner, loadColor(context.percent))
            )}
            {legend.map(line => (
              <Box key={line[0]?.name}>
                {line.map((part, i) => (
                  <Box key={part.name} marginLeft={i > 0 ? 2 : 0}>
                    <Text color={part.color}>● </Text>
                    <Text color="inactive">{legendOf(part)}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        ) : null}
        {snap.usage.map(u => (
          <Box key={u.kind} justifyContent="space-between">
            <Box>
              <Box width={7}>
                <Text color="inactive">{u.kind === 'five_hour' ? '5시간' : '7일'}</Text>
              </Box>
              {bar(u.percentUsed / 100, barWidth, loadColor(u.percentUsed))}
              <Text>{` ${Math.round(u.percentUsed)}%`}</Text>
            </Box>
            <Text color="inactive">{untilOf(u.kind, u.resetsAt, now)}</Text>
          </Box>
        ))}

        <Box marginTop={1}>
          <Text color="inactive" wrap="truncate-end">
            캐시 시간은 마지막 응답으로 잰 추정입니다
          </Text>
        </Box>
      </Box>
    )
  })
}

import { atom, memberOf, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, ModelEffort, Register } from 'claude-code'

import type { Note } from '../types'
import { badge, buildPrompt, combine, formatText, parse, prettyModel, SYSTEM, toNote } from './explain'
import type { Result } from './explain'
import { scan } from './rules'

const isOff = atom({ plugin: 'bash-explain', key: 'isOff' } as const, false)
// 지금 권한 모드: classic 훅 입력의 permission_mode에서 읽어 둔다
const mode = atom({ plugin: 'bash-explain', key: 'mode' } as const, null)
// tool_use_id마다 그린 해설
const notes = atom({ plugin: 'bash-explain', key: 'notes' } as const, null)

// Bash는 macOS·Linux·윈도우(Git Bash) 공통, PowerShell은 윈도우
const SHELLS = new Set(['Bash', 'PowerShell'])
const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const TIMEOUT_MS = 3_000
const DANGER_TIMEOUT_MS = 6_000

const RISK_COLOR = { high: 'error', medium: 'warning', low: 'success' } as const

const field = (input: unknown, key: string) => {
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' ? value : undefined
}

const asEffort = (value: unknown, fallback: ModelEffort) =>
  EFFORTS.includes(value as ModelEffort) ? (value as ModelEffort) : fallback

type Config = { model: string; effort: ModelEffort; dangerModel: string; dangerEffort: ModelEffort }

const readConfig = (options: Readonly<Record<string, unknown>>): Config => ({
  model: typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'claude-haiku-5-5',
  effort: asEffort(options.effort, 'low'),
  dangerModel:
    typeof options.dangerModel === 'string' && options.dangerModel.trim() ? options.dangerModel.trim() : 'claude-sonnet-5-5',
  dangerEffort: asEffort(options.dangerEffort, 'medium'),
})

type Call = { command: string; shell: string; description?: string }

// 같은 명령을 다시 물으면 해설을 다시 만들지 않는다
const cache = new Map<string, Promise<Result>>()
// 실행 중인 셸 호출: tool_use_id → 명령 (확인 창이 뜰 때 어느 호출인지 찾는다)
const calls = new Map<string, Call>()
// 해설을 이미 시작한 호출
const started = new Set<string>()

const explain = async ($: EngineInterface, cfg: Config, call: Call): Promise<Result> => {
  const hits = scan(call.command)
  const isDanger = hits.some(h => h.risk === 'high')
  const model = isDanger ? cfg.dangerModel : cfg.model
  const timeoutMs = isDanger ? DANGER_TIMEOUT_MS : TIMEOUT_MS
  const base: Result = { hits, risk: combine(hits), model, timeoutMs }
  try {
    const cwd = await $.session.cwd().catch(() => '')
    const reply = await $.model.complete({
      model,
      effort: isDanger ? cfg.dangerEffort : cfg.effort,
      system: SYSTEM,
      prompt: buildPrompt({ ...call, cwd, hits }),
      maxTokens: 3_000,
      timeoutMs,
    })
    if (!reply.isAnswered) return { ...base, failure: reply.reason === 'aborted' ? 'timeout' : 'error' }
    const explanation = parse(reply.text)
    if (explanation === undefined) return { ...base, failure: 'error' }
    return { ...base, explanation, risk: combine(hits, explanation) }
  } catch {
    return { ...base, failure: 'error' }
  }
}

const explainCached = ($: EngineInterface, cfg: Config, call: Call) => {
  const key = `${call.shell}\u0000${call.command}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const made = explain($, cfg, call)
  cache.set(key, made)
  // 실패한 해설은 다음에 다시 시도한다
  void made.then(r => {
    if (r.explanation === undefined) cache.delete(key)
  })
  while (cache.size > 64) cache.delete(cache.keys().next().value!)
  return made
}

// 해설을 만들어 그 호출의 Bash 줄에 그린다. 기다리지 않고 뒤에서 돈다
const prepare = async ($: EngineInterface, cfg: Config, id: string) => {
  const call = calls.get(id)
  if (call === undefined || started.has(id)) return
  started.add(id)
  const result = await explainCached($, cfg, call)
  const note = toNote(result)
  if (note !== undefined) await update($, memberOf(notes, { requestId: id }), () => note)
}

// 아직 결과가 없는 호출: 허락을 기다리는 중(isRunning은 아직 false)이거나 실행 중
const isOpen = (call: { output?: unknown; isErrored: boolean; isInterrupted: boolean }) =>
  call.output === undefined && !call.isErrored && !call.isInterrupted

// 해설 그림: 아직 안 끝났으면(확인 창이 떠 있음) 전부, 끝났으면 한 줄 요약
const noteView = (t: ElementTable, note: Note, isFull: boolean) => {
  const { Box, Text } = t
  const color = note.risk === null ? undefined : RISK_COLOR[note.risk]
  const head = (
    <Text>
      <Text color={color} bold>
        {badge(note.risk)}
      </Text>
      <Text bold> · {note.title}</Text>
    </Text>
  )
  if (!isFull) return <Box paddingLeft={5}>{head}</Box>

  // 표시 기호와 글을 나눠 두면 긴 글이 다음 줄로 넘어가도 글 시작 위치에 맞춰진다
  const line = (mark: string, text: string, style: { color?: 'error' | 'warning'; dimColor?: boolean } = {}) => (
    <Box flexDirection="row">
      <Text {...style}>{mark}</Text>
      <Box flexShrink={1}>
        <Text {...style}>{text}</Text>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" paddingLeft={5} marginTop={1}>
      {head}
      {note.parts.map(part => line('  · ', part))}
      {note.warnings.map(w => line('  ! ', w, { color: 'error' }))}
      {note.why && line('  왜: ', note.why, { dimColor: true })}
      {note.caution && line('  ⚠ ', note.caution, { color: 'warning' })}
      {line('  ─ ', note.footer, { dimColor: true })}
    </Box>
  )
}

const noteMode = async ($: EngineInterface, permissionMode: string | undefined) => {
  if (permissionMode) await update($, mode, () => permissionMode)
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bash-explain',
      description: '권한 확인 창의 셸 명령을 한글로 해설합니다 (on / off / <명령어>로 미리 보기)',
      argumentHint: 'on | off | <명령어>',
    })

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  // 턴 중간에 모드를 바꿔도 다음 도구 호출부터 맞게 따라간다
  on('classic.PostToolUse', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const shell = String(e.tool)
    const command = field(e, 'command')
    if (id !== undefined && SHELLS.has(shell) && command?.trim()) {
      calls.set(id, { command, shell, description: field(e, 'description') })
    }
    try {
      return await next(e)
    } finally {
      if (id !== undefined) {
        calls.delete(id)
        started.delete(id)
      }
    }
  })

  // 확인 창이 뜰 것이 확실하면(auto mode가 아닌데 ask) 미리 해설을 시작한다. 판정은 바꾸지 않는다
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision !== 'ask' || id === undefined || !calls.has(id)) return verdict
    const permissionMode = await read($, mode)
    if (permissionMode === 'auto' || (await read($, isOff))) return verdict
    void prepare($, cfg, id)

    return verdict
  })

  // 확인 창이 실제로 뜰 때 (auto mode에서는 분류기가 사람에게 넘겼을 때)
  on('classic.PermissionRequest', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    const command = field(e.tool_input, 'command')
    const id = [...calls].reverse().find(([, call]) => call.command === command && call.shell === e.tool_name)?.[0]
    if (id !== undefined && !(await read($, isOff))) void prepare($, cfg, id)

    return next(e)
  })

  // 확인 창 바로 위, 대화 기록의 Bash 줄 밑에 해설을 그린다 (펼친 기록에서는 호출마다 한 줄)
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!SHELLS.has(e.props.tool) || (await read($, isOff))) return next(e)
    const note: Note | null = await read($, memberOf(notes, e))
    if (note === null) return next(e)

    const drawn = await next(e)
    const t = $.ui.resolve(e)
    return (
      <t.Box flexDirection="column">
        {drawn}
        {noteView(t, note, isOpen(e.props))}
      </t.Box>
    )
  })

  // 셸 명령은 보통 "Running 1 shell command…" 묶음 줄로 그려진다
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded || (await read($, isOff))) return next(e)
    const shown: { note: Note; isFull: boolean }[] = []
    for (const call of e.props.calls) {
      if (call.tool_use_id === undefined || !SHELLS.has(call.tool)) continue
      const note: Note | null = await read($, memberOf(notes, { requestId: call.tool_use_id }))
      if (note !== null) shown.push({ note, isFull: isOpen(call) })
    }
    if (shown.length === 0) return next(e)

    const drawn = await next(e)
    const t = $.ui.resolve(e)
    return (
      <t.Box flexDirection="column">
        {drawn}
        {shown.map(({ note, isFull }) => noteView(t, note, isFull))}
      </t.Box>
    )
  })

  on('command.run', { command: 'bash-explain' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      await update($, isOff, () => arg === 'off')
      return { text: arg === 'off' ? 'bash-explain 꺼짐' : 'bash-explain 켜짐' }
    }
    if (arg === '') {
      const off = await read($, isOff)
      return {
        text: [
          `bash-explain ${off ? '꺼짐' : '켜짐'} · 일반 명령: ${prettyModel(cfg.model)} (${cfg.effort}) · 위험 명령: ${prettyModel(cfg.dangerModel)} (${cfg.dangerEffort})`,
          '사용법: /bash-explain on | off | <명령어> (명령어를 주면 실행하지 않고 해설만 보여 줌)',
        ].join('\n'),
      }
    }

    const note = toNote(await explainCached($, cfg, { command: arg, shell: 'Bash' }))
    return { text: note === undefined ? '해설을 만들지 못했어요 (사전 검사에도 걸린 것이 없음)' : formatText(note) }
  })
}

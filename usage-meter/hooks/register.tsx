import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, SessionMeasureInput } from 'claude-code'

import type { Meter } from '../types'

const meter = atom({ plugin: 'usage-meter', key: 'meter' } as const, null)
const isHidden = atom({ plugin: 'usage-meter', key: 'isHidden' } as const, false)
const modelInfo = atom({ plugin: 'usage-meter', key: 'modelInfo' } as const, { model: null, effort: null })

const toMeter = (u: SessionUsage | SessionMeasureInput): Meter => ({
  context: { tokens: u.context.tokens, window: u.context.window, percent: u.context.percent },
  rateLimits: u.rateLimits
    .filter(r => r.kind === 'five_hour')
    .map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
})

const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// 터미널 칸 수: 한글 등 전각 문자는 2칸
const cells = (text: string) =>
  [...text].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1), 0)

type Seg = { text: string; color?: string; bold?: boolean; dim?: boolean }

const SEP: Seg = { text: '│', dim: true }

// 넓은 것부터: 화면 폭에 들어가는 첫 번째 배치를 쓴다
const layouts = (model: string | null, effort: string | null, ctx: number, limit: Meter['rateLimits'][number] | undefined, now: number) => {
  const head = (withEffort: boolean): Seg[] => [
    ...(model !== null ? [{ text: model, color: 'claude', bold: true }] : []),
    ...(withEffort && effort !== null ? [{ text: `· ${effort}`, dim: true }] : []),
  ]
  const pct = (p: number): Seg => ({ text: `${Math.round(p)}%`, color: colorFor(p), bold: true })
  const part = (label: string, p: number, barWidth: number): Seg[] => [
    { text: label },
    ...(barWidth > 0 ? [{ text: bar(p, barWidth), color: colorFor(p) }] : []),
    pct(p),
  ]
  const build = (ctxLabel: string, limLabel: string, barWidth: number, withEffort: boolean, withReset: boolean): Seg[] => [
    ...head(withEffort),
    SEP,
    ...part(ctxLabel, ctx, barWidth),
    ...(limit === undefined
      ? []
      : [
          SEP,
          ...part(limLabel, limit.percentUsed, barWidth),
          ...(withReset && limit.resetsAt ? [{ text: until(limit.resetsAt, now), dim: true }] : []),
        ]),
  ]

  return [
    build('컨텍스트', '5시간', 8, true, true),
    build('컨텍스트', '5시간', 5, true, true),
    build('ctx', '5h', 5, true, true),
    build('ctx', '5h', 0, true, true),
    build('ctx', '5h', 0, false, false),
  ]
}

const widthOf = (segs: Seg[]) => segs.reduce((n, seg) => n + cells(seg.text), 0) + Math.max(0, segs.length - 1)

const colorFor = (percent: number) => (percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success')

const until = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return '↻곧'
  const minutes = Math.round(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return hours > 0 ? `↻${hours}h${mins}m` : `↻${mins}m`
}

// "claude-opus-5-5[1m]" → "Opus 5.5 (1M)"
const prettyModel = (raw: string) => {
  const isLong = /\[1m\]/i.test(raw)
  const name = raw.replace(/\[1m\]/i, '').trim()
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i.exec(name)
  const base = m
    ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
    : name.charAt(0).toUpperCase() + name.slice(1)
  return isLong ? `${base} (1M)` : base
}

const readEffort = async ($: EngineInterface) => {
  try {
    const row = (await $.config.list()).find(r => /effort/i.test(r.key))
    return row && typeof row.value === 'string' ? row.value : null
  } catch {
    return null
  }
}

const refresh = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  await update($, meter, () => toMeter(usage))
  const model = await $.session.model()
  await update($, modelInfo, info => ({ ...info, model }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-meter',
      description: '모델·effort·컨텍스트·5시간 한도 미터를 켜고 끕니다 (on / off)',
    })
    await refresh($)
    const effort = await readEffort($)
    await update($, modelInfo, info => ({ ...info, effort }))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, meter, () => toMeter(e))

    return next(e)
  })

  // 실제로 요청에 실린 모델과 effort가 가장 정확하다 (메인 루프만)
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, modelInfo, () => ({ model: e.model, effort }))
    }

    return yield* next(e)
  })

  on('command.run', { command: 'usage-meter' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const hide = arg === 'off' ? true : arg === 'on' ? false : !(await read($, isHidden))
    await update($, isHidden, () => hide)
    if (!hide) await refresh($)

    return { text: hide ? 'usage-meter 숨김' : 'usage-meter 표시' }
  })

  // 입력창 바로 위 한 줄
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const m = await read($, meter)
    if (e.props.hasSurvey || m === null || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const info = await read($, modelInfo)

    const model = info.model === null ? null : prettyModel(info.model)
    const options = layouts(model, info.effort, m.context.percent ?? 0, m.rateLimits[0], now)
    // 좌우 여백 2칸 + 엔진이 옆에 그리는 접기 버튼 [-] 자리 4칸 + 여유 1칸
    const room = (e.viewport?.columns ?? Infinity) - 7
    const segs = options.find(option => widthOf(option) <= room) ?? options[options.length - 1]!

    return (
      <Box flexDirection="row" flexWrap="nowrap" gap={1} paddingX={1} overflow="hidden">
        {segs.map(seg => (
          <Text color={seg.color} bold={seg.bold} dimColor={seg.dim} wrap="truncate-end">
            {seg.text}
          </Text>
        ))}
      </Box>
    )
  })
}

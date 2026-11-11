export type CacheInfo = {
  /** 마지막 응답 시각(ms). 캐시는 여기서부터 ttlMs 동안 산다고 추정한다. */
  lastAt: number
  ttlMs: number
  hitPercent: number
  contextTokens: number
}

export type SessionRow = {
  id: string
  name: string
  status: 'busy' | 'waiting' | 'idle'
  isSelf: boolean
  since: number
  tool?: string
  edit?: { path: string; at: number }
  moreEdits: number
  cache?: CacheInfo
}

export type TaskRow = {
  id: string
  title: string
  owner: string
  state: 'doing' | 'review' | 'waiting'
}

export type UsageRow = {
  kind: string
  percentUsed: number
  resetsAt?: string
}

export type ContextPart = {
  name: string
  tokens: number
  /** /context가 이 종류를 칠하는 테마 색 키. 엔진이 준 값을 그대로 쓴다. */
  color: string
  kind: 'used' | 'free' | 'buffer'
}

export type ContextView = {
  tokens: number
  window: number
  percent: number
  parts: ContextPart[]
}

export type Snapshot = {
  takenAt: number
  sessions: SessionRow[]
  hasLedger: boolean
  tasks: TaskRow[]
  doneCount: number
  usage: UsageRow[]
  context?: ContextView
}

declare module 'claude-code' {
  interface PluginState {
    'lead-board': { snapshot: Shaped<Snapshot> }
  }
}

export type Meter = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

export type ModelInfo = { model: string | null; effort: string | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { meter: Meter | null; isHidden: boolean; modelInfo: ModelInfo }
  }
}

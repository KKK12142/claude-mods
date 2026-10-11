export type Risk = 'high' | 'medium' | 'low'

// 확인 창 위 Bash 줄에 그리는 해설 한 건
export type Note = {
  risk: Risk | null
  title: string
  parts: string[]
  // 모델이 놓친 사전 검사의 위험 경고
  warnings: string[]
  why?: string
  caution?: string
  footer: string
}

declare module 'claude-code' {
  interface PluginState {
    'bash-explain': { isOff: boolean; mode: string | null; notes: StateFamily<Note | null> }
  }
}

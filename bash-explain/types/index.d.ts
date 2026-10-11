export type Risk = 'high' | 'medium' | 'low'

// 명령이 실제로 무엇을 바꾸는지 직접 재 본 결과 (blast-radius에서 가져온 측정)
export type Impact = {
  summary: string
  // 지워지거나 버려질 것의 앞부분
  lines: string[]
  // lines에 다 못 보인 나머지 개수
  more: number
  note?: string
  // true: 되돌릴 수 없게 잃는 것이 있음 / false: 잃는 것 없음 / null: 재지 못함
  isLoss: boolean | null
}

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
  impact?: Impact
  // 측정은 끝났고 해설은 아직 만드는 중
  isPending?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'bash-explain': { isOff: boolean; mode: string | null; notes: StateFamily<Note | null> }
  }
}

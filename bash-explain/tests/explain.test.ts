import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

const DANGER_REPLY = `위험도: 높음
요약: node_modules와 dist 폴더를 지우고 패키지를 새로 설치
- rm -rf node_modules dist → 두 폴더를 안의 내용까지 통째로 삭제 (-r 하위 폴더까지, -f 묻지 않고)
- npm ci → package-lock.json 기준으로 패키지를 새로 설치
왜: 설치가 꼬였을 때 깨끗하게 다시 까는 흔한 방법으로 보임
주의: 지운 폴더는 휴지통에 가지 않음. 소스 코드는 그대로`

const SAFE_REPLY = `위험도: 낮음
요약: 현재 폴더의 파일 목록을 자세히 보여 줌
- ls -la → 숨김 파일까지 모든 파일을 자세히 나열 (-l 자세히, -a 숨김 파일 포함)
왜: 폴더 구조를 확인하려는 것으로 보임`

// 엔진 자리: 모델 호출을 기록하고 정해 둔 답을 돌려준다
const engine = (on: On, reply: (prompt: string) => string | undefined) => {
  const calls: { model: string; effort?: string; timeoutMs?: number }[] = []
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/tmp/project' }) as never)
  on('model.complete', ($, e) => {
    calls.push({ model: e.model, effort: e.effort, timeoutMs: e.timeoutMs })
    const text = reply(e.prompt)
    const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    return { value: text === undefined ? { isAnswered: false, reason: 'aborted', usage } : { isAnswered: true, text, usage } } as never
  })
  return calls
}

test('미리 보기: 위험 명령은 Sonnet(medium), 일반 명령은 Haiku(low)로 해설한다', async ($, on) => {
  const calls = engine(on, prompt => (prompt.includes('rm -rf') ? DANGER_REPLY : SAFE_REPLY))

  const danger = await $.command.run({ command: 'bash-explain', args: 'rm -rf node_modules dist && npm ci' } as never)
  expect(calls[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium', timeoutMs: 6000 })
  expect(danger.text).toContain('🔴 위험 · node_modules와 dist 폴더를 지우고 패키지를 새로 설치')
  expect(danger.text).toContain('  · npm ci → package-lock.json 기준으로 패키지를 새로 설치')
  expect(danger.text).toContain('  왜: 설치가 꼬였을 때')
  expect(danger.text).toContain('  ⚠ 지운 폴더는 휴지통에 가지 않음')
  expect(danger.text).toContain('─ bash-explain · Sonnet 5.5')

  const safe = await $.command.run({ command: 'bash-explain', args: 'ls -la' } as never)
  expect(calls[1]).toEqual({ model: 'claude-haiku-5-5', effort: 'low', timeoutMs: 3000 })
  expect(safe.text).toContain('🟢 읽기만 · 현재 폴더의 파일 목록을 자세히 보여 줌')
  expect(safe.text).toContain('─ bash-explain · Haiku 5.5')
})

test('모델이 위험도를 낮게 말해도 사전 검사의 위험 표시는 남는다', async ($, on) => {
  engine(on, () => '위험도: 낮음\n요약: 별일 아님\n- 빌드 정리 → 폴더를 정리')

  const r = await $.command.run({ command: 'bash-explain', args: 'rm -rf build' } as never)
  expect(r.text).toContain('🔴 위험 · 별일 아님')
  expect(r.text).toContain('  ! rm -rf: 폴더를 안의 내용까지 통째로 묻지 않고 바로 삭제 (휴지통 없음)')
})

test('모델이 이미 설명한 위험 조각은 경고 줄로 겹쳐 쓰지 않는다', async ($, on) => {
  engine(on, () => '위험도: 보통\n요약: 테스트 폴더 삭제\n- rm -rf /tmp/t → 테스트 폴더를 통째로 삭제')

  const r = await $.command.run({ command: 'bash-explain', args: 'rm -rf /tmp/t' } as never)
  expect(r.text).toContain('🔴 위험 · 테스트 폴더 삭제')
  expect(r.text).not.toContain('  ! rm -rf')
})

test('시간 안에 답이 없으면 사전 검사 결과만 보여 준다', async ($, on) => {
  engine(on, () => undefined)

  const r = await $.command.run({ command: 'bash-explain', args: 'git push --force' } as never)
  expect(r.text).toContain('🔴 위험 · 사전 검사 결과')
  expect(r.text).toContain('  · git push --force: 원격 저장소의 기록을 덮어씀')
  expect(r.text).toContain('(해설이 6초 안에 오지 않아 사전 검사 결과만 보여요)')
})

test('설정으로 모델과 effort를 바꿀 수 있다', { options: { model: 'claude-sonnet-5-5', effort: 'high' } }, async ($, on) => {
  const calls = engine(on, () => SAFE_REPLY)

  await $.command.run({ command: 'bash-explain', args: 'ls -la' } as never)
  expect(calls[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'high', timeoutMs: 3000 })
})

test('on / off와 상태 보기', async ($, on) => {
  engine(on, () => SAFE_REPLY)

  expect((await $.command.run({ command: 'bash-explain', args: 'off' } as never)).text).toBe('bash-explain 꺼짐')
  expect((await $.command.run({ command: 'bash-explain', args: '' } as never)).text).toContain('bash-explain 꺼짐 · 일반 명령: Haiku 5.5 (low)')
  expect((await $.command.run({ command: 'bash-explain', args: 'on' } as never)).text).toBe('bash-explain 켜짐')
})

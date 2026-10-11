import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classify, measure, size } from '../hooks/radius'
import type { Run } from '../hooks/radius'

const ok = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '' })

// 가짜 실행기: 실행한 argv를 기록하고 정해 둔 출력을 돌려준다
const fake = (answer: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string }) => {
  const ran: string[][] = []
  const run: Run = async argv => {
    ran.push([...argv])
    return answer(argv)
  }
  return { run, ran }
}

test('위험한 조각을 찾고 cd, git -C, ( ) 범위를 따라간다', async () => {
  expect(classify('rm -rf build')).toEqual({ kind: 'rm', label: 'rm -rf', targets: ['build'], dir: null })
  expect(classify('cd app && rm -rf dist')).toMatchObject({ kind: 'rm', dir: 'app' })
  expect(classify('(cd sub && make) && rm -rf out')).toMatchObject({ kind: 'rm', dir: null })
  expect(classify('git -C repo reset --hard')).toMatchObject({ kind: 'git-reset', dir: 'repo' })
  expect(classify('sudo rm -rf /opt/x')).toMatchObject({ kind: 'rm', targets: ['/opt/x'] })
  expect(classify('git push origin +main')).toMatchObject({ kind: 'git-push-force' })
  expect(classify('git clean -fdx')).toMatchObject({ kind: 'git-clean' })
  expect(classify('npx prisma migrate deploy')).toMatchObject({ kind: 'migrate' })
  for (const harmless of ['rm notes.txt', 'git restore --staged .', 'ls migrate', 'git status', 'echo rm -rf']) {
    expect(classify(harmless)).toBe(null)
  }
})

test('rm: 지울 파일 수, 크기, 앞부분 목록', async () => {
  const { run, ran } = fake(() => ok('3 4096 1\nP /Users/me/proj/build\n./build/a.js\n./build/b.js\n./build/c.js\n'))
  const impact = await measure(run, classify('rm -rf build')!, '/Users/me/proj')
  expect(impact).toEqual({
    summary: '파일 3개, 약 4.0KB 삭제 (휴지통 없음)',
    lines: ['build/a.js', 'build/b.js', 'build/c.js'],
    more: 0,
    note: '대상: build',
    isLoss: true,
  })
  // 경로는 셸 코드가 아니라 인자로 넘긴다
  expect(ran[0]!.slice(0, 2)).toEqual(['bash', '-c'])
  expect(ran[0]!.slice(-2)).toEqual(['bash-explain', 'build'])
})

test('rm: 홈 폴더 아래 경로는 ~로 줄여 보여 준다', async () => {
  const { run } = fake(() => ok('2 8192 1\nP /Users/me/old\nH /Users/me\n/Users/me/old/a.txt\n/Users/me/old/b.txt\n'))
  const impact = await measure(run, classify('rm -rf ~/old')!, '/Users/me/proj')
  expect(impact.lines).toEqual(['~/old/a.txt', '~/old/b.txt'])
  expect(impact.isLoss).toBe(true)
})

test('rm: 임시 폴더뿐이거나 지울 것이 없으면 잃을 것 없음', async () => {
  const temp = fake(() => ok('2 2048 1\nP /private/tmp/be-test\n./be-test/a\n'))
  expect((await measure(temp.run, classify('rm -rf /tmp/be-test')!, '/Users/me')).isLoss).toBe(false)
  const none = fake(() => ok('0 0 0\n'))
  expect(await measure(none.run, classify('rm -rf ghost')!, '/Users/me')).toMatchObject({ summary: '지울 것 없음: 그런 파일이나 폴더가 없음', isLoss: false })
})

test('git reset --hard: 버려질 변경 파일, cd를 따라간 폴더에서 잰다', async () => {
  const { run, ran } = fake(argv => {
    if (argv[0] === 'bash') return ok('/Users/me/proj/app\n')
    if (argv[1] === 'status') return ok(' M src/a.ts\nM  src/b.ts\n?? new.txt\n')
    return ok(' 2 files changed, 10 insertions(+), 3 deletions(-)\n')
  })
  const impact = await measure(run, classify('cd app && git reset --hard')!, '/Users/me/proj')
  expect(impact).toMatchObject({ summary: '커밋하지 않은 변경 2개 파일을 버림', lines: ['M src/a.ts', 'M src/b.ts'], isLoss: true })
  expect(impact.note).toContain('2 files changed')
  expect(ran[0]).toEqual(['bash', '-c', expect.any(String), 'bash-explain', 'app'])
})

test('git push --force: 사라질 커밋, 로컬 사본이 없으면 모른다고 함', async () => {
  const known = fake(argv => (argv[1] === 'log' ? ok('abc123 fix login\ndef456 add test\n') : ok('main\n')))
  expect(await measure(known.run, classify('git push --force origin main')!, '/p')).toMatchObject({
    summary: 'origin/main의 커밋 2개가 사라짐',
    lines: ['abc123 fix login', 'def456 add test'],
    isLoss: true,
  })
  const unknown = fake(argv => (argv[2] === '--verify' ? ok('', 1) : ok('main\n')))
  expect((await measure(unknown.run, classify('git push -f')!, '/p')).isLoss).toBe(null)
})

test('윈도우에서는 파일 측정을 하지 않고, 실행기가 실패하면 재지 못했다고 함', async () => {
  const { run, ran } = fake(() => ok(''))
  expect(await measure(run, classify('rm -rf build')!, 'C:\\proj')).toMatchObject({ isLoss: null })
  expect(ran).toEqual([])
  const broken: Run = async () => {
    throw new Error('timeout')
  }
  expect(await measure(broken, classify('git reset --hard')!, '/p')).toMatchObject({ summary: 'git reset --hard: 4초 안에 재지 못함', isLoss: null })
  expect(size(1536)).toBe('1.5KB')
  expect(size(312 * 1024 * 1024)).toBe('312MB')
})

// ── auto mode에서 붙잡기 ──

const REPLY = '위험도: 높음\n요약: build 폴더 삭제\n- rm -rf build → build 폴더를 통째로 삭제'
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const engine = (on: On, rmOutput: string) => {
  let id = ''
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/Users/me/proj' }) as never)
  on('classic.UserPromptSubmit', () => ({}))
  on('process.run', () => ({ value: { ...ok(rmOutput), isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: REPLY, usage: USAGE } }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  on('tool.call', ($, e) => {
    id = e.tool_use_id ?? ''
    return { result: { stdout: '', stderr: '' } } as never
  })
  return () => id
}

const ROW = (id: string) => ({
  plugin: 'bash-explain',
  surface: 'terminal' as const,
  component: 'ToolUse' as const,
  requestId: id,
  props: { tool_use_id: id, tool: 'Bash', input: { command: 'rm -rf build' }, isRunning: false, isErrored: false, isInterrupted: false },
})

const LOSS = '3 4096 1\nP /Users/me/proj/build\n./build/a.js\n'

test('auto mode: 실제로 잃을 것이 있으면 확인 창을 띄우게 하고 실제 영향과 해설을 그린다', async (engine$, on) => {
  const idOf = engine(on, LOSS)
  await engine$.classic.UserPromptSubmit({ prompt: 'build 지워 줘', permission_mode: 'auto' } as never)
  await engine$.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)

  let drawn = false
  for (let i = 0; i < 50 && !drawn; i++) {
    const ui = await engine$.ui.mount(ROW(idOf()))
    drawn = (await ui.find({ type: 'Text', text: /build 폴더 삭제/ })) !== undefined
    if (drawn) {
      expect(await ui.find({ type: 'Text', text: '실제 영향: 파일 3개, 약 4.0KB 삭제 (휴지통 없음)' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'build/a.js' })).toBeDefined()
    }
    await ui.unmount()
    if (!drawn) await engine$.command.run({ command: 'bash-explain', args: '' } as never)
  }
  expect(drawn).toBe(true)
})

test('auto mode: 임시 폴더뿐이면 붙잡지 않는다', async (engine$, on) => {
  const idOf = engine(on, '2 2048 1\nP /private/tmp/x\n./x/a\n')
  await engine$.classic.UserPromptSubmit({ prompt: '정리해 줘', permission_mode: 'auto' } as never)
  await engine$.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/x' } as never)
  for (let i = 0; i < 5; i++) await engine$.command.run({ command: 'bash-explain', args: '' } as never)

  const ui = await engine$.ui.mount(ROW(idOf()))
  expect(await ui.find({ type: 'Text', text: '🔴 위험' })).toBeUndefined()
  await ui.unmount()
})

test('auto mode 붙잡기를 끄면 붙잡지 않는다', { options: { autoHold: false } }, async (engine$, on) => {
  const idOf = engine(on, LOSS)
  await engine$.classic.UserPromptSubmit({ prompt: 'build 지워 줘', permission_mode: 'auto' } as never)
  await engine$.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)
  for (let i = 0; i < 5; i++) await engine$.command.run({ command: 'bash-explain', args: '' } as never)

  const ui = await engine$.ui.mount(ROW(idOf()))
  expect(await ui.find({ type: 'Text', text: '🔴 위험' })).toBeUndefined()
  await ui.unmount()
})

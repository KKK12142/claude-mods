import { test, expect } from 'claude-code/testing'

const REPLY = `위험도: 높음
요약: dist 폴더를 통째로 지움
- rm -rf dist → dist 폴더를 안의 내용까지 삭제 (-r 하위까지, -f 묻지 않고)
왜: 빌드 결과물을 지우고 새로 만들려는 것으로 보임
주의: 휴지통에 가지 않음`

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// 허락을 기다리는 줄은 실행 중이 아니고(isRunning false) 결과도 아직 없다
const rowProps = (id: string, isDone: boolean) => ({
  tool_use_id: id,
  tool: 'Bash',
  input: { command: 'rm -rf dist' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: isDone ? { stdout: '', stderr: '' } : undefined,
})

test('확인 창이 뜨면 Bash 줄(단독·묶음) 밑에 해설을 그리고, 끝나면 한 줄로 접는다', async (engine, on) => {
  let id = ''
  let models = 0
  on('command.register', () => ({ value: {} }) as never)
  on('session.cwd', () => ({ value: '/tmp/project' }) as never)
  on('classic.PermissionRequest', () => ({}))
  on('model.complete', () => {
    models += 1
    return { value: { isAnswered: true, text: REPLY, usage: USAGE } } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  // 엔진 자리: 확인 창을 띄운다(PermissionRequest)
  on('tool.call', async ($, e) => {
    id = e.tool_use_id ?? ''
    await engine.classic.PermissionRequest({
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf dist' },
      permission_mode: 'default',
    } as never)
    return { result: { stdout: '', stderr: '' } } as never
  })

  await engine.tool.call({ tool: 'Bash', command: 'rm -rf dist', description: '빌드 폴더 삭제' } as never)
  // 해설은 뒤에서 만들어진다: 그려질 때까지 다시 그려 본다
  for (let i = 0; i < 50; i++) {
    const probe = await engine.ui.mount({ plugin: 'bash-explain', surface: 'terminal', component: 'ToolUse', requestId: id, props: rowProps(id, false) })
    const isDrawn = (await probe.find({ type: 'Text', text: '🔴 위험' })) !== undefined
    await probe.unmount()
    if (isDrawn) break
    await engine.command.run({ command: 'bash-explain', args: '' } as never)
  }
  expect(models).toBe(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await engine.ui.mount({ plugin: 'bash-explain', surface, component: 'ToolUse', requestId: id, props: rowProps(id, false) })
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '🔴 위험' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /dist 폴더를 통째로 지움/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /rm -rf dist → dist 폴더를 안의 내용까지 삭제/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /빌드 결과물을 지우고/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /bash-explain · Sonnet 5\.5/ })).toBeDefined()
    await ui.unmount()

    const done = await engine.ui.mount({ plugin: 'bash-explain', surface, component: 'ToolUse', requestId: id, props: rowProps(id, true) })
    expect(await done.find({ type: 'Text', text: /dist 폴더를 통째로 지움/ })).toBeDefined()
    expect(await done.find({ type: 'Text', text: /rm -rf dist →/ })).toBeUndefined()
    await done.unmount()
  }

  // "Running 1 shell command…" 묶음 줄에도 붙는다 (펼친 묶음은 호출마다의 ToolUse 줄이 맡는다)
  const groupProps = (isExpanded: boolean) => ({
    calls: [{ ...rowProps(id, false), tool_use_id: id }, { tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }],
    isActive: true,
    isExpanded,
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const group = await engine.ui.mount({ plugin: 'bash-explain', surface, component: 'ToolGroup', props: groupProps(false) })
    expect(await group.find({ key: 'engine' })).toBeDefined()
    expect(await group.find({ type: 'Text', text: /rm -rf dist → dist 폴더를 안의 내용까지 삭제/ })).toBeDefined()
    await group.unmount()
  }
  const expanded = await engine.ui.mount({ plugin: 'bash-explain', surface: 'terminal', component: 'ToolGroup', props: groupProps(true) })
  expect(await expanded.find({ type: 'Text', text: '🔴 위험' })).toBeUndefined()
  await expanded.unmount()

  // 해설이 없는 다른 줄은 엔진이 그린 그대로
  const other = await engine.ui.mount({ plugin: 'bash-explain', surface: 'terminal', component: 'ToolUse', requestId: 'x', props: rowProps('x', false) })
  expect(await other.find({ type: 'Text', text: '🔴 위험' })).toBeUndefined()
  await other.unmount()
})

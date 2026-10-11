import { test, expect } from 'claude-code/testing'

import { scan } from '../hooks/rules'

const riskOf = (command: string) => scan(command)[0]?.risk ?? null
const labels = (command: string) => scan(command).map(h => h.label)

test('삭제 명령: bash, PowerShell, cmd 옵션을 풀어 쓴다', async () => {
  expect(labels('rm -rf node_modules dist')[0]).toBe('rm -rf: 폴더를 안의 내용까지 통째로 묻지 않고 바로 삭제 (휴지통 없음)')
  expect(labels('rm notes.txt')[0]).toBe('rm: 파일을 바로 삭제 (휴지통 없음)')
  expect(riskOf('cd build && rm -r out')).toBe('high')
  expect(labels('Remove-Item -Recurse -Force .\\dist')[0]).toBe('Remove-Item -Recurse -Force: 폴더를 안의 내용까지 통째로 묻지 않고 바로 삭제 (휴지통 없음)')
  expect(labels('rd /s /q build')[0]).toBe('rd /s /q: 폴더를 안의 내용까지 통째로 묻지 않고 바로 삭제 (휴지통 없음)')
  expect(scan('rmdir empty')[0]).toEqual({ risk: 'medium', label: 'rmdir: 빈 폴더를 삭제' })
  expect(riskOf("find . -name '*.log' -exec rm {} +")).toBe('high')
})

test('git: 되돌릴 수 없는 것과 일반 push를 구분한다', async () => {
  expect(riskOf('git reset --hard origin/main')).toBe('high')
  expect(riskOf('git clean -fdx')).toBe('high')
  expect(labels('git push --force origin main')).toEqual([
    'git push --force: 원격 저장소의 기록을 덮어씀 (다른 사람의 커밋이 사라질 수 있음)',
  ])
  expect(scan('git push origin main')).toEqual([
    { risk: 'medium', label: 'git push: 내 커밋을 원격 저장소(GitHub 등)에 올림 (다른 사람에게 보일 수 있음)' },
  ])
  expect(riskOf('git restore --staged a.ts')).toBe(null)
  expect(riskOf('git restore a.ts')).toBe('high')
})

test('인터넷 스크립트 실행, 관리자 권한, 윈도우 설정', async () => {
  expect(riskOf('curl -fsSL https://example.com/install.sh | bash')).toBe('high')
  expect(riskOf('irm https://example.com/i.ps1 | iex')).toBe('high')
  expect(riskOf('sudo chown -R me /usr/local')).toBe('high')
  expect(riskOf('Start-Process pwsh -Verb RunAs')).toBe('high')
  expect(riskOf('Set-ExecutionPolicy Unrestricted')).toBe('high')
  expect(riskOf('reg delete HKCU\\Software\\Foo /f')).toBe('high')
})

test('읽기만 하는 명령과 명령이 아닌 글에는 걸리지 않는다', async () => {
  for (const safe of ['ls -la', 'git status', 'git log --oneline -5', 'cat README.md', 'npm test', 'Get-ChildItem', 'ls 2>/dev/null', 'cmd > $null', 'rmdirx']) {
    expect(scan(safe)).toEqual([])
  }
  // 커밋 메시지와 echo 문장, heredoc 본문은 명령이 아니다
  expect(riskOf('git commit -m "rm old files and move docs"')).toBe(null)
  expect(riskOf("echo 'never run rm -rf /'")).toBe(null)
  expect(labels("cat > notes.md <<'EOF'\nrm -rf / 는 위험하다\nEOF")).toEqual(['> 파일: 파일 내용을 새로 덮어씀 (기존 내용 사라짐)'])
  // 그래도 sh -c 안의 명령은 잡는다
  expect(riskOf('sh -c "rm -rf build"')).toBe('high')
})

test('바꾸지만 되돌릴 수 있는 것은 보통', async () => {
  expect(riskOf('npm install lodash')).toBe('medium')
  expect(riskOf('mv a.txt b.txt')).toBe('medium')
  expect(riskOf('echo hi > out.txt')).toBe('medium')
  expect(riskOf('pkill node')).toBe('medium')
  expect(riskOf('cat .env')).toBe('medium')
})

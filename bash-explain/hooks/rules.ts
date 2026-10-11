import type { Risk } from '../types'

// 사전 검사: 글자만 보고 위험한 명령 조각을 찾는다. 모델 없이 바로 나오고, 모델이 뭐라 하든 위험도를 낮추지 못한다.

export type Hit = { risk: Risk; label: string }

type Rule = {
  risk: Risk | ((m: RegExpExecArray) => Risk)
  re: RegExp
  label: string | ((m: RegExpExecArray) => string)
  // 같은 group은 먼저 걸린 규칙 하나만 쓴다 (예: push --force가 걸리면 일반 push는 건너뜀)
  group?: string
}

const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 }

export const maxRisk = (risks: readonly (Risk | null | undefined)[]): Risk | null =>
  risks.reduce<Risk | null>((top, r) => (r == null ? top : top === null || RANK[r] > RANK[top] ? r : top), null)

// 명령 이름 앞: 줄 처음, 공백, ; & | ( ` 따옴표 (sh -c "rm ..." 안의 명령도 잡는다)
const at = (names: string, rest = '', flags = '') =>
  new RegExp(`(?:^|[\\s;&|(\`'"])(?:${names})(?=\\s|$)${rest}`, flags)

// 삭제 명령의 옵션 해석: bash(-rf), PowerShell(-Recurse -Force), cmd(/s /q)
const removal = (name: string, args: string) => {
  const flags = args.split(/\s+/).filter(a => /^(?:--?|\/)[A-Za-z]/.test(a))
  const isPsRecurse = (f: string) => /^-rec/i.test(f)
  const isPsForce = (f: string) => /^-fo/i.test(f)
  const isCluster = (f: string) => /^-[A-Za-z]{1,4}$/.test(f) && !isPsRecurse(f) && !isPsForce(f)
  const recursive = flags.some(f => f === '--recursive' || isPsRecurse(f) || /^\/s$/i.test(f) || (isCluster(f) && /[rR]/.test(f)))
  const force = flags.some(f => f === '--force' || isPsForce(f) || /^\/[qf]$/i.test(f) || (isCluster(f) && /f/.test(f)))
  const isEmptyDirOnly = /^(?:rd|rmdir)$/i.test(name) && !recursive
  const shown = [name, ...flags].join(' ')
  if (isEmptyDirOnly) return { risk: 'medium' as const, label: `${shown}: 빈 폴더를 삭제` }
  const what = recursive ? '폴더를 안의 내용까지 통째로' : '파일을'
  const how = force ? '묻지 않고 ' : ''
  return { risk: 'high' as const, label: `${shown}: ${what} ${how}바로 삭제 (휴지통 없음)` }
}

const REMOTE_EXEC = '인터넷에서 받은 스크립트를 내용 확인 없이 바로 실행'
const OVERWRITE = '파일 내용을 새로 덮어씀 (기존 내용 사라짐)'
const ADMIN = '관리자 권한으로 실행 (시스템 전체를 바꿀 수 있음)'
const DISK = '디스크를 포맷하거나 지움 (모든 데이터 삭제)'
const POWER = '컴퓨터를 끄거나 다시 시작'
const KILL = '실행 중인 프로그램을 강제로 종료'

const RULES: Rule[] = [
  // ── 삭제 ──
  {
    re: /(?:^|[\s;&|(`'"])(rm)(?=\s|$)((?:[ \t]+[^\s;&|)'"]+)*)/,
    risk: m => removal(m[1]!, m[2] ?? '').risk,
    label: m => removal(m[1]!, m[2] ?? '').label,
    group: 'rm',
  },
  {
    re: /(?:^|[\s;&|(`'"])(Remove-Item|ri|del|erase|rd|rmdir)(?=\s|$)((?:[ \t]+[^\s;&|)'"]+)*)/i,
    risk: m => removal(m[1]!, m[2] ?? '').risk,
    label: m => removal(m[1]!, m[2] ?? '').label,
    group: 'win-rm',
  },
  { re: /\bfind\b[^;&|]*(?:\s-delete\b|\s-exec(?:dir)?\s+rm\b)/, risk: 'high', label: 'find -delete: 조건에 맞는 파일을 찾아 한꺼번에 삭제' },
  { re: /\bxargs\b[^;&|]*\brm\b/, risk: 'high', label: 'xargs rm: 앞 명령이 찾은 파일 목록을 한꺼번에 삭제' },

  // ── git ──
  { re: at('git', '\\s+reset\\b[^;&|]*--hard'), risk: 'high', label: 'git reset --hard: 커밋하지 않은 변경 내용을 모두 버림' },
  { re: at('git', '\\s+clean\\b[^;&|]*\\s-[a-zA-Z]*f'), risk: 'high', label: 'git clean -f: git이 관리하지 않는 파일(새로 만든 파일 등)을 삭제' },
  {
    re: at('git', '\\s+push\\b[^;&|]*(?:\\s--force(?:-with-lease)?\\b|\\s-[a-zA-Z]*f\\b|\\s\\+\\S)'),
    risk: 'high',
    label: 'git push --force: 원격 저장소의 기록을 덮어씀 (다른 사람의 커밋이 사라질 수 있음)',
    group: 'push',
  },
  { re: at('git', '\\s+push\\b'), risk: 'medium', label: 'git push: 내 커밋을 원격 저장소(GitHub 등)에 올림 (다른 사람에게 보일 수 있음)', group: 'push' },
  { re: at('git', '\\s+checkout\\b[^;&|]*\\s(?:--\\s|\\.(?=\\s|$))'), risk: 'high', label: 'git checkout --: 파일의 수정 내용을 버리고 마지막 커밋 상태로 되돌림' },
  { re: at('git', '\\s+restore\\b(?![^;&|]*--staged)'), risk: 'high', label: 'git restore: 파일의 수정 내용을 버리고 되돌림' },
  { re: at('git', '\\s+branch\\b[^;&|]*\\s-[a-zA-Z]*D\\b'), risk: 'high', label: 'git branch -D: 브랜치를 강제로 삭제 (합치지 않은 커밋도 사라질 수 있음)' },
  { re: at('git', '\\s+stash\\s+(?:drop|clear)\\b'), risk: 'high', label: 'git stash drop/clear: 임시 저장해 둔 변경 내용을 삭제' },
  { re: at('git', '\\s+(?:filter-branch|filter-repo)\\b'), risk: 'high', label: 'git filter-branch: 저장소 전체 기록을 다시 씀' },
  { re: at('git', '\\s+rebase\\b'), risk: 'medium', label: 'git rebase: 커밋 기록을 다시 씀' },

  // ── 인터넷에서 받아 바로 실행 ──
  {
    re: /\b(?:curl|wget)\b[^;&]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python3?|node|perl|ruby)\b|(?:ba|z)?sh\s+(?:-c\s+)?["']?\$\(\s*(?:curl|wget)\b|(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/,
    risk: 'high',
    label: `curl | sh: ${REMOTE_EXEC}`,
    group: 'remote-exec',
  },
  {
    re: /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|curl|wget|DownloadString)\b[^;&]*\|\s*(?:iex|Invoke-Expression)\b|\b(?:iex|Invoke-Expression)\s*\(?\s*\(?\s*(?:New-Object\s+(?:System\.)?Net\.WebClient|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b/i,
    risk: 'high',
    label: `iex: ${REMOTE_EXEC}`,
    group: 'remote-exec',
  },
  {
    re: /\bcurl\b[^;&|]*(?:\s-d\s*@|\s--data(?:-binary|-raw)?\s*@|\s-F\s*\S+=@|\s-T\s)/,
    risk: 'medium',
    label: 'curl 업로드: 내 컴퓨터의 파일을 인터넷으로 보냄',
  },

  // ── 관리자 권한·시스템 ──
  { re: at('sudo|doas'), risk: 'high', label: `sudo: ${ADMIN}` },
  { re: /-Verb\s+['"]?RunAs\b|(?:^|[\s;&|(])runas\s/i, risk: 'high', label: `RunAs: ${ADMIN}` },
  { re: at('shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer', '', 'i'), risk: 'high', label: POWER },
  {
    re: /(?:^|[\s;&|(])(?:mkfs(?:\.\w+)?|fdisk|parted|wipefs)(?=\s|$)|diskutil\s+(?:erase\w*|zeroDisk|secureErase|partitionDisk)|\b(?:Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition)\b|(?:^|[\s;&|(])format\s+[a-z]:/i,
    risk: 'high',
    label: DISK,
  },
  { re: at('dd', '[^;&|]*\\bof='), risk: 'high', label: 'dd of=: 파일이나 디스크에 데이터를 직접 덮어씀' },
  { re: at('chmod', '[^;&|]*\\s0?777\\b'), risk: 'high', label: 'chmod 777: 누구나 읽고 쓰고 실행할 수 있게 권한을 엶', group: 'chmod' },
  { re: at('chmod|chown|chgrp', '[^;&|]*\\s-[a-zA-Z]*R'), risk: 'medium', label: 'chmod/chown -R: 폴더 전체의 권한이나 소유자를 바꿈', group: 'chmod' },
  { re: at('icacls|takeown', '', 'i'), risk: 'medium', label: 'icacls/takeown: 파일 권한이나 소유권을 바꿈' },
  { re: at('crontab', '\\s+-[a-zA-Z]*r'), risk: 'high', label: 'crontab -r: 예약 작업을 모두 삭제' },
  { re: at('kill|pkill|killall|taskkill|Stop-Process|spps', '', 'i'), risk: 'medium', label: KILL },

  // ── 윈도우 설정 ──
  { re: /\bSet-ExecutionPolicy\b/i, risk: 'high', label: 'Set-ExecutionPolicy: PowerShell 스크립트 실행 보안 정책을 바꿈' },
  {
    re: /\breg(?:\.exe)?\s+delete\b|\bRemove-ItemProperty\b|\bRemove-Item\b[^;&|]*(?:HKLM|HKCU|HKEY_\w+|Registry::)/i,
    risk: 'high',
    label: '레지스트리(윈도우 설정 저장소) 항목을 삭제',
    group: 'registry',
  },
  {
    re: /\breg(?:\.exe)?\s+(?:add|import)\b|\bSet-ItemProperty\b[^;&|]*(?:HKLM|HKCU|HKEY_\w+|Registry::)|\bNew-ItemProperty\b/i,
    risk: 'medium',
    label: '레지스트리(윈도우 설정 저장소) 값을 바꿈',
    group: 'registry',
  },
  { re: /\bvssadmin\b[^;&|]*\bdelete\b|\bwbadmin\b[^;&|]*\bdelete\b|\bbcdedit\b/i, risk: 'high', label: '시스템 복원 지점·백업·부팅 설정을 지우거나 바꿈' },
  { re: /\bnet\s+(?:user|localgroup)\b[^;&|]*\/(?:add|delete)\b/i, risk: 'high', label: '윈도우 사용자 계정이나 권한 그룹을 추가·삭제' },
  { re: /\b(?:Set-MpPreference|Add-MpPreference)\b/i, risk: 'high', label: '윈도우 보안(Defender) 설정을 바꿈' },

  // ── 배포·외부 데이터 ──
  {
    re: /(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bgh\s+release\s+create\b/,
    risk: 'high',
    label: '패키지·릴리스를 공개 저장소에 배포 (되돌리기 어려움)',
  },
  { re: /\bgh\s+repo\s+delete\b|\bgh\s+api\b[^;&|]*-X\s*DELETE\b/i, risk: 'high', label: 'GitHub 저장소나 데이터를 삭제' },
  { re: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i, risk: 'high', label: '데이터베이스의 표나 데이터를 삭제' },
  {
    re: /\bdocker\s+(?:system\s+prune|volume\s+(?:rm|prune)|image\s+prune|container\s+prune|rmi?\b)/,
    risk: 'high',
    label: 'docker: 컨테이너·이미지·볼륨을 삭제',
  },

  // ── 바꾸지만 되돌릴 수 있는 것 ──
  { re: /(?:^|[^0-9>&<\-=])>\|?[ \t]*(?!\/dev\/null\b|&|nul\b|\$null\b)(?=[^\s>&|])/i, risk: 'medium', label: `> 파일: ${OVERWRITE}`, group: 'overwrite' },
  { re: /\b(?:Set-Content|Out-File)\b/i, risk: 'medium', label: `Set-Content: ${OVERWRITE}`, group: 'overwrite' },
  { re: at('mv|Move-Item|move', '', 'i'), risk: 'medium', label: 'mv: 파일을 옮기거나 이름을 바꿈 (같은 이름이 있으면 덮어씀)' },
  {
    re: /(?:^|[\s;&|(])(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\buv\s+(?:pip\s+install|add)\b|\b(?:brew|apt|apt-get|gem|cargo|go|winget|choco|scoop)\s+install\b|\b(?:Install-Module|Install-Package)\b/i,
    risk: 'medium',
    label: '패키지 설치: 인터넷에서 받은 코드를 설치 (설치 스크립트가 실행될 수 있음)',
  },
  {
    re: /\.ssh\/id_|(?:^|[\s/'"])\.env(?:\.[\w-]+)?(?=[\s'"]|$)|\.aws\/credentials|\.netrc\b|\.npmrc\b|credentials\.json\b/,
    risk: 'medium',
    label: '비밀 정보(키·비밀번호)가 담긴 파일을 다룸',
  },
]

// 명령이 아닌 글은 검사에서 뺀다: heredoc 본문(파일에 쓸 내용), 커밋 메시지, echo로 찍는 문장
const stripData = (command: string) =>
  command
    .replace(/<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, m => m.slice(0, m.indexOf('\n')))
    .replace(/(\s(?:-m|--message)(?:\s+|=))("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1""')
    .replace(/((?:^|[\s;&|(])(?:echo|printf|Write-Host|Write-Output)\s+)("(?:[^"\\]|\\.)*"|'[^']*')/gi, '$1""')

export const scan = (command: string): Hit[] => {
  const text = stripData(command)
  const seenGroups = new Set<string>()
  const hits: Hit[] = []
  for (const rule of RULES) {
    if (rule.group !== undefined && seenGroups.has(rule.group)) continue
    const m = rule.re.exec(text)
    if (m === null) continue
    if (rule.group !== undefined) seenGroups.add(rule.group)
    const label = typeof rule.label === 'string' ? rule.label : rule.label(m)
    const risk = typeof rule.risk === 'string' ? rule.risk : rule.risk(m)
    if (!hits.some(h => h.label === label)) hits.push({ risk, label })
  }
  return hits.sort((a, b) => RANK[b.risk] - RANK[a.risk])
}

// 실제 영향 측정: 명령이 무엇을 지우고 버리는지 실행 전에 직접 재 본다.
//
// Adapted from blast-radius in anthropics/claude-code-playground
// (claude-code/mods/blast-radius/hooks/blast-radius.mjs), Apache License 2.0,
// see LICENSE-blast-radius. Changes: ported to TypeScript, messages in Korean,
// the process runner is passed in, a list is cut at 5, the results feed an
// explanation and the decision to ask in auto mode instead of a Proceed/Cancel
// pane, and pending migrations are not listed (that runs the project's code
// before anyone approved).

import type { Impact } from '../types'

export type Run = (
  argv: readonly string[],
  init: { cwd?: string; timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

type RmTarget = { kind: 'rm'; label: string; targets: string[]; dir: string | null }
type GitTarget = { kind: 'git-reset' | 'git-checkout' | 'git-clean' | 'git-push-force'; label: string; args: string[]; dir: string | null }
type MigrateTarget = { kind: 'migrate'; label: string; dir: string | null }
export type Target = RmTarget | GitTarget | MigrateTarget

const LIST_MAX = 5
const TIMEOUT_MS = 4_000

const SUDO_VALUE_OPTIONS = new Set(['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'])
// 읽기만 하는 명령: 그 안의 "migrate"라는 낱말은 마이그레이션이 아니다
const READ_ONLY = new Set(['ls', 'cat', 'echo', 'printf', 'grep', 'rg', 'find', 'less', 'head', 'tail', 'cd', 'git'])
// 실제 명령 앞에 와도 하는 일을 바꾸지 않는 낱말
const PREFIXES = new Set(['command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', '!'])

/** 앞의 `cd arg`가 옮겨 간 폴더 (null은 세션 폴더) */
const joinDir = (dir: string | null, arg: string | undefined): string => {
  if (arg === undefined || arg === '~' || arg.startsWith('/') || arg.startsWith('~/')) return arg ?? '~'
  return dir ? `${dir}/${arg}` : arg
}

/** 따옴표를 지켜 낱말로 나눈다. 옵션과 경로를 읽기에 충분하다 */
export const tokenize = (text: string): string[] => {
  const words: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) words.push(m[1] ?? m[2] ?? m[3] ?? '')
  return words
}

type Segment = Target | { cd: string } | null

const classifySegment = (segment: string, dir: string | null, pushed: (string | null)[]): Segment => {
  const words = tokenize(segment.trim().replace(/^[({]+\s*/, '').replace(/\s*[)}]+$/, ''))
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words.shift()
  if (words[0] === 'sudo') {
    words.shift()
    while (words.length > 0 && words[0]!.startsWith('-')) {
      const option = words.shift()!
      if (SUDO_VALUE_OPTIONS.has(option)) words.shift()
    }
  }
  while (words.length > 0 && (PREFIXES.has(words[0]!) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!))) words.shift()
  if (words[0] === 'nice') {
    words.shift()
    const option: string | undefined = words[0]
    if (option === '-n') words.splice(0, 2)
    else if (/^-\d+$/.test(option ?? '')) words.shift()
  }
  const [first, ...args] = words
  if (first === undefined) return null
  const cmd = first.replace(/^\\/, '') // \rm은 별칭을 건너뛸 뿐 여전히 rm
  if (cmd === 'cd') return { cd: args[0] === '-' ? '-' : joinDir(dir, args[0]) }
  if (cmd === 'pushd') {
    pushed.push(dir)
    return { cd: joinDir(dir, args[0]) }
  }
  if (cmd === 'popd') return { cd: pushed.length > 0 ? (pushed.pop() ?? '~') : '-' }
  if (cmd === 'rm' || cmd.endsWith('/rm')) {
    const flags = args.filter(a => a.startsWith('-'))
    const recursive = flags.some(f => f === '--recursive' || (/^-[^-]/.test(f) && /[rR]/.test(f)))
    const force = flags.some(f => f === '--force' || (/^-[^-]/.test(f) && f.includes('f')))
    if (recursive || force) {
      return { kind: 'rm', label: `rm ${flags.join(' ')}`.trim(), targets: args.filter(a => !a.startsWith('-') || a === '-'), dir }
    }
  }
  if (cmd === 'git') {
    // git 자신의 옵션은 하위 명령 앞에 온다. -C는 실행할 폴더를 옮긴다
    let gitDir = dir
    let i = 0
    while (i < args.length && args[i]!.startsWith('-')) {
      if (args[i] === '-C' && i + 1 < args.length) {
        gitDir = joinDir(gitDir, args[i + 1])
        i += 2
      } else if (args[i] === '-c' && i + 1 < args.length) {
        i += 2
      } else {
        i += 1
      }
    }
    const sub = args[i]
    const rest = args.slice(i + 1)
    if (sub === 'reset' && rest.includes('--hard')) return { kind: 'git-reset', label: 'git reset --hard', args: rest, dir: gitDir }
    if (sub === 'clean') return { kind: 'git-clean', label: 'git clean', args: rest, dir: gitDir }
    if (sub === 'push' && rest.some(a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || /^\+/.test(a))) {
      return { kind: 'git-push-force', label: 'git push --force', args: rest, dir: gitDir }
    }
    const isStagedOnly = sub === 'restore' && rest.includes('--staged') && !rest.includes('--worktree') && !rest.includes('-W')
    if ((sub === 'checkout' || sub === 'restore') && rest.includes('.') && !isStagedOnly) {
      return { kind: 'git-checkout', label: `git ${sub} -- .`, args: rest, dir: gitDir }
    }
  }
  const joined = words.join(' ')
  if (/\balembic\s+upgrade\b/.test(joined)) return { kind: 'migrate', label: 'alembic upgrade', dir }
  if (/\bdb:migrate(?!:status\b)/.test(joined)) return { kind: 'migrate', label: 'db:migrate', dir }
  if (/\bprisma\s+migrate\b/.test(joined)) return { kind: 'migrate', label: 'prisma migrate', dir }
  if (/\bmanage\.py\s+migrate\b/.test(joined)) return { kind: 'migrate', label: 'manage.py migrate', dir }
  if (!READ_ONLY.has(cmd) && args.includes('migrate')) return { kind: 'migrate', label: 'migrate', dir }
  return null
}

/** 한 줄 명령에서 처음 나오는 위험한 조각. 앞의 cd, pushd, popd, ( ) 범위를 따라간다 */
export const classify = (command: string): Target | null => {
  let dir: string | null = null
  const scopes: (string | null)[] = []
  const pushed: (string | null)[] = []
  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    const opens = raw.match(/^\s*\(+/)?.[0].trim().length ?? 0
    // 뒤에 붙은 리다이렉트와 &는 닫는 )를 가리지 않는다: `(cd sub && make) > log`
    const tail = raw.replace(/(?:\s*(?:\d*>>?|&>>?|<)\s*\S+|\s*&)+\s*$/, '')
    const closes = tail.match(/\)+\s*$/)?.[0].trim().length ?? 0
    for (let k = 0; k < opens; k += 1) scopes.push(dir)
    const found = classifySegment(raw, dir, pushed)
    if (found !== null && !('cd' in found)) return found
    if (found !== null) dir = found.cd
    for (let k = 0; k < closes && scopes.length > 0; k += 1) dir = scopes.pop() ?? null
  }
  return null
}

export const size = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes || 0}B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = -1
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n < 10 ? 1 : 0)}${units[i]}`
}

const count = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// 경로는 셸 코드가 아니라 인자로 넘기므로 그 안의 글자가 실행되지 않는다
const CD_SCRIPT = `unset CDPATH; d="$1"; case "$d" in "~") d="$HOME";; "~/"*) d="$HOME/\${d#\\~/}";; esac; cd -- "$d" 2>/dev/null && pwd -P`

// compgen -G는 명령 치환 없이 glob만 펼친다. 상대 경로 앞에 ./를 붙여 find가 -delete 같은 이름을 동작으로 읽지 않게 한다
const RM_SCRIPT = `
shopt -s nullglob dotglob
paths=()
for p in "$@"; do
  case "$p" in "~"|"~/"*) p="$HOME\${p#\\~}";; esac
  if [[ "$p" == *[*?[]* ]]; then
    while IFS= read -r m; do paths+=("$m"); done < <(compgen -G "$p")
  elif [[ -e "$p" || -L "$p" ]]; then
    paths+=("$p")
  fi
done
if (( \${#paths[@]} == 0 )); then echo "0 0 0"; exit 0; fi
for i in "\${!paths[@]}"; do case "\${paths[$i]}" in /*) ;; *) paths[$i]="./\${paths[$i]}";; esac; done
files=$(find "\${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | wc -l | tr -d ' ')
kb=$(du -skc "\${paths[@]}" 2>/dev/null | tail -n1 | cut -f1)
echo "$files $(( \${kb:-0} * 1024 )) \${#paths[@]}"
printf 'H %s\\n' "$HOME"
for p in "\${paths[@]}"; do d=$(cd -- "$(dirname -- "$p")" 2>/dev/null && pwd -P); printf 'P %s/%s\\n' "\${d%/}" "$(basename -- "$p")"; done
find "\${paths[@]}" \\( -type f -o -type l \\) 2>/dev/null | head -n ${LIST_MAX}
`

// 세션이 지나가며 만든 임시 파일: 지워도 잃을 것이 없다고 본다
const TEMP = /^\/(?:private\/)?(?:tmp|var\/folders)\//

const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path)

const measureRm = async (run: Run, target: RmTarget, cwd: string): Promise<Impact> => {
  if (target.targets.length === 0) return { summary: '지울 경로가 없는 rm', lines: [], more: 0, isLoss: false }
  const out = await run(['bash', '-c', RM_SCRIPT, 'bash-explain', ...target.targets], { cwd, timeoutMs: TIMEOUT_MS })
  const rows = out.stdout.split('\n').filter(l => l !== '')
  const [files = 0, bytes = 0, found = 0] = (rows[0] ?? '0 0 0').split(' ').map(Number)
  const resolved = rows.filter(l => l.startsWith('P ')).map(l => l.slice(2))
  const home = rows.find(l => l.startsWith('H '))?.slice(2)
  // 홈 폴더 아래 경로는 ~로 줄여 보여 준다
  const listed = rows
    .slice(1)
    .filter(l => !l.startsWith('P ') && !l.startsWith('H '))
    .map(l => l.replace(/^\.\//, ''))
    .map(l => (home && l.startsWith(`${home}/`) ? `~${l.slice(home.length)}` : l))
  const where = `대상: ${target.targets.join(' ')}`
  if (!found) return { summary: '지울 것 없음: 그런 파일이나 폴더가 없음', lines: [], more: 0, note: where, isLoss: false }
  const isTempOnly = resolved.length > 0 && resolved.every(p => TEMP.test(p))
  if (!files) return { summary: `안에 파일이 없는 경로 ${found}개 삭제`, lines: [], more: 0, note: where, isLoss: false }
  return {
    summary: `파일 ${count(files)}개, 약 ${size(bytes)} 삭제 (휴지통 없음)`,
    lines: listed,
    more: Math.max(0, files - listed.length),
    note: isTempOnly ? `${where} · 임시 폴더 안` : where,
    isLoss: !isTempOnly,
  }
}

const measureClean = async (run: Run, args: string[], cwd: string): Promise<Impact> => {
  const flags: string[] = []
  const paths: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!
    if (a === '--') {
      paths.push(...args.slice(i + 1))
      break
    }
    if (a === '-e' || a === '--exclude') {
      flags.push(a, args[i + 1] ?? '')
      i += 1
    } else if (a.startsWith('--exclude=') || /^-e./.test(a)) {
      flags.push(a)
    } else if (/^-[a-zA-Z]+$/.test(a)) {
      const kept = a.replace(/[finq]/g, '') // -n은 아래에서 붙인다. -f, -i, -q는 시험 실행을 바꾼다
      if (kept !== '-') flags.push(kept)
    } else if (!a.startsWith('-')) {
      paths.push(a)
    }
  }
  const out = await run(['git', 'clean', '-n', ...flags, '--', ...paths], { cwd, timeoutMs: TIMEOUT_MS })
  if (out.exitCode !== 0) return { summary: 'git clean을 시험 실행하지 못함', lines: [], more: 0, note: out.stderr.trim().slice(0, 160), isLoss: null }
  const gone = out.stdout.split('\n').filter(l => l.startsWith('Would remove ')).map(l => l.slice(13))
  if (gone.length === 0) return { summary: '지울 것 없음: git이 관리하지 않는 파일이 없음', lines: [], more: 0, isLoss: false }
  return {
    summary: `git이 관리하지 않는 ${count(gone.length)}개 항목 삭제`,
    lines: gone.slice(0, LIST_MAX),
    more: Math.max(0, gone.length - LIST_MAX),
    note: 'git clean -n으로 확인. git에 없는 파일이라 되돌릴 수 없음',
    isLoss: true,
  }
}

const measureDiscard = async (run: Run, target: GitTarget, cwd: string): Promise<Impact> => {
  const status = await run(['git', 'status', '--porcelain'], { cwd, timeoutMs: TIMEOUT_MS })
  if (status.exitCode !== 0) return { summary: 'git 저장소가 아니어서 재지 못함', lines: [], more: 0, note: status.stderr.trim().slice(0, 160), isLoss: null }
  const rows = status.stdout.split('\n').filter(l => l.length > 3 && !l.startsWith('??'))
  // reset --hard는 스테이징한 변경까지, checkout -- .는 스테이징하지 않은 변경만 버린다
  const lost = target.kind === 'git-reset' ? rows : rows.filter(l => l[1] !== ' ')
  if (lost.length === 0) return { summary: '버릴 것 없음: 커밋하지 않은 변경이 없음', lines: [], more: 0, isLoss: false }
  const stat = await run(['git', 'diff', '--shortstat', target.kind === 'git-reset' ? 'HEAD' : '--'], { cwd, timeoutMs: TIMEOUT_MS })
  return {
    summary: `커밋하지 않은 변경 ${count(lost.length)}개 파일을 버림`,
    lines: lost.slice(0, LIST_MAX).map(l => `${l.slice(0, 2).trim()} ${l.slice(3)}`),
    more: Math.max(0, lost.length - LIST_MAX),
    note: [stat.stdout.trim(), '커밋하지 않은 변경은 되돌릴 수 없음'].filter(Boolean).join(' · '),
    isLoss: true,
  }
}

const measurePush = async (run: Run, args: string[], cwd: string): Promise<Impact> => {
  const positional = args.filter(a => !a.startsWith('-'))
  const remote = positional[0] ?? 'origin'
  // refspec은 src:dst. 콜론이 없으면 같은 이름의 로컬 브랜치를 올린다
  const spec = (positional[1] ?? '').replace(/^\+/, '')
  let [source, branch] = spec.includes(':') ? spec.split(':') : [spec, spec]
  branch = (branch ?? '').replace(/^refs\/heads\//, '')
  if (!branch || branch === 'HEAD') {
    const head = await run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: TIMEOUT_MS })
    branch = head.stdout.trim()
    source = 'HEAD'
  }
  source = source || 'HEAD'
  const ref = `${remote}/${branch}`
  const known = await run(['git', 'rev-parse', '--verify', '--quiet', ref], { cwd, timeoutMs: TIMEOUT_MS })
  if (known.exitCode !== 0) {
    return { summary: `${ref}에서 사라질 커밋을 알 수 없음`, lines: [], more: 0, note: `${ref}의 로컬 사본이 없음. git fetch를 먼저 하면 알 수 있음`, isLoss: null }
  }
  const log = await run(['git', 'log', '--oneline', '--no-decorate', `${source}..${ref}`], { cwd, timeoutMs: TIMEOUT_MS })
  const dropped = log.stdout.split('\n').filter(l => l !== '')
  if (dropped.length === 0) return { summary: `${ref}에서 사라지는 커밋 없음`, lines: [], more: 0, note: '마지막 fetch 기준', isLoss: false }
  return {
    summary: `${ref}의 커밋 ${count(dropped.length)}개가 사라짐`,
    lines: dropped.slice(0, LIST_MAX),
    more: Math.max(0, dropped.length - LIST_MAX),
    note: `${source}에 없는 ${ref}의 커밋, 마지막 fetch 기준`,
    isLoss: true,
  }
}

/** 실제 영향. 실패해도 던지지 않고 재지 못했다고 말한다 */
export const measure = async (run: Run, target: Target, sessionCwd: string): Promise<Impact> => {
  if (target.kind === 'migrate') {
    return {
      summary: `${target.label}: 데이터베이스 구조를 바꿈`,
      lines: [],
      more: 0,
      note: '대기 중인 마이그레이션 목록은 프로젝트 코드를 실행해야 알 수 있어 재지 않음',
      isLoss: null,
    }
  }
  // 윈도우: bash가 Git Bash가 아닐 수 있어 파일 측정은 하지 않는다. git은 셸 없이 바로 부르므로 잰다
  const isWindows = isWindowsPath(sessionCwd)
  if (isWindows && (target.kind === 'rm' || target.dir !== null)) {
    return { summary: `${target.label}: 윈도우에서는 영향을 재지 않음`, lines: [], more: 0, isLoss: null }
  }
  try {
    let cwd = sessionCwd
    if (target.dir !== null) {
      if (target.dir === '-') return { summary: `${target.label}: cd - 뒤의 폴더를 알 수 없어 재지 못함`, lines: [], more: 0, isLoss: null }
      const moved = await run(['bash', '-c', CD_SCRIPT, 'bash-explain', target.dir], { cwd: sessionCwd, timeoutMs: TIMEOUT_MS })
      const out = moved.stdout.trim()
      if (moved.exitCode !== 0 || out === '') {
        return { summary: `${target.label}: ${target.dir} 폴더가 없어 재지 못함`, lines: [], more: 0, isLoss: null }
      }
      cwd = out
    }
    switch (target.kind) {
      case 'rm':
        return await measureRm(run, target, cwd)
      case 'git-clean':
        return await measureClean(run, target.args, cwd)
      case 'git-push-force':
        return await measurePush(run, target.args, cwd)
      default:
        return await measureDiscard(run, target, cwd)
    }
  } catch {
    return { summary: `${target.label}: ${TIMEOUT_MS / 1000}초 안에 재지 못함`, lines: [], more: 0, isLoss: null }
  }
}

/** 측정 결과를 모델에 넘길 글로 */
export const describeImpact = (impact: Impact): string =>
  [
    impact.summary,
    ...impact.lines.map(l => `  ${l}`),
    ...(impact.more > 0 ? [`  … 외 ${count(impact.more)}개`] : []),
    ...(impact.note ? [`  (${impact.note})`] : []),
  ].join('\n')

export const moreText = (more: number) => `… 외 ${count(more)}개`

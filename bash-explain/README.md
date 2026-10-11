# bash-explain

Claude Code가 셸 명령 실행을 허락해 달라고 물을 때, 그 명령이 무엇을 하는지 한글로 풀어 주는 모드입니다. 확인 창 바로 위, 대화 기록의 명령 줄 밑에 해설이 나타납니다. 명령을 조각별로 나눠 설명하고, Claude가 왜 그 명령을 쓰려는지 짐작해 적고, 무엇이 바뀌거나 사라지는지와 위험도를 보여 줍니다.

```
● Running 1 shell command…
  ⎿ $ rm -rf node_modules dist && npm ci

     🔴 위험 · node_modules와 dist 폴더를 지우고 패키지를 새로 설치
       · rm -rf node_modules dist → 두 폴더를 안의 내용까지 통째로 삭제 (-r 하위 폴더까지, -f 묻지 않고)
       · npm ci → package-lock.json 기준으로 패키지를 새로 설치
       왜: 설치가 꼬였을 때 깨끗하게 다시 까는 흔한 방법으로 보임
       ⚠ 지운 폴더는 휴지통에 가지 않음. 소스 코드는 그대로
       ─ bash-explain · Sonnet 5.5

 Bash command
 │ rm -rf node_modules dist && npm ci
 Do you want to proceed?
 ❯ 1. Yes
```

Bash(macOS·Linux·윈도우 Git Bash)와 PowerShell(윈도우) 명령을 해설합니다.

## 설치

```
/plugin marketplace add KKK12142/claude-mods
/plugin install bash-explain@claude-mods
```

## 동작 방식

1. 확인 창은 **바로** 뜹니다. 해설을 기다리게 하지 않습니다.
2. **사전 검사**: `rm -rf`, `git reset --hard`, `git push --force`, `sudo`, `curl … | sh`, `Remove-Item -Recurse`, `rd /s /q`, `reg delete` 같은 위험한 조각을 글자로 찾아 위험도를 바로 정합니다. 모델이 무슨 답을 하든 이 위험도는 낮아지지 않습니다.
3. **해설**: 일반 명령은 Haiku 5.5(`low`)가 3초 안에, 사전 검사에서 위험(🔴)으로 잡힌 명령은 Sonnet 5.5(`medium`)가 6초 안에 만들어 창 위에 그립니다. 시간 안에 답이 없으면 사전 검사 결과만 보여 줍니다.
4. 수락하거나 거절해서 명령이 끝나면 해설은 `🔴 위험 · 요약` 한 줄로 접혀 기록에 남습니다.
5. 같은 명령을 다시 물으면 앞서 만든 해설을 그대로 씁니다.

| 표시 | 뜻 |
|---|---|
| 🔴 위험 | 삭제, 덮어쓰기, 강제 푸시, 관리자 권한, 인터넷에서 받은 코드 실행처럼 되돌리기 어려움 |
| 🟡 변경 | 파일·설정·패키지를 바꾸지만 되돌릴 수 있음 |
| 🟢 읽기만 | 아무것도 바꾸지 않음 |
| ⚪ 확인 필요 | 판단할 근거가 부족함 |

해설은 모델이 만든 것이라 틀릴 수 있습니다. 수락 여부를 정하는 데 참고로 쓰세요.

auto mode에서는 분류기가 사람에게 넘겨 **확인 창이 실제로 뜰 때만** 해설을 만듭니다. 분류기가 알아서 허락하거나 막은 명령에는 사용량을 쓰지 않습니다.

확인 창 자체는 Claude Code가 직접 그리고 모드가 바꿀 수 없어서, 해설은 창 안이 아니라 창 바로 위에 나옵니다.

## 명령

| 명령 | 동작 |
|---|---|
| `/bash-explain <명령어>` | 실행하지 않고 해설만 미리 보기 |
| `/bash-explain off` / `on` | 이 세션에서 끄고 켬 |
| `/bash-explain` | 지금 설정 보기 |

## 설정

`/config`의 bash-explain 항목에서 바꿉니다.

| 항목 | 기본값 |
|---|---|
| 해설 모델 / effort | `claude-haiku-5-5` / `low` |
| 위험 명령 해설 모델 / effort | `claude-sonnet-5-5` / `medium` |

해설은 지금 로그인한 계정으로 모델을 한 번 더 부르므로 사용량이 조금 듭니다. 명령어, 현재 폴더 경로, Claude가 적은 목적 메모가 해설 모델에 함께 전달됩니다.

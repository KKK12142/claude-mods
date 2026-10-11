# bash-explain

Claude Code가 셸 명령 실행을 허락해 달라고 물을 때, 그 명령이 **무엇을 하는지**와 **실제로 무엇을 지우거나 버리는지**를 확인 창 바로 위에 한글로 보여 주는 모드입니다. 해설은 모델이 쓰고, 실제 영향은 실행 전에 직접 재 봅니다. auto mode에서는 실제로 잃을 것이 있는 위험한 명령만 골라 확인 창을 띄웁니다.

```
● Running 1 shell command…
  ⎿ $ rm -rf node_modules dist && npm ci

     🔴 위험 · node_modules와 dist 폴더를 지우고 패키지를 새로 설치
       📦 실제 영향: 파일 1,284개, 약 312MB 삭제 (휴지통 없음)
            dist/index.js
            dist/app.css
            … 외 1,282개
            (대상: node_modules dist)
       · rm -rf node_modules dist → 두 폴더를 안의 내용까지 통째로 삭제 (-r 하위 폴더까지, -f 묻지 않고)
       · npm ci → package-lock.json 기준으로 패키지를 새로 설치
       왜: 설치가 꼬였을 때 깨끗하게 다시 까는 흔한 방법으로 보임
       ⚠ dist에 직접 넣어 둔 파일이 있다면 함께 사라짐
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
2. **실제 영향(📦)**: 아래 명령은 실행 전에 직접 재서 결과를 먼저 보여 줍니다. 보통 1초 안에 끝나고, 4초를 넘기면 "재지 못함"이라고 표시합니다. 읽기만 하는 명령(`find`, `du`, `git status`, `git clean -n`, `git log`)만 쓰고, 경로는 셸 코드가 아닌 인자로 넘겨 파일 이름 속 글자가 실행되지 않습니다.

   | 명령 | 보여 주는 것 |
   |---|---|
   | `rm -r`, `rm -f`, `rm -rf` | 지워질 파일 수, 크기, 앞부분 목록. glob과 `~`도 펼침 |
   | `git reset --hard` | 커밋하지 않은 변경이 있는 파일과 `git diff --shortstat` |
   | `git checkout -- .`, `git restore .` | 스테이징하지 않은 변경이 있는 파일 |
   | `git clean` | `git clean -n`으로 확인한, 지워질 추적 안 되는 항목 |
   | `git push --force` (`-f`, `--force-with-lease`, `+ref`) | 원격 브랜치에서 사라질 커밋 (마지막 fetch 기준) |
   | 마이그레이션 (`manage.py migrate`, `db:migrate` 등) | 대기 목록은 재지 않음 (프로젝트 코드를 실행해야 해서) |

   `cd dir &&`, `pushd`, `popd`, `git -C dir`를 따라가서 명령이 실제로 실행될 폴더에서 잽니다.
3. **사전 검사**: `rm -rf`, `git push --force`, `sudo`, `curl … | sh`, `Remove-Item -Recurse`, `rd /s /q`, `reg delete` 같은 위험한 조각을 글자로 찾아 위험도를 바로 정합니다. 모델이 무슨 답을 하든 이 위험도는 낮아지지 않습니다.
4. **해설**: 일반 명령은 Haiku 5.5(`low`)가 3초 안에, 위험한 명령(사전 검사 🔴이거나 실제로 잃을 것이 있음)은 Sonnet 5.5(`medium`)가 6초 안에 만듭니다. 실제 영향을 사실로 넘겨서 해설이 짐작이 아니라 측정을 바탕으로 쓰입니다.
5. 명령이 끝나면 해설은 `🔴 위험 · 요약  📦 실제 영향` 한 줄로 접혀 기록에 남습니다.

| 표시 | 뜻 |
|---|---|
| 🔴 위험 | 삭제, 덮어쓰기, 강제 푸시, 관리자 권한, 인터넷에서 받은 코드 실행처럼 되돌리기 어려움 |
| 🟡 변경 | 파일·설정·패키지를 바꾸지만 되돌릴 수 있음 |
| 🟢 읽기만 | 아무것도 바꾸지 않음 |
| ⚪ 확인 필요 | 판단할 근거가 부족함 |

해설은 모델이 만든 것이라 틀릴 수 있습니다. 수락 여부를 정하는 데 참고로 쓰세요.

### auto mode에서는

auto mode에서는 분류기가 대신 허락하므로 확인 창이 거의 뜨지 않습니다. bash-explain은 위 표의 명령 가운데 **실제로 잃을 것이 있을 때만** Claude Code의 확인 창을 띄우게 합니다. 지울 파일이 없거나, `/tmp` 같은 임시 폴더 안이거나, 버릴 변경이 없거나, 사라질 커밋이 없으면 그대로 진행합니다. 재지 못했으면(시간 초과, 폴더 없음, 윈도우) 안전하게 묻습니다. `/config`의 "auto mode에서 위험한 손실은 묻기"로 끌 수 있습니다.

그 밖에 auto mode 분류기가 사람에게 넘겨 확인 창이 뜨는 경우에도 해설과 실제 영향이 붙습니다. 분류기가 알아서 허락하거나 막은 명령에는 모델을 부르지 않습니다.

확인 창 자체는 Claude Code가 직접 그리고 모드가 바꿀 수 없어서, 해설은 창 안이 아니라 창 바로 위에 나옵니다.

## 명령

| 명령 | 동작 |
|---|---|
| `/bash-explain <명령어>` | 실행하지 않고, 지금 폴더 기준 실제 영향과 해설만 미리 보기 |
| `/bash-explain off` / `on` | 이 세션에서 끄고 켬 |
| `/bash-explain` | 지금 설정 보기 |

## 설정

`/config`의 bash-explain 항목에서 목록으로 고릅니다. 모델은 Haiku 5.5, Sonnet 5.5, Opus 5.5 중에서 고를 수 있습니다.

| 항목 | 기본값 |
|---|---|
| 해설 모델 / effort | `claude-haiku-5-5` / `low` |
| 위험 명령 해설 모델 / effort | `claude-sonnet-5-5` / `medium` |
| auto mode에서 위험한 손실은 묻기 | 켜짐 |

해설이 실패하면 사전 검사 결과와 함께 이유(시간 초과, 모델 설정, API 오류)를 보여 줍니다.

해설은 지금 로그인한 계정으로 모델을 한 번 더 부르므로 사용량이 조금 듭니다. 명령어, 현재 폴더 경로, Claude가 적은 목적 메모, 실제 영향 측정 결과(파일 이름 일부 포함)가 해설 모델에 함께 전달됩니다.

## 한계

- 명령 글자를 읽을 뿐 셸을 완전히 해석하지는 않습니다. `$(...)`, 별칭, `eval`, `bash -c "..."` 안, `xargs rm`, `find -delete`, `rm`을 부르는 스크립트는 실제 영향을 재지 못합니다(사전 검사와 해설은 붙습니다).
- 한 줄에서 처음 나오는 위험한 조각 하나만 잽니다.
- 따옴표로 감싼 glob(`rm -rf "build/*.js"`)도 펼쳐 세므로, 실제보다 많이 셀 수 있습니다.
- 파일 수는 대략적입니다. 같은 경로가 두 번 걸리면 두 번 셉니다. 크기는 `du -k` 기준 디스크 사용량입니다.
- 강제 push 목록은 마지막 `git fetch` 기준입니다. 원격을 적지 않으면 `origin`으로 봅니다.
- 윈도우에서는 파일 수·크기를 재지 않고(bash가 Git Bash가 아닐 수 있어서), 폴더를 옮기지 않는 git 명령만 잽니다. PowerShell 명령(`Remove-Item` 등)은 해설만 합니다.
- 실제 영향은 확인 창이 뜰 때 잰 것입니다. 수락하기 전까지 파일이 바뀌면 달라질 수 있습니다.

## 출처

실제 영향 측정과 auto mode에서 붙잡는 아이디어는 Anthropic의 [claude-code-playground](https://github.com/anthropics/claude-code-playground)에 있는 [blast-radius](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius) 모드(Apache License 2.0)에서 가져왔습니다(`LICENSE-blast-radius` 참고). 명령 분류, `cd` 추적, 측정 스크립트는 원본을 TypeScript로 옮긴 것이고, 이 버전은 다음을 바꿨습니다: 메시지를 한국어로, 자체 Proceed/Cancel 패널 대신 Claude Code의 확인 창을 쓰고 잃을 것이 있을 때만 auto mode에서 묻기, 측정 결과를 해설 모델에 사실로 넘기기, 임시 폴더 판정, 마이그레이션 목록은 재지 않기(허락 전에 프로젝트 코드가 실행되므로), 윈도우에서 파일 측정 건너뛰기.

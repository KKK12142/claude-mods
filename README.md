# claude-mods

Claude Code 모드(함수 훅 플러그인) 모음.

## 설치

Claude Code 터미널 세션에서 저장소를 한 번 추가한 뒤, 원하는 모드를 설치합니다.

```
/plugin marketplace add KKK12142/claude-mods
/plugin install usage-meter@claude-mods
/plugin install prism-tree@claude-mods
/plugin install bash-explain@claude-mods
/plugin install korean-ui@claude-mods
```

업데이트: `claude plugin marketplace update claude-mods` 후 `/reload-plugins`

## 모드

| 모드 | 설명 |
|---|---|
| `usage-meter` | 입력창 위 한 줄에 모델·effort·컨텍스트·5시간 한도를 막대로 표시. 화면 폭에 맞춰 줄어듦. `/usage-meter on/off`로 켜고 끔 |
| `prism-tree` | 오른쪽 사이드바 파일 트리. git 상태·바뀐 줄 수를 보여 주고 Claude가 건드린 파일을 반짝임으로 표시. 테마 6종, 머리줄 `❖` 버튼으로 전환. `/prism-tree`로 열기, `/prism-tree on/off`로 켜고 끔 ([자세히](prism-tree/README.md)) |
| `bash-explain` | 셸 명령 확인 창이 뜨면 창 바로 위에 그 명령을 한글로 해설하고, `rm -rf`·`git reset --hard`·`git clean`·강제 push가 **실제로 지울 파일 수·크기, 버릴 변경, 사라질 커밋**을 미리 재서 보여 줌. auto mode에서도 실제로 잃을 게 있으면 확인 창을 띄움. 위험도(🔴🟡🟢), Haiku/Sonnet 해설, Bash·PowerShell 지원. `/bash-explain <명령어>`로 미리 보기 ([자세히](bash-explain/README.md), 측정은 Anthropic [blast-radius](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius) 기반) |
| `korean-ui` | 명령어 설명과 `/config` 항목을 한국어로 표시. [KimSuro5773/korean-ui](https://github.com/KimSuro5773/korean-ui)의 포크 [KKK12142/korean-ui](https://github.com/KKK12142/korean-ui) |
| `terminal-browser` | Claude 옆 분할 창에 실제 브라우저를 띄우고 `ctrl+g`로 고른 요소를 입력창에 보냄. `/browser`로 열기. [zenbu-labs/terminal-browser](https://github.com/zenbu-labs/terminal-browser)의 포크 [KKK12142/terminal-browser](https://github.com/KKK12142/terminal-browser) |

### 포크한 모드

`korean-ui`, `terminal-browser`는 이 저장소에 코드가 없고, 내 GitHub 포크의 하위 폴더를 가리킵니다(`git-subdir`). 원본의 새 버전을 받으려면 포크를 먼저 동기화합니다.

```
gh repo sync KKK12142/korean-ui
gh repo sync KKK12142/terminal-browser
claude plugin marketplace update claude-mods
claude plugin update korean-ui@claude-mods
claude plugin update terminal-browser@claude-mods
```

### terminal-browser 준비 (맥북)

플러그인만으로는 동작하지 않고, 브라우저 본체와 kitty 그래픽 프로토콜을 지원하는 터미널(Ghostty, kitty, cmux 등)이 필요합니다. iTerm2나 macOS 기본 터미널, tmux 안에서는 화면이 깨질 수 있습니다.

```
brew install terminal-browser
/plugin install terminal-browser@claude-mods
```

Windows에서는 WSL에서만 동작하므로 Windows PC에는 설치하지 않습니다.

## 모드 추가하기

1. `<모드이름>/` 폴더에 `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`
2. `.claude-plugin/marketplace.json`의 `plugins`에 한 줄 추가
3. `claude plugin validate <모드이름>` 와 `claude plugin test <모드이름>` 통과 확인 후 push

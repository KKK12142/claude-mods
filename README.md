# claude-mods

Claude Code 모드(함수 훅 플러그인) 모음.

## 설치

Claude Code 터미널 세션에서 저장소를 한 번 추가한 뒤, 원하는 모드를 설치합니다.

```
/plugin marketplace add KKK12142/claude-mods
/plugin install usage-meter@claude-mods
```

업데이트: `claude plugin marketplace update claude-mods` 후 `/reload-plugins`

## 모드

| 모드 | 설명 |
|---|---|
| `usage-meter` | 입력창 아래 힌트 줄에 모델·effort·컨텍스트·5시간 한도를 막대로 표시. 화면 폭에 맞춰 줄어듦. `/usage-meter on/off`로 켜고 끔 |

## 모드 추가하기

1. `<모드이름>/` 폴더에 `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`
2. `.claude-plugin/marketplace.json`의 `plugins`에 한 줄 추가
3. `claude plugin validate <모드이름>` 와 `claude plugin test <모드이름>` 통과 확인 후 push

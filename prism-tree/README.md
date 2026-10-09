# prism-tree

오른쪽 사이드바에 작업 폴더의 파일 트리를 띄우는 모드입니다. git 상태와 바뀐 줄 수를 보여 주고, Claude가 읽고 쓰고 커밋하는 파일을 반짝임으로 표시합니다. 색은 6가지 테마 중에서 고릅니다.

Claude Code **2.1.287 이상**, 전체화면 레이아웃(`/tui fullscreen`), 가로 110칸 이상의 터미널이 필요합니다.

## 설치

```
/plugin marketplace add KKK12142/claude-mods
/plugin install prism-tree@claude-mods
```

설치 후 `/prism-tree`를 실행합니다. `/prism-tree <경로>`로 다른 폴더를 고정할 수도 있습니다.

## 켜고 끄기

| 명령 | 동작 |
|---|---|
| `/prism-tree off` | 패널을 닫고 파일 감시·git 조회를 멈춤. 새 세션에서도 꺼진 채로 시작 |
| `/prism-tree on` | 다시 켜고 현재 작업 폴더로 패널을 엶 |
| `/prism-tree`, `/prism-tree <경로>` | 꺼져 있었다면 켜면서 엶 |

`on`·`off`라는 이름의 폴더를 열려면 `./on`처럼 경로로 씁니다.

## 테마

| 테마 | 느낌 |
|---|---|
| `aurora` (기본) | 청록 강조, 차가운 파스텔 |
| `ember` | 호박색 강조, 따뜻한 색조 |
| `forest` | 라임 강조, 녹색 계열 |
| `mono` | 회색조, 삭제와 실패만 빨강 |
| `paper` | 밝은 터미널용, 짙은 청록 강조 |
| `classic` | 원본 filetree 색 |

`/config`의 prism-tree 항목에서 **Theme**을 고르거나, 패널 머리줄의 `❖` 버튼으로 순서대로 바꿉니다. 버튼으로 고른 테마는 Theme 설정을 바꾸기 전까지 다음 세션에도 유지됩니다.

활동별 색(읽기, 쓰기, 커밋, push, pull, 실패)은 테마 안에서 각자 다른 톤으로 표시됩니다.

## 설정

모두 `/config`의 prism-tree 항목에 있습니다.

- **Theme**: `aurora`, `ember`, `forest`, `mono`, `paper`, `classic`
- **Claude activity**: 반짝일 활동. `reads and writes`(기본), `writes`, `reads`, `none`
- **Follow Claude**: `on`(기본)이면 Claude가 건드린 파일로 트리가 따라가고, `off`면 보던 위치를 유지
- **Right column**: `date`(기본) 또는 `size`
- **Glyphs**: `auto`, `nerd`, `plain`

## 출처

[claude-code-filetree](https://github.com/data-goblin/claude-code-filetree)(Kurt Buhler, MIT 라이선스)를 바탕으로 만들었습니다(`LICENSE` 참고). 트리, git, 활동 감지 로직은 원본에서 왔고, 이 버전은 고정 색과 Omarchy 테마 파일 읽기를 내장 테마 프리셋과 테마 전환 버튼으로 바꿨습니다.

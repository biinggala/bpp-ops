# 크린지 플로우 MCP 서버

태스크를 Model Context Protocol로 노출해, Claude에서 대화로 조회·생성·수정·삭제할 수 있게 합니다.

대량 작업에서 값어치를 합니다 — "회의록 보고 태스크 8개 만들어줘", "이번 주 마감인 내 업무 정리해줘"처럼 UI에서 반복 클릭해야 하는 일들이요.

## 도구

| 도구 | 하는 일 |
|---|---|
| `list_projects` | 내가 멤버인 프로젝트 (아카이브 제외가 기본) |
| `list_milestones` | 접근 가능한 프로젝트의 마일스톤 |
| `list_tasks` | 업무 목록 — 프로젝트·상태·담당자·마감일·연체·검색 필터 |
| `get_task` | 단일 업무 전체 + 하위 업무 |
| `create_task` | 업무/하위 업무 생성 |
| `update_task` | 전달한 필드만 수정 |
| `delete_task` | 업무 삭제 (하위 업무 동반 삭제) |

## 접근 제어 — 읽기 전에 알아둘 것

DB 규칙이 `cringe` 전체에 대해 `auth != null`입니다. 즉 **서비스 계정이든 로그인한 사용자든 모든 데이터를 읽고 쓸 수 있고**, 실제 범위 제한은 전부 클라이언트 코드에 있습니다.

그래서 이 서버는 **모든 도구를 운영자 이메일 기준으로 스코프**합니다 (`access.ts`). 이 검사를 건너뛰면 워크스페이스의 모든 프로젝트가 AI 컨텍스트로 그대로 넘어갑니다.

규칙은 웹 앱과 동일합니다:

- **프로젝트 업무** — 그 프로젝트의 멤버이거나 생성자일 때만
- **프로젝트 없는 개인 업무** — 생성자 또는 담당자에게만. 다른 프로젝트에 접근 권한이 있다는 이유로 보이지 않습니다
- **소유권 정보가 없는 프로젝트** — 공개로 취급하지 않고 거부

`npm test`가 이 속성들을 검증합니다.

## 쓰기 안전장치

웹 앱은 태스크 **배열 전체**를 매번 덮어씁니다. 그래서 "하나 추가"도 전체 읽기 → 수정 → 전체 쓰기가 됩니다.

이 서버는 RTDB 트랜잭션을 써서 충돌 시 재시도하므로, 다른 트랜잭션 기반 쓰기와는 안전하게 경합합니다. 쓰기는 `cringe/tasks`와 `cringe/savedAt`에 **따로** 나가고, `cringe` 루트에는 절대 쓰지 않습니다 (루트에 쓰면 projects·milestones·userProfiles가 날아갑니다).

**남는 한계:** 앱 자체는 트랜잭션이 아니라 평범한 `set()`으로 덮어씁니다. 그래서 정확히 같은 순간에 앱이 저장하면 여전히 서로를 덮어쓸 수 있습니다. 이건 지금도 앱 클라이언트끼리 존재하는 레이스이고, 근본 해결은 `cringe/tasks/<id>`처럼 태스크별 키로 데이터 모델을 바꾸는 것입니다 — 서버가 아니라 앱 쪽 변경입니다.

## 로컬 실행

```bash
cd mcp
npm install
npm run build
npm test
```

환경 변수:

| 변수 | 값 |
|---|---|
| `CRINGE_OPERATOR_EMAIL` | 이 서버가 대신 행동할 사람의 이메일. **필수** — 없으면 시작을 거부합니다 |
| `FIREBASE_SERVICE_ACCOUNT` | 서비스 계정 JSON (원문 또는 base64) |
| `FIREBASE_DATABASE_URL` | `https://crng-task-manager-default-rtdb.firebaseio.com` |

Claude Code에 등록:

```bash
claude mcp add cringe-flow \
  --env CRINGE_OPERATOR_EMAIL=you@bpp.co.kr \
  --env FIREBASE_DATABASE_URL=https://crng-task-manager-default-rtdb.firebaseio.com \
  --env FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" \
  -- node /absolute/path/to/mcp/dist/index.js
```

## 팀 공용 원격 서버 — 남은 작업

지금은 stdio 전송만 구현돼 있습니다. 도구 로직과 접근 제어(`tools.ts`, `access.ts`)는 전송 방식과 무관하므로 그대로 재사용되고, 다음 두 가지만 추가하면 됩니다:

1. **HTTP 전송** — SDK의 `StreamableHTTPServerTransport`로 `registerTools()`를 감싸기
2. **사용자별 인증** — 공용 서버에서는 **누가 호출했는지 식별하는 것이 필수**입니다. 서비스 계정 하나로 전원이 붙으면 `Ctx.email`을 정할 수 없고, 그러면 위의 접근 제어가 전부 무의미해집니다

   가벼운 방식: 사용자별 토큰을 `cringe/mcpKeys/<해시>` → 이메일로 저장하고, 요청 헤더의 토큰을 이메일로 해석해 `Ctx`에 넣기. MCP 표준 OAuth보다 훨씬 간단하고, Claude Code는 커스텀 헤더를 지원합니다. claude.ai 커넥터로 붙이려면 OAuth가 필요합니다.

호스팅은 Cloud Run이 무난합니다 (이미 GCP에 프로젝트와 서비스 계정이 있음).

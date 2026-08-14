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
|  `FIREBASE_SERVICE_ACCOUNT` (로컬 전용) | 서비스 계정 JSON (원문 또는 base64) |
| `FIREBASE_DATABASE_URL` | `https://crng-task-manager-default-rtdb.firebaseio.com` |

Claude Code에 등록:

```bash
claude mcp add cringe-flow \
  --env CRINGE_OPERATOR_EMAIL=you@bpp.co.kr \
  --env FIREBASE_DATABASE_URL=https://crng-task-manager-default-rtdb.firebaseio.com \
  --env FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" \
  -- node /absolute/path/to/mcp/dist/index.js
```

## 팀 공용 원격 서버 (claude.ai / Claude Desktop)

claude.ai와 Claude Desktop 커넥터는 **OAuth 2.1 + 동적 클라이언트 등록(DCR)** 으로만 원격 MCP 서버에 붙습니다. 헤더에 토큰을 넣는 방식은 지원하지 않아서, 서버가 실제 인증 서버 역할을 해야 합니다.

MCP SDK가 엔드포인트(`/authorize`, `/token`, `/register`, `/revoke`, 메타데이터)를 전부 제공하므로, 이 저장소는 그 뒤의 로직만 구현합니다:

```
Claude → /register            (DCR, SDK)
       → /authorize           (SDK → 우리 provider)
           → Google 로그인     (팀이 이미 쓰는 그 계정)
           → /oauth/google/callback
           → Claude로 인가 코드 반환
       → /token               (SDK → 우리 provider)
       → POST /mcp            (Bearer 토큰 → 이메일 → Ctx)
```

**신원은 Google에 위임합니다.** Google이 검증한 이메일이 곧 `Ctx.email`이 되고, 그래서 `access.ts`의 접근 제어가 공용 서버에서도 의미를 갖습니다. 어떤 프로젝트에도 속하지 않은 사람은 로그인 단계에서 거부됩니다.

### 토큰 저장 위치

OAuth 클라이언트·인가 코드·토큰은 `cringe/`가 아니라 **최상위 `mcpAuth/`** 에 저장합니다. `cringe`는 로그인한 모든 사용자가 읽을 수 있어서 거기 두면 앱 사용자 누구나 남의 토큰을 가져갈 수 있습니다. `database.rules.json`에서 `mcpAuth`는 모든 클라이언트에 대해 차단되고, Admin SDK만 규칙을 우회해 접근합니다. 토큰은 SHA-256 해시를 키로 저장해서, 이 노드가 통째로 유출돼도 재사용할 수 없습니다.

### 필요한 준비

1. **Google OAuth 웹 클라이언트** — 데스크톱 앱용과 **별개**입니다.
   Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID → 유형 **웹 애플리케이션**.
   승인된 리디렉션 URI에 `https://<배포주소>/oauth/google/callback` 등록

2. **배포** (Cloud Run 예시):

   ```bash
   cd mcp
   gcloud run deploy cringe-flow-mcp --source . --region asia-northeast3 \
     --allow-unauthenticated \
     --set-env-vars PUBLIC_URL=https://<배포주소> \
     --set-env-vars FIREBASE_DATABASE_URL=https://crng-task-manager-default-rtdb.firebaseio.com \
     --set-secrets GOOGLE_OAUTH_CLIENT_ID=...,GOOGLE_OAUTH_CLIENT_SECRET=...,FIREBASE_SERVICE_ACCOUNT=...
   ```

   `--allow-unauthenticated`는 Cloud Run 계층의 이야기입니다. 실제 접근 통제는 위의 OAuth가 담당합니다.

3. **DB 규칙 배포** — `mcpAuth` 차단 규칙이 반영돼야 합니다. 웹 배포 워크플로가 `database.rules.json`을 함께 올립니다.

4. **팀원 연결** — claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가 → `https://<배포주소>/mcp`.
   각자 Google 로그인 화면이 뜨고, 로그인한 계정 기준으로 자기 프로젝트만 보입니다.

### 환경 변수 (HTTP 모드)

| 변수 | 값 |
|---|---|
| `PUBLIC_URL` | 서버의 공개 주소 (OAuth 발급자 식별자로도 쓰임) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | 위에서 만든 **웹** 클라이언트 |
|  `FIREBASE_SERVICE_ACCOUNT` (로컬 전용) | 서비스 계정 JSON (원문 또는 base64) |
| `FIREBASE_DATABASE_URL` | RTDB URL |
| `PORT` | 기본 8080 |

`CRINGE_OPERATOR_EMAIL`은 HTTP 모드에서 쓰지 않습니다 — 신원이 토큰에서 나오기 때문이고, 그게 공용 서버가 안전한 이유입니다.

### 아직 실제로 붙여보지 않았습니다

타입체크·빌드·접근 제어 테스트는 통과했지만, **OAuth 왕복은 배포된 URL이 있어야 검증됩니다.** 첫 연결에서 막히면 로그를 보고 잡겠습니다.

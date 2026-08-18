# bpp-ops MCP 서버

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

DB 규칙은 이제 프로젝트 멤버십을 강제합니다. 웹 클라이언트는 자기가 속한 프로젝트만 읽을 수 있습니다. **하지만 이 서버는 Admin SDK로 붙기 때문에 규칙을 우회합니다** — 서비스 계정에게는 전체 데이터가 그대로 보입니다.

그래서 이 서버는 **모든 도구를 운영자 이메일 기준으로 스코프**합니다 (`access.ts`). 이 검사를 건너뛰면 워크스페이스의 모든 프로젝트가 AI 컨텍스트로 그대로 넘어갑니다. 규칙이 지켜주는 건 앱이지 이 서버가 아닙니다.

규칙은 웹 앱과 동일합니다:

- **프로젝트 업무** — 그 프로젝트의 멤버이거나 생성자일 때만
- **프로젝트 없는 개인 업무** — 생성자 또는 담당자에게만. 다른 프로젝트에 접근 권한이 있다는 이유로 보이지 않습니다
- **소유권 정보가 없는 프로젝트** — 공개로 취급하지 않고 거부

`npm test`가 이 속성들을 검증합니다.

## 쓰기 안전장치

업무는 각자 자기 키에 저장됩니다 (`projects/$pid/tasks/$id`, 또는 프로젝트가 없으면 `personalTasks/$uid/$id`).

`mutateTasks()`의 시그니처는 예전 그대로 전체 목록을 받고 돌려주지만, 쓰기는 더 이상 통째 교체가 아닙니다. 변경 전후를 비교해 **달라진 업무만 각자의 키에** 씁니다. 도구가 생각하는 동안 누군가 앱에서 다른 업무를 고쳐도 그 편집이 살아남습니다 — 예전 트랜잭션으로는 좁힐 수만 있고 닫지는 못하던 구멍입니다.

업무를 프로젝트 간에 옮기면 저장 위치가 바뀌므로, 옛 키를 지우고 새 키에 씁니다. 두 작업은 하나의 multi-path 업데이트로 나갑니다.

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
| `BPP_OPS_OPERATOR_EMAIL` | 이 서버가 대신 행동할 사람의 이메일. **필수** — 없으면 시작을 거부합니다 |
|  `FIREBASE_SERVICE_ACCOUNT` (로컬 전용) | 서비스 계정 JSON (원문 또는 base64) |
| `FIREBASE_DATABASE_URL` | `https://crng-task-manager-default-rtdb.firebaseio.com` |

Claude Code에 등록:

```bash
claude mcp add bpp-ops \
  --env BPP_OPS_OPERATOR_EMAIL=you@bpp.co.kr \
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

OAuth 클라이언트·인가 코드·토큰은 **최상위 `mcpAuth/`** 에 저장합니다. `database.rules.json`에서 `mcpAuth`는 모든 클라이언트에 대해 차단되고, Admin SDK만 규칙을 우회해 접근합니다. 토큰은 SHA-256 해시를 키로 저장해서, 이 노드가 통째로 유출돼도 재사용할 수 없습니다.

### 필요한 준비

1. **Google OAuth 웹 클라이언트** — 데스크톱 앱용과 **별개**입니다.
   Cloud Console → 사용자 인증 정보 → OAuth 클라이언트 ID → 유형 **웹 애플리케이션**.
   승인된 리디렉션 URI에 `https://<배포주소>/oauth/google/callback` 등록

2. **배포** (Cloud Run 예시):

   ```bash
   cd mcp
   gcloud run deploy bpp-ops-mcp --source . --region asia-northeast3 \
     --allow-unauthenticated \
     --set-env-vars PUBLIC_URL=https://<배포주소> \
     --set-env-vars FIREBASE_DATABASE_URL=https://crng-task-manager-default-rtdb.firebaseio.com \
     --set-secrets GOOGLE_OAUTH_CLIENT_ID=...,GOOGLE_OAUTH_CLIENT_SECRET=...,FIREBASE_SERVICE_ACCOUNT=...
   ```

   `--allow-unauthenticated`는 Cloud Run 계층의 이야기입니다. 실제 접근 통제는 위의 OAuth가 담당합니다.

3. **DB 규칙 배포** — `mcpAuth` 차단 규칙이 반영돼야 합니다. 웹 배포 워크플로가 `database.rules.json`을 함께 올립니다.

   > **순서 주의 — 저장소 연결 배포를 쓰는 경우**
   >
   > Cloud Build 트리거는 푸시할 때마다 **자체 리비전을 새로 얹습니다.** 콘솔에서
   > 손으로 넣은 환경변수가 그 리비전에는 실리지 않아, 방금 설정했더라도 다음
   > 푸시 한 번에 `PUBLIC_URL is not set`으로 되돌아갑니다.
   >
   > 그래서 **빌드를 먼저 끝내고, 환경변수는 마지막에** 넣어야 합니다. 코드가
   > 자주 바뀌는 동안에는 트리거를 잠시 꺼두는 편이 편합니다.

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

`BPP_OPS_OPERATOR_EMAIL`은 HTTP 모드에서 쓰지 않습니다 — 신원이 토큰에서 나오기 때문이고, 그게 공용 서버가 안전한 이유입니다.

### 아직 실제로 붙여보지 않았습니다

타입체크·빌드·접근 제어 테스트는 통과했지만, **OAuth 왕복은 배포된 URL이 있어야 검증됩니다.** 첫 연결에서 막히면 로그를 보고 잡겠습니다.

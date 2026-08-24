# bpp-ops MCP 서버

태스크를 Model Context Protocol로 노출해, Claude에서 대화로 조회·생성·수정·삭제할 수 있게 합니다.

대량 작업에서 값어치를 합니다 — "회의록 보고 태스크 8개 만들어줘", "이번 주 마감인 내 업무 정리해줘"처럼 UI에서 반복 클릭해야 하는 일들이요.

## 도구

### 읽기

| 도구 | 하는 일 |
|---|---|
| `list_projects` | 내가 멤버인 프로젝트 (아카이브 제외가 기본) |
| `list_milestones` | 접근 가능한 프로젝트의 마일스톤 |
| `list_tasks` | 업무 목록 — 프로젝트·마일스톤·상태·우선순위·담당자·태그·마감일·연체·무기한·검색, 정렬 |
| `get_task` | 단일 업무 전체 + 하위 업무 |
| `list_members` | 같은 프로젝트 사람들 + 표시 이름. "민수한테 넘겨"의 *민수*를 이메일로 바꾸는 데 씀 |
| `get_summary` | 현황 한 번에 — 연체/오늘/이번 주/무기한/미배정 + 사람별·프로젝트별 + 다가오는 마일스톤 |

### 업무

| 도구 | 하는 일 |
|---|---|
| `create_task` | 업무/하위 업무 생성 |
| `update_task` | 전달한 필드만 수정 (마일스톤·상위·선후행·태그·카테고리 포함) |
| `bulk_update_tasks` | 여러 업무를 한 번의 쓰기로 — `shift_days`로 각자의 날짜를 통째 밀기 |
| `delete_task` | 업무 삭제 (하위 업무 동반 삭제) |
| `add_task_link` / `remove_task_link` | 업무 자료 첨부/해제. 드라이브 URL은 파일 ID를 알아봄 |

### 마일스톤 · 프로젝트

| 도구 | 하는 일 |
|---|---|
| `create_milestone` / `update_milestone` | 생성, 이름·날짜 변경, 완료 표시 |
| `delete_milestone` | 삭제 — **업무는 남고 미배정으로** 빠짐 |
| `create_project` | 프로젝트 생성 (호출자가 첫 멤버) |
| `update_project` | 이름·색·마감·고객사·보관 |
| `list_project_links` | 프로젝트 자체에 걸린 자료 (계약서, 브랜드 가이드 등) |
| `add_project_link` / `remove_project_link` | 프로젝트 자료 추가/해제 |

**업무 자료와 프로젝트 자료는 다른 것입니다.** 업무 자료는 그 일에 쓰는 파일이고,
프로젝트 자료는 **일을 하는 선반** — 누가 하고 있는 일이 아닙니다.

**일부러 넣지 않은 것**: 멤버 추가/삭제와 프로젝트 삭제. 누가 무엇을 볼 수 있는지는
사람이 직접 정하는 게 맞고, 프로젝트 삭제는 그 안의 모든 업무를 함께 지웁니다.

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

2. **배포**

   현재 돌고 있는 서버는 이렇습니다:

   | | |
   |---|---|
   | Cloud Run 서비스 | **`crng-task-manager`** |
   | 리전 | `asia-northeast3` |
   | GCP 프로젝트 | `crng-task-manager` |
   | 커넥터 주소 | `https://crng-task-manager-2bbjjrjoya-du.a.run.app/mcp` |

   서비스 이름이 앱 이름이 아니라 **프로젝트 이름과 같다는 점**이 함정입니다.
   `bpp-ops-mcp`로 배포하면 새 서비스가 하나 더 생기고, 커넥터가 보고 있는
   주소는 그대로 옛 코드를 서빙합니다.

   **Cloud Run은 한 서비스에 주소를 두 가지로 줍니다** — 예전 형식
   (`…-2bbjjrjoya-du.a.run.app`)과 새 형식
   (`…-1050546278891.asia-northeast3.run.app`). 둘 다 같은 서버에 닿지만
   커넥터에 넣을 수 있는 것은 **`PUBLIC_URL`과 글자까지 같은 쪽 하나**입니다.
   이 서버가 내놓는 OAuth 메타데이터의 issuer와 구글에 보내는 리디렉션
   주소가 모두 `PUBLIC_URL`에서 만들어지므로, 다른 형식으로 넣으면 주소는
   열리는데 로그인이 issuer 불일치나 `redirect_uri_mismatch`로 막힙니다.
   지금 무엇으로 돌고 있는지는 `/healthz`가 `issuer`로 알려 줍니다.

   **이미 올라가 있는 서버를 새 코드로 갱신할 때** — 환경변수는 서비스에 남아
   있으므로 다시 지정하지 않습니다. `--set-env-vars`를 붙이면 기존 값 전체가
   그 목록으로 **교체**되므로, 오히려 빼먹은 변수가 사라집니다.

   ```bash
   cd mcp
   gcloud run deploy crng-task-manager --source . \
     --project crng-task-manager --region asia-northeast3
   ```

   **처음부터 새 서비스를 만들 때만** 환경변수를 함께 넘깁니다:

   ```bash
   cd mcp
   gcloud run deploy <서비스> --source . --region asia-northeast3 \
     --allow-unauthenticated \
     --set-env-vars PUBLIC_URL=https://<배포주소> \
     --set-env-vars FIREBASE_DATABASE_URL=https://crng-task-manager-default-rtdb.firebaseio.com \
     --set-secrets GOOGLE_OAUTH_CLIENT_ID=...,GOOGLE_OAUTH_CLIENT_SECRET=...
   ```

   `FIREBASE_SERVICE_ACCOUNT`는 Cloud Run에서 **넣지 않습니다** — 런타임 서비스
   계정이 그대로 쓰입니다. `--allow-unauthenticated`는 Cloud Run 계층의
   이야기이고, 실제 접근 통제는 위의 OAuth가 담당합니다.

   배포가 끝나면 새 도구가 실제로 붙었는지 확인합니다:

   ```bash
   gcloud run services describe crng-task-manager \
     --project crng-task-manager --region asia-northeast3 \
     --format='value(status.latestReadyRevisionName, status.url)'
   ```

   claude.ai 쪽은 커넥터를 껐다 켜면 도구 목록을 다시 읽습니다.

3. **DB 규칙 배포** — `mcpAuth` 차단 규칙이 반영돼야 합니다. 웹 배포 워크플로가 `database.rules.json`을 함께 올립니다.

   > **순서 주의 — 저장소 연결(Cloud Build 트리거) 배포를 쓰는 경우**
   >
   > Cloud Build 트리거는 푸시할 때마다 **자체 리비전을 새로 얹습니다.** 콘솔에서
   > 손으로 넣은 환경변수가 그 리비전에는 실리지 않아, 방금 설정했더라도 다음
   > 푸시 한 번에 `PUBLIC_URL is not set`으로 되돌아갑니다.
   >
   > 그래서 **빌드를 먼저 끝내고, 환경변수는 마지막에** 넣어야 합니다.
   >
   > 아래 GitHub Actions 워크플로는 배포할 때마다 환경변수를 전부 다시 지정해서
   > 이 문제 자체를 없앱니다. 그쪽을 쓴다면 Cloud Build 트리거는 꺼두세요 —
   > 두 파이프라인이 같은 서비스에 서로 다른 리비전을 얹게 됩니다.

4. **팀원 연결** — claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가 → `https://<배포주소>/mcp`.
   각자 Google 로그인 화면이 뜨고, 로그인한 계정 기준으로 자기 프로젝트만 보입니다.

### GitHub Actions로 배포 (선택 — 기본은 꺼져 있음)

`.github/workflows/deploy-mcp.yml`은 **수동 실행 전용**입니다. 서비스 계정 키와
시크릿 세 개를 더 등록해야 해서, 노트북에서 `gcloud run deploy --source .` 한 줄
치는 것보다 준비가 많습니다. 그 교환이 값어치 있어지는 날을 위해 남겨뒀습니다 —
`on:`에 push 트리거를 되살리고 아래 시크릿을 채우면 자동 배포로 바뀝니다.

**이게 위의 "순서 주의"를 없앱니다.** 워크플로가 배포할 때마다 환경변수를 전부
다시 지정하기 때문에, 콘솔에서 손으로 넣은 값이 다음 푸시에 날아가는 일이
생기지 않습니다. 설정이 파이프라인 안에 있어서 살아남습니다.

**1. 배포용 서비스 계정 만들기**

Cloud Console → IAM 및 관리자 → 서비스 계정 → 만들기. 이 역할들이 필요합니다:

| 역할 | 왜 |
|---|---|
| Cloud Run 관리자 (`roles/run.admin`) | 서비스 배포 |
| Cloud Build 편집자 (`roles/cloudbuild.builds.editor`) | `--source` 빌드 |
| Artifact Registry 작성자 (`roles/artifactregistry.writer`) | 이미지 저장 |
| 스토리지 관리자 (`roles/storage.admin`) | 소스 업로드 |
| 서비스 계정 사용자 (`roles/iam.serviceAccountUser`) | 런타임 계정으로 실행 |

키를 JSON으로 내려받습니다.

**2. 저장소 시크릿 등록**

GitHub → Settings → Secrets and variables → Actions → New repository secret:

| 이름 | 값 |
|---|---|
| `GCP_SA_KEY` | 위에서 받은 JSON **원문 전체** |
| `MCP_PUBLIC_URL` | 배포된 주소 (`https://crng-task-manager-2bbjjrjoya-du.a.run.app`, 끝에 `/` 없이) |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth **웹** 클라이언트 ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 같은 클라이언트의 시크릿 |

RTDB 주소는 기본값이 들어 있어 따로 넣지 않아도 됩니다. 바꾸려면 저장소 변수
`FIREBASE_DATABASE_URL`을 지정하세요.

> **첫 배포는 닭과 달걀입니다.** `MCP_PUBLIC_URL`은 배포되기 전에는 모릅니다.
> 아무 값이나 넣고 한 번 돌린 뒤, 요약에 찍힌 실제 주소로 고쳐서 다시 돌리면
> 됩니다. 값이 어긋나 있으면 워크플로가 경고를 남깁니다 — `PUBLIC_URL`은 OAuth
> 발급자 식별자라, 실제 주소와 다르면 토큰 검증이 실패하고 그게 설정 문제가
> 아니라 로그인 문제처럼 보입니다.

**시크릿을 Cloud Run 환경변수로 두는 게 걸린다면** Secret Manager에 넣고
워크플로의 `--set-env-vars`에서 그 두 줄을 `--set-secrets`로 바꾸면 됩니다.
콘솔 접근 권한이 있는 사람에게 값이 보이지 않게 됩니다.

### 환경 변수 (HTTP 모드)

| 변수 | 값 |
|---|---|
| `PUBLIC_URL` | 서버의 공개 주소 (OAuth 발급자 식별자로도 쓰임) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | 위에서 만든 **웹** 클라이언트 |
|  `FIREBASE_SERVICE_ACCOUNT` (로컬 전용) | 서비스 계정 JSON (원문 또는 base64) |
| `FIREBASE_DATABASE_URL` | RTDB URL |
| `PORT` | 기본 8080 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 푸시 알림 키 쌍 (아래) |
| `VAPID_SUBJECT` | 기본 `mailto:heegun@bpp.co.kr` |
| `PUSH_BRIEF_SECRET` | 아침 브리핑을 부를 때 쓰는 공유 암호 |

`BPP_OPS_OPERATOR_EMAIL`은 HTTP 모드에서 쓰지 않습니다 — 신원이 토큰에서 나오기 때문이고, 그게 공용 서버가 안전한 이유입니다.

### 아직 실제로 붙여보지 않았습니다

타입체크·빌드·접근 제어 테스트는 통과했지만, **OAuth 왕복은 배포된 URL이 있어야 검증됩니다.** 첫 연결에서 막히면 로그를 보고 잡겠습니다.

## 알림 보내는 쪽 (푸시)

이 서버는 MCP 말고 알림 발송도 겸합니다. 경로는 셋입니다.

| 경로 | 누가 부르는가 | 무엇을 확인하는가 |
|---|---|---|
| `POST /push/notify` | 앱 (담당자 지정 직후 등) | 부르는 사람의 Firebase ID 토큰. 수신자는 **한 명**뿐 |
| `POST /push/brief` | Cloud Scheduler, 평일 아침 | 헤더 `x-brief-secret`. 내용은 요청이 아니라 DB에서 나옴 |
| `GET /push/health` | 사람 (curl) | 키가 설정됐는지만 알려줌 |

키 쌍은 한 번만 만들고, **공개키는 웹에 박히고 비밀키는 이 서버에만** 둡니다:

```bash
npx web-push generate-vapid-keys
```

공개키는 `src/lib/push.ts`의 `VAPID_PUBLIC` 값과 같아야 합니다 (지금 값이 이미
들어 있습니다). 비밀키는 저장소에 절대 넣지 않고 Cloud Run에만 넣습니다:

```bash
gcloud run services update crng-task-manager --region asia-northeast3 \
  --update-env-vars VAPID_PUBLIC_KEY=<공개키>,VAPID_PRIVATE_KEY=<비밀키>,PUSH_BRIEF_SECRET=<아무 긴 문자열>
```

`--update-env-vars`입니다 (`--set-env-vars`는 기존 변수를 전부 지웁니다).

아침 브리핑은 스케줄러가 부릅니다 — 평일 10시:

```bash
gcloud scheduler jobs create http bpp-ops-morning-brief \
  --location asia-northeast3 --schedule "0 10 * * 1-5" --time-zone Asia/Seoul \
  --uri https://<배포주소>/push/brief --http-method POST \
  --headers x-brief-secret=<위와 같은 문자열>
```

마감이 지난 일도, 오늘 마감도 없는 사람에게는 아무것도 보내지 않습니다.

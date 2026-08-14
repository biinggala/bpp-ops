# bpp-ops 데스크톱 앱 (macOS)

Tauri v2 기반의 얇은 셸입니다. 프론트엔드를 번들하지 않고 배포된 웹 앱
(`https://crng-task-manager.web.app`)을 직접 로드하므로, Firebase에 배포하면
데스크톱 앱도 자동으로 최신이 됩니다. 자동 업데이터가 필요 없습니다.

네이티브 코드가 하는 일은 **로그인 브릿지 하나**뿐입니다.

## 왜 로그인 브릿지가 필요한가

Google은 내장 웹뷰에서의 OAuth를 차단합니다. 웹에서 쓰는
`signInWithPopup`이 데스크톱에서는 절대 완료되지 않습니다.

그래서 데스크톱에서는 설치형 앱 표준 흐름(RFC 8252)을 씁니다:

```
로그인 클릭
 → Rust가 127.0.0.1 임의 포트에 루프백 리스너 오픈
 → 시스템 브라우저(Safari)로 Google 동의 화면 열기
 → 사용자가 진짜 브라우저에서 로그인 (Google 정책 통과)
 → ?code=... 로 리다이렉트 → 리스너가 수신
 → Rust가 PKCE로 code를 id_token으로 교환
 → 프론트엔드가 signInWithCredential 호출
```

`isDesktopShell()`로 분기하므로 **웹과 데스크톱이 같은 코드베이스**를 씁니다
(`src/lib/desktopAuth.ts`).

토큰 교환을 JS가 아니라 Rust에서 하는 이유: Google 설치형 앱 클라이언트는
교환 시 `client_secret`을 요구하는데, 이걸 웹 번들에 넣으면 공개 배포되는
JavaScript에 노출됩니다. 바이너리 안에 컴파일해 넣는 쪽이 맞습니다.

## 최초 설정 (한 번만)

### 1. Google OAuth 클라이언트 생성

Google Cloud Console → `crng-task-manager` 프로젝트 → **사용자 인증 정보** →
**OAuth 클라이언트 ID 만들기** → 유형 **데스크톱 앱**.

생성된 클라이언트 ID와 시크릿을 GitHub 저장소 시크릿에 등록합니다:

| 시크릿 이름 | 값 |
|---|---|
| `CRNG_OAUTH_CLIENT_ID` | `...apps.googleusercontent.com` |
| `CRNG_OAUTH_CLIENT_SECRET` | 클라이언트 시크릿 |

두 값이 없으면 빌드는 되지만 로그인 시 명확한 오류를 냅니다.

### 2. 빌드

GitHub Actions → **Build macOS Desktop App** → Run workflow (수동 실행),
또는 릴리스를 만들려면 태그를 밉니다:

```bash
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```

Intel + Apple Silicon 유니버설 `.dmg`가 나옵니다.

## 팀원 설치 안내

서명되지 않은 빌드라 첫 실행 시 macOS가 막습니다:

1. `.dmg`를 열고 앱을 `응용 프로그램`으로 드래그
2. 터미널에서 격리 속성 제거:
   ```bash
   xattr -cr "/Applications/bpp-ops.app"
   ```
3. 앱 실행

정식 서명·공증을 원하면 Apple Developer 계정(연 $99)이 필요하고,
워크플로에 서명 시크릿을 추가하면 이 단계가 사라집니다.

## 로컬 개발

macOS에서만 의미가 있습니다:

```bash
npm install
CRNG_OAUTH_CLIENT_ID=... CRNG_OAUTH_CLIENT_SECRET=... npm run desktop:dev
```

## 확인이 남은 항목

원격 URL로 로드된 프론트엔드가 `window.__TAURI__`를 통해 커스텀 명령을
호출하려면 `capabilities/default.json`의 `remote.urls` 허용이 필요합니다.
설정은 되어 있으나 **실제 macOS 실행으로 검증되지 않았습니다.** 첫 빌드에서
로그인이 "not allowed" 류의 오류를 내면, 해당 capability에 명령별 권한을
명시적으로 추가해야 할 수 있습니다.

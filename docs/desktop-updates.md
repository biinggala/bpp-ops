# 데스크톱 앱 자동 업데이트

앱 상단의 `업데이트` 버튼을 누르면 새 버전을 받아서 설치하고 다시 시작합니다.
브라우저로 나가지 않습니다.

## 왜 이렇게 되어 있나

앱은 배포된 웹을 그대로 불러오므로 **화면과 기능은 항상 최신**입니다. 낡는 것은
껍데기(바이너리)뿐이고, 그건 자주 바뀌지 않습니다. 그래서 업데이트 버튼은 할 일이
있을 때만 나타납니다.

받아오는 곳이 GitHub 릴리즈가 아닌 이유는 **저장소가 비공개**라서입니다. 릴리즈에
붙은 `.dmg`는 GitHub 로그인을 요구하는데, 앱은 그 로그인을 통과할 수 없습니다.
그래서 업데이트용 묶음은 **이미 공개되어 있는 웹 배포**에 함께 실립니다:

```
https://crng-task-manager.web.app/updates/latest.json          ← 어떤 버전이 있는지
https://crng-task-manager.web.app/updates/bpp-ops.app.tar.gz   ← 실제 파일
```

두 파일은 릴리즈 워크플로가 `public/updates/`에 커밋하고, 웹 배포가 공개합니다.
공개된 자리에 놓이는 만큼 **출처가 아니라 서명으로** 검증합니다 — 앱에는 공개키가
박혀 있고, 서명이 맞지 않는 파일은 설치되지 않습니다.

## 한 번만 해두는 준비

서명 키 한 쌍이 필요합니다. **비밀키는 저장소에 절대 넣지 않습니다.**

1. 저장소 폴더에서 키를 만듭니다. 암호는 비워도 됩니다.

   ```bash
   npm run tauri -- signer generate -w ~/.bpp-ops-updater.key
   ```

2. GitHub → 저장소 → Settings → Secrets and variables → Actions → New repository secret

   | 이름 | 값 |
   |---|---|
   | `TAURI_SIGNING_PRIVATE_KEY` | `cat ~/.bpp-ops-updater.key` 의 내용 전체 |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 1번에서 정한 암호 (비웠으면 빈 값) |

3. 공개키를 `src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`에 넣습니다.

   ```bash
   cat ~/.bpp-ops-updater.key.pub
   ```

   릴리즈 워크플로는 이 값이 비어 있거나 자리표시자면 **배포를 거부합니다.**
   키가 없는 채로 나간 앱은 어떤 업데이트도 받아들이지 않고, 그 사실은 몇 달 뒤
   업데이트를 처음 내보낼 때에야 드러나기 때문입니다.

> **비밀키를 잃어버리면** 이미 설치된 앱들은 새 업데이트를 거부합니다. 새 키로
> 만든 빌드를 한 번은 손으로 나눠줘야 하니, 백업해 두세요.

## 릴리즈할 때 자동으로 일어나는 일

1. `CHANGELOG.md`에 새 `## vX.Y.Z` 절이 main에 올라감
2. 릴리즈 워크플로가 mac에서 앱을 빌드하고 **서명된 업데이트 묶음**을 만듦
3. 그 묶음과 `latest.json`을 `public/updates/`에 커밋 → 웹 배포가 공개
4. GitHub 릴리즈에 `.dmg`도 첨부 (앱이 없는 사람이 처음 설치할 때 쓰는 용도)

버전은 `package.json` 한 곳에서 나옵니다. `src-tauri/tauri.conf.json`과
`src-tauri/Cargo.toml`도 같은 값이어야 하고, CHANGELOG와 다르면 워크플로가
멈춥니다.

## 알아두면 좋은 것

- 업데이트 묶음이 저장소에 커밋됩니다 — 릴리즈당 약 9MB. 파일 하나 때문에 호스팅을
  하나 더 세우지 않은 대가입니다.
- v1.2.1 이하 앱에는 업데이터가 없습니다. 그 버전들은 버튼을 누르면 예전처럼
  다운로드 페이지가 열립니다.

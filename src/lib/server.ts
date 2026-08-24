/**
 * ── 우리 서버 주소 ───────────────────────────────────────────────────────────
 *
 * 푸시 알림을 보내는 곳과 Claude 커넥터가 붙는 곳은 **같은 Cloud Run
 * 서비스** 하나입니다. 그래서 주소도 한 곳에만 적습니다.
 *
 * Cloud Run은 한 서비스에 주소를 두 가지로 줍니다 — 예전 형식
 * (`…-2bbjjrjoya-du.a.run.app`)과 새 형식
 * (`…-1050546278891.asia-northeast3.run.app`). 둘 다 같은 서버에 닿아서
 * 평범한 API 호출은 어느 쪽으로 보내든 됩니다. 그런데 **커넥터 로그인만은
 * 아닙니다**: 서버가 내놓는 OAuth 메타데이터의 issuer와 구글에 보내는
 * 리디렉션 주소가 서버의 `PUBLIC_URL`에서 만들어지므로, 다른 형식으로 넣으면
 * 주소는 열리는데 로그인이 막힙니다.
 *
 * 실제로 그렇게 한 번 막혔습니다. mcp/README에 적혀 있던 것이 PUBLIC_URL이
 * 아닌 쪽이었고, 그걸 복사해 넣은 사람이 `redirect_uri_mismatch`를 봤습니다.
 * 코드에도 두 형식이 흩어져 있으면 같은 일이 또 납니다 — 그래서 여기 하나만
 * 두고, 아래 값은 **서버의 PUBLIC_URL과 글자까지 같아야 합니다.**
 * 지금 무엇으로 돌고 있는지는 `/healthz`가 `issuer`로 답합니다.
 */
export const SERVER_ORIGIN = 'https://crng-task-manager-2bbjjrjoya-du.a.run.app'

/** Claude 설정에 붙여 넣는 커넥터 주소. */
export const MCP_CONNECTOR_URL = `${SERVER_ORIGIN}/mcp`

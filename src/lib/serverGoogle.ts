import { onValue, ref } from 'firebase/database'
import { auth, db } from './firebase'
import { SERVER_ORIGIN } from './server'
import { coversScope } from './scopes'
import { openExternal } from './desktopLinks'

/**
 * ── 서버가 들고 있는 구글 열쇠 ───────────────────────────────────────────────
 *
 * 브라우저가 직접 받는 구글 토큰은 한 시간짜리고, 그걸 갱신할 열쇠는
 * 브라우저가 가질 수 없습니다 — 클라이언트 비밀을 쥔 쪽만 바꿔 쓸 수 있어서요.
 * 그래서 갱신은 '구글 세션이 살아 있고 브라우저가 허락할 때만' 조용히 됐고,
 * 사파리와 아이폰에서는 그 자리가 막혀 **몇 시간마다 재연동**이 됐습니다.
 *
 * 이제 열쇠는 우리 서버가 듭니다(mcp/src/google.ts). 여기서는 그 서버에
 * 토큰 한 장을 달라고 할 뿐입니다 — 창도, 팝업도, 구글 세션도 필요 없습니다.
 *
 * **연결이 사람에게 붙습니다.** 노트북에서 한 번 연결하면 폰에서도 됩니다.
 */

export class NotLinked extends Error {
  constructor() { super('구글이 연결되어 있지 않습니다') }
}

async function idToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('로그인이 필요합니다')
  return token
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVER_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify(body),
  })
  // 412는 '아직 연결 안 됨' 또는 '그 범위는 허락 안 됨'입니다. 오류와 구별해야
  // 앱이 팝업으로 물어보러 갈지, 그냥 실패로 둘지 정할 수 있습니다.
  if (res.status === 412) throw new NotLinked()
  if (!res.ok) throw new Error(`구글 토큰 요청 실패 (${res.status})`)
  return res.json() as Promise<T>
}

/** 이 범위를 덮는 토큰 한 장. 서버에 열쇠가 없으면 NotLinked. */
export async function tokenFromServer(scope: string): Promise<{ token: string; expiresIn: number }> {
  return post<{ token: string; expiresIn: number }>('/google/token', { scope })
}

/** 연결을 시작할 구글 주소. 창은 부르는 쪽이 엽니다. */
export async function linkUrl(scope: string, email?: string | null): Promise<string> {
  const { url } = await post<{ url: string }>('/google/start', { scope, email: email ?? undefined })
  return url
}

/**
 * 연동을 끕니다. 범위를 주면 **그것만** 뺍니다 — 화면에서는 캘린더·드라이브·
 * 메일이 각각 스위치라, 하나를 껐는데 서버가 계속 그 열쇠를 들고 있으면
 * 사람이 본 것과 다릅니다.
 */
export async function unlinkServerGoogle(scope?: string): Promise<void> {
  await post('/google/disconnect', scope ? { scope } : {})
}

/**
 * 이 배포에 열쇠 보관이 켜져 있는지.
 *
 * 안 켜져 있으면 서버가 전부 503으로 답합니다. 그때는 예전처럼 브라우저가
 * 직접 받습니다 — **되던 것이 안 되게 만들지는 않습니다.**
 */
let known: boolean | null = null

/**
 * 앱이 뜰 때 한 번 물어 둡니다.
 *
 * 클릭이 온 뒤에 물어보면 답을 기다리는 사이에 브라우저가 창을 막습니다.
 * 그래서 '켜져 있나'는 미리 알아 두고, 클릭 순간에는 아는 것으로만 정합니다.
 */
export function warmServerGoogle(): void {
  if (known !== null) return
  void fetch(`${SERVER_ORIGIN}/google/health`)
    .then(r => r.json() as Promise<{ configured?: boolean }>)
    .then(body => { known = !!body.configured })
    .catch(() => { known = false })
}

/** 지금 아는 대로. 아직 모르면 거짓입니다 — 모르는 것을 '된다'로 읽지 않습니다. */
export function serverGoogleKnown(): boolean {
  return known === true
}

/* ── 연결하고, 끝날 때까지 기다립니다 ──────────────────────────────────────── */

/** 사람이 창을 닫았거나 시간이 지난 것. 오류로 떠들 일이 아닙니다. */
export class AuthzCancelled extends Error {
  constructor() { super('연결이 끝나지 않았습니다') }
}

/**
 * 동의 창이 끝나기를 기다립니다.
 *
 * 창은 다른 자리에서 열리고 결과는 우리 서버가 받습니다. 그래서 이쪽은
 * **DB의 `googleLinked/{uid}`가 바뀌는 것**으로 압니다 — 창을 들여다보는
 * 방법(폴링, postMessage)은 브라우저마다 다르게 막히지만, 이 줄은 실시간
 * DB라 그냥 옵니다.
 *
 * 5분이면 포기합니다. 창을 그냥 닫았을 때 영원히 도는 표시가 남으면 그건
 * '고장'으로 읽힙니다.
 */
export function waitForGrant(scope: string, ms = 5 * 60_000): Promise<void> {
  const uid = auth.currentUser?.uid
  if (!uid) return Promise.reject(new Error('로그인이 필요합니다'))
  return new Promise((resolve, reject) => {
    const node = ref(db, `googleLinked/${uid}`)
    let stop = () => {}
    const timer = setTimeout(() => { stop(); reject(new AuthzCancelled()) }, ms)
    stop = onValue(node, snap => {
      const row = snap.val() as { scope?: string } | null
      if (!row || !coversScope(row.scope, scope)) return
      clearTimeout(timer)
      stop()
      resolve()
    }, () => { clearTimeout(timer); stop(); reject(new Error('연결 상태를 읽지 못했습니다')) })
  })
}

/**
 * 한 번의 동의로 열쇠를 만들고, 그 자리에서 토큰 한 장을 받아 옵니다.
 *
 * 창은 **부르는 쪽이 클릭과 같은 순간에 열어** 넘겨줍니다. 여기서 열면 주소를
 * 받아 오는 사이에 브라우저가 '사람이 시킨 창'으로 안 쳐서 막습니다.
 */
export async function linkAndWait(
  scope: string, email: string | null | undefined, win: Window | null,
): Promise<{ token: string; expiresIn: number }> {
  // 이미 덮고 있으면 창은 필요 없습니다. 열어 둔 빈 창은 닫습니다.
  try {
    const held = await tokenFromServer(scope)
    win?.close()
    return held
  } catch (e) {
    if (!(e instanceof NotLinked)) { win?.close(); throw e }
  }

  const url = await linkUrl(scope, email)
  if (win && !win.closed) win.location.href = url
  else await openExternal(url)

  await waitForGrant(scope)
  return tokenFromServer(scope)
}

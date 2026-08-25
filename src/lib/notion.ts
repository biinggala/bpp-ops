import { auth } from './firebase'
import { SERVER_ORIGIN } from './server'

/**
 * ── 노션에 묻는 길 ───────────────────────────────────────────────────────────
 *
 * 드라이브는 이 앱이 구글에 직접 묻습니다. 노션은 못 합니다 — 노션 API가
 * 브라우저에서 오는 호출을 막아 두었고(CORS), 그건 우리가 켜고 끌 수 있는
 * 스위치가 아닙니다. 그래서 **우리 서버를 거칩니다**(mcp/src/notion.ts).
 *
 * 그 말은 이 파일에 노션 열쇠가 없다는 뜻이기도 합니다. 여기서 보내는 것은
 * 파이어베이스 로그인 증명 하나뿐이고, 서버가 그걸로 '누구인지'를 정한 뒤
 * 그 사람 열쇠를 꺼내 씁니다. 열쇠는 이 기기에 한 번도 안 내려옵니다.
 */

export interface NotionHit {
  id: string
  title: string
  url: string
  /** 어느 데이터베이스·페이지 아래인지. 제목이 같은 페이지를 구별해 줍니다. */
  parent?: string
  emoji?: string
  editedAt?: string
}

export interface NotionPassage { before: string; match: string; after: string }

/** 연결이 끊겼거나 아직 안 했을 때. 오류와 구별해야 앱이 '다시 연결'을 말할 수 있습니다. */
export class NotionNotConnected extends Error {
  constructor() { super('노션이 연결되어 있지 않습니다') }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('로그인이 필요합니다')

  const res = await fetch(`${SERVER_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  })
  if (res.status === 412) throw new NotionNotConnected()
  if (!res.ok) throw new Error(`노션 요청 실패 (${res.status})`)
  return res.json() as Promise<T>
}

/** 연결을 시작할 주소. 창을 여는 것은 부르는 쪽입니다 — 탭 열기가 셸마다 다릅니다. */
export async function notionAuthUrl(): Promise<string> {
  const { url } = await post<{ url: string }>('/notion/start', {})
  return url
}

export async function searchNotion(query: string, signal?: AbortSignal): Promise<NotionHit[]> {
  const { results } = await post<{ results: NotionHit[] }>('/notion/search', { query }, signal)
  return results ?? []
}

export async function notionSnippets(
  ids: string[], query: string, signal?: AbortSignal,
): Promise<Record<string, NotionPassage | null>> {
  if (!ids.length) return {}
  const { snippets } = await post<{ snippets: Record<string, NotionPassage | null> }>(
    '/notion/snippets', { ids, query }, signal,
  )
  return snippets ?? {}
}

export async function disconnectNotion(): Promise<void> {
  await post('/notion/disconnect', {})
}

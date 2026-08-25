import { create } from 'zustand'
import { ref, onValue } from 'firebase/database'
import { db } from '../lib/firebase'
import { P } from '../lib/paths'
import { openExternal } from '../lib/desktopLinks'
import {
  notionAuthUrl, searchNotion, notionSnippets, disconnectNotion,
  NotionNotConnected, type NotionHit, type NotionPassage,
} from '../lib/notion'

/**
 * ── 노션 ─────────────────────────────────────────────────────────────────────
 *
 * 드라이브 store와 하는 일은 같은데 열쇠를 안 듭니다 — 노션 열쇠는 서버에만
 * 있고, 여기서는 '붙었는지'만 압니다. 그 한 줄을 DB에서 **구독합니다**:
 * 연결 창은 다른 탭(데스크톱에서는 아예 다른 브라우저)에서 끝나므로,
 * 돌아온 것을 이 화면이 알아차릴 방법이 그것뿐입니다. 물어보러 가는 대신
 * 줄이 생기면 스위치가 저절로 켜집니다.
 *
 * **찾는 것은 제목입니다.** 노션 검색 API가 본문을 안 봅니다 — 대신 제목으로
 * 걸린 페이지의 본문에서 그 낱말이 있는 문장을 뒤이어 가져옵니다(서버가
 * 합니다). 그래서 드라이브처럼 '내용에 있음'으로 걸리는 줄은 없고, 제목으로
 * 선 줄에 문장이 나중에 붙습니다.
 */

export const snippetKey = (id: string, term: string) => `${id}::${term.trim().toLowerCase()}`

interface NotionState {
  /** 연결된 워크스페이스 이름. null이면 안 붙었습니다. */
  workspace: string | null
  linked: boolean
  /** 노션 쪽에서 연동을 끊었습니다 — 다시 눌러야 합니다. */
  revoked: boolean
  connecting: boolean
  error: string | null
  snippets: Record<string, NotionPassage | null>
  snippetLoading: Record<string, true>

  subscribe: (uid: string) => () => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  search: (query: string) => Promise<NotionHit[]>
  loadSnippets: (hits: NotionHit[], term: string) => void
}

/**
 * 지난 검색어로 받던 것은 멈춥니다.
 *
 * 드라이브에서 배운 것과 같은 자리입니다 — 한글은 조합하는 동안 '최ㅈ' ·
 * '최재' · '최재원'이 차례로 검색어가 되고, 안 끊으면 셋 다 서버를 거쳐
 * 노션까지 갔다 옵니다. 노션은 초당 세 번쯤에서 429로 답하므로 이건
 * 느려지는 정도가 아니라 **막히는** 문제입니다.
 */
let searchAbort: AbortController | null = null
let snippetAbort: AbortController | null = null
let snippetTerm = ''

export const useNotionStore = create<NotionState>((set, get) => ({
  workspace: null,
  linked: false,
  revoked: false,
  connecting: false,
  error: null,
  snippets: {},
  snippetLoading: {},

  subscribe: (uid) => {
    const node = ref(db, P.notionLinked(uid))
    return onValue(node, snap => {
      const row = snap.val() as { workspace?: string; revoked?: boolean } | null
      const revoked = !!row?.revoked
      set({
        linked: !!row && !revoked,
        workspace: row?.workspace || null,
        revoked,
        // 줄이 생겼으면 창에서 돌아온 것입니다. 스위치를 여기서 놓습니다.
        ...(row ? { connecting: false } : {}),
      })
    }, () => set({ linked: false, workspace: null }))
  },

  connect: async () => {
    set({ connecting: true, error: null })
    try {
      const url = await notionAuthUrl()
      // 웹뷰에서는 새 탭이 조용히 안 열립니다. openExternal이 셸에 넘깁니다.
      await openExternal(url)
      // 창을 그냥 닫아 버리면 알 길이 없습니다. 3분 뒤에는 스위치를 되돌려
      // 놓습니다 — 영원히 도는 표시는 '고장'으로 읽힙니다.
      setTimeout(() => { if (!get().linked) set({ connecting: false }) }, 180_000)
    } catch (e) {
      set({ connecting: false, error: e instanceof Error ? e.message : '연결에 실패했습니다' })
    }
  },

  disconnect: async () => {
    // 화면을 먼저 끕니다. 서버가 지우면 구독이 같은 값을 다시 알려 줍니다.
    set({ linked: false, workspace: null, revoked: false, connecting: false })
    try { await disconnectNotion() } catch { /* 이미 없는 것과 구별할 필요가 없습니다 */ }
  },

  search: async (query) => {
    if (!get().linked) return []
    searchAbort?.abort()
    const controller = new AbortController()
    searchAbort = controller
    try {
      return await searchNotion(query, controller.signal)
    } catch (e) {
      if (controller.signal.aborted) return []
      if (e instanceof NotionNotConnected) { set({ linked: false, revoked: true }); return [] }
      return []
    }
  },

  loadSnippets: (hits, term) => {
    const q = term.trim()
    if (!q || !hits.length) return
    if (q !== snippetTerm) { snippetAbort?.abort(); snippetTerm = q }

    const { snippets, snippetLoading } = get()
    const wanted = hits
      .filter(h => !(snippetKey(h.id, q) in snippets) && !snippetLoading[snippetKey(h.id, q)])
      .slice(0, 6)
    if (!wanted.length) return

    set({
      snippetLoading: {
        ...snippetLoading,
        ...Object.fromEntries(wanted.map(h => [snippetKey(h.id, q), true as const])),
      },
    })

    const controller = new AbortController()
    snippetAbort = controller
    void notionSnippets(wanted.map(h => h.id), q, controller.signal)
      .then(found => {
        if (controller.signal.aborted) return
        set(s => ({
          snippets: {
            ...s.snippets,
            // 서버가 안 돌려준 것은 '찾았지만 없음'입니다. null로 적어 두어야
            // 같은 검색어로 다시 물으러 가지 않습니다.
            ...Object.fromEntries(wanted.map(h => [snippetKey(h.id, q), found[h.id] ?? null])),
          },
        }))
      })
      .catch(() => {
        // 실패한 것도 적어 둡니다. 안 적으면 같은 검색어로 계속 다시 묻고,
        // 노션은 그걸 429로 갚습니다.
        if (controller.signal.aborted) return
        set(s => ({
          snippets: { ...s.snippets, ...Object.fromEntries(wanted.map(h => [snippetKey(h.id, q), null])) },
        }))
      })
      .finally(() => {
        set(s => {
          const next = { ...s.snippetLoading }
          wanted.forEach(h => delete next[snippetKey(h.id, q)])
          return { snippetLoading: next }
        })
      })
  },
}))

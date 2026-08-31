import { create } from 'zustand'
import { unlinkServerGoogle } from '../lib/serverGoogle'
import { auth } from '../lib/firebase'
import { requestGoogleToken, prepareGoogleAuthz, GIS_CONFIGURED } from '../lib/googleAuthz'
import {
  DRIVE_SCOPE, TOKEN_EXPIRED, searchFiles, getFile, driveIdFromUrl,
  fetchSnippet, canSnippet, passageIn,
  type DriveFile, type DriveSearchResult, type Snippet,
} from '../lib/googleDrive'
import { DOCS_SCOPE, fetchDocTabs } from '../lib/googleDocs'
import { isDesktopShell, forgetStoredGrant } from '../lib/desktopAuth'

const TOKEN_KEY = 'drive_token'
const EXPIRY_KEY = 'drive_expiry'
const CONNECTED_KEY = 'drive_connected'

interface DriveState {
  token: string | null
  expiry: number | null
  /** The person connected Drive at least once, so reconnecting can be silent. */
  wasConnected: boolean
  /** A silent renewal failed; only a click will help, so stop trying on its own. */
  needsReconnect: boolean
  connecting: boolean
  error: string | null
  /** Live metadata, keyed by Drive id. `null` means "asked, not available". */
  meta: Record<string, DriveFile | null>
  /** Matched passages, keyed by `id::term`. `null` means "asked, none found". */
  snippets: Record<string, Snippet | null>
  /**
   * Keys currently being read, so a row can hold the space and say so.
   *
   * The UI cannot infer this: "no snippet yet" and "this file will never have
   * one" — a PDF, or past the per-search cap — look identical from the outside,
   * and showing a spinner for the second forever would be worse than nothing.
   */
  snippetLoading: Record<string, true>

  connect: () => Promise<boolean>
  disconnect: () => void
  ensureToken: () => Promise<string | null>
  search: (query: string, folderId?: string | null) => Promise<DriveSearchResult[]>
  /** Fills `meta` for ids not already known. Safe to call on every render. */
  resolve: (ids: string[]) => void
  /** Fills `snippets` for content matches. Safe to call on every render. */
  loadSnippets: (files: DriveSearchResult[], term: string) => void
}

function loadStored() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const expiry = Number(localStorage.getItem(EXPIRY_KEY)) || null
    const wasConnected = localStorage.getItem(CONNECTED_KEY) === '1'
    if (token && expiry && expiry > Date.now()) return { token, expiry, wasConnected: true }
    return { token: null, expiry: null, wasConnected }
  } catch { /* ignore */ }
  return { token: null, expiry: null, wasConnected: false }
}

function storeToken(token: string, expiresInSeconds = 3500) {
  const expiry = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(EXPIRY_KEY, String(expiry))
    localStorage.setItem(CONNECTED_KEY, '1')
  } catch { /* ignore */ }
  return expiry
}

/** Ids already being fetched, so a list of twenty rows makes one request each. */
const inFlight = new Set<string>()
/** The single in-progress token renewal, shared by every caller that asks. */
let renewal: Promise<string | null> | null = null

const SNIPPET_LIMIT = 8

/**
 * ── 지난 검색어로 받던 것은 멈춥니다 ────────────────────────────────────────
 *
 * 한글은 조합하는 동안에도 글자가 바뀝니다. '최재원'을 치면 '최ㅈ' · '최재' ·
 * '최재ㅇ' · '최재원' 넷이 차례로 검색어가 되고, 넷 다 **같은 문서를 처음부터
 * 다시** 내려받았습니다. 앞의 셋은 이미 쓸모없는데도요.
 *
 * 문서 하나가 몇 백 킬로바이트고 통로는 셋뿐이라, 마지막 검색어의 조각은
 * 앞의 아홉 개가 끝나기를 기다렸습니다. 그게 그 삼십 초입니다.
 */
let snippetTerm = ''
let snippetAbort: AbortController | null = null

/**
 * ── 한 번 찾은 문장은 이 기기에 남깁니다 ────────────────────────────────────
 *
 * 같은 사람 이름을 다음 주에 또 찾습니다. 그때마다 문서를 통째로 다시 받을
 * 이유가 없습니다.
 *
 * **문서가 고쳐졌으면 버립니다.** 열쇠에 그 문서의 수정 시각을 같이 넣어
 * 두므로, 내용이 바뀌면 열쇠가 달라져서 저절로 안 맞습니다 — 옛 문장을
 * 새것처럼 보여 주는 일이 없습니다.
 */
const DISK_KEY = 'bpp_snippets_v1'
const DISK_MAX = 300
type Cached = Record<string, { s: Snippet | null; at: number }>

function readDisk(): Cached {
  try { return JSON.parse(localStorage.getItem(DISK_KEY) ?? '{}') as Cached } catch { return {} }
}
function writeDisk(next: Cached) {
  // 오래된 것부터 버립니다. 무한히 자라면 언젠가 저장 공간을 다 씁니다.
  const keys = Object.keys(next)
  if (keys.length > DISK_MAX) {
    keys.sort((a, b) => next[a].at - next[b].at).slice(0, keys.length - DISK_MAX).forEach(k => delete next[k])
  }
  try { localStorage.setItem(DISK_KEY, JSON.stringify(next)) } catch { /* 꽉 찼으면 그냥 캐시가 없는 것 */ }
}
/** 파일이 고쳐지면 달라지는 열쇠. */
const diskKey = (f: { id: string; modifiedTime?: string }, term: string) =>
  `${f.id}@${f.modifiedTime ?? ''}::${term.trim().toLowerCase()}`

/**
 * 문장, 그리고 그게 있는 탭 — 구글 문서에 대해서.
 *
 * **문서는 이제 이쪽만 씁니다.** 드라이브의 텍스트 내보내기가 탭 안의 글자를
 * 안 담는다는 것이 확인됐습니다. 탭에 적힌 문장을 내보내기로 찾으려던 것은
 * 통째로 헛일이었고, 그래서 문장이 늘 이 호출을 기다렸습니다.
 *
 * 이제 이 호출이 필요한 것만 받아 오므로(googleDocs의 마스크) 먼저 부르는
 * 편이 쌉니다. 탭이 하나뿐이어도 문장은 돌려줍니다 — 탭 이름만 안 붙습니다.
 *
 * 이 API가 아예 없는 워크스페이스에서는 null이고, 그때는 부른 쪽이 내보내기로
 * 물러납니다.
 */
async function docSnippet(token: string, f: DriveSearchResult, needle: string, signal?: AbortSignal): Promise<Snippet | null> {
  if (f.mimeType !== 'application/vnd.google-apps.document') return null
  if (docsUnavailable) return null
  let tabs
  try {
    tabs = await fetchDocTabs(token, f.id, signal)
  } catch (e) {
    // 취소는 거절이 아닙니다. 여기서 latch를 걸면 글자를 하나 지웠다는
    // 이유로 탭 기능이 그 세션 내내 죽습니다.
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    // One refusal is enough: the API is off, or the scope was never granted.
    // Asking again per document per search would be a request each for nothing.
    docsUnavailable = true
    return null
  }
  for (const tab of tabs) {
    const found = passageIn(tab.text, needle)
    if (!found) continue
    // 탭이 하나뿐인 문서는 그냥 문서입니다. "?tab=t.0"으로 보내는 건 주소에
    // 군더더기고, 화면이 하지 말아야 할 약속입니다 — 문장만 돌려줍니다.
    return tabs.length < 2 ? found : { ...found, tabId: tab.tabId, tabTitle: tab.title }
  }
  return null
}

/** 그 마지막 호출이 '이 워크스페이스는 Docs API가 없다'로 끝났는가. */
export function docsApiDown(): boolean { return docsUnavailable }

/** Latched after the first refusal; cleared when somebody reconnects. */
let docsUnavailable = false
export const snippetKey = (id: string, term: string) => `${id}::${term.trim().toLowerCase()}`

/** Readies the Google client before the 연동 button is pressed. See warmCalendarAuth. */
export function warmDriveAuth(): void {
  void prepareGoogleAuthz(`${DRIVE_SCOPE} ${DOCS_SCOPE}`)
}

export const useDriveStore = create<DriveState>((set, get) => ({
  ...loadStored(),
  connecting: false,
  needsReconnect: false,
  error: null,
  meta: {},
  snippets: {},
  snippetLoading: {},

  connect: async () => {
    if (!GIS_CONFIGURED) {
      set({ error: '구글 클라이언트 ID가 설정되지 않았습니다' })
      return false
    }
    set({ connecting: true, error: null })
    try {
      const granted = await requestGoogleToken({
        scope: `${DRIVE_SCOPE} ${DOCS_SCOPE}`,
        interactive: true,
        hint: auth.currentUser?.email ?? undefined,
      })
      const expiry = storeToken(granted.token, granted.expiresIn)
      // A reconnect is the moment the Docs grant could have arrived.
      docsUnavailable = false
      set({ token: granted.token, expiry, wasConnected: true, needsReconnect: false, connecting: false, error: null })
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : '드라이브 연동 오류'
      const cancelled = msg.includes('취소') || msg.includes('cancel') || msg.includes('popup')
      set({ connecting: false, error: cancelled ? null : msg })
      return false
    }
  },

  disconnect: () => {
    void unlinkServerGoogle(`${DRIVE_SCOPE} ${DOCS_SCOPE}`).catch(() => {})
    // The desktop shell remembers its own grant; leaving it would reconnect
    // silently on the next reload.
    if (isDesktopShell()) void forgetStoredGrant(`${DRIVE_SCOPE} ${DOCS_SCOPE}`)
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(EXPIRY_KEY)
      localStorage.removeItem(CONNECTED_KEY)
    } catch { /* ignore */ }
    set({ token: null, expiry: null, wasConnected: false, needsReconnect: false, meta: {}, snippets: {}, snippetLoading: {}, error: null })
  },

  /**
   * A usable token, renewed without a window where Google allows it.
   *
   * The silent path is the normal one — the grant is already on file, and GIS
   * will reissue against it for as long as the Google session lives. Only when
   * that session has gone does this return null and the connect button come back.
   */
  ensureToken: async () => {
    const { token, expiry, wasConnected, needsReconnect } = get()
    if (token && expiry && expiry > Date.now()) return token
    if (!wasConnected || needsReconnect || !GIS_CONFIGURED) return null

    // One renewal at a time. Typing in the search box calls this once per
    // keystroke, and GIS opens a window for every request it is given — which
    // is what made a popup flash on each letter.
    if (!renewal) {
      renewal = (async () => {
        try {
          const granted = await requestGoogleToken({
            scope: DRIVE_SCOPE,
            interactive: false,
            hint: auth.currentUser?.email ?? undefined,
          })
          const newExpiry = storeToken(granted.token, granted.expiresIn)
          set({ token: granted.token, expiry: newExpiry, error: null })
          return granted.token
        } catch {
          // The Google session is gone. Asking again without a click cannot
          // succeed, so stop and let the connect button come back.
          set({ token: null, expiry: null, needsReconnect: true })
          return null
        } finally {
          renewal = null
        }
      })()
    }
    return renewal
  },

  search: async (query, folderId) => {
    const token = await get().ensureToken()
    if (!token) return []
    try {
      const files = await searchFiles(token, query, folderId)
      // Search results are metadata too — caching them here means attaching a
      // file draws it immediately instead of re-fetching what we just had.
      // contentMatch is about this search, not about the file, so it is dropped
      // rather than cached onto it.
      set(s => ({
        meta: {
          ...s.meta,
          ...Object.fromEntries(files.map(({ contentMatch: _drop, ...f }) => [f.id, f])),
        },
      }))
      set({ error: null })
      return files
    } catch (e) {
      const msg = e instanceof Error ? e.message : '드라이브 검색 오류'
      // Only a genuinely stale token is worth discarding. Anything else is
      // Google describing a problem that re-authorising will not fix.
      if (msg === TOKEN_EXPIRED) set({ token: null, expiry: null })
      else set({ error: msg })
      return []
    }
  },

  /**
   * Reading a whole document to quote one line is not free, so this is capped.
   * The cap is deliberately near what fits on screen — nobody reads past the
   * eighth result of a search they are going to refine anyway.
   */
  loadSnippets: (files, term) => {
    const needle = term.trim()
    if (!needle) return
    if (needle !== snippetTerm) {
      // 검색어가 바뀌었습니다. 지난 것으로 받던 것은 이제 아무도 안 봅니다.
      snippetAbort?.abort()
      snippetAbort = new AbortController()
      snippetTerm = needle
    }
    const signal = snippetAbort?.signal

    // 지난번에 찾아 둔 것부터 꺼내 놓습니다. 요청이 아예 안 나갑니다.
    const disk = readDisk()
    const fromDisk: Record<string, Snippet | null> = {}
    for (const f of files) {
      if (!f.contentMatch) continue
      const hit = disk[diskKey(f, needle)]
      if (hit) fromDisk[snippetKey(f.id, needle)] = hit.s
    }
    if (Object.keys(fromDisk).length) set(s => ({ snippets: { ...s.snippets, ...fromDisk } }))

    const { snippets } = get()
    const todo = files
      .filter(f => f.contentMatch && canSnippet(f.mimeType))
      .filter(f => !(snippetKey(f.id, needle) in snippets) && !inFlight.has(snippetKey(f.id, needle)))
      .slice(0, SNIPPET_LIMIT)
    if (!todo.length) return
    const keys = todo.map(f => snippetKey(f.id, needle))
    keys.forEach(k => inFlight.add(k))
    // Marked before the first request so every row that is going to get a quote
    // can reserve its space immediately, rather than jumping when one arrives.
    set(s => ({ snippetLoading: { ...s.snippetLoading, ...Object.fromEntries(keys.map(k => [k, true as const])) } }))

    const done = (ks: string[]) => {
      ks.forEach(k => inFlight.delete(k))
      set(s => {
        const next = { ...s.snippetLoading }
        ks.forEach(k => delete next[k])
        return { snippetLoading: next }
      })
    }

    void (async () => {
      const token = await get().ensureToken()
      if (!token) { done(keys); return }

      const alive = () => snippetTerm === needle
      const store = (key: string, snip: Snippet | null) =>
        set(s => ({ snippets: { ...s.snippets, [key]: snip } }))

      /**
       * ── 파일 종류에 맞는 곳에만 묻습니다 ────────────────────────────────
       *
       * 두 판으로 나눠 뒀었습니다: 먼저 드라이브 내보내기로 글자를 받고, 그
       * 뒤에 Docs API로 탭을 알아보는 식이었습니다. 전제가 틀렸습니다 —
       * **내보내기는 탭 안의 글자를 안 담습니다.** 탭에 적힌 문장은 1판이
       * 절대 못 찾았고, 그래서 문장이 늘 2판을 기다렸습니다. 1판은 그동안
       * 문서를 통째로 한 번 더 받고 있었고요.
       *
       * 구글 문서는 Docs API 하나로 끝냅니다. 시트와 텍스트 파일은 그 API가
       * 모르는 형식이라 내보내기로 갑니다. 문서 하나에 요청 하나입니다.
       */
      await (async () => {
        const LANES = 3
        let next = 0
        const lane = async () => {
          for (;;) {
            const i = next++
            if (i >= todo.length) return
            const f = todo[i]
            const key = keys[i]
            if (!alive()) { done([key]); continue }
            const isDoc = f.mimeType === 'application/vnd.google-apps.document'
            try {
              let snip: Snippet | null = null
              if (isDoc) snip = await docSnippet(token, f, needle, signal)
              // 그 API가 없는 워크스페이스일 때만 내보내기로 물러납니다.
              // 있는데 못 찾았다면 문서 안에 없는 것이고(댓글이나 파일 설명에
              // 걸린 경우입니다), 그건 내보내기도 못 찾습니다.
              if (!snip && (!isDoc || docsApiDown())) {
                snip = await fetchSnippet(token, { id: f.id, mimeType: f.mimeType }, needle, 70, signal)
              }
              if (alive()) {
                store(key, snip)
                const next = readDisk()
                next[diskKey(f, needle)] = { s: snip, at: Date.now() }
                writeDisk(next)
              }
            } catch (e) {
              // 멈춘 것은 실패가 아닙니다 — '이 문서에는 없다'로 적어 두면
              // 다음에 같은 검색어로 물어도 영영 안 찾아봅니다.
              if (e instanceof DOMException && e.name === 'AbortError') { done([key]); continue }
              if (e instanceof Error && e.message === TOKEN_EXPIRED) set({ token: null, expiry: null })
              store(key, null)
            }
            done([key])
          }
        }
        await Promise.all(Array.from({ length: Math.min(LANES, todo.length) }, lane))
      })()
    })()
  },

  resolve: (ids) => {
    const { meta } = get()
    const missing = ids.filter(id => id && !(id in meta) && !inFlight.has(id))
    if (!missing.length) return
    missing.forEach(id => inFlight.add(id))

    void (async () => {
      const token = await get().ensureToken()
      if (!token) {
        missing.forEach(id => inFlight.delete(id))
        return
      }
      await Promise.all(missing.map(async id => {
        try {
          const file = await getFile(token, id)
          set(s => ({ meta: { ...s.meta, [id]: file } }))
        } catch (e) {
          // Deleted, or shared with the folder but not with this person. Either
          // way the stored title is all we have, and that is what gets drawn.
          set(s => ({ meta: { ...s.meta, [id]: null } }))
          if (e instanceof Error && e.message === TOKEN_EXPIRED) set({ token: null, expiry: null })
        } finally {
          inFlight.delete(id)
        }
      }))
    })()
  },
}))

export { driveIdFromUrl }

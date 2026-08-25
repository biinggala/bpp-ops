import { create } from 'zustand'
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
 * The passage and the tab it lives in, for a Doc that has tabs.
 *
 * Returns null for anything else — a plain document, a Sheet, or a workspace
 * where the Docs API is off or the grant predates the scope — and the caller
 * falls back to the Drive export, which finds the same passage but cannot say
 * where in the document it is.
 */
async function docSnippet(token: string, f: DriveSearchResult, needle: string): Promise<Snippet | null> {
  if (f.mimeType !== 'application/vnd.google-apps.document') return null
  if (docsUnavailable) return null
  let tabs
  try {
    tabs = await fetchDocTabs(token, f.id)
  } catch {
    // One refusal is enough: the API is off, or the scope was never granted.
    // Asking again per document per search would be a request each for nothing.
    docsUnavailable = true
    return null
  }
  // A single unnamed tab is just a document. Sending someone to "?tab=t.0" of a
  // document with one tab is noise in the URL and a promise the UI should not
  // make.
  if (tabs.length < 2) return null
  for (const tab of tabs) {
    const found = passageIn(tab.text, needle)
    if (found) return { ...found, tabId: tab.tabId, tabTitle: tab.title }
  }
  return null
}

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
      /**
       * 한 번에 셋씩.
       *
       * 하나씩 줄 세워 받고 있었습니다 — 각각이 몇 백 킬로바이트라 검색 자체를
       * 밀어내지 않게 하려던 것인데, 검색은 이미 끝난 뒤에 시작하는 일이라
       * 밀어낼 것이 없습니다. 넷이 걸리면 넷을 차례로 기다렸고, 그동안 화면은
       * '내용 불러오는 중…' 넷을 띄운 채로 있었습니다.
       *
       * 전부 한꺼번에 부르지는 않습니다. 여덟 개가 동시에 몇 메가를 끌어오면
       * 그 연결로 하는 다른 일이 다 같이 느려집니다.
       */
      const LANES = 3
      let next = 0
      const lane = async () => {
        for (;;) {
          const i = next++
          if (i >= todo.length) return
          const f = todo[i]
          const key = keys[i]
          try {
            const snip = await docSnippet(token, f, needle)
              ?? await fetchSnippet(token, { id: f.id, mimeType: f.mimeType }, needle)
            set(s => ({ snippets: { ...s.snippets, [key]: snip } }))
            done([key])
          } catch (e) {
            set(s => ({ snippets: { ...s.snippets, [key]: null } }))
            if (e instanceof Error && e.message === TOKEN_EXPIRED) {
              // 토큰이 죽었으면 남은 것도 다 실패합니다. 줄줄이 부르지 않고
              // 여기서 접습니다.
              set({ token: null, expiry: null })
              done(keys.slice(i))
              return
            }
            done([key])
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(LANES, todo.length) }, lane))
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

import { create } from 'zustand'
import { auth } from '../lib/firebase'
import { requestGoogleToken, GIS_CONFIGURED } from '../lib/googleAuthz'
import {
  DRIVE_SCOPE, TOKEN_EXPIRED, searchFiles, getFile, driveIdFromUrl,
  fetchSnippet, canSnippet,
  type DriveFile, type DriveSearchResult, type Snippet,
} from '../lib/googleDrive'

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
export const snippetKey = (id: string, term: string) => `${id}::${term.trim().toLowerCase()}`

export const useDriveStore = create<DriveState>((set, get) => ({
  ...loadStored(),
  connecting: false,
  needsReconnect: false,
  error: null,
  meta: {},
  snippets: {},

  connect: async () => {
    if (!GIS_CONFIGURED) {
      set({ error: '구글 클라이언트 ID가 설정되지 않았습니다' })
      return false
    }
    set({ connecting: true, error: null })
    try {
      const granted = await requestGoogleToken({
        scope: DRIVE_SCOPE,
        interactive: true,
        hint: auth.currentUser?.email ?? undefined,
      })
      const expiry = storeToken(granted.token, granted.expiresIn)
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
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(EXPIRY_KEY)
      localStorage.removeItem(CONNECTED_KEY)
    } catch { /* ignore */ }
    set({ token: null, expiry: null, wasConnected: false, needsReconnect: false, meta: {}, snippets: {}, error: null })
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
    todo.forEach(f => inFlight.add(snippetKey(f.id, needle)))

    void (async () => {
      const token = await get().ensureToken()
      if (!token) {
        todo.forEach(f => inFlight.delete(snippetKey(f.id, needle)))
        return
      }
      // Serial, not parallel: each of these can be a few hundred kilobytes, and
      // they are a nicety — they must not crowd out the search itself.
      for (const f of todo) {
        const key = snippetKey(f.id, needle)
        try {
          const snip = await fetchSnippet(token, { id: f.id, mimeType: f.mimeType }, needle)
          set(s => ({ snippets: { ...s.snippets, [key]: snip } }))
        } catch (e) {
          set(s => ({ snippets: { ...s.snippets, [key]: null } }))
          if (e instanceof Error && e.message === TOKEN_EXPIRED) {
            set({ token: null, expiry: null })
            todo.forEach(x => inFlight.delete(snippetKey(x.id, needle)))
            return
          }
        } finally {
          inFlight.delete(key)
        }
      }
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

// Google Drive, read-only.
//
// The app never copies a file's contents or changes anything in Drive. It stores
// an id and asks Drive for the current name whenever it draws it, which is the
// whole point: a pasted URL records what a file was called on the day somebody
// pasted it, and drifts from that moment on.

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

const API = 'https://www.googleapis.com/drive/v3'
const FIELDS = 'id,name,mimeType,webViewLink,iconLink,modifiedTime,parents,owners(displayName,emailAddress)'

export const TOKEN_EXPIRED = 'DRIVE_TOKEN_EXPIRED'
export const NOT_FOUND = 'DRIVE_NOT_FOUND'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  webViewLink?: string
  iconLink?: string
  modifiedTime?: string
  parents?: string[]
  owners?: { displayName?: string; emailAddress?: string }[]
}

/**
 * 403 is not an expired token.
 *
 * Treating it as one cost an afternoon: Drive answers 403 when the API is not
 * enabled on the Cloud project, and the code responded by throwing the token
 * away and asking Google for a new one — which succeeded, and was refused
 * again. Every keystroke in the search box started a fresh authorisation, so a
 * popup flashed once per letter typed and no search ever returned anything.
 * Only 401 means the token is stale; everything else is Google explaining a
 * problem the person needs to read.
 */
async function call<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    ...params,
  })
  const res = await fetch(`${API}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.ok) return res.json() as Promise<T>
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)

  let detail = ''
  try {
    const body = await res.json() as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch { /* not JSON */ }

  if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(detail)) {
    throw new Error(
      'Google Cloud 프로젝트에서 Drive API가 켜져 있지 않습니다. ' +
      'APIs & Services → Library → Google Drive API → 사용 설정',
    )
  }
  if (res.status === 404) throw new Error(NOT_FOUND)
  throw new Error(detail || `드라이브 오류 (${res.status})`)
}

/** Drive's query language takes single quotes, so any in the term must be escaped. */
function quote(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export interface DriveSearchResult extends DriveFile {
  /** Matched on contents rather than on the name — worth saying, see below. */
  contentMatch?: boolean
}

/**
 * Files matching `query`: the project's own folder first, then names, then
 * anything whose contents mention it.
 *
 * Three passes rather than one because the ordering is most of the value.
 * Drive cannot express "these first, then those" in a single query, and inside
 * a project the file you mean is nearly always the one already filed under it;
 * failing that, the one actually called that; and only failing that, the one
 * that mentions it somewhere on page four.
 *
 * `fullText` covers the indexed contents of Docs, Sheets, Slides, PDFs and
 * plain text — so "출연자 김민수" finds the 대본 that names him even when the
 * file is called "3화 초고". It matches whole words from the start, not
 * arbitrary substrings, which is why the name passes are still run separately:
 * they catch "잼카" → "잼카세".
 */
export async function searchFiles(
  token: string,
  query: string,
  folderId?: string | null,
  limit = 20,
): Promise<DriveSearchResult[]> {
  const term = query.trim()
  const escaped = quote(term)
  const nameQ = term ? `name contains '${escaped}' and trashed = false` : 'trashed = false'
  const textQ = `fullText contains '${escaped}' and trashed = false`
  const common = {
    fields: `files(${FIELDS})`,
    pageSize: String(limit),
  }
  // With a term, Drive's own relevance ordering beats anything alphabetical.
  // With none, this is a "recently opened" list, which is the most useful thing
  // to show before anybody has typed.
  const ordered = { ...common, ...(term ? {} : { orderBy: 'viewedByMeTime desc' }) }

  const out: DriveSearchResult[] = []
  const seen = new Set<string>()
  const push = (files: DriveFile[] = [], contentMatch = false) => {
    for (const f of files) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push(contentMatch ? { ...f, contentMatch: true } : f)
    }
  }

  const none = Promise.resolve({ files: [] as DriveFile[] })
  const [scoped, byName, byText] = await Promise.all([
    folderId
      ? call<{ files?: DriveFile[] }>(token, '/files', { ...ordered, q: `'${quote(folderId)}' in parents and ${nameQ}` })
      : none,
    call<{ files?: DriveFile[] }>(token, '/files', { ...ordered, q: nameQ }),
    term
      ? call<{ files?: DriveFile[] }>(token, '/files', { ...common, q: textQ })
      : none,
  ])
  push(scoped.files)
  push(byName.files)
  push(byText.files, true)
  return out.slice(0, limit)
}

export async function getFile(token: string, fileId: string): Promise<DriveFile> {
  return call<DriveFile>(token, `/files/${encodeURIComponent(fileId)}`, { fields: FIELDS })
}

/**
 * The Drive item a URL points at, or null if it points at something else.
 *
 * Covers the shapes Drive actually hands out — /file/d/, the editor URLs for
 * Docs/Sheets/Slides/Forms, folders, and the older ?id= form — so links already
 * pasted into tasks are recognised without anybody having to re-add them.
 */
export function driveIdFromUrl(url: string): string | null {
  if (!url) return null
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (!/(^|\.)google\.com$/.test(u.hostname)) return null

  const byPath = u.pathname.match(/\/(?:file|document|spreadsheets|presentation|forms|drawings)\/d\/([A-Za-z0-9_-]+)/)
  if (byPath) return byPath[1]

  const byFolder = u.pathname.match(/\/(?:folders|drive\/folders)\/([A-Za-z0-9_-]+)/)
  if (byFolder) return byFolder[1]

  const byQuery = u.searchParams.get('id')
  if (byQuery && /^[A-Za-z0-9_-]+$/.test(byQuery)) return byQuery

  return null
}

const KIND: { match: (m: string) => boolean; icon: string; label: string }[] = [
  { match: m => m === 'application/vnd.google-apps.folder',       icon: '📁', label: '폴더' },
  { match: m => m === 'application/vnd.google-apps.document',     icon: '📄', label: '문서' },
  { match: m => m === 'application/vnd.google-apps.spreadsheet',  icon: '📊', label: '스프레드시트' },
  { match: m => m === 'application/vnd.google-apps.presentation', icon: '📽', label: '슬라이드' },
  { match: m => m === 'application/vnd.google-apps.form',         icon: '📝', label: '설문지' },
  { match: m => m === 'application/pdf',                          icon: '📕', label: 'PDF' },
  { match: m => m.startsWith('image/'),                           icon: '🖼', label: '이미지' },
  { match: m => m.startsWith('video/'),                           icon: '🎬', label: '영상' },
  { match: m => m.startsWith('audio/'),                           icon: '🎵', label: '오디오' },
  { match: m => m.includes('zip') || m.includes('compressed'),    icon: '🗜', label: '압축' },
]

export function fileKind(mimeType?: string): { icon: string; label: string } {
  const m = mimeType ?? ''
  return KIND.find(k => k.match(m)) ?? { icon: '📎', label: '파일' }
}

/** A Drive item's canonical URL, for ids we hold without having fetched them yet. */
export function driveUrl(fileId: string, mimeType?: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.folder':       return `https://drive.google.com/drive/folders/${fileId}`
    case 'application/vnd.google-apps.document':     return `https://docs.google.com/document/d/${fileId}/edit`
    case 'application/vnd.google-apps.spreadsheet':  return `https://docs.google.com/spreadsheets/d/${fileId}/edit`
    case 'application/vnd.google-apps.presentation': return `https://docs.google.com/presentation/d/${fileId}/edit`
    default:                                         return `https://drive.google.com/file/d/${fileId}/view`
  }
}

// ── Content snippets ──────────────────────────────────────────────────────────

/**
 * Drive has no snippet field.
 *
 * `fullText contains` will tell you a document mentions your term and then say
 * nothing about where or in what sentence — which is the half that makes a
 * result worth clicking. So the text is exported and the match found here.
 *
 * Only for the formats Drive will hand over as text. A PDF would have to be
 * downloaded as a blob and parsed, which is a library and a lot of bytes for a
 * line of preview, so PDFs keep the "내용 일치" label and no quote.
 */
const EXPORT_AS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  // Sheets export one sheet at a time, so a match on a later tab finds nothing.
  'application/vnd.google-apps.spreadsheet': 'text/csv',
}

export function canSnippet(mimeType?: string): boolean {
  if (!mimeType) return false
  return mimeType in EXPORT_AS || mimeType.startsWith('text/')
}

export interface Snippet {
  before: string
  match: string
  after: string
}

/** Enough of a long document to find the term in; past this it is not worth the bytes. */
const MAX_TEXT = 400_000

export async function fetchSnippet(
  token: string,
  file: { id: string; mimeType: string },
  term: string,
  radius = 70,
): Promise<Snippet | null> {
  const needle = term.trim()
  if (!needle || !canSnippet(file.mimeType)) return null

  const exportAs = EXPORT_AS[file.mimeType]
  const url = exportAs
    ? `${API}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportAs)}`
    : `${API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (!res.ok) return null

  const text = (await res.text()).slice(0, MAX_TEXT)
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
  // Drive matched on something this export does not contain — a later sheet, a
  // comment, the file's description. Better no quote than a misleading one.
  if (at < 0) return null

  const tidy = (v: string) => v.replace(/\s+/g, ' ')
  const from = Math.max(0, at - radius)
  const to = Math.min(text.length, at + needle.length + radius)
  return {
    before: (from > 0 ? '…' : '') + tidy(text.slice(from, at)),
    match: text.slice(at, at + needle.length),
    after: tidy(text.slice(at + needle.length, to)) + (to < text.length ? '…' : ''),
  }
}

export function relativeTime(iso?: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return '방금'
  if (mins < 60) return `${mins}분 전`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}시간 전`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}일 전`
  if (days < 30) return `${Math.round(days / 7)}주 전`
  if (days < 365) return `${Math.round(days / 30)}개월 전`
  return `${Math.round(days / 365)}년 전`
}

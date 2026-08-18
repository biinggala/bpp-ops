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

/**
 * Files matching `query`, the project's own folder first.
 *
 * Two passes rather than one: Drive cannot express "these first, then the rest"
 * in a single query, and the ordering is the useful part — inside a project, the
 * file you mean is almost always the one already filed under it.
 */
export async function searchFiles(
  token: string,
  query: string,
  folderId?: string | null,
  limit = 20,
): Promise<DriveFile[]> {
  const term = query.trim()
  const base = term ? `name contains '${quote(term)}' and trashed = false` : 'trashed = false'
  const common = {
    fields: `files(${FIELDS})`,
    pageSize: String(limit),
    // With no search term this is a "recently opened" list, which is the most
    // useful thing to show before anybody has typed.
    orderBy: term ? 'folder,name' : 'viewedByMeTime desc',
  }

  const out: DriveFile[] = []
  const seen = new Set<string>()
  const push = (files: DriveFile[] = []) => {
    for (const f of files) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push(f)
    }
  }

  // Both passes always run. Gating the second on the first coming up short
  // meant a project with a busy folder could never find anything outside it.
  const [scoped, all] = await Promise.all([
    folderId
      ? call<{ files?: DriveFile[] }>(token, '/files', { ...common, q: `'${quote(folderId)}' in parents and ${base}` })
      : Promise.resolve({ files: [] as DriveFile[] }),
    call<{ files?: DriveFile[] }>(token, '/files', { ...common, q: base }),
  ])
  push(scoped.files)
  push(all.files)
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

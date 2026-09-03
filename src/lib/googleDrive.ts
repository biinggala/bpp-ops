import type { IconName } from '../components/shared/Icon'
// Google Drive, read-only.
//
// The app never copies a file's contents or changes anything in Drive. It stores
// an id and asks Drive for the current name whenever it draws it, which is the
// whole point: a pasted URL records what a file was called on the day somebody
// pasted it, and drifts from that moment on.

import { DRIVE_SCOPE } from './scopes'
export { DRIVE_SCOPE }

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
  /**
   * 내용으로 걸린 것의 자리를 **미리 남겨 둡니다.**
   *
   * 이름으로 걸린 것을 먼저 다 밀어 넣고 있었습니다. 흔한 낱말을 치면 이름
   * 일치만으로 정원이 차서, 내용으로 걸린 파일은 한 줄도 못 섰습니다 —
   * 그런데 **이름만으로는 못 찾는 것**이 바로 그쪽이라, 흔한 낱말일수록
   * 답은 내용 쪽에 있습니다.
   *
   * 남은 자리가 있으면 잘린 이름 일치도 뒤에 다시 붙입니다. 버리는 건
   * 없고, 순서만 바뀝니다.
   */
  const named = byName.files ?? []
  const room = term ? Math.min(6, Math.floor(limit / 3)) : 0
  const head = Math.max(0, limit - room - out.length)
  push(named.slice(0, head))
  push(byText.files, true)
  push(named.slice(head))
  return out.slice(0, limit)
}

/**
 * ── 무엇이 바뀌었는지 묻는 값싼 방법 ────────────────────────────────────────
 *
 * 붙여 둔 파일이 마흔 개면 `files.get`을 마흔 번 부르게 됩니다. 앱을 켤 때마다
 * 마흔 번씩요. Drive에는 "이 아이디들 중에서" 같은 질의가 없어서 목록으로
 * 묶을 수도 없습니다.
 *
 * 대신 **변경 목록**을 씁니다. 내 드라이브 전체에서 지난번 이후 바뀐 것을 한
 * 번에 받아 오고, 그중 우리가 아는 파일만 골라냅니다 — 파일이 몇 개든 요청은
 * 한 번입니다. 지난번이 언제인지는 페이지 토큰이 기억합니다.
 */
export interface DriveChange {
  fileId: string
  /** 휴지통에 갔거나 공유가 끊겨 더 못 보는 상태. */
  removed: boolean
  name?: string
  modifiedTime?: string
  webViewLink?: string
  by?: { displayName?: string; emailAddress?: string }
}

/** 지금부터 세겠다는 표식. 처음 한 번만 받아 두면 됩니다. */
export async function getStartPageToken(token: string): Promise<string> {
  const res = await call<{ startPageToken: string }>(token, '/changes/startPageToken', {})
  return res.startPageToken
}

const CHANGE_FIELDS =
  'newStartPageToken,nextPageToken,changes(fileId,removed,' +
  'file(id,name,trashed,modifiedTime,webViewLink,lastModifyingUser(displayName,emailAddress)))'

/** 한 번에 읽어 올 페이지 수. 이만큼도 안 끝나면 따라잡기를 포기합니다. */
const MAX_PAGES = 10

/**
 * `pageToken` 이후의 변경들과, 다음번에 쓸 토큰.
 *
 * `caughtUp`이 거짓이면 열 페이지로도 다 못 읽었다는 뜻입니다 — 오래 앱을
 * 안 켰거나 드라이브가 아주 바쁜 경우입니다. 그럴 땐 못 읽은 나머지를
 * 포기하고 지금 시점으로 표식을 옮깁니다. 이건 장부가 아니라 알림입니다.
 */
export async function listChanges(token: string, pageToken: string): Promise<{
  changes: DriveChange[]
  nextToken: string
  caughtUp: boolean
}> {
  const changes: DriveChange[] = []
  let cursor = pageToken
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await call<{
      changes?: {
        fileId?: string
        removed?: boolean
        file?: DriveFile & { trashed?: boolean; lastModifyingUser?: { displayName?: string; emailAddress?: string } }
      }[]
      nextPageToken?: string
      newStartPageToken?: string
    }>(token, '/changes', { pageToken: cursor, pageSize: '100', fields: CHANGE_FIELDS })

    for (const c of res.changes ?? []) {
      if (!c.fileId) continue
      changes.push({
        fileId: c.fileId,
        removed: !!c.removed || !!c.file?.trashed,
        name: c.file?.name,
        modifiedTime: c.file?.modifiedTime,
        webViewLink: c.file?.webViewLink,
        by: c.file?.lastModifyingUser,
      })
    }
    if (res.newStartPageToken) return { changes, nextToken: res.newStartPageToken, caughtUp: true }
    if (!res.nextPageToken) return { changes, nextToken: cursor, caughtUp: true }
    cursor = res.nextPageToken
  }
  // 따라잡지 못했습니다. 부른 쪽이 표식을 새로 받아 옵니다.
  return { changes, nextToken: cursor, caughtUp: false }
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

/**
 * ── 파일의 종류, 그리고 그 종류의 그림 ───────────────────────────────────────
 *
 * 전에는 이모지였습니다(📄 📊 📽 📕 🖼). 이모지는 글자가 아니라 **그림**이라,
 * 선으로 그린 나머지 아이콘 옆에 놓이면 혼자 색을 갖고 혼자 두껍고 혼자
 * 베이스라인이 다릅니다. 자료 목록이나 검색 결과 한 목록에 둘이 섞여 있으면
 * 그 목록이 두 가족으로 보입니다.
 *
 * 이제 이름만 돌려줍니다 — 그리는 것은 Icon이 합니다. 종류는 그대로입니다:
 * 문서와 스프레드시트가 같아 보이면 어느 것을 열지 눈으로 못 고릅니다.
 */
const KIND: { match: (m: string) => boolean; icon: IconName; label: string }[] = [
  { match: m => m === 'application/vnd.google-apps.folder',       icon: 'folder', label: '폴더' },
  { match: m => m === 'application/vnd.google-apps.document',     icon: 'doc',    label: '문서' },
  { match: m => m === 'application/vnd.google-apps.spreadsheet',  icon: 'sheet',  label: '스프레드시트' },
  { match: m => m === 'application/vnd.google-apps.presentation', icon: 'slide',  label: '슬라이드' },
  { match: m => m === 'application/vnd.google-apps.form',         icon: 'form',   label: '설문지' },
  { match: m => m === 'application/pdf',                          icon: 'pdf',    label: 'PDF' },
  { match: m => m.startsWith('image/'),                           icon: 'image',  label: '이미지' },
  { match: m => m.startsWith('video/'),                           icon: 'video',  label: '영상' },
  { match: m => m.startsWith('audio/'),                           icon: 'audio',  label: '오디오' },
  { match: m => m.includes('zip') || m.includes('compressed'),    icon: 'zip',    label: '압축' },
]

export function fileKind(mimeType?: string): { icon: IconName; label: string } {
  const m = mimeType ?? ''
  return KIND.find(k => k.match(m)) ?? { icon: 'attach', label: '파일' }
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
  /** Set when the passage was found inside one tab of a multi-tab Doc. */
  tabId?: string
  tabTitle?: string
}

/** Enough of a long document to find the term in; past this it is not worth the bytes. */
const MAX_TEXT = 400_000

export async function fetchSnippet(
  token: string,
  file: { id: string; mimeType: string },
  term: string,
  radius = 70,
  signal?: AbortSignal,
): Promise<Snippet | null> {
  const needle = term.trim()
  if (!needle || !canSnippet(file.mimeType)) return null

  const exportAs = EXPORT_AS[file.mimeType]
  const url = exportAs
    ? `${API}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportAs)}`
    : `${API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal })
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)
  if (!res.ok) return null

  return passageIn((await res.text()).slice(0, MAX_TEXT), needle, radius)
}

/**
 * The term in its sentence, or null if this text does not contain it.
 *
 * Null rather than an empty quote: Drive matches on things an export does not
 * carry — a later sheet, a comment, the file's description — and a passage that
 * does not contain the term is worse than none.
 */
export function passageIn(text: string, needle: string, radius = 70): Snippet | null {
  const at = text.toLowerCase().indexOf(needle.toLowerCase())
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

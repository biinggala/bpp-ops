import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useDriveStore, warmDriveAuth, snippetKey } from '../../store/driveStore'
import { useProjectStore } from '../../store/projectStore'
import { isComposing, gid, safeExternalUrl } from '../../lib/utils'
import { Icon } from './Icon'
import { fileKind, relativeTime, driveIdFromUrl, driveUrl, type DriveFile, type DriveSearchResult } from '../../lib/googleDrive'
import { docTabUrl } from '../../lib/googleDocs'
import { NOTION } from '../../types'
import type { TaskLink } from '../../types'
import { useShallow } from 'zustand/react/shallow'

/**
 * ── Task materials ───────────────────────────────────────────────────────────
 *
 * What "a task and its files are aligned" is taken to mean here:
 *
 * 1. The task points at the file, not at a copy of its name. A pasted URL is a
 *    photograph of a moment — rename the doc and the task quietly starts lying.
 *    Storing the Drive id and reading the name back keeps the two in step.
 * 2. Attaching happens where the work is. The old flow was leave the app, find
 *    the file in Drive, copy the address, come back, paste. Searching Drive from
 *    inside the task removes the round trip, which is where the friction was.
 * 3. The project's folder is a scope, not a bookmark. When a project has one,
 *    its contents are offered first, because inside a project the file you mean
 *    is nearly always the one already filed under it.
 *
 * Links that are not Drive items — a reference video, an article — keep working
 * exactly as before. Not every material lives in Drive and the app should not
 * pretend otherwise.
 */

/** Reads the current name/icon for every Drive link in the list. */
export function useResolvedLinks(links: TaskLink[] | undefined): Map<string, DriveFile | null> {
  const meta = useDriveStore(s => s.meta)
  const resolve = useDriveStore(s => s.resolve)
  const wasConnected = useDriveStore(s => s.wasConnected)

  const ids = useMemo(
    () => Array.from(new Set((links ?? []).map(driveIdOf).filter((v): v is string => !!v))),
    [links],
  )

  useEffect(() => {
    if (!wasConnected || ids.length === 0) return
    resolve(ids)
  }, [ids, resolve, wasConnected])

  return useMemo(() => {
    const m = new Map<string, DriveFile | null>()
    for (const id of ids) if (id in meta) m.set(id, meta[id])
    return m
  }, [ids, meta])
}

/**
 * Links pasted before any of this existed are Drive files too — the id is right
 * there in the URL. Recognising it means they light up without anybody having to
 * re-attach a thing.
 */
export function driveIdOf(link: TaskLink): string | null {
  return link.driveId ?? driveIdFromUrl(link.url)
}

/**
 * `tab` sends the link to one tab of a multi-tab Doc.
 *
 * Without it, a document found by a phrase on its fourth tab opens on whichever
 * tab the reader last had open — which for a 기획 / 대본 / 일정 document is most
 * of the way to not having found it.
 */
export function linkFromDriveFile(f: DriveFile, tab?: { id: string; title: string }): TaskLink {
  return {
    id: gid(),
    title: f.name,
    url: tab ? docTabUrl(f.id, tab.id) : (f.webViewLink || driveUrl(f.id, f.mimeType)),
    driveId: f.id,
    mimeType: f.mimeType,
    ...(tab ? { tabTitle: tab.title } : {}),
  }
}

/** The project folder's Drive id, when the project has one set. */
/**
 * The folder a project's Drive search should look in first.
 *
 * Read off the project's own shelf: a folder put there is the folder the work
 * lives in, and there is no second place to say so. `driveFolderUrl` is the
 * older, separate field — kept only until a project's folder has been folded
 * into its shelf, which the 자료 view does the first time it draws one.
 */
export function useProjectFolderId(projectId: string | undefined): string | null {
  const projects = useProjectStore(s => s.projects)
  return useMemo(() => {
    const project = projectId ? projects.find(p => p.id === projectId) : undefined
    if (!project) return null
    const shelved = (project.links ?? []).find(isDriveFolder)
    if (shelved) return driveIdOf(shelved) ?? null
    return project.driveFolderUrl ? driveIdFromUrl(project.driveFolderUrl) : null
  }, [projects, projectId])
}

/** A Drive folder, whether Drive told us so or the URL says it. */
export function isDriveFolder(link: TaskLink): boolean {
  return link.mimeType === FOLDER_MIME || /\/drive\/folders\//.test(link.url)
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// ── One attached file ─────────────────────────────────────────────────────────

export function FileRow({ link, file, onRemove, onNote, compact = false }: {
  link: TaskLink
  /** undefined = not looked up yet, null = looked up and unavailable. */
  file?: DriveFile | null
  onRemove?: () => void
  /** Supplied where the note may be written; omitted makes the row read-only. */
  onNote?: (note: string) => void
  compact?: boolean
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [draft, setDraft] = useState(link.note ?? '')
  const [hovered, setHovered] = useState(false)

  const commitNote = () => { onNote?.(draft.trim()); setEditingNote(false) }
  const isDrive = !!driveIdOf(link)
  const kind = fileKind(file?.mimeType ?? link.mimeType)
  const name = file?.name ?? link.title
  // The stored URL wins when it names a tab: Drive's own link always points at
  // the document, and would quietly undo the thing that made this worth
  // attaching.
  const href = safeExternalUrl(link.tabTitle ? link.url : (file?.webViewLink ?? link.url))
  // A Drive link that resolved to nothing is either deleted or not shared with
  // this person. Saying so beats drawing a name that no longer opens.
  const gone = isDrive && file === null

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: compact ? '5px 8px' : '7px 9px',
        borderRadius: 'var(--r2)',
        border: compact ? 'none' : '1px solid var(--bd)',
        background: compact ? 'transparent' : 'var(--bg2)',
        transition: 'background .07s, border-color .1s',
        minWidth: 0,
      }}
      onMouseEnter={e => { setHovered(true); e.currentTarget.style.background = compact ? 'var(--bg3)' : 'var(--bg2)'; e.currentTarget.style.borderColor = compact ? 'transparent' : 'var(--bd2)' }}
      onMouseLeave={e => { setHovered(false); e.currentTarget.style.background = compact ? 'transparent' : 'var(--bg2)'; e.currentTarget.style.borderColor = compact ? 'transparent' : 'var(--bd)' }}
    >
      <span style={{
        flexShrink: 0, display: 'flex', color: 'var(--t2)',
        opacity: gone ? .4 : 1,
      }}>
        <Icon name={isDrive ? kind.icon : 'link'} size={15} />
      </span>
      <a
        href={href ?? undefined} target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        title={file?.name ?? link.url}
        style={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
      >
        <div style={{
          fontSize: 13, color: gone ? 'var(--t3)' : 'var(--t1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: gone ? 'line-through' : 'none',
        }}>{name}</div>
        <div style={{ fontSize: 10, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
          {link.note && <span style={{ color: 'var(--t2)', fontWeight: 500 }}>{link.note} · </span>}
          {gone ? '드라이브에서 찾을 수 없음'
            : isDrive ? [
                kind.label,
                link.tabTitle ? `탭: ${link.tabTitle}` : null,
                file?.modifiedTime ? `${relativeTime(file.modifiedTime)} 수정` : null,
              ].filter(Boolean).join(' · ')
            : hostOf(link.url)}
        </div>
      </a>
      {onNote && !editingNote && (
        <button
          onClick={e => { e.stopPropagation(); setDraft(link.note ?? ''); setEditingNote(true) }}
          title={link.note ? '메모 수정' : '메모 추가'}
          style={{
            flexShrink: 0, height: 20, padding: '0 6px', border: 'none',
            background: 'transparent', cursor: 'pointer', color: 'var(--t3)',
            fontSize: 11, borderRadius: 'var(--r1)', fontFamily: 'var(--font)',
            // Hidden until wanted: most rows never need one, and a permanent
            // affordance on every file is a column of clutter.
            opacity: hovered || link.note ? 1 : 0, transition: 'opacity .1s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t1)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
        >✎</button>
      )}
      {onNote && editingNote && (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitNote}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); commitNote() }
            if (e.key === 'Escape') { setDraft(link.note ?? ''); setEditingNote(false) }
          }}
          placeholder="메모 (예: 김민수 미팅)"
          style={{
            flexShrink: 1, minWidth: 0, width: 150,
            border: '1px solid var(--ac)', borderRadius: 'var(--r1)',
            padding: '3px 6px', fontSize: 11, background: 'var(--bg)',
            color: 'var(--t1)', outline: 'none', fontFamily: 'var(--font)',
          }}
        />
      )}
      {onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          aria-label="첨부 해제"
          style={{ flexShrink: 0, width: 20, height: 20, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--t3)', fontSize: 12, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'rgba(212,76,71,.1)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent' }}
        >✕</button>
      )}
    </div>
  )
}

/**
 * Shared by the quote and by its placeholder.
 *
 * Same padding, same line height, same two-line clamp — so when the text
 * arrives it fills a box that was already the right size instead of shoving the
 * rest of the list down.
 */
/** 본문 한 조각을 담는 상자. 커맨드 팔레트도 같은 것을 씁니다 — 같은 정보가
 *  두 화면에서 다르게 생기면 사람은 그걸 다른 것으로 배웁니다. */
export const SNIPPET_BOX: React.CSSProperties = {
  fontSize: 11, color: 'var(--t2)', marginTop: 3,
  lineHeight: 1.45, background: 'var(--bg2)', borderRadius: 4,
  padding: '3px 6px', overflow: 'hidden',
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
} as React.CSSProperties

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

// ── Drive search ──────────────────────────────────────────────────────────────

export function DriveSearch({ folderId, attachedIds, onPick, onClose }: {
  folderId: string | null
  attachedIds: Set<string>
  onPick: (f: DriveFile, tab?: { id: string; title: string }) => void
  onClose?: () => void
}) {
  const { wasConnected, token, needsReconnect, connect, connecting, search, error } = useDriveStore(useShallow(s => ({ wasConnected: s.wasConnected, token: s.token, needsReconnect: s.needsReconnect, connect: s.connect, connecting: s.connecting, search: s.search, error: s.error })))
  const snippets = useDriveStore(s => s.snippets)
  const snippetLoading = useDriveStore(s => s.snippetLoading)
  const loadSnippets = useDriveStore(s => s.loadSnippets)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<DriveSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const connected = (wasConnected || !!token) && !needsReconnect
  const seq = useRef(0)

  // Ready the Google client while the panel opens, not on the click — a window
  // opened after a network round trip is blocked on iOS. Same fix as 캘린더.
  useEffect(() => { if (!token) warmDriveAuth() }, [token])

  // Debounced, and every response carries the request number that asked for it —
  // otherwise a slow early query can land after a fast later one and overwrite it.
  useEffect(() => {
    if (!connected) return
    const mine = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      const files = await search(q, folderId)
      if (seq.current !== mine) return
      setResults(files); setLoading(false)
      // Quotes come after the list. Showing results the moment they exist and
      // filling the passages in behind beats holding the whole list back for a
      // detail that is a nicety.
      loadSnippets(files, q)
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, folderId, connected, search])

  if (!connected) {
    return (
      <div style={{ padding: '14px 10px', textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 9, lineHeight: 1.5 }}>
          {needsReconnect
            ? <>구글 로그인이 만료되었습니다<br />다시 연결해 주세요</>
            : <>구글 드라이브를 연결하면<br />파일을 검색해서 바로 붙일 수 있습니다</>}
        </div>
        <button
          onClick={() => void connect()}
          disabled={connecting}
          style={{ padding: '6px 14px', borderRadius: 'var(--r2)', border: 'none', background: 'var(--ac)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: connecting ? 'default' : 'pointer', fontFamily: 'var(--font)', opacity: connecting ? .6 : 1 }}
        >
          {connecting ? '연결 중...' : needsReconnect ? '다시 연결' : '드라이브 연결'}
        </button>
        {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
      </div>
    )
  }

  return (
    <>
      <div style={{ paddingBottom: 4, flexShrink: 0 }}>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape' && !isComposing(e)) { e.stopPropagation(); onClose?.() }
          }}
          placeholder="파일 이름 또는 내용 검색..."
          style={{
            width: '100%', boxSizing: 'border-box',
            border: '1px solid var(--bd)', borderRadius: 'var(--r1)',
            padding: '5px 8px', fontSize: 12,
            background: 'var(--bg2)', color: 'var(--t1)',
            outline: 'none', fontFamily: 'var(--font)',
          }}
        />
      </div>
      <div style={{ flex: '1 1 auto', overflowY: 'auto', minHeight: 96, margin: '0 -4px', padding: '0 4px' }}>
        {!q && !loading && results.length > 0 && (
          <div style={{ padding: '4px 8px 2px', fontSize: 10, fontWeight: 600, color: 'var(--t3)', letterSpacing: '.04em' }}>
            최근 항목
          </div>
        )}
        {error && (
          <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--danger)', lineHeight: 1.5, wordBreak: 'break-word' }}>
            {error}
          </div>
        )}
        {!error && loading && results.length === 0 && (
          <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--t3)' }}>불러오는 중...</div>
        )}
        {!error && !loading && results.length === 0 && (
          <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--t3)' }}>
            {q ? '검색 결과가 없습니다' : '표시할 파일이 없습니다'}
          </div>
        )}
        {results.map(f => {
          const already = attachedIds.has(f.id)
          const kind = fileKind(f.mimeType)
          const inFolder = !!folderId && !!f.parents?.includes(folderId)
          const sKey = snippetKey(f.id, q)
          const snip = f.contentMatch ? snippets[sKey] : null
          const snipLoading = !!f.contentMatch && !!snippetLoading[sKey]
          // The box is there either way, so nothing shifts when the text lands.
          const hasBox = !!snip || snipLoading
          return (
            <div
              key={f.id}
              onMouseDown={e => {
                e.preventDefault()
                if (already) return
                onPick(f, snip?.tabId ? { id: snip.tabId, title: snip.tabTitle ?? '' } : undefined)
              }}
              style={{
                display: 'flex', alignItems: hasBox ? 'flex-start' : 'center', gap: 8,
                padding: '6px 8px', borderRadius: 'var(--r1)',
                cursor: already ? 'default' : 'pointer',
                opacity: already ? .45 : 1,
                transition: 'background .07s', minWidth: 0,
              }}
              onMouseEnter={e => { if (!already) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{
                flexShrink: 0, display: 'flex', color: 'var(--t2)',
                marginTop: hasBox ? 2 : 0,
              }}>
                <Icon name={kind.icon} size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                  {[
                    inFolder ? '이 프로젝트 폴더' : null,
                    snip?.tabTitle ? `탭: ${snip.tabTitle}` : null,
                    f.contentMatch && !hasBox ? '내용 일치' : null,
                    f.modifiedTime ? `${relativeTime(f.modifiedTime)} 수정` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
                {hasBox && (
                  <span style={{ ...SNIPPET_BOX, ...(snip ? {} : { color: 'var(--t3)' }) }}
                    className={snip ? 'bpp-snippet' : 'bpp-snippet-loading'}
                  >
                    {snip ? (
                      <>
                        {snip.before}
                        <mark style={{ background: NOTION.yellow.bg, color: NOTION.yellow.text, fontWeight: 600, padding: '0 1px', borderRadius: 2 }}>{snip.match}</mark>
                        {snip.after}
                      </>
                    ) : '내용 불러오는 중…'}
                  </span>
                )}
              </span>
              {already && <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>첨부됨</span>}
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Paste-a-URL, for everything that is not in Drive ──────────────────────────

export function UrlAdd({ onAdd }: { onAdd: (link: TaskLink) => void }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const submit = () => {
    const raw = url.trim()
    if (!raw) return
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const driveId = driveIdFromUrl(href)
    onAdd({
      id: gid(),
      title: title.trim() || (driveId ? '드라이브 항목' : href.replace(/^https?:\/\//i, '').slice(0, 40)),
      url: href,
      ...(driveId ? { driveId } : {}),
    })
    setTitle(''); setUrl('')
  }

  const style: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    border: '1px solid var(--bd)', borderRadius: 'var(--r1)',
    padding: '5px 8px', fontSize: 12,
    background: 'var(--bg2)', color: 'var(--t1)',
    outline: 'none', fontFamily: 'var(--font)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <input
        value={title} onChange={e => setTitle(e.target.value)}
        placeholder="이름 (선택)"
        onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) (e.currentTarget.nextElementSibling?.firstElementChild as HTMLInputElement)?.focus() }}
        style={style}
      />
      <div style={{ display: 'flex', gap: 5 }}>
        <input
          value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://..."
          onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) submit() }}
          style={{ ...style, flex: 1, width: 'auto' }}
        />
        <button
          onMouseDown={e => { e.preventDefault(); submit() }}
          disabled={!url.trim()}
          style={{ padding: '4px 10px', borderRadius: 'var(--r1)', border: 'none', background: url.trim() ? 'var(--ac)' : 'var(--bg3)', color: url.trim() ? '#fff' : 'var(--t3)', fontSize: 12, cursor: url.trim() ? 'pointer' : 'default', fontFamily: 'var(--font)', flexShrink: 0 }}
        >추가</button>
      </div>
    </div>
  )
}

/** The two ways in, as a pair of tabs — search Drive, or paste anything else. */
export function AttachTabs({ mode, onChange }: {
  mode: 'drive' | 'url'
  onChange: (m: 'drive' | 'url') => void
}) {
  const tab = (id: 'drive' | 'url', label: string) => (
    <button
      onClick={() => onChange(id)}
      style={{
        padding: '3px 9px', borderRadius: 'var(--r1)', border: 'none',
        background: mode === id ? 'var(--bg4)' : 'transparent',
        color: mode === id ? 'var(--t1)' : 'var(--t3)',
        fontSize: 12, fontWeight: mode === id ? 500 : 400,
        cursor: 'pointer', fontFamily: 'var(--font)', whiteSpace: 'nowrap',
      }}
    >{label}</button>
  )
  return (
    <div style={{ display: 'flex', gap: 2, flexShrink: 0, paddingBottom: 4 }}>
      {tab('drive', '드라이브')}
      {tab('url', '링크')}
    </div>
  )
}

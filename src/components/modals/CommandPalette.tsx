import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { isComposing } from '../../lib/utils'
import { useUiStore } from '../../store/uiStore'
import { useAuthStore } from '../../store/authStore'
import { searchNotes, forgetNotes } from '../../lib/noteSearch'
import { useTaskStore } from '../../store/taskStore'
import { useSpaceStore } from '../../store/spaceStore'
import { useProjectStore } from '../../store/projectStore'
import { useDriveStore } from '../../store/driveStore'
import { useNotionStore } from '../../store/notionStore'
import { useMobile } from '../../hooks/useMobile'
import { haptic } from '../../lib/haptics'
import { Icon } from '../shared/Icon'
import { fileKind, driveUrl, type DriveSearchResult, type Snippet } from '../../lib/googleDrive'
import { snippetKey, warmDriveAuth } from '../../store/driveStore'
import { snippetKey as notionKey } from '../../store/notionStore'
import type { NotionHit } from '../../lib/notion'
import { docTabUrl } from '../../lib/googleDocs'
import { SNIPPET_BOX } from '../shared/DriveFiles'
import { NOTION } from '../../types'
import { openExternal } from '../../lib/desktopLinks'
import type { TaskLink, ViewType } from '../../types'
import { useShallow } from 'zustand/react/shallow'

// 보드는 뷰 탭에서 내렸으므로 여기서도 내립니다 — 팔레트에만 남으면
// 화면 어디에도 없는 곳으로 가는 문이 됩니다. 코드는 그대로 있습니다.
const VIEW_META: { id: ViewType; icon: string; label: string }[] = [
  { id: 't', icon: '≡', label: '리스트 뷰' },
  { id: 'c', icon: '📅', label: '캘린더 뷰' },
  { id: 'g', icon: '📊', label: '간트 차트' },
  { id: 's', icon: '📈', label: '통계' },
]

function fuzzy(str: string, q: string): boolean {
  if (!q) return true
  const s = str.toLowerCase()
  const query = q.toLowerCase()
  let si = 0
  for (let qi = 0; qi < query.length; qi++) {
    const idx = s.indexOf(query[qi], si)
    if (idx === -1) return false
    si = idx + 1
  }
  return true
}

/**
 * 결과 묶음의 순서이자, 이름표입니다.
 *
 * 전에는 묶음을 손으로 하나씩 세었고, 그러다 데일리 노트 결과가 목록에는 들어
 * 있는데 어느 묶음에도 안 들어가서 **화면에 아예 안 그려지고 있었습니다**
 * (↑↓는 그 위를 지나갔습니다 — 빈 칸을 지나는 것처럼 보였을 겁니다).
 * 표 하나로 두면 종류를 새로 만들 때 여기 한 줄을 빠뜨릴 수가 없습니다.
 */
const KINDS = [
  { kind: 'action',  label: '빠른 실행' },
  { kind: 'task',    label: '업무' },
  { kind: 'project', label: '프로젝트' },
  { kind: 'space',   label: '스페이스' },
  { kind: 'link',    label: '붙여 둔 자료' },
  { kind: 'note',    label: '데일리 노트' },
  { kind: 'drive',   label: '드라이브' },
  { kind: 'notion',  label: '노션' },
] as const

type Kind = typeof KINDS[number]['kind']

type Item = {
  id: string
  kind: Kind
  icon: string
  label: string
  sub?: string
  hint?: string
  /** 드라이브 문서의 본문 한 조각. 내용으로 걸린 결과에만 붙습니다. */
  snippet?: Snippet | null
  /** 그 조각을 아직 가져오는 중. null(영영 없음)과 구별해야 합니다. */
  snippetLoading?: boolean
  accentColor?: string
  onSelect: () => void
}

export function CommandPalette() {
  const {
    isCommandPaletteOpen, closeCommandPalette,
    openTaskModal, setView, setScreen, setSpace, setProject, setDetailTaskId, openNote,
    openCalendar,
  } = useUiStore(useShallow(s => ({ isCommandPaletteOpen: s.isCommandPaletteOpen, closeCommandPalette: s.closeCommandPalette, openTaskModal: s.openTaskModal, setView: s.setView, setScreen: s.setScreen, setSpace: s.setSpace, setProject: s.setProject, setDetailTaskId: s.setDetailTaskId, openNote: s.openNote, openCalendar: s.openCalendar })))
  const tasks = useTaskStore(s => s.tasks)
  const spaces = useSpaceStore(s => s.spaces)
  const projects = useProjectStore(s => s.projects)

  const isMobile = useMobile()
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('')
      setSelectedIdx(0)
      // preventScroll: 폰에서 이 창은 화면 위쪽에 붙어 있는데, 기본 focus는
      // 뒤에 있는 본문까지 스크롤시켜 판이 한 번 덜컹거립니다.
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 20)
    }
  }, [isCommandPaletteOpen])

  useEffect(() => { setSelectedIdx(0) }, [query])

  /**
   * 노트에서 찾기.
   *
   * 업무·프로젝트는 이미 메모리에 있어 즉시 걸러지지만 노트는 DB에 있습니다.
   * 그래서 여기만 비동기고, 결과가 늦게 와도 목록의 맨 아래에 붙습니다 —
   * 위쪽이 늦게 흔들리면 이미 고르고 있던 줄이 발밑에서 바뀝니다.
   *
   * 팔레트를 열 때마다 캐시를 버립니다. 열고 나서 적은 건 못 찾아도 되지만,
   * 지난번에 열어 둔 뒤로 적은 건 찾을 수 있어야 합니다.
   */
  const email = useAuthStore(s => s.email)
  const [noteHits, setNoteHits] = useState<{ date: string; snippet: string }[]>([])
  const [driveHits, setDriveHits] = useState<DriveSearchResult[]>([])
  const [notionHits, setNotionHits] = useState<NotionHit[]>([])
  const driveConnected = useDriveStore(s => s.wasConnected && !s.needsReconnect)
  const notionConnected = useNotionStore(s => s.linked)
  /**
   * 노트와 드라이브는 **나중에 옵니다.**
   *
   * 업무·프로젝트는 이미 손에 있어서 글자를 치는 즉시 걸러지지만, 저 둘은
   * 물어보러 갑니다. 그 사이 화면이 '결과 없음'이라고 말하고 있었습니다 —
   * 안 온 것을 없는 것으로 읽은 자리이고, 사람은 그 한 마디를 믿고 창을
   * 닫습니다. 실제로는 잠시 뒤에 답이 왔고요.
   */
  const [notesBusy, setNotesBusy] = useState(false)
  const [driveBusy, setDriveBusy] = useState(false)
  const [notionBusy, setNotionBusy] = useState(false)
  const searching = notesBusy || driveBusy || notionBusy
  const snippets = useDriveStore(s => s.snippets)
  const snippetLoading = useDriveStore(s => s.snippetLoading)
  const notionSnips = useNotionStore(s => s.snippets)

  useEffect(() => {
    if (!isCommandPaletteOpen) return
    forgetNotes()
    // 첫 글자를 치기 전에 토큰을 미리 챙겨 둡니다. 이게 없으면 첫 검색만
    // 유독 느리고, 사람은 그 한 번으로 '검색이 느리다'를 배웁니다.
    if (driveConnected) warmDriveAuth()
  }, [isCommandPaletteOpen])

  useEffect(() => {
    const q = query.trim()
    if (!email || q.length < 2) { setNoteHits([]); setNotesBusy(false); return }
    let alive = true
    setNotesBusy(true)
    const timer = setTimeout(() => {
      void searchNotes(email, q)
        .then(hits => { if (alive) setNoteHits(hits) })
        .finally(() => { if (alive) setNotesBusy(false) })
    }, 140)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, email])

  /**
   * 드라이브는 남의 서버라 글자마다 물어볼 수 없습니다.
   *
   * 노트 검색과 같은 박자(140ms 뒤, 두 글자부터)로 묻고, 연결이 안 되어 있으면
   * 아예 묻지 않습니다 — `search`는 조용히 빈 배열을 주도록 되어 있어서 팝업이
   * 뜨거나 로그인 창이 튀어나오는 일은 없습니다.
   */
  useEffect(() => {
    const q = query.trim()
    if (!driveConnected || q.length < 2) { setDriveHits([]); setDriveBusy(false); return }
    let alive = true
    setDriveBusy(true)
    const timer = setTimeout(() => {
      void useDriveStore.getState().search(q)
        // 여섯 줄이면 이름으로 걸린 것만으로 차서, 내용으로 걸린 파일이
        // 화면에 아예 안 섰습니다. 팔레트는 스크롤되는 목록입니다.
        .then(files => { if (alive) setDriveHits(files.slice(0, 12)) })
        .catch(() => { if (alive) setDriveHits([]) })
        .finally(() => { if (alive) setDriveBusy(false) })
      // 노트와 같은 박자로 묻습니다. 260ms였는데, 사람이 손을 멈춘 뒤로
      // 그만큼을 더 기다리는 것이 '느리다'의 대부분이었습니다.
    }, 150)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, driveConnected])

  /**
   * 내용으로 걸린 문서의 본문 한 조각.
   *
   * '내용에 있음'만으로는 눌러 볼지 말지를 못 정합니다 — 어디에, 무슨 문장에
   * 있는지가 그 결정의 절반입니다. 자료 고르는 창이 이미 하고 있던 일이고,
   * 같은 store 함수를 그대로 씁니다.
   */
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || !driveHits.length) return
    useDriveStore.getState().loadSnippets(driveHits, q)
  }, [driveHits, query])

  /**
   * 노션도 남의 서버입니다 — 그리고 한 겹 더 멉니다.
   *
   * 노션 API는 브라우저에서 오는 호출을 막아 두어서, 이 요청은 우리 서버를
   * 거쳐 노션에 갑니다. 그만큼 늦게 오므로 드라이브보다 조금 더 기다렸다
   * 묻습니다 — 대신 지난 검색어로 가던 것은 store가 끊습니다.
   *
   * **제목만 걸립니다.** 노션 검색 API가 본문을 안 봅니다. 본문은 걸린
   * 페이지에 한해 뒤이어 붙습니다(아래 조각 효과).
   */
  useEffect(() => {
    const q = query.trim()
    if (!notionConnected || q.length < 2) { setNotionHits([]); setNotionBusy(false); return }
    let alive = true
    setNotionBusy(true)
    const timer = setTimeout(() => {
      void useNotionStore.getState().search(q)
        .then(hits => { if (alive) setNotionHits(hits) })
        .catch(() => { if (alive) setNotionHits([]) })
        .finally(() => { if (alive) setNotionBusy(false) })
    }, 200)
    return () => { alive = false; clearTimeout(timer) }
  }, [query, notionConnected])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2 || !notionHits.length) return
    useNotionStore.getState().loadSnippets(notionHits, q)
  }, [notionHits, query])

  /**
   * 업무와 프로젝트에 붙여 둔 링크들.
   *
   * 자료 뷰는 '이 프로젝트의 자료'를 봅니다. 여기서는 프로젝트를 몰라도 됩니다 —
   * 이름 일부만 기억나는 상태가 사람이 실제로 자료를 찾는 상태입니다.
   * 같은 주소가 여러 업무에 붙어 있으면 한 줄로 합칩니다.
   */
  const allLinks = useMemo(() => {
    const seen = new Map<string, { link: TaskLink; where: string }>()
    const add = (link: TaskLink | undefined, where: string) => {
      if (!link?.url) return
      if (!seen.has(link.url)) seen.set(link.url, { link, where })
    }
    projects.forEach(p => p.links?.forEach(l => add(l, p.name)))
    tasks.forEach(t => t.links?.forEach(l => add(l, t.name)))
    return [...seen.values()]
  }, [projects, tasks])

  const items: Item[] = useMemo(() => {
    const q = query.trim()
    const result: Item[] = []

    if (!q) {
      result.push({
        id: 'new-task', kind: 'action', icon: '+', label: '새 업무 추가', hint: 'N',
        onSelect: () => { openTaskModal(); closeCommandPalette() },
      })
      // 범위 없는 캘린더 — 사이드바의 그 줄과 같은 곳입니다. 뷰 탭의
      // '캘린더 뷰'(지금 범위를 달력으로)와는 다른 문이라 따로 둡니다.
      result.push({
        id: 'go-calendar', kind: 'action', icon: '📆', label: '캘린더',
        sub: '내 일정 전부',
        onSelect: () => { openCalendar(); closeCommandPalette() },
      })
      VIEW_META.forEach(v => result.push({
        id: `view-${v.id}`, kind: 'action', icon: v.icon, label: v.label,
        // 오늘에 서서 뷰를 고르면 업무 화면으로 데려가야 합니다 — 안 그러면
        // 고른 것이 화면에 나타나지 않아 눌리지 않은 것처럼 보입니다.
        onSelect: () => { setView(v.id); setScreen('work'); closeCommandPalette() },
      }))
    }

    tasks
      .filter(t => fuzzy(t.name, q) || fuzzy(t.cat, q))
      .slice(0, 8)
      .forEach(t => result.push({
        id: t.id, kind: 'task', icon: '📝', label: t.name,
        sub: [t.cat, t.due].filter(Boolean).join(' · '),
        onSelect: () => { setDetailTaskId(t.id); closeCommandPalette() },
      }))

    spaces
      .filter(s => fuzzy(s.name, q))
      .forEach(s => result.push({
        id: s.id, kind: 'space', icon: '●', label: s.name, hint: '스페이스로 이동',
        accentColor: s.color,
        onSelect: () => { setSpace(s.name); closeCommandPalette() },
      }))

    projects
      .filter(p => fuzzy(p.name, q))
      .forEach(p => result.push({
        id: p.id, kind: 'project', icon: '🗂', label: p.name, hint: '프로젝트로 이동',
        accentColor: p.color,
        onSelect: () => { setProject(p.id); closeCommandPalette() },
      }))

    /**
     * 붙여 둔 자료 묶음에 **실제로 세운** 파일들.
     *
     * 아래에서 드라이브 결과를 거를 때 씁니다. 예전에는 '붙여 둔 파일 전부'로
     * 걸렀는데, 이 묶음은 **이름과 메모만** 보고 드라이브 쪽은 **내용까지**
     * 봅니다. 그래서 이름에 없는 낱말이 본문에 있는 파일은 — 붙여 둔 자료라는
     * 이유로 드라이브에서 빠지고, 이름이 안 맞아 여기에도 안 서서, **어느
     * 쪽에도 안 나타났습니다.**
     */
    const shownLinks = new Set<string>()
    if (q) {
      allLinks
        .filter(({ link }) => fuzzy(link.title, q) || (link.note ? fuzzy(link.note, q) : false))
        .slice(0, 6)
        .forEach(({ link, where }) => (link.driveId && shownLinks.add(link.driveId), result.push({
          id: `link-${link.url}`, kind: 'link',
          icon: link.driveId ? fileKind(link.mimeType).icon : '🔗',
          label: link.note || link.title,
          sub: where,
          onSelect: () => { void openExternal(link.url); closeCommandPalette() },
        })))
    }

    noteHits.forEach(h => result.push({
      id: `note-${h.date}`, kind: 'note', icon: '🗓', label: h.snippet,
      sub: noteDayLabel(h.date), hint: '노트로 이동',
      onSelect: () => { openNote(h.date); closeCommandPalette() },
    }))

    // 위에서 **이미 세운** 파일만 뺍니다. 같은 줄이 둘이 되는 것은 막되,
    // 거기 안 선 파일까지 빼면 그건 빼는 게 아니라 잃는 것입니다.
    driveHits
      .filter(f => !shownLinks.has(f.id))
      .forEach(f => result.push({
        id: `drive-${f.id}`, kind: 'drive', icon: fileKind(f.mimeType).icon, label: f.name,
        sub: (f.contentMatch ? snippets[snippetKey(f.id, q)]?.tabTitle : null)
          ? `탭: ${snippets[snippetKey(f.id, q)]!.tabTitle}`
          : f.contentMatch ? '내용에 있음' : fileKind(f.mimeType).label,
        snippet: f.contentMatch ? snippets[snippetKey(f.id, q)] ?? null : null,
        snippetLoading: !!f.contentMatch && !!snippetLoading[snippetKey(f.id, q)],
        /**
         * 찾은 문장이 **그 탭에 있으면 그 탭을 엽니다.**
         *
         * 탭이 열두 개인 문서에서 파일만 열어 주면, 방금 화면에서 읽은 그
         * 문장을 다시 손으로 찾아야 합니다. 자료 고르는 창이 이미 이렇게
         * 하고 있었습니다.
         */
        onSelect: () => {
          const tabId = f.contentMatch ? snippets[snippetKey(f.id, q)]?.tabId : undefined
          void openExternal(
            tabId ? docTabUrl(f.id, tabId) : (f.webViewLink || driveUrl(f.id, f.mimeType)),
          )
          closeCommandPalette()
        },
      }))

    /**
     * 노션 페이지.
     *
     * 부제는 **어디 아래에 있는지**입니다 — 노션에서는 같은 이름의 페이지가
     * 데이터베이스마다 하나씩 있는 일이 흔해서, 제목만으로는 어느 것인지
     * 못 고릅니다. 아이콘도 페이지에 붙여 둔 이모지를 그대로 씁니다: 그게
     * 사람이 노션에서 그 페이지를 알아보는 방법입니다.
     */
    notionHits.forEach(h => result.push({
      id: `notion-${h.id}`, kind: 'notion', icon: h.emoji || '📄', label: h.title,
      sub: h.parent,
      /**
       * 조각은 **찾았을 때만** 자리를 잡습니다.
       *
       * 드라이브는 '내용에 있음'으로 걸린 파일에만 조각을 붙이므로 그 줄에는
       * 반드시 문장이 있습니다. 노션은 제목으로 걸린 것이라 본문에 그 낱말이
       * 없는 줄이 대부분이고, 그런 줄마다 '불러오는 중…' 상자를 세웠다가
       * 없애면 목록이 여섯 번 출렁입니다. 제목은 이미 서 있으니 조각은
       * 덤입니다 — 오면 붙고, 없으면 아무 일도 없습니다.
       */
      snippet: notionSnips[notionKey(h.id, q)] ?? null,
      onSelect: () => { void openExternal(h.url); closeCommandPalette() },
    }))

    // KINDS 순서로 세워 둡니다. 화면의 묶음도 ↑↓가 세는 순서도 이 배열
    // 하나에서 나와야 합니다 — 둘이 따로 정해지면 엔터가 다른 줄을 엽니다.
    const rank = (k: Kind) => KINDS.findIndex(x => x.kind === k)
    return result.sort((a, b) => rank(a.kind) - rank(b.kind))
  }, [query, tasks, spaces, projects, noteHits, driveHits, notionHits, allLinks, snippets, snippetLoading, notionSnips])

  const execute = useCallback(() => {
    items[selectedIdx]?.onSelect()
  }, [items, selectedIdx])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!isCommandPaletteOpen) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, items.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); execute() }
      else if (e.key === 'Escape') closeCommandPalette()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [isCommandPaletteOpen, items.length, execute])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!isCommandPaletteOpen) return null

  // 묶음은 KINDS 순서대로. startIdx는 ↑↓가 세는 순서라 이 순서와 같아야 하고,
  // ordered가 곧 그 순서입니다 — items 자체를 여기서 다시 세워 어긋날 자리를
  // 없앱니다.
  const groups: { label: string; startIdx: number; items: Item[] }[] = []
  let cursor = 0
  KINDS.forEach(({ kind, label }) => {
    const group = items.filter(i => i.kind === kind)
    if (!group.length) return
    groups.push({ label, startIdx: cursor, items: group })
    cursor += group.length
  })

  return (
    <>
      <div
        onClick={closeCommandPalette}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200, backdropFilter: 'blur(4px)' }}
      />
      {/*
        폰에서는 떠 있는 판이 아니라 위에서 내려오는 한 장입니다.

        580px 고정폭은 390pt 화면에서 그냥 밖으로 나갑니다. 그리고 여기서는
        키보드가 올라오면 화면의 절반이 사라지므로, 판을 가운데 띄우는 대신
        위에 붙이고 아래를 키보드에 내줍니다 — dvh는 그 줄어든 높이를
        따라옵니다(vh는 안 따라옵니다).
      */}
      <div data-tour="palette" style={isMobile ? {
        position: 'fixed', top: 0, left: 0, right: 0,
        maxHeight: '88dvh',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'var(--bg)',
        borderBottomLeftRadius: 'var(--r4)', borderBottomRightRadius: 'var(--r4)',
        boxShadow: '0 12px 40px rgba(0,0,0,.32)',
        zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      } : {
        position: 'fixed', top: '14vh', left: '50%', transform: 'translateX(-50%)',
        width: 580, maxHeight: '66vh',
        background: 'var(--bg)', borderRadius: 'var(--r4)',
        boxShadow: '0 32px 80px rgba(0,0,0,.32), 0 0 0 1px var(--bd)',
        zIndex: 201, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* Search row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '11px 14px' : '13px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          {/* 폰에는 ⌘ 키가 없습니다. 여기 있는 이유를 말해 주는 건 돋보기입니다. */}
          {isMobile
            ? <span style={{ color: 'var(--t3)', display: 'flex', flexShrink: 0 }}><Icon name="search" size={17} /></span>
            : <span style={{ fontSize: 15, color: 'var(--t3)', lineHeight: 1, flexShrink: 0, fontWeight: 400 }}>⌘</span>}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={isMobile ? '검색' : '업무 · 프로젝트 · 자료 · 노트 검색...'}
            autoFocus
            /* type="search"가 아니라 text입니다 — 사파리가 자기 ✕를 하나 더
               그려서 우리 것과 나란히 섭니다. 자판 모양만 검색으로 바꿉니다. */
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            /* iOS는 16px보다 작은 입력칸에 커서가 들어가면 화면을 확대합니다 —
               한 번 확대되면 되돌아오지 않아서, 검색 한 번에 앱이 커진 채로
               남습니다. 폰에서만 16px입니다. */
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: isMobile ? 16 : 14, background: 'transparent', color: 'var(--t1)', fontFamily: 'var(--font)' }}
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              aria-label="지우기"
              style={{ border: 'none', background: 'var(--bg3)', color: 'var(--t3)', cursor: 'pointer', fontSize: isMobile ? 14 : 12, borderRadius: 999, width: isMobile ? 28 : 20, height: isMobile ? 28 : 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font)' }}
            >✕</button>
          ) : isMobile ? (
            <button
              onClick={() => { haptic('tap'); closeCommandPalette() }}
              style={{ border: 'none', background: 'transparent', color: 'var(--ac)', cursor: 'pointer', fontSize: 14, fontFamily: 'var(--font)', padding: '4px 2px', flexShrink: 0 }}
            >취소</button>
          ) : (
            <kbd style={kbdStyle}>ESC</kbd>
          )}
        </div>

        {/* Result list */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch', paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : 0 }}>
          {/*
            **아직 안 온 것과 없는 것을 구별합니다.** 노트와 드라이브는 물어보러
            가는 사이 몇 백 밀리초가 비는데, 그동안 '결과 없음'이라고 말하면
            사람은 그 한 마디를 믿고 창을 닫습니다.
          */}
          {items.length === 0 && (
            <div style={{ padding: '36px 16px', textAlign: 'center', fontSize: 13, color: 'var(--t3)' }}
              className={searching ? 'bpp-snippet-loading' : undefined}>
              {searching ? '찾는 중…' : '결과 없음'}
            </div>
          )}

          {groups.map(group => (
            <div key={group.label}>
              <div style={{ padding: '8px 16px 2px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
                {group.label}
              </div>
              {group.items.map((item, i) => {
                const absIdx = group.startIdx + i
                const isSelected = absIdx === selectedIdx
                // 상자는 어느 쪽이든 자리를 잡습니다 — 글이 도착할 때 줄이
                // 안 움직입니다.
                const hasSnippet = !!item.snippet || !!item.snippetLoading
                return (
                  <div
                    key={item.id}
                    data-idx={absIdx}
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIdx(absIdx)}
                    style={{
                      display: 'flex', alignItems: hasSnippet ? 'flex-start' : 'center', gap: 10,
                      // 손가락으로 누를 줄은 44pt 가까이 되어야 옆 줄이 안 눌립니다.
                      padding: isMobile ? '11px 14px' : '7px 16px',
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg3)' : 'transparent',
                      transition: 'background .06s',
                    }}
                  >
                    <span style={{
                      width: 28, height: 28, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 6, fontSize: 13,
                      background: item.accentColor ? item.accentColor + '18' : 'var(--bg2)',
                      color: item.kind === 'space' ? item.accentColor : 'var(--t2)',
                    }}>
                      {item.icon}
                    </span>

                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: isMobile ? 15 : 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.label}
                      </span>
                      {hasSnippet && (
                        <span style={{ ...SNIPPET_BOX, ...(item.snippet ? {} : { color: 'var(--t3)' }) }}
                          className={item.snippet ? 'bpp-snippet' : 'bpp-snippet-loading'}
                        >
                          {item.snippet ? (
                            <>
                              {item.snippet.before}
                              <mark style={{ background: NOTION.yellow.bg, color: NOTION.yellow.text, fontWeight: 600, padding: '0 1px', borderRadius: 2 }}>{item.snippet.match}</mark>
                              {item.snippet.after}
                            </>
                          ) : '내용 불러오는 중…'}
                        </span>
                      )}
                    </span>

                    {/* 조각이 있으면 '내용에 있음'은 중복입니다. 다만 탭
                        이름과 노션의 부모 페이지는 조각이 못 하는 말이라
                        그대로 둡니다. */}
                    {item.sub && (!hasSnippet || item.sub.startsWith('탭: ') || item.kind === 'notion') && (
                      <span style={{ fontSize: isMobile ? 12 : 11, color: 'var(--t3)', flexShrink: 0, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sub}</span>
                    )}

                    {item.hint && !item.sub && !isMobile && (
                      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>{item.hint}</span>
                    )}

                    {/* 골라 놓은 줄에 붙는 ↵는 키보드가 있는 사람에게만
                        뜻이 있습니다. 폰에서는 그냥 누르면 됩니다. */}
                    {isSelected && !isMobile && (
                      <kbd style={{ ...kbdStyle, opacity: .6, flexShrink: 0, marginLeft: 4 }}>↵</kbd>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* 자판 안내는 자판이 있을 때만. 폰에서는 키보드가 올라오는 자리를
            안내문이 차지하고 앉아 결과 한 줄을 밀어냅니다. */}
        {!isMobile && (
          <div style={{ padding: '6px 14px', borderTop: '1px solid var(--bd)', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
            <FooterHint keys={['↑', '↓']} label="이동" />
            <FooterHint keys={['↵']} label="선택" />
            <FooterHint keys={['ESC']} label="닫기" />
          </div>
        )}
      </div>
    </>
  )
}

const kbdStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--t3)',
  background: 'var(--bg2)', border: '1px solid var(--bd)',
  borderRadius: 4, padding: '2px 5px',
}

function FooterHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--t3)' }}>
      {keys.map(k => <kbd key={k} style={kbdStyle}>{k}</kbd>)}
      <span>{label}</span>
    </div>
  )
}

/** 노트 결과의 부제. 며칠 전 것인지가 날짜 자체보다 빨리 읽힙니다. */
function noteDayLabel(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00')
  const diff = Math.round((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  const base = `${d.getMonth() + 1}/${d.getDate()} 노트`
  if (diff === 0) return `오늘 노트`
  if (diff === -1) return `어제 노트`
  if (diff < 0) return `${base} · ${-diff}일 전`
  return base
}

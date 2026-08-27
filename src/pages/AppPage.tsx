import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { useTaskStore } from '../store/taskStore'
import { useGCalStore } from '../store/gcalStore'
import { useProjectStore } from '../store/projectStore'
import { useMilestoneStore } from '../store/milestoneStore'
import { useAuthStore } from '../store/authStore'
import { usePresenceStore } from '../store/presenceStore'
import { useUserProfileStore } from '../store/userProfileStore'
import { useSyncStore } from '../store/syncStore'
import { useOrgStore } from '../store/orgStore'
import { useGearStore } from '../store/gearStore'
import { usePrefsStore } from '../store/prefsStore'
import { useNotionStore } from '../store/notionStore'
import { Welcome } from '../components/modals/Welcome'
import { parseInviteToken, PENDING_TASK_KEY } from '../lib/paths'
import { claimGuestSeats, claimInvitedOrgs, stampProjects, syncRoster } from '../lib/roster'
import { projectsToList } from '../lib/orgListing'
import { useMobile } from '../hooks/useMobile'
import type { Project } from '../types'
import { Sidebar } from '../components/layout/Sidebar'
import { Topbar } from '../components/layout/Topbar'
import { ViewBar } from '../components/layout/ViewBar'
import { TableView } from '../components/views/table'
import { BoardView } from '../components/views/board'
import { CalendarView } from '../components/views/calendar'
import { StatsView } from '../components/views/stats'
import { FilesView } from '../components/views/files'
import { GanttView } from '../components/views/gantt'
import { GearView } from '../components/views/gear'
import { TodayView } from '../components/views/today'
import { TaskModal } from '../components/modals/TaskModal'
import { TaskDetailModal } from '../components/modals/TaskDetailModal'
import { CommandPalette } from '../components/modals/CommandPalette'
import { EmptyState, ScopeEmpty } from '../components/shared/EmptyState'
import { useFilteredTasks } from '../hooks/useFilteredTasks'
import { LoadingRows } from '../components/shared/Loading'
import { Toast } from '../components/shared/Toast'
import { NoticeToast } from '../components/layout/NoticeToast'
import { setNoticeReporter } from '../lib/notify'
import { useToast } from '../components/shared/Toast'
import { useShallow } from 'zustand/react/shallow'

class TaskDetailErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[TaskDetail crash]', err, info)
  }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export function AppPage() {
  const isMobile = useMobile()
  const view = useUiStore(s => s.view)
  const screen = useUiStore(s => s.screen)
  const openTaskDetail = useUiStore(s => s.openTaskDetail)
  const tasks = useTaskStore(s => s.tasks)
  const subscribeWorkspace = useSyncStore(s => s.subscribe)
  const ready = useSyncStore(s => s.ready)
  const orgByProject = useSyncStore(s => s.orgByProject)
  const sidebarHidden = useUiStore(s => s.sidebarHidden)
  const joinProject = useProjectStore(s => s.joinProject)
  const invites = useProjectStore(s => s.invites)
  const projects = useProjectStore(s => s.projects)
  const setProject = useUiStore(s => s.setProject)
  const [invitePending, setInvitePending] = useState<{ project: Project } | null>(null)
  const dismissedInvites = useRef(new Set<string>())
  // Read invite code once at mount; sessionStorage is cleared immediately to avoid replay on refresh
  const pendingInviteRef = useRef((() => {
    const code = sessionStorage.getItem('pending_invite')
    if (code) sessionStorage.removeItem('pending_invite')
    return code
  })())
  const openCommandPalette = useUiStore(s => s.openCommandPalette)
  const isTaskModalOpen = useUiStore(s => s.isTaskModalOpen)
  const undo = useTaskStore(s => s.undo)
  const { uid, displayName, email } = useAuthStore(useShallow(s => ({ uid: s.uid, displayName: s.displayName, email: s.email })))
  const detailTaskId = useUiStore(s => s.detailTaskId)
  const subscribePresence = usePresenceStore(s => s.subscribe)

  // Everything the workspace reads hangs off the signed-in account now: the
  // project list is per-user, and so is the invite inbox.
  useEffect(() => {
    if (!uid) return
    return subscribeWorkspace(uid, email ?? null)
  }, [uid, email])

  // 이 사람이 소개를 봤는지, 어느 업데이트까지 읽었는지. 계정에 붙습니다.
  const subscribePrefs = usePrefsStore(s => s.subscribe)
  useEffect(() => {
    if (!email) return
    return subscribePrefs(email)
  }, [email, subscribePrefs])

  // 조직 — 회의실 목록이 사는 곳. 도메인으로도, 내 색인으로도 찾습니다
  // (도메인 없이 초대만으로 만든 조직은 색인이 유일한 길입니다).
  const subscribeOrg = useOrgStore(s => s.subscribe)
  useEffect(() => {
    if (!email) return
    return subscribeOrg(email, uid)
  }, [email, uid, subscribeOrg])

  // 노션이 붙었는지. 연결 창은 다른 탭에서 끝나므로, 돌아온 것을 이 화면이
  // 아는 방법은 DB의 그 한 줄을 보고 있는 것뿐입니다.
  const subscribeNotion = useNotionStore(s => s.subscribe)
  useEffect(() => {
    if (!uid) return
    return subscribeNotion(uid)
  }, [uid, subscribeNotion])

  /**
   * ── 조직 명단 채우기 ───────────────────────────────────────────────────────
   *
   * docs/tenants.md의 1단계. 화면은 이 명단을 아직 안 읽습니다 — 여기서는
   * 채우기만 합니다.
   *
   * 스크립트로 한 번 돌리지 않고 앱이 합니다. 사람이 들어오고 나가는 건
   * 계속 일어나는 일이라, 한 번 맞춰 놓는 것으로는 곧 다시 틀려집니다.
   * 빠진 것만 적으므로 두 번째부터는 읽기 한 번으로 끝납니다.
   *
   * `ready`를 기다립니다. 프로젝트가 다 오기 전에는 같이 일하는 사람 목록이
   * 실제보다 짧고, 그 짧은 목록으로는 아무도 잘못 적히지 않지만 아무도 안
   * 적히기도 합니다 — 기다렸다 한 번에 하는 편이 낫습니다.
   */
  const membersByProject = useSyncStore(s => s.membersByProject)
  const profiles = useUserProfileStore(s => s.profiles)
  const orgId = useOrgStore(s => s.orgId)
  const orgDomain = useOrgStore(s => s.domain)
  const orgReady = useOrgStore(s => s.ready)
  // 주소를 정렬해 한 줄로 만듭니다. 목록 자체를 의존성에 넣으면 내용이 같아도
  // 참조가 바뀔 때마다 다시 돌아서, 쓸 것이 없는데도 매번 읽으러 갑니다.
  const peerKey = useMemo(() => {
    const uids = new Set<string>()
    for (const members of Object.values(membersByProject)) {
      for (const member of Object.keys(members)) uids.add(member)
    }
    return [...uids]
      .map(u => profiles[u]?.email?.toLowerCase().trim())
      .filter((e): e is string => !!e)
      .sort()
      .join(' ')
  }, [membersByProject, profiles])

  /*
    장비·팀 목록과, 아직 안 끝난 예약.

    화면이 열릴 때가 아니라 여기서 붙습니다 — 설정의 장비 칸과 사이드바
    양쪽이 같은 목록을 봐야 하고, 붙는 자리가 둘이면 하나는 언젠가
    안 붙습니다. 읽는 양은 작습니다: 반납일로 색인해 두어서 지난 예약은
    아예 안 실려 옵니다.
  */
  const subscribeGear = useGearStore(s => s.subscribe)
  useEffect(() => {
    if (!orgId || !ready) return
    return subscribeGear(orgId)
  }, [orgId, ready, subscribeGear])

  useEffect(() => {
    if (!uid || !email || !orgId || !ready) return
    void syncRoster({
      orgId,
      domain: orgDomain,
      uid,
      email,
      peers: peerKey ? peerKey.split(' ') : [],
    })
  }, [uid, email, orgId, orgDomain, ready, peerKey])

  /**
   * ── 프로젝트에 소속 도장 ───────────────────────────────────────────────────
   *
   * 2단계. 사람 다음은 프로젝트입니다. 소속이 안 적힌 것만 골라 적으므로
   * 두 번째부터는 읽기 한 번으로 끝납니다.
   *
   * 아직 아무것도 안 막습니다 — 규칙도 화면도 이 값을 안 봅니다.
   */
  const unstamped = useMemo(
    () => projects.filter(p => !p.orgId).map(p => p.id).sort().join(' '),
    [projects],
  )
  useEffect(() => {
    if (!orgId || !ready || !unstamped) return
    void stampProjects({
      orgId,
      domain: orgDomain,
      projects: projects.map(p => ({ id: p.id, orgId: p.orgId, creatorEmail: p.creatorEmail })),
    })
  }, [orgId, orgDomain, ready, unstamped])

  /**
   * ── 목록에 아직 없는 프로젝트를 올립니다 ──────────────────────────────────
   *
   * 워크스페이스 안의 프로젝트는 목록에 있습니다. 이 규칙이 생기기 전에
   * 만들어진 것들은 올린 적이 없어서 아무에게도 안 보이는데, 만든 사람
   * 화면에는 멀쩡히 있으니 빠졌다는 것조차 안 보입니다.
   *
   * 소속 도장과 같은 방식입니다 — 멤버가 지나가면서 채웁니다. 한 번 채우면
   * `orgProjects`가 늘어나 다음 렌더에서는 빈 목록이 되어 멈춥니다.
   */
  /**
   * ── 어느 캘린더를 보는가는 계정에 붙습니다 ────────────────────────────────
   *
   * 체크는 브라우저 저장소에도 남지만, 데스크톱 앱은 껐다 켜면 그게 비어
   * 있었습니다 — 매번 구독 중인 캘린더가 전부 쏟아졌습니다.
   *
   * **다 오기 전에는 안 건드립니다.** 아직 안 온 `hiddenCalendars`는 빈
   * 배열이고, 빈 배열은 '아무것도 안 껐다'와 똑같이 생겼습니다. 그대로
   * 반영하면 켤 때마다 전부 켜졌다가 잠시 뒤 다시 꺼집니다.
   */
  const prefsReady = usePrefsStore(s => s.ready)
  const hiddenSeen = usePrefsStore(s => s.hiddenSeen)
  const hiddenCalendars = usePrefsStore(s => s.hiddenCalendars)
  const setHiddenCalendars = usePrefsStore(s => s.setHiddenCalendars)
  const calendarCount = useGCalStore(s => s.calendars.length)
  const applyHiddenCalendars = useGCalStore(s => s.applyHiddenCalendars)
  useEffect(() => {
    if (!prefsReady || !calendarCount) return
    if (hiddenSeen) { applyHiddenCalendars(hiddenCalendars); return }
    // 한 번도 적은 적이 없으면, 지금 이 기기의 선택을 계정으로 옮깁니다.
    // 덮어쓰면 이 기능이 생기기 전부터 꺼 두었던 것이 전부 켜집니다.
    if (!email) return
    const { calendars, enabledCalendarIds } = useGCalStore.getState()
    const on = enabledCalendarIds ?? calendars.map(c => c.id)
    setHiddenCalendars(email, calendars.filter(c => !on.includes(c.id)).map(c => c.id))
  }, [prefsReady, hiddenSeen, calendarCount, hiddenCalendars, applyHiddenCalendars, setHiddenCalendars, email])

  const orgProjects = useOrgStore(s => s.orgProjects)
  const listProject = useOrgStore(s => s.listProject)
  const unlisted = useMemo(
    () => (orgId ? projectsToList(projects, orgId, orgProjects) : []),
    [projects, orgId, orgProjects],
  )
  const unlistedKey = unlisted.join(' ')
  useEffect(() => {
    if (!orgId || !ready || !unlistedKey) return
    const byId = new Map(projects.map(p => [p.id, p]))
    for (const id of unlistedKey.split(' ')) {
      const p = byId.get(id)
      if (p) void listProject({ id: p.id, name: p.name, color: p.color, orgId: p.orgId })
    }
    // projects는 매 렌더 새 배열입니다 — 위 목록(unlistedKey)이 곧 그 요약입니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, ready, unlistedKey, listProject])

  /**
   * ── 남의 회사에서는 게스트 자리에 스스로 앉습니다 ─────────────────────────
   *
   * 내 프로젝트 중에 **내 도메인 회사가 아닌 곳** 소속이 있으면, 나는 거기서
   * 외부 협업자입니다. 명단에 없으면 3단계 규칙이 그 프로젝트를 닫아 버리므로,
   * 방금 초대 링크로 들어온 사람이 자기 프로젝트를 못 보게 됩니다.
   *
   * 내 도메인 회사는 **제외합니다.** 거기서는 `syncRoster`가 나를 `member`로
   * 적습니다. 둘 다 '행이 없을 때만' 쓰기 때문에, 안 걸러 내면 어느 쪽이
   * 먼저 닿느냐에 따라 우리 직원이 게스트로 적힐 수 있습니다.
   */
  // 프로젝트가 아니라 **내 색인**에서 읽습니다. 명단에 없어서 프로젝트가
  // 닫힌 사람도 자기 색인은 읽을 수 있고, 그래서 스스로 자리를 앉힐 수
  // 있습니다 — 교착이 여기서 풀립니다(syncStore의 '예비 열쇠').
  const guestOrgs = useMemo(
    () => [...new Set(Object.values(orgByProject).filter(o => o && o !== orgId))].sort().join(' '),
    [orgByProject, orgId],
  )
  useEffect(() => {
    // orgReady를 기다립니다. 어느 워크스페이스에 붙을지 아직 못 정한 동안에는
    // orgId가 null이고, 그러면 위 목록이 **내 회사까지 '남의 것'으로 셉니다.**
    if (!uid || !email || !ready || !orgReady || !guestOrgs) return
    void claimGuestSeats(uid, email, guestOrgs.split(' '))
  }, [uid, email, ready, orgReady, guestOrgs])

  /**
   * ── 초대장에 실려 온 회사 ──────────────────────────────────────────────────
   *
   * 외부 협업자가 자기 회사를 알아내는 유일한 길입니다. 도메인으로 찾는 길은
   * 도메인이 안 맞아 막혀 있고, 명단을 읽으려면 회사 id를 알아야 하는데 그게
   * 바로 묻고 있는 질문입니다.
   *
   * 도메인으로 이미 찾은 사람에게도 돌립니다 — 두 회사에 걸친 사람이 있을 수
   * 있고, 그 경우 도메인은 한쪽만 답합니다.
   */
  const invitedOrgs = useMemo(
    () => [...new Set(Object.values(invites).map(i => i.orgId).filter((o): o is string => !!o))].sort().join(' '),
    [invites],
  )
  useEffect(() => {
    if (!uid || !invitedOrgs) return
    void claimInvitedOrgs(uid, invitedOrgs.split(' '))
  }, [uid, invitedOrgs])

  useEffect(() => {
    if (!uid) return
    const name = displayName ?? email?.split('@')[0] ?? uid
    const unsub = subscribePresence(uid, uid, name)
    return unsub
  }, [uid])

  /**
   * ── 받은 프로젝트가 있는 곳으로 옮겨 갑니다 ────────────────────────────────
   *
   * 초대는 **목적지가 있는 행동**입니다. 그런데 다른 워크스페이스에 서 있는
   * 채로 수락하면, 방금 받은 프로젝트가 사이드바 어디에도 없습니다 — 거르는
   * 규칙대로면 맞는 동작이라 더 헷갈립니다. 수락이 안 먹힌 것처럼 보입니다.
   *
   * **거르는 규칙에 예외를 만들지 않습니다.** '방금 들어온 건 특별히 보여
   * 준다'를 더하면 그 규칙이 또 갈라집니다. 서 있는 곳만 옮깁니다 — 그건
   * 개인 설정이라 싸고, 되돌리기 쉽고, 남에게 아무 영향이 없습니다.
   *
   * **내가 멤버인 곳일 때만** 옮깁니다. 게스트로 들어간 남의 회사는 전환
   * 목록에 없어서 옮겨 봐야 아무 데도 아닌 곳에 서게 되고, 그런 프로젝트는
   * 어차피 어디 서 있든 보입니다. 두 경우 다 맞습니다.
   *
   * 화면이 통째로 바뀌는 일은 이유를 말해야 합니다.
   */
  const goToWorkspace = useCallback((oid?: string) => {
    // 스토어에서 그 자리에 읽습니다. 이 함수를 부르는 곳이 '초대 링크를 들고
    // 처음 켠 순간'이라, 값을 닫아 두면 아직 안 온 email을 붙들게 됩니다.
    const me = useAuthStore.getState().email
    if (!oid || !me) return
    const { orgId: standing, myOrgs } = useOrgStore.getState()
    if (standing === oid) return
    const there = myOrgs.find(o => o.id === oid)
    if (!there) return
    usePrefsStore.getState().setActiveOrg(me, oid)
    useToast.getState().show(`'${there.name}'로 이동했습니다`)
  }, [])

  // Invite link. The token carries the project id as well as the code, because
  // a non-member cannot search the project list to find which project a bare
  // code belongs to.
  useEffect(() => {
    if (!uid || !pendingInviteRef.current) return
    const token = pendingInviteRef.current
    pendingInviteRef.current = null
    const parsed = parseInviteToken(token)
    if (!parsed) return
    let cancelled = false
    joinProject(parsed.projectId, parsed.inviteCode, parsed.orgId).then(joined => {
      if (!joined || cancelled) return
      goToWorkspace(parsed.orgId)
      setProject(parsed.projectId)
    })
    return () => { cancelled = true }
  }, [uid])

  /**
   * ── 공유받은 업무 링크 ─────────────────────────────────────────────────────
   *
   * 첫 그림이 다 온 뒤에(ready) 엽니다. 그 전에 물으면 아직 안 온 것을
   * '없는 것'으로 읽게 되고, 멀쩡한 링크에 대고 "볼 수 없습니다"라고
   * 말하게 됩니다 — 이 앱에서 여러 번 밟은 자리입니다.
   *
   * 못 찾으면 조용히 넘기지 않고 말해 줍니다. 링크를 눌렀는데 평소 화면이
   * 뜨면, 링크가 잘못된 것인지 앱이 무시한 것인지 알 방법이 없습니다.
   * 대개는 그 프로젝트의 멤버가 아니라서입니다 — 링크는 권한을 주지 않습니다.
   */
  useEffect(() => {
    if (!uid || !ready) return
    const wanted = sessionStorage.getItem(PENDING_TASK_KEY)
    if (!wanted) return
    sessionStorage.removeItem(PENDING_TASK_KEY)
    if (tasks.some(t => t.id === wanted)) openTaskDetail(wanted)
    else useToast.getState().show('그 업무를 볼 수 없습니다. 프로젝트 멤버에게 초대를 부탁하세요')
  }, [uid, ready, tasks, openTaskDetail])

  // Invitations waiting in my inbox, for people invited by address rather than
  // by link. The project itself stays unreadable until the invite is accepted,
  // so the name shown here is the copy stored with the invitation.
  useEffect(() => {
    if (invitePending) return
    const entry = Object.entries(invites).find(([pid]) =>
      !projects.some(p => p.id === pid) && !dismissedInvites.current.has(pid)
    )
    if (!entry) return
    const [pid, invite] = entry
    // 소속을 같이 싣습니다. 초대장에는 있는데 여기서 떨어뜨리고 있었고,
    // 그러면 아래 수락이 joinProject에 넘길 것이 없어집니다 — 외부 협업자가
    // 조직 명단에 자기 자리를 못 앉고, 그 프로젝트가 안 열립니다.
    setInvitePending({ project: { id: pid, name: invite.name || '초대받은 프로젝트', color: '#2383E2', inviteCode: invite.code, ...(invite.orgId ? { orgId: invite.orgId } : {}) } })
  }, [invites, projects, invitePending])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable

      /**
       * 검색 — ⌘K와 ⌘F 둘 다.
       *
       * ⌘K가 이 종류의 앱이 쓰는 키입니다(슬랙·노션·리니어·깃허브). 그런데
       * **찾을 때 손이 먼저 가는 건 ⌘F**고, 그건 배워서 그런 게 아니라 삼십 년
       * 동안 모든 프로그램에서 그랬기 때문입니다.
       *
       * ⌘F를 가로채면 브라우저의 '이 페이지에서 찾기'를 잃습니다. 그걸 감수
       * 합니다 — 이 앱에서 찾는 것은 대개 화면에 안 그려져 있는 업무나 문서고,
       * 브라우저 찾기는 그런 것을 못 찾습니다. 노션도 같은 이유로 ⌘F를 자기
       * 검색으로 씁니다.
       */
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault()
        if (!isTaskModalOpen) openCommandPalette()
      }

      /**
       * ⌘\ — 노션과 같은 키입니다. 다른 걸 고르면 새로 외워야 합니다.
       *
       * `e.code`로도 봅니다. 한글 입력 상태에서 이 자리를 누르면 브라우저가
       * 주는 글자가 `\`가 아니라 `₩`입니다 — 글자만 보면 한글로 타이핑하다
       * 누른 사람에게는 단축키가 없는 것과 같습니다. `code`는 자판의 자리를
       * 말하므로 입력기와 무관합니다.
       */
      if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.key === '₩' || e.code === 'Backslash')) {
        e.preventDefault()
        // 왼쪽 칸은 ⌘\, 오른쪽 칸은 ⇧를 더해서. 짝이 되는 두 칸이라 자판에서도
        // 같은 자리를 씁니다.
        if (e.shiftKey) useUiStore.getState().toggleDayRail()
        else useUiStore.getState().toggleSidebarHidden()
      }

      /**
       * ── ⌘Z는 '방금 한 일'을 되돌립니다 ─────────────────────────────────
       *
       * 되돌릴 것이 두 곳에 쌓입니다 — 업무(taskStore)와 캘린더(gcalStore).
       * 되돌리는 방법이 서로 달라서 스토어를 합치지는 않았습니다: 저쪽은 우리
       * DB에 다시 쓰고 이쪽은 구글에 다시 물어봅니다.
       *
       * 대신 둘 다 쌓인 시각을 적어 두고, 여기서 **더 최근 것**을 고릅니다.
       * 스토어 순서로 고르면 방금 옮긴 타임블록 대신 아까 고친 업무가
       * 되돌아가고, 그러면 ⌘Z가 무엇을 되돌릴지 아무도 예측할 수 없습니다.
       */
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !isEditing) {
        e.preventDefault()
        const taskHistory = useTaskStore.getState().history
        const calHistory = useGCalStore.getState().history
        const taskAt = taskHistory[taskHistory.length - 1]?.at ?? -1
        const calAt = calHistory[calHistory.length - 1]?.at ?? -1
        if (calAt > taskAt) void useGCalStore.getState().undoLast()
        else if (taskAt >= 0) undo()
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [isTaskModalOpen, openCommandPalette, undo])

  /**
   * 비어 있음에는 두 가지가 있습니다.
   *
   * 하나는 **이 앱에 업무가 하나도 없는 첫날**이고, 하나는 **지금 이 서랍이
   * 빈 것**입니다('개인'에 아무것도 없는 날처럼). 전에는 앞의 것만 봤고,
   * 뒤의 것은 아무것도 안 그렸습니다 — 필터 바만 남은 검은 판이 되어서,
   * 업무가 없는 것인지 앱이 고장 난 것인지 구별이 안 됐습니다.
   *
   * 다 오기 전에는 어느 쪽도 말하지 않습니다. 아직 안 온 것뿐입니다.
   *
   * 간트·통계·자료는 목록이 비어도 자기 화면이 있어서 빼 둡니다. 캘린더도
   * 달력이 그려져 있으면 고장으로 보이지 않습니다.
   */
  const scoped = useFilteredTasks()
  const listy = view === 't' || view === 'b'
  const firstDay = ready && tasks.length === 0 && view !== 's' && view !== 'g'
  const scopeEmpty = ready && tasks.length > 0 && listy && scoped.length === 0

  // Notices are invisible to the person who sends them — both the ones that
  // land and the ones that do not. The toast is where both are said.
  useEffect(() => {
    setNoticeReporter(message => useToast.getState().show(message))
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* 폰에서는 서랍이라 늘 있어야 합니다 — 없으면 열 것이 없습니다. */}
      {(isMobile || !sidebarHidden) && <Sidebar />}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar />
        {!isMobile && screen === 'work' && <ViewBar />}
        {/* 캘린더 화면은 뷰 탭 없이 거르개만. ViewBar 주석 참고. */}
        {!isMobile && screen === 'calendar' && <ViewBar filtersOnly />}

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {screen === 'today' ? (
            <TodayView />
          ) : !ready ? (
            <LoadingRows />
          ) : screen === 'gear' ? (
            /* 장비 현황. 업무가 하나도 없어도 열려야 하는 화면이라 아래
               빈 상태 분기보다 위에 있습니다 — 장비를 보러 온 사람에게
               '업무를 만들어 보세요'를 보여 줄 이유가 없습니다. */
            <GearView />
          ) : screen === 'calendar' ? (
            /* 범위 없는 캘린더. 뷰 탭의 캘린더와 같은 화면을 그리지만,
               걸린 필터가 없어서 보이는 것이 곧 내 앞의 전부입니다. */
            <CalendarView />
          ) : firstDay ? (
            <EmptyState />
          ) : scopeEmpty ? (
            <ScopeEmpty />
          ) : (
            <>
              {view === 't' && <TableView />}
              {view === 'b' && <BoardView />}
              {view === 'c' && <CalendarView />}
              {view === 'g' && <GanttView />}
              {view === 's' && <StatsView />}
              {view === 'f' && <FilesView />}
            </>
          )}
        </div>

        {/* Bottom tab nav — in normal flow so iOS PWA viewport quirks can't float it */}
        {isMobile && <ViewBar />}
      </div>

      <TaskModal />
      <TaskDetailErrorBoundary key={detailTaskId ?? 'none'}>
        <TaskDetailModal />
      </TaskDetailErrorBoundary>
      <CommandPalette />
      {/* 맨 위에 섭니다 — 처음 온 사람에게 다른 창이 먼저 뜨면 그건 소개가
          아니라 방해입니다. */}
      <Welcome />
      <Toast />
      <NoticeToast />

      {invitePending && (
        <InviteAcceptModal
          project={invitePending.project}
          onAccept={() => {
            const { id, inviteCode, orgId: from } = invitePending.project
            /**
             * 수락한 것도 '다시 안 묻는다'에 넣습니다.
             *
             * 안 넣으면 이 창이 곧바로 다시 뜹니다. 가입이 오가는 동안
             * 초대장은 아직 남아 있고 프로젝트는 아직 안 와서, 위 조건
             * ('초대장에 있고 내 프로젝트에는 없는 것')이 그대로 참입니다.
             * 사람에게는 수락이 안 먹힌 것처럼 보입니다.
             */
            dismissedInvites.current.add(id)
            setInvitePending(null)
            void joinProject(id, inviteCode ?? '', from).then(joined => {
              if (joined) {
                goToWorkspace(from)
                return void setProject(id)
              }
              // 실패하면 말합니다. 조용히 사라지면 수락한 줄 알고 기다립니다.
              dismissedInvites.current.delete(id)
              useToast.getState().show('초대를 수락하지 못했습니다. 초대한 사람에게 다시 부탁해 주세요')
            })
          }}
          onDecline={() => {
            dismissedInvites.current.add(invitePending.project.id)
            setInvitePending(null)
          }}
        />
      )}
    </div>
  )
}

function InviteAcceptModal({ project, onAccept, onDecline }: {
  project: Project
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 'var(--r4)', padding: '32px 28px', width: 360, boxShadow: '0 12px 48px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
        {/* Project icon */}
        <div style={{ width: 48, height: 48, borderRadius: 12, background: project.color, marginBottom: 18 }} />
        <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 6 }}>프로젝트 초대</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', marginBottom: 8, textAlign: 'center' }}>
          {project.name}
        </div>
        <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 28, textAlign: 'center', lineHeight: 1.6 }}>
          이 프로젝트에 초대되었습니다.<br />참여를 수락하시겠어요?
        </div>
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          <button
            onClick={onDecline}
            style={{ flex: 1, padding: '10px 0', borderRadius: 'var(--r2)', border: '1px solid var(--bd)', background: 'transparent', fontSize: 13, fontWeight: 500, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            거절
          </button>
          <button
            onClick={onAccept}
            style={{ flex: 2, padding: '10px 0', borderRadius: 'var(--r2)', border: 'none', background: 'var(--ac)', fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer', fontFamily: 'var(--font)' }}
            onMouseEnter={e => e.currentTarget.style.opacity = '.9'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            참여 수락
          </button>
        </div>
      </div>
    </div>
  )
}

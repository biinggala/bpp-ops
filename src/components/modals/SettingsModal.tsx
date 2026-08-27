import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { setTheme, themeChoice, type ThemeChoice } from '../../lib/theme'
import { haptic } from '../../lib/haptics'
import { useMobile } from '../../hooks/useMobile'
import { useAuthStore } from '../../store/authStore'
import { disablePush, enablePush, pushEnabledHere, pushSupport, showLocalNotice } from '../../lib/push'
import { chimeEnabled, playChime, setChimeEnabled } from '../../lib/chime'
import { fileWatchEnabled, setFileWatchEnabled } from '../../lib/driveWatch'
import { useDriveStore } from '../../store/driveStore'
import { useGCalStore } from '../../store/gcalStore'
import { useMailStore } from '../../store/mailStore'
import { useNotionStore } from '../../store/notionStore'
import { useGearStore } from '../../store/gearStore'
import { gearKinds, groupGear } from '../../lib/gear'
import { PUBLIC_DOMAINS, useOrgStore, pendingJoinCount } from '../../store/orgStore'
import { roomRuleNote } from '../../lib/roomRule'
import { useTrashStore } from '../../store/trashStore'
import { useProjectStore } from '../../store/projectStore'
import { GetDesktopApp } from '../shared/GetDesktopApp'
import { MCP_CONNECTOR_URL } from '../../lib/server'
import { usePrefsStore } from '../../store/prefsStore'
import { LATEST } from '../../lib/whatsNew'
import { askConfirm } from '../shared/Confirm'
import { showTestNotice } from '../layout/NoticeToast'
import { Icon, type IconName } from '../shared/Icon'
import { useShallow } from 'zustand/react/shallow'
import { isComposing } from '../../lib/utils'
import { useUserProfileStore } from '../../store/userProfileStore'
import { useVisibleProjects } from '../../hooks/useVisibleProjects'

/**
 * ── 설정 ─────────────────────────────────────────────────────────────────────
 *
 * Two halves, and the split is *whose it is*. The 내 계정 pages belong to this
 * machine and this account — nobody shares a screen, or the room it is in, or
 * the pocket the phone is in, so none of that goes near the database. The
 * 워크스페이스 pages are the opposite: change one and fifty people see it.
 *
 * The notification switches used to live in the bell's popover, which put
 * settings inside an inbox: you went there to clear notices and found a control
 * panel at the top of the list. The bell is now only the list.
 */

const THEMES: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: 'light', label: '밝게', icon: 'sun' },
  { value: 'dark', label: '어둡게', icon: 'moon' },
  { value: 'system', label: '시스템', icon: 'monitor' },
]

/**
 * ── 설정 ─────────────────────────────────────────────────────────────────────
 *
 * 왼쪽에 항목, 오른쪽에 그 항목만. 한 장에 다 쌓아 두었더니 화면 밝기부터
 * 조직 프로젝트까지 여섯 덩어리가 한 줄로 늘어서서, 뭘 고치러 왔든 스크롤을
 * 먼저 해야 했습니다. **한 번에 한 가지만 보이면 그 한 가지가 짧습니다.**
 *
 * 나뉜 기준은 **누구의 것인가**입니다. 앞의 네 장(일반·알림·연동·휴지통)은 이
 * 기기와 내 계정의 것이고, 뒤의 네 장(개요·멤버·회의실·프로젝트)은 회사가
 * 함께 쓰는 것입니다. 같은 창에 있으면서 하나는 나만의 것이고 하나는 전원의
 * 것이면, 모르고 고치는 사람이 나옵니다 — 그래서 줄로 갈라 놓았습니다.
 *
 * 한 장은 한 가지에 답합니다. '개요'는 이 워크스페이스가 무엇인가, '멤버'는
 * 누가 있는가, '회의실'과 '프로젝트'는 함께 보는 두 목록. 사람 이야기가 개요와
 * 멤버 두 장에 걸쳐 있던 동안에는, 관리자를 해제하는 자리와 자리를 바꾸는
 * 자리가 서로 다른 장에 있었습니다.
 *
 * 폰에서는 왼쪽 대신 위에 가로로 놓습니다. 390pt에서 세로 목록에 132px을
 * 내주면 본문이 250px가 되고, 그건 설정 한 줄이 안 들어가는 폭입니다.
 */

type Page = 'general' | 'notify' | 'link' | 'trash' | 'org' | 'members' | 'rooms' | 'gear' | 'projects'

export function SettingsModal({ onClose, start = 'general' }: {
  onClose: () => void
  /**
   * 어느 장을 펴고 열 것인가.
   *
   * 프로필 메뉴의 '새 워크스페이스'가 이걸 씁니다 — 만드는 자리를 그 메뉴에
   * 옮겨 놓는 대신, 이미 있는 자리를 펴서 보여 줍니다. 같은 일을 하는 화면이
   * 둘이 되면 둘 중 하나는 언젠가 뒤처집니다.
   *
   * `'org-new'`는 장이 아니라 **거기서 무엇을 하려는지**입니다. 개요 장의
   * 만들기 칸은 접혀 있어서, '새 워크스페이스'를 눌러 와도 만들 자리가 안
   * 보였습니다 — 부른 이유를 들고 와야 그 칸이 펴집니다.
   */
  start?: Page | 'org-new'
}) {
  const isMobile = useMobile()
  const [page, setPage] = useState<Page>(start === 'org-new' ? 'org' : start)
  const [openNew] = useState(start === 'org-new')
  const email = useAuthStore(s => s.email)
  const orgId = useOrgStore(s => s.orgId)
  const joinRequests = useOrgStore(s => s.joinRequests)
  const myProjects = useProjectStore(s => s.projects)
  const pending = useMemo(
    () => pendingJoinCount(joinRequests, new Set(myProjects.map(p => p.id))),
    [joinRequests, myProjects],
  )

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  /**
   * ── 왼쪽 목록 ──────────────────────────────────────────────────────────────
   *
   * **내 것과 우리 것을 갈라 놓습니다.** 여덟 줄이 한 덩어리로 서 있으면
   * '이걸 바꾸면 나만 바뀌나, 모두 바뀌나'를 매번 눌러 봐야 압니다. 그 답이
   * 목록의 생김새에 있어야 합니다.
   *
   * 장마다 이름 옆에 한 줄이 붙습니다. 오른쪽 맨 위에 그 장이 무엇에 답하는
   * 화면인지 적기 위해서입니다 — 제목만 있으면 '알림'이 무엇을 말하는지는
   * 눌러서 알아내야 합니다.
   */
  const pages: { id: Page; label: string; note: string; group: string; badge?: number }[] = [
    { id: 'general', label: '일반', group: '내 계정', note: '이 기기에서 보이는 것들. 다른 사람 화면은 안 바뀝니다.' },
    { id: 'notify', label: '알림', group: '내 계정', note: '언제 무엇으로 알릴지. 기기마다 따로 정합니다 — 노트북에서 켠다고 폰이 켜지지는 않습니다.' },
    { id: 'link', label: '연동', group: '내 계정', note: '밖에서 온 것을 알림함과 찾기에 들이는 통로입니다.' },
    { id: 'trash', label: '휴지통', group: '내 계정', note: "지운 업무가 여기 남습니다. 되살리면 원래 프로젝트로, 원래 이름 그대로 돌아옵니다. '영영 지우기'는 되돌릴 수 없습니다." },
    { id: 'org', label: '개요', group: '워크스페이스', note: orgId
      ? '이 워크스페이스 자체 — 이름, 들어오는 방법, 없애는 자리. 사람과 회의실은 아래 각각의 장에 있습니다.'
      : '아직 워크스페이스가 없습니다. 만들면 회의실과 공개 프로젝트 목록, 명단이 생깁니다.' },
    ...(orgId ? [
      { id: 'members' as Page, label: '멤버', group: '워크스페이스', note: '누가 여기 있고 무엇을 할 수 있는지. 관리자·멤버·게스트를 이 한 자리에서 정합니다.' },
      { id: 'rooms' as Page, label: '회의실', group: '워크스페이스', note: '함께 보는 목록입니다. 예약은 전원이 할 수 있고, 목록을 고치는 것은 관리자입니다.' },
      { id: 'gear' as Page, label: '장비', group: '워크스페이스', note: '카메라·렌즈처럼 빌려 나가는 것들. 목록은 관리자가, 예약은 전원이 합니다 — 먼저 잡는 사람이 임자입니다.' },
      { id: 'projects' as Page, label: '프로젝트', group: '워크스페이스', badge: pending, note: '이 워크스페이스에서 만든 프로젝트가 모두 여기 섭니다. 이름만입니다 — 업무 내용은 참여한 뒤에 보입니다.' },
    ] : []),
  ]
  const here = pages.find(p => p.id === page)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(15,15,15,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 12 : 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)',
          border: '1px solid var(--bd)', width: '100%', maxWidth: isMobile ? 520 : 720,
          height: isMobile ? '88vh' : 560, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 18px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <span style={{ color: 'var(--t2)', display: 'flex' }}><Icon name="settings" size={16} /></span>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', flex: 1 }}>설정</div>
          <button
            onClick={onClose}
            style={{
              width: 24, height: 24, borderRadius: 'var(--r1)', border: 'none', background: 'transparent',
              color: 'var(--t3)', fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >✕</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row' }}>
          <div style={{
            flexShrink: 0,
            display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: 1,
            padding: isMobile ? '8px 10px' : '10px 8px',
            width: isMobile ? 'auto' : 176,
            background: isMobile ? 'transparent' : 'var(--bg2)',
            borderRight: isMobile ? 'none' : '1px solid var(--bd)',
            borderBottom: isMobile ? '1px solid var(--bd)' : 'none',
            overflowX: isMobile ? 'auto' : 'visible',
          }}>
            {pages.map((p, i) => (
              <React.Fragment key={p.id}>
                {/* 폰에서는 가로로 흐르는 한 줄이라 묶음 이름을 못 세웁니다 —
                    세로 목록에서만 갈라집니다. */}
                {!isMobile && p.group !== pages[i - 1]?.group && (
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--t3)',
                    padding: '0 9px', margin: i === 0 ? '0 0 4px' : '14px 0 4px',
                  }}>{p.group}</div>
                )}
                <PageTab
                  label={p.label}
                  badge={p.badge}
                  on={page === p.id}
                  wide={!isMobile}
                  onClick={() => setPage(p.id)}
                />
              </React.Fragment>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: isMobile ? '18px 16px 24px' : '26px 28px 28px' }}>
            {here && <PageHead title={here.label} note={here.note} />}
            {page === 'general' && (
              <>
                <Section title="화면 밝기">
                  <ThemeChoiceRow />
                </Section>
                <Section title="안내" note="한 번 보고 닫으면 다시 안 뜹니다. 여기서 언제든 다시 열 수 있습니다.">
                  <ReplayRows onOpen={onClose} />
                </Section>
                {/* 이미 앱으로 보고 있는 사람과 폰에서는 스스로 사라집니다. */}
                <GetDesktopApp />
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6, paddingTop: 12, borderTop: '1px solid var(--bd)', userSelect: 'text' }}>
                  빌드 {__BUILD_ID__}
                </div>
              </>
            )}

            {page === 'notify' && (
              <Section note="켜 두는 것이 기본입니다.">
                <PushRow />
                <ChimeRow />
                <FileWatchRow />
              </Section>
            )}

            {page === 'link' && (
              <>
                <Section title="계정에 붙습니다" note="한 번 해 두면 폰에서도 그대로입니다.">
                  <MailLinkRow />
                  <NotionLinkRow />
                  <ConnectorRow />
                </Section>
                {/*
                  ── 왜 갈라 놓나 ──────────────────────────────────────────
                  구글 것은 **열쇠가 이 브라우저에 삽니다.** 노트북에서 켜도
                  폰에서는 폰에서 한 번 더 눌러야 실제로 됩니다. 위의 것들과
                  섞어 놓으면 한 번 켜면 어디서나 된다고 읽히고, 폰에서 안
                  되는 것이 고장으로 보입니다.
                */}
                <Section title="이 기기에 붙습니다" note="열쇠가 이 브라우저에 살아서, 폰에서는 폰에서 한 번 더 눌러야 합니다.">
                  <GoogleLinkRow which="calendar" />
                  <GoogleLinkRow which="drive" />
                </Section>
              </>
            )}

            {page === 'trash' && <TrashSection />}
            {page === 'org' && <OrgSection openNew={openNew} />}
            {page === 'members' && <MembersPage />}
            {page === 'rooms' && <RoomsSection />}
            {page === 'gear' && <GearSection />}
            {page === 'projects' && <><OrgProjects /><MyProjectMembers /></>}

            {!email && (
              <div style={{ fontSize: 12, color: 'var(--t3)' }}>로그인이 필요합니다</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PageTab({ label, badge, on, wide, onClick }: {
  label: string
  badge?: number
  on: boolean
  wide: boolean
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        width: wide ? '100%' : 'auto', flexShrink: 0,
        padding: wide ? '6px 9px' : '5px 11px',
        borderRadius: 'var(--r1)', border: 'none', cursor: 'pointer',
        fontFamily: 'var(--font)', fontSize: 13, textAlign: 'left',
        fontWeight: on ? 600 : 400,
        color: on ? 'var(--t1)' : 'var(--t2)',
        background: on ? 'var(--bg3)' : hovered ? 'var(--bg2)' : 'transparent',
        whiteSpace: 'nowrap', transition: 'background .1s',
      }}
    >
      {label}
      {/* 승인을 기다리는 요청. 설정을 열지 않아도 알아야 하는 값이라 사이드바
          기어에도 같은 숫자가 붙습니다. */}
      {!!badge && (
        <span style={{
          marginLeft: 'auto', minWidth: 16, height: 16, padding: '0 4px',
          borderRadius: 8, background: 'var(--danger)', color: '#fff',
          fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
    </button>
  )
}

/**
 * ── 한 장의 머리 ────────────────────────────────────────────────────────────
 *
 * 왼쪽에서 고른 것의 이름이 오른쪽 맨 위에 한 번 더 서고, 그 아래 한 줄이
 * 무엇에 답하는 화면인지 말합니다.
 *
 * 전에는 이 자리가 없어서 묶음 제목이 장 제목 노릇을 했습니다. 그래서 장이
 * 하나짜리인 곳('알림')에서는 같은 말이 왼쪽과 오른쪽에 두 번 서고, 여러
 * 묶음이 있는 곳('일반')에서는 장 이름이 아예 없었습니다. 같은 자리가
 * 화면마다 다른 것을 뜻하면 위계가 아니라 그때그때입니다.
 */
function PageHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--t1)', letterSpacing: '-.01em' }}>{title}</div>
      {note && <div style={{ fontSize: 12.5, color: 'var(--t3)', lineHeight: 1.6, marginTop: 5 }}>{note}</div>}
    </div>
  )
}

/**
 * 한 장 안의 묶음.
 *
 * 이름 아래 실선 하나. 줄과 줄 사이에는 선을 안 긋습니다 — 줄마다 선이 있으면
 * 표가 되고, 표는 '어디까지가 한 덩어리인가'를 말해 주지 않습니다. 여백이
 * 줄을 가르고, 선이 묶음을 가릅니다.
 */
function Section({ title, count, note, children }: {
  title?: string
  /** 이름 옆의 숫자. 굵기를 빼서 이름과 같은 층으로 읽히지 않게 합니다. */
  count?: number
  note?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginTop: 26 }}>
      {title && (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 6,
          fontSize: 13, fontWeight: 600, color: 'var(--t1)',
          paddingBottom: 7, borderBottom: '1px solid var(--bd)',
        }}>
          {title}
          {count !== undefined && (
            <span style={{ fontWeight: 400, color: 'var(--t3)' }}>{count}</span>
          )}
        </div>
      )}
      {note && <div style={{ fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.6, marginTop: title ? 9 : 0 }}>{note}</div>}
      {children}
    </div>
  )
}

/**
 * 소개와 업데이트 노트를 다시 여는 두 줄.
 *
 * 저장된 '봤음'은 건드리지 않습니다 — 다시 보겠다는 건 잊었다는 뜻이지
 * 안 봤다는 뜻이 아니고, 되돌려 놓으면 다음에 앱을 켤 때 또 뜹니다.
 * 그래서 이번 한 번만 여는 `replay`를 씁니다.
 *
 * 설정 창은 먼저 닫습니다. 판이 두 장 겹치면 소개를 닫았을 때 설정이 아직
 * 열려 있습니다.
 */
function ReplayRows({ onOpen }: { onOpen: () => void }) {
  const setReplay = usePrefsStore(s => s.setReplay)
  const open = (what: 'intro' | 'whatsNew') => { onOpen(); setReplay(what) }
  return (
    <>
      <ReplayRow title="처음 안내 다시 보기" sub="어디서 무엇을 하는지 네 장" onClick={() => open('intro')} />
      {LATEST && (
        <ReplayRow title="업데이트 노트" sub={`가장 최근: ${LATEST.date}`} onClick={() => open('whatsNew')} />
      )}
    </>
  )
}

function ReplayRow({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
        {title}
        <span style={{ display: 'block', ...ROW_SUB }}>{sub}</span>
      </span>
      <button
        onClick={onClick}
        style={{
          flexShrink: 0, height: 26, padding: '0 10px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)',
        }}
      >
        열기
      </button>
    </div>
  )
}

function ThemeChoiceRow() {
  const [choice, setChoice] = useState<ThemeChoice>(() => themeChoice())
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {THEMES.map(t => {
        const on = choice === t.value
        return (
          <button
            key={t.value}
            onClick={() => { setTheme(t.value); setChoice(t.value); haptic('tap') }}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              padding: '12px 6px 10px', borderRadius: 'var(--r2)', cursor: 'pointer',
              fontFamily: 'var(--font)', fontSize: 12, fontWeight: on ? 600 : 400,
              border: `1px solid ${on ? 'var(--ac)' : 'var(--bd)'}`,
              background: on ? 'var(--ac-l)' : 'transparent',
              color: on ? 'var(--ac)' : 'var(--t2)',
              transition: 'background .1s, color .1s, border-color .1s',
            }}
            onMouseEnter={e => { if (!on) e.currentTarget.style.background = 'var(--bg3)' }}
            onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}
          >
            <Icon name={t.icon} size={19} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/** The switch used by both notification rows, so they cannot drift apart. */
function MiniSwitch({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      role="switch"
      aria-checked={on}
      style={{
        width: 38, height: 22, borderRadius: 999, flexShrink: 0, padding: 2,
        border: 'none', cursor: busy ? 'default' : 'pointer',
        background: on ? 'var(--ac)' : 'var(--bd2)',
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background .15s', opacity: busy ? .6 : 1,
      }}
    >
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'all .15s' }} />
    </button>
  )
}

/**
 * 줄 하나.
 *
 * 왼쪽에 이름과 그 아래 설명, 오른쪽에 그걸 바꾸는 것. 열한 군데가 각자
 * 그리고 있어서 글자 크기가 조금씩 달랐습니다 — 같은 자리가 화면마다 다르면
 * 눈이 매번 다시 재야 합니다.
 */
const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 14,
  padding: '12px 0',
}
/** 줄의 이름. */
const ROW_TITLE: React.CSSProperties = { fontSize: 13, color: 'var(--t1)', lineHeight: 1.4 }
/** 그 아래 한 줄. */
const ROW_SUB: React.CSSProperties = { fontSize: 11.5, color: 'var(--t3)', lineHeight: 1.55, marginTop: 3 }

/**
 * 이 기기에서 푸시 받기.
 *
 * A subscription belongs to one browser on one machine, so this is per-device by
 * nature. It is on wherever it can be — see `autoEnablePush` — and this switch
 * exists for the one device that has not been asked yet, and for turning it off.
 *
 * When it *cannot* work, the reason is written out rather than left as a dead
 * switch: an iPhone that has not been added to the home screen and a desktop
 * shell with no Push API fail for completely different reasons, and 'off' says
 * neither of them.
 */
function PushRow() {
  const isMobile = useMobile()
  const [on, setOn] = useState(pushEnabledHere())
  const [busy, setBusy] = useState(false)
  /** 결과 한 줄. `bad`가 참일 때만 빨갛습니다 — 정상을 빨갛게 칠하지 않습니다. */
  const [error, setError] = useState<{ bad: boolean; text: string } | null>(null)
  const me = useAuthStore(s => s.displayName || s.email?.split('@')[0] || '나')
  const support = pushSupport()

  /**
   * 한 번 눌러 두 가지를 확인합니다 — 따로 실패하기 때문입니다.
   *
   * 배너는 앱이 직접 그립니다. 기기 알림(OS 알림)은 알림 권한과 살아 있는
   * 서비스 워커가 필요하고, 데스크톱 셸에서는 아예 불가능합니다. '알림이 안
   * 와요'라는 말에 둘 중 무엇이 안 됐는지가 답이어야 합니다.
   *
   * **좌표를 안 씁니다.** 전에는 `배너 y=60 h=58 w=330`을 그대로 보여줬습니다.
   * 배너가 안 그려지던 버그를 잡을 때 필요했던 값인데, 그 버그가 끝난 뒤에도
   * 남아서 사용자에게 읽으라고 내밀고 있었습니다. 재기는 계속 하되(그려졌는지
   * 아닌지는 물어봐야 압니다) 말로 옮깁니다.
   *
   * 그리고 **데스크톱에서 기기 알림 실패는 빨간 글씨가 아닙니다.** 그건 이
   * 앱의 정상 상태고, 정상을 빨갛게 칠하면 빨간 글씨를 안 보게 됩니다.
   */
  const runTest = async () => {
    showTestNotice(me, !isMobile)
    const res = await showLocalNotice('테스트 알림', '이게 보이면 기기 알림도 정상입니다')

    await new Promise(r => setTimeout(r, 300))
    const drawn = !!document.querySelector('[data-notice-banner]')

    if (!drawn) {
      setError({ bad: true, text: '화면 배너가 안 떴습니다. 새로고침한 뒤 다시 눌러 주세요.' })
      return
    }
    if (res.ok) {
      setError({ bad: false, text: '배너와 기기 알림 모두 정상입니다.' })
      return
    }
    if (!support.ok) {
      // 데스크톱 앱에서는 배너가 곧 알림입니다. 위 줄이 이미 그렇게 말합니다.
      setError({ bad: false, text: '배너는 정상입니다. 기기 알림은 이 앱에서 원래 안 되고, 앱이 닫혀 있을 때는 폰으로 옵니다.' })
      return
    }
    setError({ bad: true, text: `배너는 떴고, 기기 알림이 실패했습니다 — ${res.reason}` })
  }

  const test = (
    <button
      onClick={() => void runTest()}
      style={{
        fontSize: 11, color: 'var(--ac)', background: 'transparent', border: 'none',
        cursor: 'pointer', fontFamily: 'var(--font)', padding: 0, flexShrink: 0, marginTop: 2,
      }}
    >테스트</button>
  )

  const detail = error && (
    <span style={{ display: 'block', fontSize: 11, marginTop: 3, lineHeight: 1.45, color: error.bad ? 'var(--danger)' : 'var(--t3)' }}>
      {error.text}
    </span>
  )

  // Offered even where push cannot work at all — in the desktop app the banner
  // *is* the notification, and this is the only way to see it without waiting
  // for a colleague to assign something.
  if (!support.ok) {
    return (
      <div style={ROW}>
        <span style={{ flex: 1, minWidth: 0, ...ROW_SUB, marginTop: 0 }}>
          {support.reason}
          {detail}
        </span>
        {test}
      </div>
    )
  }

  const toggle = async () => {
    setBusy(true); setError(null)
    if (on) {
      await disablePush()
      setOn(false)
    } else {
      const res = await enablePush()
      if (res.ok) setOn(true)
      else setError({ bad: true, text: res.reason })
    }
    setBusy(false)
  }

  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
        이 기기에서 푸시 받기
        <span style={{ display: 'block', ...ROW_SUB }}>
          앱이 닫혀 있어도 알림이 옵니다
        </span>
        {detail}
      </span>
      {test}
      <MiniSwitch on={on} busy={busy} onClick={() => void toggle()} />
    </div>
  )
}

/**
 * ── Claude 커넥터 주소 ───────────────────────────────────────────────────────
 *
 * 앱 어디에도 안 적혀 있었습니다. 그래서 붙이려는 사람은 슬랙에 흘러다니는
 * 메시지나 저장소의 README에서 복사했고, 그중 하나가 **틀린 주소**였습니다 —
 * Cloud Run이 한 서비스에 주소를 두 형식으로 주는데 둘 중 로그인이 되는 건
 * 하나뿐입니다. 붙는 것 같다가 `redirect_uri_mismatch`로 막혔고, 화면의 어떤
 * 글자도 그게 주소 문제라고 말해 주지 않았습니다.
 *
 * 이제 앱 안에 있습니다. 복사하는 곳이 하나면 틀린 사본이 돌아다니지 않고,
 * 주소가 바뀌면 여기 한 줄만 고치면 모두가 새것을 복사합니다(lib/server.ts).
 */
function ConnectorRow() {
  const [copied, setCopied] = useState(false)
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', ...ROW_TITLE }}>Claude 커넥터</span>
        <span style={{ display: 'block', ...ROW_SUB }}>
          Claude 설정 › 커넥터에서 이 주소를 넣으면 대화 중에 업무를 읽고 만들 수 있습니다.
        </span>
        {/* 주소 자체를 보여 줍니다. 복사 버튼만 두면 무엇이 복사됐는지
            확인할 방법이 없고, 안 되는 날 물어볼 것도 없습니다. */}
        <span style={{
          display: 'block', marginTop: 6, padding: '5px 7px',
          borderRadius: 'var(--r1)', background: 'var(--bg2)',
          border: '1px solid var(--bd)', fontSize: 11, color: 'var(--t2)',
          wordBreak: 'break-all', userSelect: 'text',
        }}>
          {MCP_CONNECTOR_URL}
        </span>
      </span>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(MCP_CONNECTOR_URL)
            .then(() => setCopied(true))
            .catch(() => {})
        }}
        style={{
          flexShrink: 0, height: 26, padding: '0 10px', borderRadius: 'var(--r1)',
          border: '1px solid var(--bd)', background: 'transparent',
          fontSize: 12, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)',
        }}
      >
        {copied ? '복사했습니다' : '복사'}
      </button>
    </div>
  )
}

/**
 * 메일 연동 — 켜고 끄는 것만.
 *
 * 연결하는 버튼은 받은 알림 목록 안에도 있습니다. 처음 보는 사람은 거기서
 * 만나고, 끊으러 오는 사람은 여기로 옵니다 — 끊는 버튼을 목록에 두면 매일
 * 보는 자리에 매일 안 쓰는 버튼이 있게 됩니다.
 */
function MailLinkRow() {
  const wasConnected = useMailStore(s => s.wasConnected)
  const needsReconnect = useMailStore(s => s.needsReconnect)
  const connecting = useMailStore(s => s.connecting)
  const connect = useMailStore(s => s.connect)
  const disconnect = useMailStore(s => s.disconnect)
  const on = wasConnected && !needsReconnect

  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
        메일
        <span style={{ display: 'block', ...ROW_SUB }}>
          {on
            ? '나에게 물어 왔고 아직 답 안 한 대화만 가져옵니다'
            : '읽기 권한만 받습니다. 메일을 보내거나 지우지 않습니다.'}
        </span>
      </span>
      <MiniSwitch
        on={on}
        busy={connecting}
        onClick={() => { if (on) disconnect(); else void connect() }}
      />
    </div>
  )
}

/**
 * 노션 — 켜면 ⌘K에서 노션 페이지도 같이 찾습니다.
 *
 * 메일과 다른 점 하나를 문구로 말해 둡니다: **내 노션만** 붙습니다. 회사
 * 하나에 열쇠 하나를 두면 그 열쇠로 아무나 아무 페이지나 보게 되므로, 각자
 * 자기 계정을 붙이고 각자가 볼 수 있는 것만 나옵니다. '나만 보는 페이지가
 * 남에게 보이나'가 켜기 전에 드는 생각이고, 답이 여기 있어야 합니다.
 *
 * 연결하는 창은 **다른 탭에서** 끝납니다(데스크톱 앱에서는 진짜 브라우저).
 * 그래서 눌러 놓고 여기 돌아오면 스위치가 저절로 켜져 있습니다 — DB의 한
 * 줄을 보고 있기 때문입니다.
 */
/**
 * ── 구글 캘린더 · 구글 드라이브 ─────────────────────────────────────────────
 *
 * 여기 없었습니다. 켜는 자리가 **처음 안내 화면에만** 있었고, 거기 마지막
 * 줄이 '나중에 설정에서도 할 수 있습니다'라고 말하고 있었습니다 — 지킬 수
 * 없는 말이었습니다. 안내를 한 번 넘기고 나면 다시 켤 데가 없었습니다.
 *
 * **켜졌는지를 `token`만으로 판단하지 않습니다.** 토큰은 한 시간이면
 * 만료되는데, 한 번 켠 사람은 앱이 조용히 다시 받아 옵니다. 토큰만 보면
 * 설정을 한 시간 뒤에 열 때마다 '꺼짐'으로 보이고, 그건 참이 아닙니다.
 * 끊는 것은 `disconnect`가 그 기록까지 지웁니다.
 */
function GoogleLinkRow({ which }: { which: 'calendar' | 'drive' }) {
  const drive = useDriveStore(useShallow(s => ({
    token: s.token, was: s.wasConnected, connecting: s.connecting, error: s.error,
    connect: s.connect, disconnect: s.disconnect,
  })))
  // 캘린더 쪽은 '연결 중'이라는 이름의 값이 없습니다. 조용히 다시 붙는 중과
  // 목록을 읽는 중 둘을 합쳐서 씁니다 — 처음 안내 화면이 쓰던 것과 같습니다.
  const cal = useGCalStore(useShallow(s => ({
    token: s.token, was: s.wasConnected, connecting: s.loading || s.autoRefreshing, error: s.error,
    connect: s.connect, disconnect: s.disconnect,
  })))
  const it = which === 'drive' ? drive : cal
  const on = !!it.token || it.was

  const label = which === 'drive' ? '구글 드라이브' : '구글 캘린더'
  const sub = it.error ? it.error
    : it.connecting ? '구글 창에서 허용하면 여기가 켜집니다'
    : on
      ? which === 'drive'
        ? '문서를 업무에 붙이고, 찾기에서 같이 찾습니다'
        : '일정이 하루 화면에 보이고, 회의실을 여기서 잡습니다'
      : which === 'drive'
        ? '내 드라이브만 읽습니다. 공유 상태는 그대로입니다.'
        : '읽기만 합니다. 쓰기는 회의실을 잡을 때 따로 묻습니다.'

  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
        {label}
        <span style={{ display: 'block', ...ROW_SUB, ...(it.error ? { color: 'var(--danger)' } : null) }}>
          {sub}
        </span>
      </span>
      <MiniSwitch
        on={on}
        busy={it.connecting}
        onClick={() => { if (on) it.disconnect(); else void it.connect() }}
      />
    </div>
  )
}

function NotionLinkRow() {
  const available = useNotionStore(s => s.available)
  const checkAvailable = useNotionStore(s => s.checkAvailable)
  useEffect(() => { checkAvailable() }, [checkAvailable])
  const linked = useNotionStore(s => s.linked)
  const workspace = useNotionStore(s => s.workspace)
  const revoked = useNotionStore(s => s.revoked)
  const connecting = useNotionStore(s => s.connecting)
  const error = useNotionStore(s => s.error)
  const connect = useNotionStore(s => s.connect)
  const disconnect = useNotionStore(s => s.disconnect)

  // 아직 안 물어본 동안에도, 열쇠가 없을 때도 줄을 안 세웁니다. 붙어 있는
  // 사람에게는 보여야 하므로 linked가 먼저입니다 — 서버가 잠깐 안 될 때
  // 남의 연결이 화면에서 사라지면 그건 끊긴 것처럼 보입니다.
  if (!linked && available !== true) return null

  const note = error ? error
    : revoked ? '노션에서 연동이 해제됐습니다. 다시 눌러 주세요.'
    : linked ? `${workspace || '내 노션'} · 검색에서 페이지를 같이 찾습니다`
    : connecting ? '노션 창에서 허용하면 여기가 켜집니다'
    : '내 계정으로 붙습니다. 내가 볼 수 있는 페이지만 나옵니다.'

  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
        노션
        <span style={{ display: 'block', ...ROW_SUB, ...(error ? { color: 'var(--danger)' } : null) }}>
          {note}
        </span>
      </span>
      <MiniSwitch
        on={linked}
        busy={connecting}
        onClick={() => { if (linked) void disconnect(); else void connect() }}
      />
    </div>
  )
}

/**
 * ── 첨부 파일이 바뀌었을 때 ─────────────────────────────────────────────────
 *
 * 드라이브가 연결돼 있을 때만 도는 것이라, 여기 스위치는 '한 번 더' 끄는
 * 자리입니다. 온종일 같이 고치는 문서 하나가 붙어 있으면 이 알림만 계속
 * 올라올 수 있고, 그때 끌 데가 있어야 합니다.
 *
 * 문구가 '이 기기에서 확인합니다'인 이유: 알림은 사람에게 남습니다. 폰에서
 * 꺼도 노트북이 켜져 있으면 알림은 옵니다 — 끄는 건 이 기기가 확인하는
 * 일이지 알림을 안 받는 게 아닙니다. 그걸 안 쓰면 거짓말이 됩니다.
 */
function FileWatchRow() {
  const [on, setOn] = useState(fileWatchEnabled())
  const connected = useDriveStore(s => !!s.token || s.wasConnected)
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
        첨부 파일 변경 알림
        <span style={{ display: 'block', ...ROW_SUB }}>
          {connected
            ? '내 업무에 붙인 드라이브 파일을 이 기기에서 확인합니다'
            : '드라이브를 연동해야 확인할 수 있습니다'}
        </span>
      </span>
      <MiniSwitch on={on && connected} onClick={() => { const next = !on; setFileWatchEnabled(next); setOn(next) }} />
    </div>
  )
}

/**
 * 알림 소리 — 배너가 뜰 때만.
 *
 * A push that arrives with the app closed uses the phone's own notification
 * sound; nothing here reaches that, and no web app can choose it.
 */
function ChimeRow() {
  const [on, setOn] = useState(chimeEnabled())
  return (
    <div style={ROW}>
      <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
        알림 소리
        <span style={{ display: 'block', ...ROW_SUB }}>
          앱이 열려 있을 때 배너와 함께
        </span>
      </span>
      <MiniSwitch
        on={on}
        onClick={() => {
          const next = !on
          setChimeEnabled(next); setOn(next)
          // Hearing it is the only way to judge it.
          if (next) playChime()
        }}
      />
    </div>
  )
}


/**
 * ── 워크스페이스 개요 ───────────────────────────────────────────────────────
 *
 * 여기부터는 **다른 사람 화면에도 보이는** 설정입니다. 위의 장들은 다 이 기기
 * 것입니다.
 *
 * 이 장에는 워크스페이스 **자체**만 둡니다 — 이름, 들어오는 방법, 하나 더
 * 만들기, 그리고 없애기. 사람은 '멤버', 방은 '회의실', 공개 목록은
 * '프로젝트'로 나갔습니다. 한 장에 다 있으면 목록이 길어질수록 정작 이
 * 워크스페이스가 무엇인지를 말하는 줄이 스크롤 위로 밀립니다.
 */
/**
 * 워크스페이스를 만드는 자리.
 *
 * **첫 번째든 두 번째든 같은 화면입니다.** 예전에는 소속이 없을 때만 그렸는데,
 * 그러면 하나가 생기는 순간 만드는 길이 사라집니다 — 전환은 있는데 만들 수가
 * 없어서, 두 번째 워크스페이스가 생길 방법이 남의 초대뿐이었습니다.
 */
function MakeWorkspace({ email, myDomain, domainTaken }: {
  email: string
  myDomain: string
  /** 내 도메인의 워크스페이스가 이미 있는가. 한 도메인에 하나뿐입니다. */
  domainTaken: boolean
}) {
  const { createOrg, createInviteOrg, error } = useOrgStore(useShallow(s => ({
    createOrg: s.createOrg, createInviteOrg: s.createInviteOrg, error: s.error,
  })))
  const [orgName, setOrgName] = useState('')
  const [busy, setBusy] = useState(false)

  /*
    만드는 방법이 둘이고, **나중에 못 바꿉니다** — 도메인은 한 번 정해지면 그
    워크스페이스의 벽이라, 뒤늦게 붙이거나 떼면 이미 들어와 있는 사람의 소속이
    통째로 흔들립니다. 그래서 고르는 자리에서 차이를 다 말해 줍니다.

    회사 주소가 아닌 사람에게 도메인 쪽을 눌러 보게 두지 않습니다. 지메일로
    만들면 이 앱을 쓰는 **모든 지메일 사용자**가 한 워크스페이스가 되는데,
    그건 눌러 보고 알 일이 아닙니다.
  */
  const publicDomain = PUBLIC_DOMAINS.has(myDomain.toLowerCase())
  const domainOff = publicDomain || domainTaken
  const card: React.CSSProperties = {
    flex: 1, minWidth: 0, textAlign: 'left', padding: '10px 12px',
    border: '1px solid var(--bd)', borderRadius: 'var(--r2)', background: 'transparent',
    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3,
  }
  const make = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    if (await fn()) setOrgName('')
    setBusy(false)
  }

  return (
    <>
      <input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="워크스페이스 이름 (예: 블랙페이퍼)" style={{ ...INPUT, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => make(() => createOrg(orgName, email))}
          disabled={busy || !orgName.trim() || domainOff}
          style={{ ...card, opacity: busy || !orgName.trim() || domainOff ? .45 : 1, cursor: domainOff ? 'not-allowed' : 'pointer' }}
        >
          <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>회사 도메인으로</span>
          <span style={{ fontSize: 11, color: 'var(--t3)', wordBreak: 'keep-all' }}>
            {publicDomain
              ? `@${myDomain} 같은 개인 주소는 같은 회사를 뜻하지 않아서 쓸 수 없습니다.`
              : domainTaken
                ? `@${myDomain} 는 이미 워크스페이스가 있습니다. 한 도메인에 하나입니다.`
                : `@${myDomain} 로 로그인한 사람은 초대 없이 들어옵니다.`}
          </span>
        </button>
        <button
          onClick={() => make(() => createInviteOrg(orgName, email))}
          disabled={busy || !orgName.trim()}
          style={{ ...card, opacity: busy || !orgName.trim() ? .45 : 1 }}
        >
          <span style={{ fontSize: 13, color: 'var(--t1)', fontWeight: 600 }}>초대로만</span>
          <span style={{ fontSize: 11, color: 'var(--t3)', wordBreak: 'keep-all' }}>
            도메인을 안 씁니다. 부른 사람만 들어옵니다. 개인 주소를 쓰는 팀이라면 이쪽입니다.
          </span>
        </button>
      </div>
      {busy && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>만드는 중…</div>}
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </>
  )
}

function OrgSection({ openNew = false }: { openNew?: boolean }) {
  const email = useAuthStore(s => s.email)
  const { orgId, name, domain, admins, ready } = useOrgStore(useShallow(s => ({
    orgId: s.orgId, name: s.name, domain: s.domain, admins: s.admins, ready: s.ready,
  })))
  const [adding, setAdding] = useState(openNew)
  const myDomain = email?.split('@')[1] ?? ''

  if (!email) return null
  if (!ready) return <div style={{ fontSize: 12, color: 'var(--t3)' }}>불러오는 중…</div>

  if (!orgId) {
    return (
      <Section title="새 워크스페이스" note="만든 사람이 첫 관리자가 됩니다. 만드는 방법은 나중에 바꿀 수 없습니다.">
        <MakeWorkspace email={email} myDomain={myDomain} domainTaken={false} />
      </Section>
    )
  }

  const isAdmin = admins.includes(email.toLowerCase())

  return (
    <>
      <Section
        title="지금 있는 곳"
        note={domain
          ? '같은 도메인으로 로그인한 사람이 곧 멤버입니다. 초대도 승인도 없습니다.'
          : '초대로만 들어오는 워크스페이스입니다. 부른 사람만 들어옵니다.'}
      >
        <div style={ROW}>
          <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
            {name || myDomain}
            <span style={{ display: 'block', ...ROW_SUB }}>
              {domain ? `@${domain}` : '초대로만'}
            </span>
          </span>
        </div>
      </Section>

      {/*
        ── 하나 더 만들기 ────────────────────────────────────────────────────
        접어 둡니다. 대부분은 평생 한 번도 안 누르는 버튼이고, 펴 둔 채로
        두면 '지금 이 워크스페이스'를 말해야 할 자리에서 그게 더 커 보입니다.
      */}
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          style={{ ...QUIET, marginTop: 16 }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)' }}
        >+ 새 워크스페이스 만들기</button>
      ) : (
        <Section
          title="새 워크스페이스"
          note="지금 있는 곳은 그대로 두고 하나 더 만듭니다. 만든 뒤에는 왼쪽 위 계정 사진을 눌러 오갑니다."
        >
          <MakeWorkspace email={email} myDomain={myDomain} domainTaken={!!domain && domain.toLowerCase() === myDomain.toLowerCase()} />
        </Section>
      )}

      <DangerZone orgId={orgId} name={name || myDomain} email={email} isAdmin={isAdmin} adminCount={admins.length} />
    </>
  )
}

/**
 * ── 지우는 단추 ──────────────────────────────────────────────────────────────
 *
 * **손이 그 줄에 왔을 때만 보입니다.** 스무 줄짜리 목록에 × 스무 개가 나란히
 * 서 있으면 그게 목록의 무늬가 되고, 무늬가 되면 눌러도 되는 것처럼 보입니다.
 * 바로 옆이 자주 누르는 자리라 한 칸만 빗나가면 지우는 창이 뜹니다.
 *
 * 보이고 안 보이고는 **CSS가 정합니다**(`.bpp-row:hover .bpp-rowx`). 전에는
 * 화면 폭으로 재서 넘겼는데(창이 좁으면 폰이라고 쳤습니다), 노트북 창을 좁혀
 * 쓰면 늘 보였습니다 — 물어야 하는 것은 폭이 아니라 '이 기기에 hover가
 * 있나'이고, 그건 CSS만 정확히 압니다.
 *
 * 담는 줄에 `bpp-row`를 달아야 합니다.
 */
function RowRemove({ label, onClick }: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="bpp-rowx"
      style={{
        marginLeft: 10, width: 22, height: 22, flexShrink: 0, borderRadius: 'var(--r1)',
        border: 'none', background: 'transparent', color: 'var(--t3)',
        cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, lineHeight: 1,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-l)'; e.currentTarget.style.color = 'var(--danger)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--t3)' }}
      onFocus={e => { e.currentTarget.style.color = 'var(--danger)' }}
      onBlur={e => { e.currentTarget.style.color = 'var(--t3)' }}
    >×</button>
  )
}

/**
 * 멤버냐 게스트냐 — **두 값뿐인 축**이라 목록이 아니라 스위치입니다.
 *
 * 값이 둘이면 고르는 데 두 번(열고 고르기) 걸릴 이유가 없고, 무엇보다
 * 목록에는 **없는 값이 끼어들 자리**가 있습니다. 관리자가 거기 끼어 있어서
 * 한 칸 미끄러지면 워크스페이스를 통째로 내주는 일이 됐습니다.
 */
function RoleToggle({ value, busy, onChange }: {
  value: 'member' | 'guest'
  busy: boolean
  onChange: (next: 'member' | 'guest') => void
}) {
  const options: { key: 'member' | 'guest'; label: string }[] = [
    { key: 'member', label: '멤버' },
    { key: 'guest', label: '게스트' },
  ]
  return (
    <div style={{
      display: 'flex', gap: 2, padding: 2, flexShrink: 0,
      borderRadius: 'var(--r2)', background: 'var(--bg3)',
      opacity: busy ? .5 : 1,
    }}>
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => { if (!busy && o.key !== value) onChange(o.key) }}
          style={{
            padding: '2px 8px', borderRadius: 'var(--r1)', border: 'none',
            fontSize: 11.5, fontFamily: 'var(--font)',
            cursor: busy || o.key === value ? 'default' : 'pointer',
            background: o.key === value ? 'var(--bg)' : 'transparent',
            color: o.key === value ? 'var(--t1)' : 'var(--t3)',
            fontWeight: o.key === value ? 600 : 400,
            boxShadow: o.key === value ? 'var(--sh-sm)' : 'none',
          }}
        >{o.label}</button>
      ))}
    </div>
  )
}

/**
 * ── 워크스페이스 멤버 ───────────────────────────────────────────────────────
 *
 * **프로젝트 초대와 다른 일입니다.** 프로젝트에 부르는 것은 그 프로젝트를
 * 열어 주는 것이고(게스트), 여기서 부르는 것은 워크스페이스 구성원으로
 * 세우는 것입니다 — 회의실을 잡고, 공개된 프로젝트 목록을 보고, 전환 목록에
 * 그곳이 뜹니다.
 *
 * 전에는 둘이 한 손짓이었습니다. 프로젝트에 부르면 워크스페이스 멤버가
 * 됐고, 그래서 **프로젝트 초대 링크를 잘못 누른 사람이 회사 명단에**
 * 들어왔습니다. 지금은 프로젝트 초대가 게스트 자리까지만 만듭니다.
 *
 * 명단은 구독하지 않고 이 화면이 열릴 때 한 번 읽습니다. 오십 명짜리 명단을
 * 늘 듣고 있을 이유가 없고, 보는 자리는 여기 하나뿐입니다.
 *
 * ── 왜 한 장이 됐나 ─────────────────────────────────────────────────────────
 * 관리자 목록이 '관리' 장 위쪽에 따로 있고, 그 아래 멤버 칸에도 '관리자'
 * 묶음이 있었습니다. **같은 사람이 한 화면에 두 번** 서 있었고, 해제는 위에서
 * 되는데 자리 바꾸기는 아래에서 되니 무엇이 어디 있는지는 눌러 봐야 알았습니다.
 * 사람 이야기는 사람 장 하나에 둡니다.
 */
function MembersPage() {
  const me = useAuthStore(s => s.email)
  const { orgId, domain, founder, admins, ready, listMembers, inviteToOrg, removeFromOrg, setAdmin, setOrgRole, error } =
    useOrgStore(useShallow(s => ({
      orgId: s.orgId, domain: s.domain, founder: s.founder, admins: s.admins, ready: s.ready,
      listMembers: s.listMembers, inviteToOrg: s.inviteToOrg, removeFromOrg: s.removeFromOrg,
      setAdmin: s.setAdmin, setOrgRole: s.setOrgRole, error: s.error,
    })))
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  /* 소속팀은 명단과 나란한 이름표입니다 — 여기서 보여 주는 이유는 '누가 어느
     팀인가'를 물을 자리가 명단 말고 없어서입니다. 목록 자체는 장비 장에
     있습니다(거기가 이 이름들이 쓰이는 곳입니다). */
  const { teams, teamOf, setMemberTeam } = useGearStore(useShallow(s => ({
    teams: s.teams, teamOf: s.teamOf, setMemberTeam: s.setMemberTeam,
  })))
  const [rows, setRows] = useState<{ email: string; role: string }[] | null>(null)
  const [mail, setMail] = useState('')
  const [adminMail, setAdminMail] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(() => { void listMembers().then(setRows) }, [listMembers])
  useEffect(reload, [reload])

  /**
   * ── 세 칸으로 나눕니다 ────────────────────────────────────────────────────
   *
   * 한 줄에 섞어 놓고 옆에 작은 글씨로 '게스트'라고 적으면, 스무 명쯤에서
   * 누가 어느 쪽인지 세게 됩니다. 물어보는 것이 '이 사람 뭐지'가 아니라
   * '바깥 사람이 누구지'라서, 그 답이 목록의 생김새에 있어야 합니다.
   *
   * 관리자는 명단의 역할이 아니라 그 위에 얹히는 표시입니다. 그래서 명단에
   * 줄이 없는 관리자도 있을 수 있습니다 — 도메인형에서는 로그인만으로
   * 멤버라 명단에 안 적힐 수 있고, 그 사람이 관리자면 여기서 사라져 버립니다.
   * 명단에 없으면 주소만으로 세웁니다. **안 온 것을 없는 것으로 읽지 않습니다.**
   */
  const groups = useMemo(() => {
    const all = rows ?? []
    const byMail = new Map(all.map(m => [m.email, m]))
    return [
      {
        key: 'admin', label: '관리자',
        note: '회의실 목록과 이 명단, 워크스페이스 이름과 삭제를 고칩니다. 남의 업무가 더 보이지는 않습니다.',
        people: admins.map(mail => byMail.get(mail) ?? { email: mail, role: 'member' }),
      },
      {
        key: 'member', label: '멤버',
        note: '회의실을 잡고, 워크스페이스에 공개된 프로젝트 목록을 봅니다.',
        people: all.filter(m => !admins.includes(m.email) && m.role === 'member'),
      },
      {
        key: 'guest', label: '게스트',
        note: '초대받은 프로젝트만 봅니다. 워크스페이스 목록에는 못 들어옵니다.',
        people: all.filter(m => !admins.includes(m.email) && m.role === 'guest'),
      },
    ]
  }, [rows, admins])

  if (!me) return null
  if (!ready || !orgId) return <div style={{ fontSize: 12, color: 'var(--t3)' }}>불러오는 중…</div>

  const isAdmin = admins.includes(me.toLowerCase())

  const change = async (mail: string, role: 'admin' | 'member' | 'guest') => {
    setBusy(mail)
    const ok = await setOrgRole(mail, role)
    setBusy(null)
    if (ok) reload()
  }

  const drop = async (mail: string) => {
    setBusy(mail)
    const ok = await removeFromOrg(mail)
    setBusy(null)
    if (ok) reload()
  }

  const add = async () => {
    if (!mail.trim() || busy) return
    setBusy('add')
    const ok = await inviteToOrg(mail)
    setBusy(null)
    if (ok) { setMail(''); reload() }
  }

  const raise = async () => {
    if (!adminMail.trim() || busy) return
    setBusy('raise')
    const ok = await setOrgRole(adminMail, 'admin')
    setBusy(null)
    if (ok) { setAdminMail(''); reload() }
  }

  return (
    <>
      {rows === null && <div style={{ ...ROW_SUB, marginTop: 20 }}>불러오는 중…</div>}

      {rows !== null && groups.map(g => (
        <Section key={g.key} title={g.label} count={g.people.length} note={g.note}>
          {g.people.length === 0 && (
            <div style={{ ...ROW_SUB, marginTop: 10 }}>없습니다.</div>
          )}
          {g.people.map(m => {
            /**
             * 만든 사람은 자리를 못 바꿉니다.
             *
             * 규칙이 그 줄을 지키고 있어서 눌러도 거절당하는데, 눌러도 안
             * 되는 것을 눌리게 두면 그건 고장으로 보입니다. 화면과 규칙이
             * 같은 말을 해야 합니다.
             */
            const isFounder = m.email === founder
            const mine = m.email === me.toLowerCase()
            const isAdm = g.key === 'admin'
            // 마지막 한 명이면 아무도 못 내립니다 — 자기 자신도. 내리는
            // 순간 회의실도 명단도 아무도 못 고치는 워크스페이스가 남습니다.
            const last = isAdm && admins.length <= 1
            const name = getNameByEmail(m.email)
            return (
              <div key={m.email} className="bpp-row" style={{ ...ROW, alignItems: 'center' }}>
                <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {name || m.email}
                  {/* 이름을 모르는 사람은 주소가 이름 자리에 섭니다. 아래에
                      또 적으면 같은 글자가 두 줄이 됩니다 — 아직 이 앱을 안
                      켜 본 사람이 대개 여기고, 외부 협업자가 그렇습니다. */}
                  {(name || isFounder || mine) && (
                    <span style={{ display: 'block', ...ROW_SUB }}>
                      {[name ? m.email : null, isFounder ? '만든 사람' : null, mine ? '나' : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>

                {/*
                  ── 관리자는 토글에 안 섞습니다 ─────────────────────────────
                  하나의 드롭다운에 관리자·멤버·게스트를 늘어놓았었습니다.
                  관리자가 멤버 바로 옆에 있어서 한 칸만 미끄러지면 그 사람이
                  워크스페이스 전체를 고칠 수 있게 됐습니다. 되돌릴 수는
                  있지만, **되돌리기 전까지 무슨 일이 있었는지 아무도 모릅니다.**

                  게다가 그건 한 축이 아닙니다. 명단에는 member/guest만 있고
                  관리자는 그 위에 얹히는 별개의 표시입니다.

                  자주 하는 일(멤버↔게스트)은 한 번에, 드문 일(관리자)은
                  칸 아래에서 주소를 적어서. 주소를 적는 그 동작이 곧
                  '이건 다른 일이다'입니다.
                */}
                {isAdmin && isAdm && (
                  last || (isFounder && !mine) ? (
                    <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>
                      {last ? '혼자입니다' : '만든 사람'}
                    </span>
                  ) : (
                    <button
                      /* 표시만 뗍니다. 명단에서는 멤버로 그대로 남습니다 —
                         관리자를 그만두는 것과 워크스페이스를 나가는 것은
                         다른 일입니다. */
                      onClick={async () => {
                        setBusy(m.email)
                        const ok = await setAdmin(m.email, false)
                        setBusy(null)
                        if (ok) reload()
                      }}
                      style={{ ...navBtn, padding: '3px 9px', fontSize: 11, borderColor: 'transparent', color: 'var(--danger)' }}
                    >관리자 해제</button>
                  )
                )}

                {/* 소속은 게스트에게 안 묻습니다 — 바깥 사람이라 우리 팀이
                    없고, 장비도 안 빌립니다. */}
                {teams.length > 0 && m.role !== 'guest' && (
                  <TeamPick
                    value={teamOf[m.email] ?? ''}
                    teams={teams}
                    disabled={!isAdmin && !mine}
                    onChange={t => void setMemberTeam(m.email, t)}
                  />
                )}

                {isAdmin && !isAdm && !isFounder && (
                  <RoleToggle
                    value={m.role === 'guest' ? 'guest' : 'member'}
                    busy={busy === m.email}
                    onChange={next => void change(m.email, next)}
                  />
                )}

                {isAdmin && !isAdm && !isFounder && !mine && (
                  <RowRemove
                    label={`${m.email} 내리기`}
                    onClick={async () => {
                      const ok = await askConfirm({
                        message: `${getNameByEmail(m.email) || m.email} 님을 명단에서 내립니다`,
                        detail: '이 워크스페이스가 안 보이게 됩니다. 다시 들어오려면 새로 불러야 합니다. 참여 중인 프로젝트는 그대로입니다.',
                        confirmLabel: '내리기',
                      })
                      if (ok) void drop(m.email)
                    }}
                  />
                )}
              </div>
            )
          })}

          {/* 세우는 자리는 그 칸 안에 있습니다 — 관리자를 만드는 곳이
              '관리자' 칸 아래인 편이, 화면 어딘가 다른 곳을 가리키는 것보다
              한 걸음 짧습니다. */}
          {isAdmin && g.key === 'admin' && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <input
                value={adminMail}
                onChange={e => setAdminMail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) void raise() }}
                placeholder={domain ? `이메일 (@${domain})` : '이메일 (명단에 있는 사람)'}
                style={INPUT}
              />
              <button onClick={() => void raise()} style={navBtn} disabled={busy === 'raise'}>관리자로</button>
            </div>
          )}

          {/* 도메인형에는 초대가 없습니다 — 로그인하는 순간 멤버라 부를 것이
              없습니다. 그래서 이 칸 자체를 안 그립니다. */}
          {isAdmin && g.key === 'member' && !domain && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <input
                value={mail}
                onChange={e => setMail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) void add() }}
                placeholder="이메일"
                style={INPUT}
              />
              <button onClick={() => void add()} style={navBtn} disabled={busy === 'add'}>부르기</button>
            </div>
          )}
          {g.key === 'member' && domain && (
            <div style={{ ...ROW_SUB, marginTop: 10 }}>
              @{domain} 로 로그인하면 자동으로 멤버가 됩니다. 따로 부를 것이 없습니다.
            </div>
          )}
          {g.key === 'guest' && (
            <div style={{ ...ROW_SUB, marginTop: 10 }}>
              게스트는 사이드바에서 프로젝트에 부르면 생깁니다. 그건 그 프로젝트만 열어 줍니다.
            </div>
          )}
        </Section>
      ))}

      {!isAdmin && rows !== null && (
        <div style={{ ...ROW_SUB, marginTop: 20 }}>
          자리를 바꾸는 것은 관리자입니다. 필요하면 위 관리자에게 말하면 됩니다.
        </div>
      )}
      {error && <div style={{ ...ROW_SUB, color: 'var(--danger)', marginTop: 12 }}>{error}</div>}
    </>
  )
}

/**
 * ── 위험한 칸 ────────────────────────────────────────────────────────────────
 *
 * 두 가지가 여기 있는데, **무게가 다릅니다.**
 *
 *   나가기  나 하나에게만 일어납니다. 되돌리려면 누가 다시 불러야 하지만,
 *           남의 데이터는 그대로입니다. 한 번 묻고 끝냅니다.
 *   삭제    모두에게, 그리고 영영입니다. 이름을 정확히 쳐야 열립니다 —
 *           프로젝트 삭제와 같은 문턱이고, 같은 무게의 일이니 같은 문턱이어야
 *           합니다.
 *
 * 접혀 있습니다. 펴 둔 채로 두면 설정을 훑는 눈에 붉은 글자가 계속 걸리고,
 * 그러면 그게 평범한 줄이 됩니다. 위험한 것은 찾아가서 눌러야 합니다.
 */
function DangerZone({ orgId, name, email, isAdmin, adminCount }: {
  orgId: string; name: string; email: string; isAdmin: boolean; adminCount: number
}) {
  const { leaveOrg, deleteOrg } = useOrgStore(useShallow(s => ({ leaveOrg: s.leaveOrg, deleteOrg: s.deleteOrg })))
  const uid = useAuthStore(s => s.uid)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // 관리자가 나 혼자면 나갈 수 없습니다. 나가는 순간 회의실도 명단도 아무도
  // 못 고치는 워크스페이스가 남습니다 — 남은 사람들에게 떠넘기는 일입니다.
  const lastAdmin = isAdmin && adminCount <= 1

  const leave = async () => {
    if (!uid) return
    const ok = await askConfirm({
      message: `'${name}'에서 나가시겠어요?`,
      detail: '이 워크스페이스의 프로젝트가 안 보이게 됩니다. 다시 들어오려면 관리자가 불러야 합니다.',
      confirmLabel: '나가기',
    })
    if (!ok) return
    setBusy(true)
    const done = await leaveOrg(orgId, email, uid)
    setBusy(false)
    if (!done) setProblem('나가지 못했습니다. 잠시 뒤에 다시 시도해 주세요.')
  }

  const wipe = async () => {
    if (!uid || typed !== name) return
    setBusy(true)
    const result = await deleteOrg(orgId, email, uid)
    setBusy(false)
    setTyped('')
    if (result.ok) return
    if (result.remaining > 0) {
      setProblem(`이 워크스페이스에 프로젝트가 ${result.remaining}개 남아 있습니다. 먼저 지우거나 다른 곳으로 옮겨 주세요.`)
      return
    }
    setProblem(result.error ?? '워크스페이스를 지우지 못했습니다.')
  }

  if (!open) {
    return (
      /* 위의 조용한 줄과 같은 무게로 나란히 서면 둘이 한 묶음으로 읽힙니다.
         하나는 만드는 일이고 하나는 없애는 일이라, 선 하나로 갈라 둡니다. */
      <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid var(--bd)' }}>
        <button
          onClick={() => setOpen(true)}
          style={QUIET}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)' }}
        >워크스페이스 나가기 · 삭제</button>
      </div>
    )
  }

  return (
    <div style={{
      marginTop: 14, border: '1px solid var(--danger)', borderRadius: 'var(--r2)',
      padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', flex: 1 }}>위험</div>
        {/* 열었으면 닫을 수 있어야 합니다. 펼치는 단추를 만들면서 접는 길을
            안 만들면, 잘못 눌렀을 때 나가는 방법이 설정을 통째로 닫는 것뿐
            입니다 — '어제 못 끝낸 것'에서 똑같이 했던 실수입니다. */}
        <button
          onClick={() => { setOpen(false); setTyped(''); setProblem(null) }}
          aria-label="접기"
          style={{
            border: 'none', background: 'transparent', padding: '0 2px',
            cursor: 'pointer', fontSize: 13, color: 'var(--t3)', fontFamily: 'var(--font)',
          }}
        >×</button>
      </div>
      <div style={{ ...ROW_SUB, marginTop: 2, marginBottom: 4 }}>
        아래 둘은 되돌릴 수 없습니다.
      </div>

      <div style={{ ...ROW, alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
          이 워크스페이스에서 나가기
          <span style={{ display: 'block', ...ROW_SUB }}>
            {lastAdmin
              ? '관리자가 나 혼자입니다. 다른 사람을 관리자로 세운 뒤에 나갈 수 있습니다.'
              : '여기 프로젝트가 안 보이게 됩니다. 남의 것은 그대로입니다.'}
          </span>
        </span>
        <button
          onClick={() => void leave()}
          disabled={busy || lastAdmin}
          style={{
            ...navBtn, padding: '4px 12px', fontSize: 12, flexShrink: 0,
            borderColor: 'var(--danger)', color: 'var(--danger)',
            opacity: busy || lastAdmin ? .4 : 1,
            cursor: busy || lastAdmin ? 'default' : 'pointer',
          }}
        >나가기</button>
      </div>

      {isAdmin && (
        <div style={{ ...ROW, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <span style={ROW_TITLE}>
            워크스페이스 삭제
            <span style={{ display: 'block', ...ROW_SUB }}>
              모두에게서 사라집니다. 회의실과 예약, 공개 목록이 같이 없어집니다.
              {' '}<b style={{ color: 'var(--t2)' }}>프로젝트가 하나라도 남아 있으면 지울 수 없습니다</b> —
              워크스페이스가 없어지면 그 프로젝트를 아무도 못 읽게 되기 때문입니다.
            </span>
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e) && typed === name) void wipe() }}
              placeholder={`지우려면 '${name}' 입력`}
              style={INPUT}
            />
            <button
              onClick={() => void wipe()}
              disabled={busy || typed !== name}
              style={{
                ...navBtn, padding: '4px 12px', fontSize: 12, flexShrink: 0,
                borderColor: typed === name ? 'var(--danger)' : 'var(--bd)',
                color: typed === name ? 'var(--danger)' : 'var(--t3)',
                opacity: busy ? .4 : 1,
                cursor: busy || typed !== name ? 'default' : 'pointer',
              }}
            >삭제</button>
          </div>
        </div>
      )}

      {problem && (
        <div style={{ ...ROW_SUB, color: 'var(--danger)', marginTop: 8 }}>{problem}</div>
      )}
    </div>
  )
}

/**
 * ── 회의실 ───────────────────────────────────────────────────────────────────
 *
 * 목록은 관리자만 바꿉니다. **예약은 전원입니다** — 잠글 곳은 목록이지 사용이
 * 아닙니다. 회의실을 쓰려고 관리자에게 부탁해야 한다면 이 기능은 없는 게
 * 낫습니다.
 */
/**
 * ── 장비 ─────────────────────────────────────────────────────────────────────
 *
 * 회의실 칸과 같은 모양입니다. 같은 일을 하는 두 칸이 다르게 생기면, 하나를
 * 고칠 때 다른 하나를 안 고칩니다.
 *
 * 다른 것은 아래 팀 칸 하나입니다. 장비 예약은 '어느 팀이 잡았나'를 보여
 * 줘야 하는데, 그 팀 이름을 정할 자리가 없으면 예약마다 사람이 손으로
 * 타이핑하게 되고, 그러면 '촬영팀'과 '촬영 팀'이 다른 팀이 됩니다.
 */
function GearSection() {
  const email = useAuthStore(s => s.email)
  const { name, domain, admins } = useOrgStore(useShallow(s => ({ name: s.name, domain: s.domain, admins: s.admins })))
  const { gear, addGear, updateGear, removeGear, error, clearError } = useGearStore(useShallow(s => ({
    gear: s.gear, addGear: s.addGear, updateGear: s.updateGear, removeGear: s.removeGear,
    error: s.error, clearError: s.clearError,
  })))
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState('')
  const groups = useMemo(() => groupGear(gear), [gear])
  const kinds = useMemo(() => gearKinds(gear), [gear])
  if (!email) return null
  const isAdmin = admins.includes(email.toLowerCase())

  const add = () => {
    if (!draft.trim()) return
    void addGear(draft, undefined, draftKind)
    setDraft('')
    // 종류는 안 지웁니다. 장비는 대개 한 종류를 여러 개 몰아서 넣습니다 —
    // 조명 여섯 개를 넣는 동안 여섯 번 다시 고르게 하지 않습니다.
  }

  return (
    <>
      <Section
        title={name || domain || '장비'}
        count={gear.length}
        note={isAdmin
          ? '여기서 고치면 모두의 화면이 바뀝니다. 예약 현황은 사이드바의 장비에 있습니다.'
          : '목록은 관리자만 바꿉니다. 예약은 누구나 할 수 있습니다.'}
      >
        {gear.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 8px' }}>
            아직 등록된 장비가 없습니다
          </div>
        )}
        {/* 종류로 묶어 세웁니다. 카메라 넷·렌즈 여섯·조명 여덟이 한 줄로
            늘어서면 목록이 아니라 벽입니다. 묶음이 하나뿐이면 머리글을
            안 답니다 — 하나짜리 묶음의 이름은 아무것도 안 가릅니다. */}
        {groups.map(g => (
          <div key={g.kind}>
            {groups.length > 1 && (
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--t3)',
                margin: '12px 0 2px', display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {g.kind}
                <span style={{ fontWeight: 400 }}>{g.items.length}</span>
              </div>
            )}
            {g.items.map(item => (
              <div key={item.id} className="bpp-row" style={{ ...ROW, opacity: item.active === false ? .5 : 1 }}>
                <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
                  {item.name}
                  {item.note && <span style={{ display: 'block', ...ROW_SUB }}>{item.note}</span>}
                </span>
                {isAdmin ? (
                  <>
                    <KindPick
                      value={item.kind ?? ''}
                      kinds={kinds}
                      onChange={k => void updateGear(item.id, { kind: k || null })}
                    />
                    {/* 수리 중인 카메라는 없는 것이 아니라 지금 못 쓰는 것입니다.
                        끄면 예약 목록에서 사라지고, 지난 예약은 그대로 남습니다. */}
                    <MiniSwitch on={item.active !== false} onClick={() => void updateGear(item.id, { active: item.active === false })} />
                    <RowRemove
                      label={`${item.name} 지우기`}
                      onClick={async () => {
                        const ok = await askConfirm({
                          message: `'${item.name}'을 목록에서 지웁니다`,
                          detail: '지난 예약은 그대로 남습니다. 수리 중이라면 지우지 말고 스위치를 끄세요.',
                          confirmLabel: '지우기',
                        })
                        if (ok) void removeGear(item.id)
                      }}
                    />
                  </>
                ) : item.active === false && <span style={{ fontSize: 11, color: 'var(--t3)' }}>사용 안 함</span>}
              </div>
            ))}
          </div>
        ))}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) add() }}
              placeholder="장비 이름 (예: A7S3 1번기)"
              style={{ ...INPUT, flex: 1 }}
            />
            <KindPick value={draftKind} kinds={kinds} onChange={setDraftKind} placeholder="종류" />
            <button onClick={add} style={navBtn}>추가</button>
          </div>
        )}
        {error && (
          <div onClick={clearError} style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6, cursor: 'pointer' }}>{error}</div>
        )}
      </Section>

      <TeamsSection isAdmin={isAdmin} />
    </>
  )
}

/**
 * ── 팀 ───────────────────────────────────────────────────────────────────────
 *
 * **라벨이지 경계가 아닙니다.** 팀이 다르다고 안 보이는 것은 하나도 없습니다 —
 * 접근은 계속 프로젝트 멤버십만으로 정해집니다. 여기 이름이 하는 일은 장비
 * 현황판에서 '이 카메라는 지금 촬영팀이 들고 있다'를 한 줄로 말하는 것
 * 하나입니다.
 *
 * 지우면 소속은 그대로 남습니다(화면에서만 안 보입니다). 오십 줄을 지우는
 * 쓰기를 걸면 그중 몇은 실패하고, 절반만 지워진 상태가 남습니다.
 */
function TeamsSection({ isAdmin }: { isAdmin: boolean }) {
  const email = useAuthStore(s => s.email)
  const { teams, teamOf, addTeam, renameTeam, removeTeam, setMemberTeam } = useGearStore(useShallow(s => ({
    teams: s.teams, teamOf: s.teamOf, addTeam: s.addTeam, renameTeam: s.renameTeam,
    removeTeam: s.removeTeam, setMemberTeam: s.setMemberTeam,
  })))
  const [draft, setDraft] = useState('')
  const mine = email ? teamOf[email.toLowerCase()] ?? '' : ''

  const add = () => {
    if (!draft.trim()) return
    void addTeam(draft)
    setDraft('')
  }

  return (
    <Section
      title="팀"
      count={teams.length}
      note="장비 예약에 '어느 팀이 잡았는지' 적히는 이름입니다. 보이는 범위와는 상관이 없습니다."
    >
      {teams.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 8px' }}>
          아직 팀이 없습니다{isAdmin ? '' : ' — 관리자가 만듭니다'}
        </div>
      )}
      {teams.map(t => (
        <div key={t.id} className="bpp-row" style={ROW}>
          {isAdmin ? (
            <input
              defaultValue={t.name}
              onBlur={e => { if (e.target.value.trim() && e.target.value !== t.name) void renameTeam(t.id, e.target.value) }}
              onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) e.currentTarget.blur() }}
              style={{ ...INPUT, flex: 1, minWidth: 0, border: '1px solid transparent', background: 'transparent', padding: '2px 4px' }}
            />
          ) : (
            <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>{t.name}</span>
          )}
          {isAdmin && (
            <RowRemove
              label={`${t.name} 지우기`}
              onClick={async () => {
                const ok = await askConfirm({
                  message: `'${t.name}' 팀을 지웁니다`,
                  detail: '지난 예약에 적힌 팀 이름은 그대로 남습니다. 지금 이 팀인 사람들은 소속이 없는 것으로 보입니다.',
                  confirmLabel: '지우기',
                })
                if (ok) void removeTeam(t.id)
              }}
            />
          )}
        </div>
      ))}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !isComposing(e)) add() }}
            placeholder="팀 이름 (예: 촬영팀)"
            style={INPUT}
          />
          <button onClick={add} style={navBtn}>추가</button>
        </div>
      )}

      {/* 내 소속은 내가 답합니다. 관리자 한 명이 오십 명을 채우게 두면
          아무도 안 채웁니다 — 남의 소속은 멤버 장에서 관리자가 고칩니다. */}
      {teams.length > 0 && email && (
        <div style={{ ...ROW, marginTop: 10, borderTop: '1px solid var(--bd)', paddingTop: 12 }}>
          <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
            내 소속
            <span style={{ display: 'block', ...ROW_SUB }}>내가 잡는 예약에 이 이름이 붙습니다.</span>
          </span>
          <TeamPick value={mine} teams={teams} onChange={t => void setMemberTeam(email, t)} />
        </div>
      )}
    </Section>
  )
}

/**
 * ── 종류 고르기 ──────────────────────────────────────────────────────────────
 *
 * 이미 쓴 종류들 + '새 종류…'. 목록만 두면 첫 종류를 못 만들고, 글자 칸만
 * 두면 '조명'과 '조 명'이 다른 묶음이 됩니다. 대부분은 고르는 일이고 가끔이
 * 만드는 일이라, 고르는 쪽이 기본이고 만드는 것은 한 칸 더 들어갑니다.
 */
function KindPick({ value, kinds, onChange, placeholder = '종류 없음' }: {
  value: string
  kinds: string[]
  onChange: (kind: string) => void
  placeholder?: string
}) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')

  if (typing) {
    const done = () => {
      onChange(draft.trim())
      setDraft('')
      setTyping(false)
    }
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={e => {
          if (e.key === 'Enter' && !isComposing(e)) done()
          if (e.key === 'Escape') { setDraft(''); setTyping(false) }
        }}
        placeholder="새 종류"
        style={{ ...INPUT, width: 96, flexShrink: 0, padding: '3px 6px', fontSize: 11.5 }}
      />
    )
  }

  return (
    <select
      value={value}
      onChange={e => {
        if (e.target.value === '\u0000new') { setTyping(true); return }
        onChange(e.target.value)
      }}
      style={{
        ...navBtn, padding: '3px 6px', fontSize: 11.5, flexShrink: 0,
        maxWidth: 104, color: value ? 'var(--t1)' : 'var(--t3)',
      }}
    >
      <option value="">{placeholder}</option>
      {/* 지금 값이 목록에 없으면(다른 사람이 방금 지웠거나 옛 값) 그것도
          세웁니다. 안 세우면 고른 적 없는 값으로 보입니다. */}
      {(kinds.includes(value) || !value ? kinds : [...kinds, value]).map(k => (
        <option key={k} value={k}>{k}</option>
      ))}
      <option value={'\u0000new'}>새 종류…</option>
    </select>
  )
}

function TeamPick({ value, teams, onChange, disabled }: {
  value: string
  teams: { id: string; name: string }[]
  onChange: (teamId: string | null) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value || null)}
      style={{
        ...navBtn, padding: '3px 6px', fontSize: 11.5, flexShrink: 0,
        maxWidth: 120, color: value ? 'var(--t1)' : 'var(--t3)',
      }}
    >
      <option value="">소속 없음</option>
      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  )
}

function RoomsSection() {
  const email = useAuthStore(s => s.email)
  const { name, domain, rooms, admins, addRoom, updateRoom, removeRoom, error } = useOrgStore(useShallow(s => ({ name: s.name, domain: s.domain, rooms: s.rooms, admins: s.admins, addRoom: s.addRoom, updateRoom: s.updateRoom, removeRoom: s.removeRoom, error: s.error })))
  const [roomName, setRoomName] = useState('')
  if (!email) return null
  const isAdmin = admins.includes(email.toLowerCase())

  return (
    <>
    <Section
      title={name || domain || '회의실'}
      count={rooms.length}
      note={isAdmin
        ? '여기서 고치면 모두의 화면이 바뀝니다.'
        : '목록은 관리자만 바꿉니다. 예약은 누구나 할 수 있습니다.'}
    >
      {rooms.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--t3)', padding: '2px 0 8px' }}>
          아직 등록된 회의실이 없습니다
        </div>
      )}
      {rooms.map(room => (
        <div key={room.id} className="bpp-row" style={{ ...ROW, opacity: room.active === false ? .5 : 1 }}>
          <span style={{ flex: 1, minWidth: 0, ...ROW_TITLE }}>
            {room.name}
            {room.note && <span style={{ display: 'block', ...ROW_SUB }}>{room.note}</span>}
          </span>
          {isAdmin ? (
            <>
              {/* 끄기와 지우기는 다른 일입니다. 끄는 것은 '지금은 못 쓴다'(공사
                  중), 지우는 것은 '이런 방은 없다'(오타로 만든 것). 예약이
                  잡을 때의 방 이름을 들고 있으므로 지워도 지난 예약은 읽힙니다. */}
              <MiniSwitch on={room.active !== false} onClick={() => void updateRoom(room.id, { active: room.active === false })} />
              {/* window.confirm은 안 씁니다 — 데스크톱 웹뷰에서 호스트가
                  대화상자를 안 그려주면 항상 false라, 아무도 못 본 확인창이
                  이미 거절돼 있습니다. docs/desktop-updates.md의 그 표. */}
              <RowRemove
                label={`${room.name} 지우기`}
                onClick={async () => {
                  const ok = await askConfirm({
                    message: `'${room.name}'을 목록에서 지웁니다`,
                    detail: '지난 예약은 그대로 남습니다. 잠깐 못 쓰는 것이라면 지우지 말고 스위치를 끄세요.',
                    confirmLabel: '지우기',
                  })
                  if (ok) void removeRoom(room.id)
                }}
              />
            </>
          ) : room.active === false && <span style={{ fontSize: 11, color: 'var(--t3)' }}>사용 안 함</span>}
        </div>
      ))}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && roomName.trim()) { void addRoom(roomName); setRoomName('') } }}
            placeholder="회의실 이름 (예: 대회의실)"
            style={INPUT}
          />
          <button onClick={() => { if (roomName.trim()) { void addRoom(roomName); setRoomName('') } }} style={navBtn}>추가</button>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </Section>

    {/* 방 목록과 나란한 묶음입니다 — 목록 안에 넣으면 방 하나처럼 읽힙니다. */}
    <RoomRuleRow isAdmin={isAdmin} />
    </>
  )
}

/**
 * ── 얼마나 오래 잡을 수 있나 ─────────────────────────────────────────────────
 *
 * 방은 몇 개뿐이고 낮에는 모두가 씁니다. 한 팀이 오전 내내 잡아 두면 나머지는
 * 그날 방이 없습니다 — 그래서 붐비는 시간대에는 한 번에 잡는 길이를 제한합니다.
 *
 * **숫자를 코드에 박아 두지 않습니다.** 방이 열 개인 회사와 두 개인 회사에
 * 같은 두 시간을 물릴 이유가 없고, 붐비는 시간도 회사마다 다릅니다.
 *
 * 재는 것은 회의의 길이가 아니라 **그 시간대를 차지한 만큼**이라, 17시에
 * 시작해 20시에 끝나는 회의는 안 막힙니다. 그 설명을 칸 안에 적어 둡니다 —
 * 안 적으면 '세 시간짜리 회의를 잡았는데 왜 되지?'가 남습니다.
 */
function RoomRuleRow({ isAdmin }: { isAdmin: boolean }) {
  const { rule, rooms, setRoomRule, updateRoom } = useOrgStore(useShallow(s => ({
    rule: s.roomRule, rooms: s.rooms, setRoomRule: s.setRoomRule, updateRoom: s.updateRoom,
  })))
  const [busy, setBusy] = useState(false)

  const save = async (patch: Partial<typeof rule>) => {
    setBusy(true)
    await setRoomRule({ ...rule, ...patch })
    setBusy(false)
  }

  const hours = Array.from({ length: 25 }, (_, h) => h * 60)
  const lengths = [30, 60, 90, 120, 180, 240, 360, 480]
  const label = (m: number) => (m < 60 ? `${m}분` : m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`)

  return (
    <Section
      title="한 번에 잡을 수 있는 길이"
      note={isAdmin
        ? '붐비는 시간대만 제한합니다. 그 시간대를 얼마나 차지하는지로 재기 때문에, 저녁까지 이어지는 긴 회의는 막히지 않습니다.'
        : roomRuleNote(rule)}
    >
      {isAdmin && (
        <>
          <div style={{ ...ROW, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 120, ...ROW_TITLE }}>
              붐비는 시간
              <span style={{ display: 'block', ...ROW_SUB }}>이 시간대 밖은 얼마든지 잡습니다.</span>
            </span>
            <select
              value={rule.from}
              disabled={busy}
              onChange={e => void save({ from: Number(e.target.value) })}
              style={{ ...INPUT, flex: '0 0 auto', width: 84 }}
            >
              {hours.filter(h => h < rule.to).map(h => <option key={h} value={h}>{h / 60}시</option>)}
            </select>
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>–</span>
            <select
              value={rule.to}
              disabled={busy}
              onChange={e => void save({ to: Number(e.target.value) })}
              style={{ ...INPUT, flex: '0 0 auto', width: 84 }}
            >
              {hours.filter(h => h > rule.from).map(h => <option key={h} value={h}>{h / 60}시</option>)}
            </select>
          </div>

          <div style={{ ...ROW, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 120, ...ROW_TITLE }}>
              최대 길이
              <span style={{ display: 'block', ...ROW_SUB }}>그 시간대를 차지할 수 있는 만큼입니다.</span>
            </span>
            <select
              value={rule.maxMinutes}
              disabled={busy}
              onChange={e => void save({ maxMinutes: Number(e.target.value) })}
              style={{ ...INPUT, flex: '0 0 auto', width: 104 }}
            >
              {lengths.map(m => <option key={m} value={m}>{label(m)}</option>)}
            </select>
          </div>

          {/*
            ── 어느 방에 물릴 것인가 ────────────────────────────────────────
            방마다 성격이 다릅니다 — 편집실은 하루 종일 붙잡고 앉아 있는
            자리고, 작은 회의실은 삼십 분씩 돌아가며 씁니다. 하나로 묶으면
            둘 중 하나가 늘 틀립니다.

            규칙 자체를 방마다 따로 두지는 않습니다. 숫자가 방 수만큼 늘면
            '지금 규칙이 뭐지'를 물을 자리가 없어집니다. 붐비는 방들은 한
            규칙, 안 붐비는 방은 제외 — 이 둘이면 대부분이 설명됩니다.
          */}
          {rooms.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
              <div style={{ ...ROW_SUB, marginTop: 0, marginBottom: 4 }}>이 규칙을 적용할 회의실</div>
              {rooms.map(room => {
                const on = !room.noLimit
                return (
                  <label
                    key={room.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={() => void updateRoom(room.id, { noLimit: on })}
                      style={{ accentColor: 'var(--ac)', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ ...ROW_TITLE, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {room.name}
                    </span>
                    {!on && <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>제한 없음</span>}
                  </label>
                )
              })}
            </div>
          )}

          {/* 지금 규칙이 사람 말로 어떻게 읽히는지. 숫자 두 칸을 보고 머릿속에서
              문장을 만들게 하지 않습니다 — 회의실 칸에 실제로 뜰 그 문장입니다. */}
          <div style={{ ...ROW_SUB, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--bd)' }}>
            {roomRuleNote(rule)}
          </div>
        </>
      )}
    </Section>
  )
}

/**
 * ── 워크스페이스의 프로젝트 ──────────────────────────────────────────────────
 *
 * **경계가 아니라 라벨입니다.** 여기 이름이 올라와도 그 프로젝트의 업무는 안
 * 보입니다 — 접근은 계속 프로젝트 멤버십이 정합니다. 이 목록이 답하는 건
 * '우리 회사에 이런 프로젝트가 있고, 들어가려면 누구에게 말하면 되는가'
 * 하나입니다. 새로 들어온 사람이 아무것도 못 보는 문제는 그걸로 풀립니다.
 *
 * 올리는 동작은 없습니다 — 워크스페이스 안에서 만들면 그 순간 여기 섭니다.
 * 따로 올리게 두었더니 올리는 걸 잊은 프로젝트가 아무에게도 안 보였고, 정보가
 * 안 모이는 것이 바로 노션을 접었던 이유였습니다.
 */
/**
 * ── 내 프로젝트에 누가 있나 ──────────────────────────────────────────────────
 *
 * 지금까지는 프로젝트를 하나씩 우클릭해서 멤버 관리를 열어야 알 수 있었습니다.
 * 열 개면 열 번입니다. '이 사람 어디어디 있지'나 '나간 사람이 아직 남아
 * 있나'는 목록을 훑으며 답하는 질문이라, 한 자리에 펼쳐 놓는 편이 맞습니다.
 *
 * **보여 주기만 합니다.** 넣고 빼는 것은 사이드바의 멤버 관리에 그대로
 * 둡니다 — 같은 일을 하는 화면이 둘이 되면 둘 중 하나는 언젠가 뒤처집니다.
 *
 * 여기 서는 것은 **내가 멤버인 프로젝트**뿐입니다. 남의 프로젝트 명단은
 * 애초에 못 읽습니다(규칙). 워크스페이스 전체 목록은 위에 따로 있고, 거긴
 * 이름만 있습니다.
 */
function MyProjectMembers() {
  const projects = useVisibleProjects()
  const getNameByEmail = useUserProfileStore(s => s.getNameByEmail)
  const [open, setOpen] = useState<string | null>(null)

  const live = useMemo(() => projects.filter(p => !p.archived), [projects])
  if (!live.length) return null

  return (
    <Section title="내가 있는 프로젝트" count={live.length} note="여기서는 보기만 합니다. 넣고 빼는 것은 사이드바에서 프로젝트를 우클릭 → 멤버 관리.">
      {live.map(p => {
        const members = p.memberEmails ?? []
        const pending = p.pendingEmails ?? []
        const shown = open === p.id
        return (
          <div key={p.id} style={ROW}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button
                onClick={() => setOpen(shown ? null : p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                  border: 'none', background: 'transparent', padding: 0,
                  cursor: 'pointer', fontFamily: 'var(--font)', textAlign: 'left',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                <span style={{ ...ROW_TITLE, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--t3)', flexShrink: 0 }}>
                  {members.length}{pending.length ? ` · 대기 ${pending.length}` : ''}
                </span>
                <span style={{ fontSize: 8, color: 'var(--t3)', flexShrink: 0, display: 'inline-block', transform: shown ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>
              </button>
              {shown && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {members.map(m => (
                    <div key={m} style={{ ...ROW_SUB, marginTop: 0 }}>
                      {getNameByEmail(m) || m}
                      {getNameByEmail(m) && <span style={{ opacity: .7 }}> · {m}</span>}
                    </div>
                  ))}
                  {/* 초대만 받고 아직 안 들어온 사람. 명단에 있는 것과 실제로
                      들어와 있는 것은 다른 상태고, 안 갈라 놓으면 '초대했는데
                      왜 안 보이지'를 여기서 답할 수 없습니다. */}
                  {pending.map(m => (
                    <div key={m} style={{ ...ROW_SUB, marginTop: 0, opacity: .75 }}>
                      {m} · 수락 대기
                    </div>
                  ))}
                  {!members.length && !pending.length && (
                    <div style={{ ...ROW_SUB, marginTop: 0 }}>나 혼자입니다.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

function OrgProjects() {
  const email = useAuthStore(s => s.email)
  const { orgId, orgProjects, joinRequests, requestJoin, clearJoinRequest, error } = useOrgStore(useShallow(s => ({ orgId: s.orgId, orgProjects: s.orgProjects, joinRequests: s.joinRequests, requestJoin: s.requestJoin, clearJoinRequest: s.clearJoinRequest, error: s.error })))
  const myProjects = useProjectStore(s => s.projects)
  const addMember = useProjectStore(s => s.addMember)
  const displayName = useAuthStore(s => s.displayName)
  const [busy, setBusy] = useState<string | null>(null)

  if (!orgId || !email) return null

  const mine = new Set(myProjects.map(p => p.id))
  const asked = new Set(
    joinRequests.filter(r => r.email === email.toLowerCase()).map(r => r.projectId),
  )

  return (
    <Section
      title="워크스페이스의 프로젝트"
      count={orgProjects.length}
      note="이 워크스페이스에서 만든 프로젝트가 모두 여기 섭니다. 이름만입니다 — 업무는 참여한 뒤에 보입니다."
    >
      {orgProjects.length === 0 && (
        <div style={{ ...ROW_SUB, marginTop: 10 }}>
          아직 프로젝트가 없습니다.
        </div>
      )}

      {orgProjects.map(project => {
        const joined = mine.has(project.id)
        // 이 프로젝트 멤버에게만 요청이 의미가 있습니다 — 승인할 사람이니까요.
        const requests = joined ? joinRequests.filter(r => r.projectId === project.id) : []
        return (
          <div key={project.id} style={{ padding: '2px 0' }}>
            <div style={ROW}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: project.color ?? 'var(--bd2)', flexShrink: 0 }} />
                <span style={{ ...ROW_TITLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.name}
                </span>
              </span>
              {joined ? (
                <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>참여 중</span>
              ) : asked.has(project.id) ? (
                <button
                  onClick={() => void clearJoinRequest(project.id, email)}
                  style={{ ...navBtn, padding: '3px 9px', fontSize: 11, borderColor: 'transparent', color: 'var(--t3)' }}
                >요청함 · 취소</button>
              ) : (
                <button
                  onClick={async () => {
                    setBusy(project.id)
                    await requestJoin(project.id, email, displayName ?? undefined)
                    setBusy(null)
                  }}
                  disabled={busy === project.id}
                  style={{ ...navBtn, padding: '3px 10px', fontSize: 11 }}
                >{busy === project.id ? '…' : '참여 요청'}</button>
              )}
            </div>

            {/*
              승인은 **초대장을 쓰는 것**입니다.

              이미 있는 초대 흐름을 그대로 씁니다 — 승인하면 그 사람의 초대함에
              초대가 놓이고, 그쪽 앱에 초대 창이 뜹니다. 참여 경로를 두 개 만들면
              하나는 언젠가 안 맞게 됩니다.
            */}
            {requests.map(r => (
              <div key={r.email} style={{ ...ROW, paddingLeft: 15, minHeight: 26 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name ? `${r.name} · ${r.email}` : r.email} 참여 요청
                </span>
                <button
                  onClick={async () => { addMember(project.id, r.email); await clearJoinRequest(project.id, r.email) }}
                  style={{ ...navBtn, padding: '2px 9px', fontSize: 11, borderColor: 'var(--ac)', color: 'var(--ac)' }}
                >승인</button>
                <button
                  onClick={() => void clearJoinRequest(project.id, r.email)}
                  style={{ ...navBtn, padding: '2px 8px', fontSize: 11, borderColor: 'transparent', color: 'var(--t3)' }}
                >거절</button>
              </div>
            ))}
          </div>
        )
      })}
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
    </Section>
  )
}

const INPUT: React.CSSProperties = {
  flex: 1, minWidth: 0, boxSizing: 'border-box',
  padding: '5px 8px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'var(--bg2)', color: 'var(--t1)', fontSize: 12.5,
  outline: 'none', fontFamily: 'var(--font)',
}

/**
 * ── 조용한 줄 ────────────────────────────────────────────────────────────────
 *
 * 평생 한 번 누를까 말까 한 것들('새 워크스페이스 만들기', '나가기 · 삭제')이
 * 씁니다. 눌리는 것이되 눈에 먼저 걸리지는 않아야 합니다.
 *
 * `display: block`이 중요합니다. 전에는 `alignSelf: 'flex-start'`만 적어
 * 두었는데 담는 곳이 flex가 아니어서 아무 일도 안 했고, 버튼 둘이 **한 줄에
 * 붙어** '+ 새 워크스페이스 만들기워크스페이스 나가기 · 삭제'로 읽혔습니다.
 * 있지도 않은 부모를 가정한 값이었습니다.
 */
const QUIET: React.CSSProperties = {
  display: 'block', width: 'fit-content', padding: 0,
  border: 'none', background: 'transparent', cursor: 'pointer',
  fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--font)', textAlign: 'left',
}

const navBtn: React.CSSProperties = {
  padding: '5px 12px', borderRadius: 'var(--r1)', border: '1px solid var(--bd)',
  background: 'transparent', color: 'var(--t2)', fontSize: 12,
  cursor: 'pointer', fontFamily: 'var(--font)', flexShrink: 0,
}


/**
 * ── 휴지통 ───────────────────────────────────────────────────────────────────
 *
 * 지운 업무가 여기 머뭅니다. 이 화면을 열 때 한 번 읽습니다 — 늘 켜 두는
 * 목록이 아니라 가끔 찾으러 오는 곳이라, 앱을 켤 때마다 내려받을 이유가
 * 없습니다.
 *
 * 되살리기는 **원래 자리로** 돌아갑니다: 같은 id, 같은 프로젝트. 상위 업무가
 * 이미 사라졌으면 최상위로 올라옵니다 — 없는 부모 밑에 접혀서 어느 목록에도
 * 안 나타나는 것보다 낫습니다.
 */
function TrashSection() {
  const { items, loading, error, load, restore, purge } = useTrashStore(useShallow(s => ({
    items: s.items, loading: s.loading, error: s.error, load: s.load, restore: s.restore, purge: s.purge,
  })))
  const projects = useProjectStore(s => s.projects)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const ids = projects.map(p => p.id).sort().join(' ')

  useEffect(() => { void load(ids ? ids.split(' ') : []) }, [ids])

  const nameOfProject = (pid?: string) => projects.find(p => p.id === pid)?.name ?? '개인'

  if (loading && !items.length) return <div style={{ fontSize: 12, color: 'var(--t3)' }}>불러오는 중…</div>

  return (
    <Section>
      {error && <div style={{ fontSize: 11, color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}
      {!items.length && (
        <div style={{ fontSize: 12, color: 'var(--t3)' }}>비어 있습니다.</div>
      )}
      {items.map(item => (
        <div key={item.path} style={{ ...ROW, alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.task.name || '이름 없음'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
              {nameOfProject(item.projectId)}
              {item.by ? ` · ${item.by}님이 지움` : ''}
              {item.at ? ` · ${new Date(item.at).toLocaleDateString('ko-KR')}` : ''}
            </div>
          </div>
          <button
            onClick={async () => { setBusy(item.path); await restore(item); setBusy(null) }}
            disabled={busy === item.path}
            style={{ ...navBtn, flexShrink: 0, opacity: busy === item.path ? .5 : 1 }}
          >되살리기</button>
          {/*
            영영 지우기는 한 번 더 묻습니다. 여기서 지운 것은 어디에도 안
            남습니다 — 이 앱에서 되돌릴 수 없는 몇 안 되는 동작입니다.
          */}
          <button
            onClick={async () => {
              if (confirming !== item.path) { setConfirming(item.path); return }
              await purge(item)
              setConfirming(null)
            }}
            onBlur={() => setConfirming(c => (c === item.path ? null : c))}
            style={{
              ...navBtn, flexShrink: 0,
              borderColor: confirming === item.path ? 'var(--danger)' : undefined,
              color: 'var(--danger)',
            }}
          >{confirming === item.path ? '정말 지울까요?' : '영영 지우기'}</button>
        </div>
      ))}
    </Section>
  )
}

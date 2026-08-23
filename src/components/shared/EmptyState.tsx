import { useUiStore } from '../../store/uiStore'
import { useSpaceStore } from '../../store/spaceStore'
import { useProjectStore } from '../../store/projectStore'
import { useShallow } from 'zustand/react/shallow'

/**
 * ── 이 범위에 아무것도 없을 때 ───────────────────────────────────────────────
 *
 * 빈 화면과 고장 난 화면은 구별되지 않습니다. '개인'을 눌렀는데 아무것도 없이
 * 검은 판만 남으면, 개인 업무가 없는 것인지 앱이 안 뜬 것인지 알 방법이
 * 없습니다 — 위의 필터 바까지 멀쩡히 있으니 더 그렇습니다.
 *
 * 그래서 **왜 비었는지**까지 말합니다. 거를 것이 걸려 있어서 빈 것과, 애초에
 * 없어서 빈 것은 다음에 할 일이 다릅니다: 앞은 조건을 풀어야 하고 뒤는
 * 하나 만들어야 합니다.
 *
 * 큰 EmptyState(아래)와 다른 물건입니다. 그건 '이 앱에 업무가 하나도 없다'는
 * 첫날의 화면이고, 이건 '지금 이 서랍이 비었다'는 매일의 화면입니다. 매일
 * 보는 화면이 매번 56px 이모지로 축하하면 곧 성가십니다.
 */
export function ScopeEmpty() {
  const { projectId, myTasksOnly, personalOnly, filters, hideCompleted, resetFilters, setHideCompleted, openTaskModal } =
    useUiStore(useShallow(s => ({
      projectId: s.projectId, myTasksOnly: s.myTasksOnly, personalOnly: s.personalOnly,
      filters: s.filters, hideCompleted: s.hideCompleted,
      resetFilters: s.resetFilters, setHideCompleted: s.setHideCompleted,
      openTaskModal: s.openTaskModal,
    })))
  const projects = useProjectStore(s => s.projects)

  const narrowed =
    filters.projects.length > 0 || filters.assignees.length > 0 ||
    filters.statuses.length > 0 || filters.tags.length > 0 ||
    filters.search.trim().length > 0 || hideCompleted

  const projectName = projectId ? projects.find(p => p.id === projectId)?.name : null

  const { title, note } = narrowed
    ? { title: '조건에 맞는 업무가 없습니다', note: '걸어 둔 필터를 풀면 다시 보입니다.' }
    : personalOnly
    ? { title: '개인 업무가 없습니다', note: '프로젝트에 속하지 않은 업무가 여기 쌓입니다. 나만 볼 수 있습니다.' }
    : myTasksOnly
    ? { title: '나에게 온 업무가 없습니다', note: '담당자가 나로 지정된 업무가 여기 모입니다.' }
    : projectName
    ? { title: `${projectName}에 업무가 없습니다`, note: '첫 업무를 만들어 시작하세요.' }
    : { title: '업무가 없습니다', note: '첫 업무를 만들어 시작하세요.' }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 14, padding: 40, textAlign: 'center',
    }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t2)', marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: 'var(--t3)', lineHeight: 1.6, maxWidth: 320 }}>{note}</div>
      </div>
      <button
        onClick={() => {
          if (narrowed) { resetFilters(); setHideCompleted(false) }
          else openTaskModal({ projectId: projectId ?? undefined })
        }}
        style={{
          height: 30, padding: '0 12px', borderRadius: 'var(--r2)',
          border: '1px solid var(--bd)', background: 'transparent',
          color: 'var(--t2)', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font)',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg3)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {narrowed ? '필터 모두 해제' : '새 업무'}
      </button>
    </div>
  )
}

export function EmptyState() {
  const { openTaskModal } = useUiStore(useShallow(s => ({ openTaskModal: s.openTaskModal })))
  const { spaces } = useSpaceStore()
  const hasSpaces = spaces.length > 0

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 28,
      padding: 40,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 56, userSelect: 'none', lineHeight: 1 }}>📋</div>

      {!hasSpaces ? (
        <>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 10 }}>
              시작해볼까요?
            </div>
            <div style={{ fontSize: 14, color: 'var(--t3)', lineHeight: 1.7, maxWidth: 340 }}>
              왼쪽 사이드바에서 <strong style={{ color: 'var(--t2)' }}>스페이스</strong>를 먼저 만들어보세요.<br />
              스페이스는 팀의 업무 카테고리입니다.
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Step n={1} label="사이드바 하단 '스페이스 추가' 클릭" />
            <Arrow />
            <Step n={2} label="스페이스 이름 입력" />
            <Arrow />
            <Step n={3} label="업무 추가로 시작" />
          </div>
        </>
      ) : (
        <>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', marginBottom: 10 }}>
              업무가 없어요
            </div>
            <div style={{ fontSize: 14, color: 'var(--t3)', lineHeight: 1.6 }}>
              첫 번째 업무를 추가해보세요
            </div>
          </div>

          <button
            onClick={() => openTaskModal()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 32px',
              borderRadius: 14,
              background: 'var(--ac)',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(35,131,226,.35)',
              transition: 'transform .12s, box-shadow .12s',
              fontFamily: 'var(--font)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 8px 28px rgba(35,131,226,.4)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(35,131,226,.35)'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            업무 추가
          </button>
        </>
      )}
    </div>
  )
}

function Step({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        background: 'rgba(35,131,226,.1)', color: 'var(--ac)',
        fontSize: 14, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {n}
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', maxWidth: 110, lineHeight: 1.5 }}>{label}</div>
    </div>
  )
}

function Arrow() {
  return (
    <div style={{ color: 'var(--bd2)', fontSize: 20, marginBottom: 20, flexShrink: 0 }}>→</div>
  )
}

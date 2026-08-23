import { useEffect, useState } from 'react'
import { setTheme, themeChoice, type ThemeChoice } from '../../lib/theme'
import { haptic } from '../../lib/haptics'
import { Icon, type IconName } from '../shared/Icon'

/**
 * ── 설정 ─────────────────────────────────────────────────────────────────────
 *
 * Everything here belongs to *this machine*, not to the team. Fifty people share
 * the projects; nobody shares a screen or the room it is in, so none of this
 * goes near the database — the same line the sidebar's ordering follows.
 *
 * It lives behind an icon rather than in the sidebar's foot because a control
 * you touch twice a year should not be occupying the sidebar's last row every
 * day. The room the theme switch was taking is worth more than the one click it
 * saves.
 */

const THEMES: { value: ThemeChoice; label: string; icon: IconName; hint: string }[] = [
  { value: 'light', label: '밝게', icon: 'sun', hint: '항상 밝은 화면' },
  { value: 'dark', label: '어둡게', icon: 'moon', hint: '항상 어두운 화면' },
  { value: 'system', label: '시스템', icon: 'monitor', hint: '기기 설정을 따릅니다' },
]

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => themeChoice())

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const pick = (value: ThemeChoice) => { setTheme(value); setChoice(value); haptic('tap') }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(15,15,15,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)',
          border: '1px solid var(--bd)', width: '100%', maxWidth: 420,
          padding: '20px 22px 22px', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
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

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 3 }}>화면 밝기</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.6, marginBottom: 10 }}>
          이 기기에서만 적용됩니다. 다른 사람 화면은 바뀌지 않습니다.
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {THEMES.map(t => {
            const on = choice === t.value
            return (
              <button
                key={t.value}
                onClick={() => pick(t.value)}
                title={t.hint}
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

        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--bd)', userSelect: 'text' }}>
          빌드 {__BUILD_ID__}
        </div>
      </div>
    </div>
  )
}

import React, { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * ── Asking before something irreversible ─────────────────────────────────────
 *
 * `window.confirm` returns false in the desktop shell. A webview shows no dialog
 * unless the native host is asked to draw one, and it is not — so the answer is
 * always "no" and the code guarded by it never runs. That is why deleting a task
 * in the app did nothing at all: the confirmation nobody saw had already been
 * declined.
 *
 * This asks in the app instead, which also means the question looks like the
 * rest of it. Imperative on purpose: a promise is a drop-in replacement for the
 * call it replaces, so the four places that ask did not each need dialog state
 * of their own.
 */
export function askConfirm({ message, detail, confirmLabel = '삭제', danger = true }: {
  message: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    const close = (answer: boolean) => {
      resolve(answer)
      // Out of the current render: unmounting a root from inside one warns.
      setTimeout(() => { root.unmount(); host.remove() }, 0)
    }

    root.render(
      <ConfirmDialog
        message={message}
        detail={detail}
        confirmLabel={confirmLabel}
        danger={danger}
        onAnswer={close}
      />,
    )
  })
}

function ConfirmDialog({ message, detail, confirmLabel, danger, onAnswer }: {
  message: string
  detail?: string
  confirmLabel: string
  danger: boolean
  onAnswer: (answer: boolean) => void
}) {
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onAnswer(false) }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onAnswer(true) }
    }
    // Captured, so a list row's own Enter or Escape handler does not see it.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onAnswer])

  const accent = danger ? 'var(--danger)' : 'var(--ac)'

  return (
    <div
      onClick={() => onAnswer(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9700,
        background: 'rgba(15,15,15,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 'var(--r3)', boxShadow: 'var(--sh-lg)',
          width: '100%', maxWidth: 380, padding: '20px 22px',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)', lineHeight: 1.5 }}>{message}</div>
        {detail && (
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6, lineHeight: 1.6 }}>{detail}</div>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            onClick={() => onAnswer(false)}
            style={{
              padding: '6px 14px', fontSize: 13, borderRadius: 'var(--r1)',
              border: '1px solid var(--bd)', background: 'transparent',
              color: 'var(--t2)', cursor: 'pointer', fontFamily: 'var(--font)',
            }}
          >취소</button>
          <button
            ref={okRef}
            onClick={() => onAnswer(true)}
            style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 500, borderRadius: 'var(--r1)',
              border: `1px solid ${accent}`, background: accent,
              color: '#fff', cursor: 'pointer', fontFamily: 'var(--font)',
            }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

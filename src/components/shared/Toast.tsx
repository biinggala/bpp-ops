import { useEffect, useState } from 'react'
import { create } from 'zustand'

interface ToastState {
  message: string
  visible: boolean
  show: (msg: string) => void
}

export const useToast = create<ToastState>((set) => ({
  message: '',
  visible: false,
  show: (message) => {
    set({ message, visible: true })
    setTimeout(() => set({ visible: false }), 2200)
  },
}))

export function Toast() {
  const { message, visible } = useToast()
  return (
    <div
      style={{
        position: 'fixed', bottom: 22, left: '50%', zIndex: 500,
        pointerEvents: 'none',
        transition: 'transform .25s, opacity .25s',
        transform: `translateX(-50%) translateY(${visible ? 0 : 60}px)`,
        opacity: visible ? 1 : 0,
      }}
    >
      {/*
        글자가 상자 벽에 붙어 있었습니다. 한글은 글자틀을 가득 채우는 글씨라
        라틴 문자와 같은 여백을 주면 더 좁아 보입니다 — 받침이 아래 벽에
        닿습니다. 위아래를 넉넉히 주고 줄높이도 같이 폅니다.

        긴 문장은 줄바꿈합니다. 한 줄로 우기면 좁은 화면에서 상자가 창 밖으로
        나가고, 그러면 뒷말이 통째로 안 보입니다.
      */}
      <div style={{
        background: 'rgba(28,28,30,.92)',
        backdropFilter: 'blur(12px)',
        color: '#fff', fontSize: 13, fontWeight: 500, lineHeight: 1.5,
        padding: '11px 18px', borderRadius: 'var(--r3)',
        maxWidth: 'min(420px, calc(100vw - 32px))',
        boxShadow: 'var(--sh-lg)',
        textAlign: 'center', wordBreak: 'keep-all',
      }}>
        {message}
      </div>
    </div>
  )
}

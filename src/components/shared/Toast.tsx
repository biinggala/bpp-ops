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
      className="fixed bottom-[22px] left-1/2 pointer-events-none z-[500] transition-all duration-250"
      style={{
        transform: `translateX(-50%) translateY(${visible ? 0 : 60}px)`,
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="bg-[rgba(28,28,30,.92)] backdrop-blur-lg text-white text-[12px] font-medium px-[18px] py-[8px] rounded-xl whitespace-nowrap">
        {message}
      </div>
    </div>
  )
}

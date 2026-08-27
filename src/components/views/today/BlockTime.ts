import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { MutableRefObject } from 'react'
import { useGCalStore } from '../../../store/gcalStore'
import { noteRefOf } from '../../../lib/noteChecks'

/**
 * ── 체크박스 줄에도 시간이 보입니다 ──────────────────────────────────────────
 *
 * 업무 줄(TaskRef)은 시간 축에 놓이면 오른쪽 끝에 `09:00–10:00`이 붙습니다.
 * 체크박스 줄은 똑같이 끌어다 놓을 수 있는데 아무 표시가 없었습니다. 같은
 * 손짓을 했는데 한쪽만 답을 하면, 다른 쪽은 **안 된 것처럼 보입니다** —
 * 실제로는 구글 캘린더에 일정이 만들어져 있는데도요.
 *
 * ── 문서를 안 고칩니다 ───────────────────────────────────────────────────────
 *
 * 시간은 일정 쪽에 삽니다(`noteRef`). 노트에 적어 넣으면 두 곳이 같은 사실을
 * 들고 있게 되고, 캘린더에서 시간을 옮기는 순간 둘이 어긋납니다. 그래서
 * **그릴 때만** 붙입니다(프로즈미러 데코레이션) — 문서는 그대로라 저장도,
 * 되돌리기 기록도 안 생깁니다.
 *
 * 글자는 CSS가 `attr(data-at)`로 꺼내 그립니다. li가 이미 flex라서, 붙는
 * 자리가 업무 줄의 그 자리와 같습니다.
 */
export const BLOCK_TIME_KEY = new PluginKey('blockTime')

/** 시각 하나. TaskRef의 그것과 같은 모양이어야 해서 같은 규칙입니다. */
function clock(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const BlockTime = Extension.create<{ dateRef: MutableRefObject<string> | null }>({
  name: 'blockTime',

  addOptions() {
    return { dateRef: null }
  },

  addProseMirrorPlugins() {
    const { dateRef } = this.options
    return [
      new Plugin({
        key: BLOCK_TIME_KEY,
        props: {
          decorations(state) {
            const date = dateRef?.current
            if (!date) return null
            /*
              이 날짜의 블록만 지도로 만듭니다. 줄마다 events를 훑으면 줄
              수 × 일정 수가 되는데, 넉 달치를 싣고 있어서 그 곱이 큽니다.
            */
            const at = new Map<string, string>()
            for (const ev of useGCalStore.getState().events) {
              if (!ev.noteRef || ev.allDay || !ev.startIso || !ev.endIso) continue
              if (!ev.noteRef.startsWith(`${date}|`)) continue
              at.set(ev.noteRef, `${clock(ev.startIso)}–${clock(ev.endIso)}`)
            }
            if (!at.size) return null

            const found: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'taskItem') return
              const bid = node.attrs.bid as string | null
              if (!bid) return
              const label = at.get(noteRefOf(date, bid))
              if (label) found.push(Decoration.node(pos, pos + node.nodeSize, { 'data-at': label }))
            })
            return found.length ? DecorationSet.create(state.doc, found) : null
          },
        },
      }),
    ]
  },
})

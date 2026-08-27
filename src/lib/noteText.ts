/**
 * ── 노트를 글자로 옮깁니다 ───────────────────────────────────────────────────
 *
 * 밖으로 복사할 때 쓰는 글자 사본입니다. 프로즈미러의 기본 사본은 블록마다 빈
 * 줄을 하나씩 끼우는데, 체크박스 줄은 `목록 > 줄 > 문단` 세 겹이라 한 줄
 * 옮기는 데 빈 줄이 여러 개 붙었습니다. 목록 표시도 안 실립니다 — 불릿은
 * 화면이 그리는 것이지 글자가 아니니까요.
 *
 * 마크다운으로 적습니다. 슬랙도 노션도 이건 읽습니다.
 *
 * 노드를 받지만 프로즈미러를 안 부릅니다 — 필요한 것만 추린 모양(NoteNode)을
 * 받아서, 값만 넣으면 답이 나오는 함수로 둡니다.
 */

export interface NoteNode {
  type: string
  /** 이 노드가 블록인가. 모르는 종류를 한 줄로 칠지 정합니다. */
  isBlock?: boolean
  text?: string
  /** 이 노드 아래 글자 전부. 제목·문단처럼 통째로 쓸 때 씁니다. */
  textContent?: string
  attrs?: { level?: number; checked?: boolean }
  content?: NoteNode[]
}

/** 화면에만 살고 문서에는 id만 있는 줄들의 이름. */
export type LabelOf = (node: NoteNode) => string

/** 목록 한 줄의 머리. */
function bullet(kind: 'bullet' | 'ordered' | 'task', index: number, checked: boolean): string {
  if (kind === 'ordered') return `${index + 1}. `
  if (kind === 'task') return checked ? '- [x] ' : '- [ ] '
  return '- '
}

export function noteLines(nodes: NoteNode[], labelOf: LabelOf, depth = 0): string[] {
  const pad = '  '.repeat(depth)
  const out: string[] = []

  for (const node of nodes) {
    const name = node.type

    if (name === 'taskRef' || name === 'fileRef') {
      out.push(`${pad}- ${labelOf(node)}`)
      continue
    }
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
      const kind = name === 'orderedList' ? 'ordered' : name === 'taskList' ? 'task' : 'bullet'
      ;(node.content ?? []).forEach((item, i) => {
        /*
          줄의 첫 문단은 머리와 같은 줄에 붙입니다. 나머지(안쪽 목록 등)는
          다음 줄로 갑니다 — 안 그러면 `- ` 다음이 비고 글자가 아래 줄에
          혼자 서서, 목록 한 줄이 두 줄이 됩니다.
        */
        const inner = noteLines(item.content ?? [], labelOf, depth + 1)
        const head = inner.shift() ?? ''
        out.push(`${pad}${bullet(kind, i, !!item.attrs?.checked)}${head.trim()}`)
        out.push(...inner)
      })
      continue
    }
    if (name === 'heading') {
      out.push(`${pad}${'#'.repeat(node.attrs?.level ?? 1)} ${node.textContent ?? ''}`)
      continue
    }
    if (name === 'blockquote') {
      for (const line of noteLines(node.content ?? [], labelOf)) out.push(`${pad}> ${line}`)
      continue
    }
    if (name === 'horizontalRule') { out.push('---'); continue }
    if (name === 'codeBlock') { out.push('```', node.textContent ?? '', '```'); continue }
    if (node.isBlock) { out.push(pad + (node.textContent ?? '')); continue }
    if (node.text) out.push(pad + node.text)
  }

  return out
}

/**
 * 줄들을 한 덩어리로.
 *
 * 빈 줄이 셋 이상 이어지면 하나로 줄입니다 — 문단 사이 한 칸은 남기되,
 * 붙여 넣은 글이 스크롤 한 번씩 건너뛰게 두지는 않습니다.
 */
export function noteText(nodes: NoteNode[], labelOf: LabelOf): string {
  return noteLines(nodes, labelOf).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

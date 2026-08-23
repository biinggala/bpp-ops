import { useEffect } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useDriveStore } from '../../../store/driveStore'
import { fileKind, driveUrl } from '../../../lib/googleDrive'
import { openExternal } from '../../../lib/desktopLinks'

/**
 * ── 노트 안의 자료 ───────────────────────────────────────────────────────────
 *
 * 업무 참조와 같은 생각입니다: **아이디만 저장하고 이름은 그릴 때마다 읽습니다.**
 * 드라이브에서 파일 이름을 바꾸면 노트에도 바뀌어 있습니다. 붙일 때의 이름을
 * 복사해 두면 3월에 '무제 문서'였던 것이 영원히 무제 문서로 남습니다.
 *
 * 다만 사본 하나는 갖고 있습니다 — 붙일 때의 이름. 드라이브가 연결 안 돼 있거나
 * 접근 권한이 없으면 그거라도 보여야 합니다. 빈 줄이 되면 어제 여기 뭘 붙였는지
 * 알 방법이 없어집니다.
 *
 * 여는 건 `openExternal`로. 데스크톱 셸에서 `target="_blank"`는 아무 일도 안
 * 하고, 아무 일도 안 하는 링크는 고장 난 링크와 구별되지 않습니다.
 */

export const FileRef = Node.create({
  name: 'fileRef',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      driveId: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-drive-id'),
        renderHTML: a => (a.driveId ? { 'data-drive-id': a.driveId } : {}),
      },
      title: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-title') ?? '',
        renderHTML: a => (a.title ? { 'data-title': a.title } : {}),
      },
      mimeType: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-mime') ?? '',
        renderHTML: a => (a.mimeType ? { 'data-mime': a.mimeType } : {}),
      },
      url: {
        default: '',
        parseHTML: el => (el as HTMLElement).getAttribute('data-url') ?? '',
        renderHTML: a => (a.url ? { 'data-url': a.url } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-file-ref]' }]
  },

  renderHTML({ HTMLAttributes }) {
    // 검색이 읽는 건 이 HTML입니다. 이름을 본문으로 넣어 두면 '커피차 견적서'로
    // 노트를 찾을 수 있습니다 — 태그 속성만 있으면 못 찾습니다.
    const title = (HTMLAttributes as Record<string, string>)['data-title'] ?? ''
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file-ref': '' }), title]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileRefView)
  },
})

function FileRefView({ node, deleteNode }: NodeViewProps) {
  const driveId = node.attrs.driveId as string | null
  const stored = (node.attrs.title as string) || '파일'
  const mime = (node.attrs.mimeType as string) || ''
  const url = (node.attrs.url as string) || (driveId ? driveUrl(driveId, mime) : '')

  const live = useDriveStore(s => (driveId ? s.meta[driveId] : undefined))
  const resolve = useDriveStore(s => s.resolve)

  useEffect(() => { if (driveId) resolve([driveId]) }, [driveId, resolve])

  const name = live?.name ?? stored
  const kind = fileKind(live?.mimeType || mime)
  // 드라이브가 '못 찾겠다'고 답한 경우. 지워졌거나, 공유가 끊겼거나.
  const gone = live === null

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={ROW} data-drag-handle>
      <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1 }}>{kind.icon}</span>
      <span
        onClick={() => url && void openExternal(url)}
        title={gone ? '드라이브에서 찾을 수 없습니다' : name}
        style={{
          fontSize: 14, lineHeight: 1.6, minWidth: 0, cursor: url ? 'pointer' : 'default',
          color: gone ? 'var(--t3)' : 'var(--t1)',
          textDecoration: 'underline', textDecorationColor: 'var(--bd2)', textUnderlineOffset: 3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{name}</span>
      <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0 }}>
        {gone ? '접근 불가' : kind.label}
      </span>
      <button onClick={() => deleteNode()} title="노트에서 빼기" style={REMOVE}>×</button>
    </NodeViewWrapper>
  )
}

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '3px 6px', margin: '1px -6px', borderRadius: 'var(--r2)',
}

const REMOVE: React.CSSProperties = {
  marginLeft: 'auto', flexShrink: 0,
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--t3)', fontSize: 14, lineHeight: 1, padding: '0 2px',
  fontFamily: 'var(--font)',
}

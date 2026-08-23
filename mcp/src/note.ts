import type { Task } from './types.js'

/**
 * ── 노트의 글자와 화면 ───────────────────────────────────────────────────────
 *
 * 노트는 웹 편집기가 쓰는 HTML로 저장됩니다. 모델에게는 그게 읽을 것이 못
 * 되므로 마크다운으로 펴서 주고, 받을 때는 다시 HTML로 접습니다.
 *
 * **업무 줄은 id만 저장돼 있습니다.** 화면에서는 그릴 때마다 태스크를 읽어
 * 이름과 상태를 보여주므로, 여기서도 같은 일을 해야 노트가 같은 뜻으로
 * 읽힙니다 — 안 그러면 모델에게는 빈 줄로 보입니다.
 */

const unescape = (s: string) =>
  s.replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 저장된 노트를 사람이 읽는 줄들로. */
export function noteToMarkdown(html: string, tasks: Task[]): string {
  if (!html.trim()) return ''
  const byId = new Map(tasks.map(t => [t.id, t]))

  return html
    // 업무 줄 — id를 이름과 상태로 바꿔 줍니다.
    .replace(/<div[^>]*data-task-id="([^"]+)"[^>]*><\/div>|<div[^>]*data-task-id="([^"]+)"[^>]*\/>/g,
      (_m, a, b) => {
        const t = byId.get(a ?? b)
        if (!t) return '- [ ] (삭제된 업무)\n'
        return `- [${t.status === '완료' ? 'x' : ' '}] ${t.name} <!-- 업무 ${t.id} -->\n`
      })
    .replace(/<li[^>]*data-checked="true"[^>]*>/gi, '\n- [x] ')
    .replace(/<li[^>]*data-checked="false"[^>]*>/gi, '\n- [ ] ')
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<blockquote[^>]*>/gi, '\n> ')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|h[1-6]|li|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(l => unescape(l).trim())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join('\n')
    .trim()
}

/** 자유 체크리스트 한 줄. 노트에만 살고 태스크가 되지 않습니다. */
export function checklistHtml(lines: string[]): string {
  if (!lines.length) return ''
  const items = lines
    .map(l => `<li data-checked="false"><p>${escape(l.trim())}</p></li>`)
    .join('')
  return `<ul data-type="taskList">${items}</ul>`
}

/** 진짜 태스크를 가리키는 줄. 이름은 안 넣습니다 — 화면이 그때그때 읽습니다. */
export function taskRefHtml(taskIds: string[]): string {
  return taskIds.map(id => `<div data-task-ref data-task-id="${escape(id)}"></div>`).join('')
}

/** 그냥 글 한 문단. */
export function paragraphHtml(lines: string[]): string {
  return lines.map(l => `<p>${escape(l.trim())}</p>`).join('')
}

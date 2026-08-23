import { get, ref } from 'firebase/database'
import { db } from './firebase'
import { emailKey } from './paths'

/**
 * ── 노트에서 찾기 ────────────────────────────────────────────────────────────
 *
 * "그거 어디 적어놨더라"에 답하는 것.
 *
 * 노트는 하루에 하나씩 쌓이므로 반년만 지나도 백 개가 넘고, 그때부터는 날짜를
 * 짚어 가며 찾는 게 불가능합니다. 업무는 목록에서 눈으로 찾을 수 있지만 노트에
 * 적은 한 줄은 그렇지 않습니다.
 *
 * **한 번만 통째로 읽고 기억해 둡니다.** 내 노트 전부라 해봐야 몇백 KB고, 내
 * 가지 안이라 규칙도 한 번에 통과합니다. 앱이 뜰 때가 아니라 처음 검색할 때
 * 읽습니다 — 아무도 안 찾는 날에는 한 바이트도 안 씁니다.
 */

interface NoteHit {
  date: string
  /** 찾은 말이 들어 있는 한 줄. 앞뒤로 조금 더 붙여 둡니다. */
  snippet: string
}

let cache: Promise<Record<string, string>> | null = null

/** 다음 검색이 새로 읽도록. 노트를 고치면 캐시가 늙습니다. */
export function forgetNotes() { cache = null }

async function allNotes(email: string): Promise<Record<string, string>> {
  if (!cache) {
    cache = get(ref(db, `dailyNotes/${emailKey(email)}`))
      .then(snap => {
        const raw = (snap.val() ?? {}) as Record<string, { html?: string }>
        const out: Record<string, string> = {}
        for (const [date, node] of Object.entries(raw)) {
          if (node?.html) out[date] = node.html
        }
        return out
      })
      .catch(e => { console.warn('[noteSearch]', e); cache = null; return {} })
  }
  return cache
}

/** 태그를 지우고 줄바꿈을 살립니다 — 한 줄이 한 줄로 보여야 합니다. */
function lines(html: string): string[] {
  return html
    .replace(/<\/(p|li|h[1-6]|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
}

export async function searchNotes(email: string, query: string, limit = 6): Promise<NoteHit[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const notes = await allNotes(email)
  const hits: NoteHit[] = []
  // 최근 것부터. 지난주에 적은 것이 재작년 것보다 먼저 궁금합니다.
  for (const date of Object.keys(notes).sort().reverse()) {
    const line = lines(notes[date]).find(l => l.toLowerCase().includes(q))
    if (!line) continue
    hits.push({ date, snippet: line.length > 70 ? `${line.slice(0, 70)}…` : line })
    if (hits.length >= limit) break
  }
  return hits
}

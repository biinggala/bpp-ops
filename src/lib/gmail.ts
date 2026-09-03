/**
 * ── 답해야 하는 메일 ─────────────────────────────────────────────────────────
 *
 * '안 읽은 메일'은 메일함이 할 일입니다. 그건 지메일이 훨씬 잘하고, 여기에
 * 그대로 옮겨 오면 받은 알림은 일주일 안에 아무도 안 여는 목록이 됩니다.
 *
 * 여기서 셀 수 있는 건 하나뿐입니다 — **나에게 물어 온, 아직 내가 답 안 한
 * 메일.** 그 기준을 지메일의 질의로 옮기면 이렇게 됩니다:
 *
 * - `to:me` — 참조로 받은 건 통보지 질문이 아닙니다.
 * - `is:unread in:inbox` — 보관했거나 읽은 건 이미 처리한 것으로 봅니다.
 * - 프로모션·소셜·업데이트·포럼 탭 제외 — 사람이 쓴 게 아닌 것들입니다.
 * - `-from:me` — 내가 보낸 메일이 스레드에 섞여 오는 걸 막습니다.
 *
 * 그리고 하나 더, 질의로는 못 하는 것: **스레드의 마지막 글이 나면 뺍니다.**
 * 이미 답장한 대화가 상대의 새 글로 다시 안 읽음이 되는 건 맞지만, 내가 마지막
 * 으로 말한 대화가 목록에 남아 있으면 안 됩니다.
 *
 * 읽음 표시는 **여기서 안 합니다.** 지메일에서 읽으면 다음 새로고침에 목록에서
 * 사라집니다. 우리 쪽에 따로 '읽음'을 두면 두 군데가 어긋나고, 그때부터는 어느
 * 쪽도 못 믿습니다.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** 읽기만 합니다. 메일을 지우거나 보낼 권한은 안 받습니다. */
import { GMAIL_SCOPE } from './scopes'
export { GMAIL_SCOPE }

export const TOKEN_EXPIRED = 'GMAIL_TOKEN_EXPIRED'

export interface MailThread {
  threadId: string
  messageId: string
  subject: string
  /** 보낸 사람 이름만. "김민수 <a@b.com>"에서 앞부분. */
  from: string
  fromEmail: string
  snippet: string
  at: number
  /** 이 대화에 글이 몇 개인가. 하나면 안 붙입니다. */
  count: number
}

const QUERY = [
  'in:inbox',
  'is:unread',
  'to:me',
  '-from:me',
  '-category:promotions',
  '-category:social',
  '-category:updates',
  '-category:forums',
].join(' ')

async function call<T>(token: string, path: string, params: Record<string, string | string[]> = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    // metadataHeaders처럼 같은 이름을 여러 번 보내는 것들이 있습니다.
    if (Array.isArray(value)) value.forEach(v => qs.append(key, v))
    else qs.append(key, value)
  }
  const res = await fetch(`${API}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.ok) return res.json() as Promise<T>
  if (res.status === 401) throw new Error(TOKEN_EXPIRED)

  let detail = ''
  try {
    const body = await res.json() as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch { /* not JSON */ }
  // 드라이브에서 배운 것과 같습니다: 403은 만료가 아니라 API가 꺼져 있다는 말일
  // 때가 많고, 그걸 만료로 보면 글자 하나 칠 때마다 인증 창이 뜹니다.
  if (res.status === 403 && /has not been used|is disabled|accessNotConfigured/i.test(detail)) {
    throw new Error(
      'Google Cloud 프로젝트에서 Gmail API가 켜져 있지 않습니다. ' +
      'APIs & Services → Library → Gmail API → 사용 설정',
    )
  }
  throw new Error(detail || `메일 오류 (${res.status})`)
}

interface RawHeader { name: string; value: string }
interface RawMessage {
  id: string
  threadId: string
  internalDate?: string
  snippet?: string
  labelIds?: string[]
  payload?: { headers?: RawHeader[] }
}

const headerOf = (m: RawMessage, name: string) =>
  m.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

/** `"김민수" <a@b.com>` → `{ name: '김민수', email: 'a@b.com' }` */
function parseFrom(raw: string): { name: string; email: string } {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw)
  if (angled) {
    return { name: angled[1].replace(/^"|"$/g, '') || angled[2], email: angled[2].toLowerCase() }
  }
  return { name: raw.trim(), email: raw.trim().toLowerCase() }
}

/**
 * 답을 기다리는 대화들. 최근 것부터.
 *
 * 스레드 단위로 읽습니다 — 같은 대화의 안 읽은 글 세 개가 세 줄이 되면
 * 목록이 대화 수보다 커집니다. 사람은 대화 단위로 답합니다.
 */
export async function listNeedsReply(token: string, me: string, limit = 6): Promise<MailThread[]> {
  // 조금 넉넉히 받아 옵니다. 아래에서 '내가 마지막으로 말한 대화'를 걸러내면
  // 남는 게 줄어드는데, 그때 화면에 여섯 줄을 못 채우면 아쉽습니다.
  const list = await call<{ threads?: { id: string }[] }>(token, '/threads', {
    q: QUERY,
    maxResults: String(Math.min(limit * 3, 25)),
  })
  const ids = (list.threads ?? []).map(t => t.id)
  if (!ids.length) return []

  const mine = me.toLowerCase()
  const out: MailThread[] = []

  // 한 스레드에 한 번. 제목은 첫 글, 보낸 사람은 마지막 글에 있으므로 헤더
  // 두 개를 같이 받아 옵니다 — 나눠 받으면 스레드마다 왕복이 두 번입니다.
  const threads = await Promise.all(ids.map(id =>
    call<{ id: string; messages?: RawMessage[] }>(token, `/threads/${id}`, {
      format: 'metadata',
      metadataHeaders: ['From', 'Subject'],
    }).catch(() => null),
  ))

  for (const thread of threads) {
    const messages = thread?.messages
    if (!messages?.length) continue
    const last = messages[messages.length - 1]
    const from = parseFrom(headerOf(last, 'From'))
    // 내가 마지막으로 말한 대화는 내 차례가 아닙니다.
    if (from.email === mine) continue
    out.push({
      threadId: thread!.id,
      messageId: last.id,
      subject: headerOf(messages[0], 'Subject') || '(제목 없음)',
      from: from.name,
      fromEmail: from.email,
      snippet: (last.snippet ?? '').trim(),
      at: Number(last.internalDate ?? 0),
      count: messages.length,
    })
    if (out.length >= limit) break
  }

  return out.sort((a, b) => b.at - a.at)
}

/** 그 대화를 지메일에서 여는 주소. */
export function threadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`
}

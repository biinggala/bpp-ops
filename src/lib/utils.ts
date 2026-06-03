import type { Project } from '../types'

// Central access-check function used everywhere we filter projects.
// A user can access a project if:
//   1. Their email is in memberEmails (explicit member), OR
//   2. Their email matches creatorEmail (project owner), OR
//   3. The project has NO memberEmails AND NO creatorEmail (truly legacy, backward-compat only)
// The old pattern `!p.memberEmails?.length` is intentionally NOT used here because
// it grants access to projects that have memberEmails:[] due to a partially-set creator,
// which exposes other users' data.
export function canAccessProject(p: Project, userEmail: string | null | undefined): boolean {
  const e = userEmail?.toLowerCase() ?? ''
  if (!e) return false
  if (p.memberEmails?.some(m => m.toLowerCase() === e)) return true
  if (p.creatorEmail && p.creatorEmail.toLowerCase() === e) return true
  // Truly legacy project: no access records at all
  return !p.memberEmails?.length && !p.creatorEmail
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function gid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function fmtDate(d: string): string {
  if (!d) return ''
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

export function isOverdue(due: string, status: string): boolean {
  if (!due || status === '완료') return false
  return new Date(due) < new Date(new Date().toDateString())
}

export function parseAssignees(assignee: string): string[] {
  return assignee ? assignee.split(',').map(s => s.trim()).filter(Boolean) : []
}

const STORAGE_KEY = 'cringe_v9'

export function loadFromStorage<T>(key = STORAGE_KEY): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveToStorage<T>(data: T, key = STORAGE_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    localStorage.setItem(key + '_ts', String(Date.now()))
  } catch { /* quota exceeded etc. */ }
}

export function getLocalTs(key = STORAGE_KEY): number {
  return parseInt(localStorage.getItem(key + '_ts') || '0')
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}

export function toDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function fmtYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// BFS: returns all task IDs reachable via .blocking chains from startId (startId excluded)
export function getBlockingCascade(startId: string, allTasks: { id: string; blocking?: string[] }[]): string[] {
  const result: string[] = []
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length) {
    const id = queue.shift()!
    const task = allTasks.find(t => t.id === id)
    task?.blocking?.forEach(bid => {
      if (!visited.has(bid)) {
        visited.add(bid)
        result.push(bid)
        queue.push(bid)
      }
    })
  }
  return result
}

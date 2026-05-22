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

const STORAGE_KEY = 'cringe_v8'
const TS_KEY = STORAGE_KEY + '_ts'

export function loadFromStorage<T>(key = STORAGE_KEY): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveToStorage<T>(data: T, key = STORAGE_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    localStorage.setItem(TS_KEY, String(Date.now()))
  } catch { /* quota exceeded etc. */ }
}

export function getLocalTs(): number {
  return parseInt(localStorage.getItem(TS_KEY) || '0')
}

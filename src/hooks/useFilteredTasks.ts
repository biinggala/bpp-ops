import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useUiStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import { useProjectStore } from '../store/projectStore'
import { assigneeAliases, parseAssignees, isAssignedTo } from '../lib/utils'
import type { Task } from '../types'
import { useShallow } from 'zustand/react/shallow'

export function useFilteredTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const { projectId, myTasksOnly, personalOnly, hideCompleted, filters } = useUiStore(useShallow(s => ({ projectId: s.projectId, myTasksOnly: s.myTasksOnly, personalOnly: s.personalOnly, hideCompleted: s.hideCompleted, filters: s.filters })))
  const email = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)

  return useMemo(() => {
    // 구독 자체가 내가 멤버인 프로젝트로 한정되므로, 스토어에 있는 것은 전부 접근 가능하다.
    const accessibleIds = new Set(projects.map(p => p.id))
    // Tasks without a projectId are shown only if the user is the creator or assignee,
    // never to unrelated users just because they happen to have any project access.
    const hasAccess = accessibleIds.size > 0
    let result = tasks.filter(t => {
      if (t.projectId) return accessibleIds.has(t.projectId)
      // No projectId: show only if this user created or is assigned to the task
      if (!hasAccess) return false
      if (t.createdBy && email && t.createdBy.toLowerCase() === email.toLowerCase()) return true
      if (email && t.assignee?.toLowerCase().includes(email.toLowerCase())) return true
      return false
    })

    // Archived projects drop out of every aggregate view (전체 업무, 내 할 일,
    // 통계). They remain fully visible when the archived project itself is the
    // selected one, so the work is retrievable rather than deleted.
    if (!projectId) {
      const archivedIds = new Set(projects.filter(p => p.archived).map(p => p.id))
      if (archivedIds.size) result = result.filter(t => !t.projectId || !archivedIds.has(t.projectId))
    }

    if (projectId) result = result.filter(t => t.projectId === projectId)
    // 프로젝트가 없는 것들 — 나 말고는 아무도 못 보는 업무입니다.
    if (personalOnly) result = result.filter(t => !t.projectId)
    if (myTasksOnly) result = result.filter(t => isAssignedTo(t.assignee, email))

    if (filters.projects.length) {
      result = result.filter(t => t.projectId ? filters.projects.includes(t.projectId) : false)
    }
    if (filters.assignees.length) {
      // 고른 사람과 저장된 값의 대소문자가 다를 수 있어서, 두 모양을 다
      // 넣어 두고 맞춥니다.
      const wanted = new Set(filters.assignees.flatMap(assigneeAliases))
      result = result.filter(t => parseAssignees(t.assignee).some(tok => wanted.has(tok)))
    }
    if (filters.statuses.length) {
      result = result.filter(t => filters.statuses.includes(t.status as never))
    }
    if (filters.tags.length) {
      result = result.filter(t => filters.tags.some(tag => t.tags?.includes(tag)))
    }
    if (hideCompleted) {
      result = result.filter(t => t.status !== '완료')
    }

    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase()
      result = result.filter(t =>
        t.name.toLowerCase().includes(q) || t.memo.toLowerCase().includes(q)
      )
    }

    // Tasks with no due date sort last in every date-driven order — an empty
    // due date is "not scheduled", not "due at the beginning of time".
    const byDue = (a: Task, b: Task) => {
      if (!a.due && !b.due) return 0
      if (!a.due) return 1
      if (!b.due) return -1
      return a.due.localeCompare(b.due)
    }

    if (filters.sort === 'due_asc') {
      result.sort((a, b) => {
        if (!a.due && !b.due) return 0
        if (!a.due) return 1
        if (!b.due) return -1
        return a.due.localeCompare(b.due)
      })
    } else if (filters.sort === 'due_desc') {
      result.sort((a, b) => {
        if (!a.due && !b.due) return 0
        if (!a.due) return 1
        if (!b.due) return -1
        return b.due.localeCompare(a.due)
      })
    } else if (filters.sort === 'priority_desc') {
      // Same priority falls back to the nearer deadline, so the top of the list
      // is "높음, and of those the one due soonest" rather than an arbitrary
      // order within the 높음 block.
      const rank: Record<string, number> = { '높음': 0, '중간': 1, '낮음': 2 }
      result.sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || byDue(a, b))
    } else if (filters.sort === 'name_asc') {
      result.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    }

    return result
  }, [tasks, projectId, myTasksOnly, personalOnly, hideCompleted, email, projects, filters])
}

import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useUiStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import { useProjectStore } from '../store/projectStore'
import { canAccessProject } from '../lib/utils'
import type { Task } from '../types'

export function useFilteredTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const { space, projectId, myTasksOnly, hideCompleted, filters } = useUiStore()
  const memberKey = useAuthStore(s => s.memberKey)
  const email = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)

  return useMemo(() => {
    const accessibleIds = new Set(
      projects.filter(p => canAccessProject(p, email)).map(p => p.id)
    )
    // Tasks without a projectId are shown only if the user is the creator or assignee,
    // never to unrelated users just because they happen to have any project access.
    const hasAccess = accessibleIds.size > 0
    let result = tasks.filter(t => {
      if (t.projectId) return accessibleIds.has(t.projectId)
      // No projectId: show only if this user created or is assigned to the task
      if (!hasAccess) return false
      if (t.createdBy && email && t.createdBy.toLowerCase() === email.toLowerCase()) return true
      if (email && t.assignee?.toLowerCase().includes(email.toLowerCase())) return true
      if (memberKey && t.assignee?.includes(memberKey)) return true
      return false
    })

    if (space) result = result.filter(t => t.cat === space)
    if (projectId) result = result.filter(t => t.projectId === projectId)
    if (myTasksOnly) {
      result = result.filter(t => {
        if (memberKey && t.assignee.includes(memberKey)) return true
        if (email && t.assignee.toLowerCase().includes(email.toLowerCase())) return true
        return false
      })
    }

    if (filters.projects.length) {
      result = result.filter(t => t.projectId ? filters.projects.includes(t.projectId) : false)
    }
    if (filters.assignees.length) {
      result = result.filter(t => filters.assignees.some(a => t.assignee.includes(a)))
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
    }

    return result
  }, [tasks, space, projectId, myTasksOnly, hideCompleted, memberKey, email, projects, filters])
}

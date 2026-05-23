import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useUiStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import { useProjectStore } from '../store/projectStore'
import type { Task } from '../types'

export function useFilteredTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const { space, projectId, myTasksOnly, filters } = useUiStore()
  const memberKey = useAuthStore(s => s.memberKey)
  const email = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)

  return useMemo(() => {
    // Projects this user can access (invited or legacy with no memberEmails)
    const accessibleIds = new Set(
      projects
        .filter(p => !p.memberEmails?.length || (email ? p.memberEmails.includes(email) : false))
        .map(p => p.id)
    )
    const hasAccess = accessibleIds.size > 0

    // New users (no accessible project) see nothing.
    // Otherwise, show tasks from accessible projects only.
    let result = tasks.filter(t => {
      if (!t.projectId) return hasAccess   // unassigned tasks: visible if user has any project
      return accessibleIds.has(t.projectId)
    })

    if (space) result = result.filter(t => t.cat === space)
    if (projectId) result = result.filter(t => t.projectId === projectId)
    if (myTasksOnly && memberKey) result = result.filter(t => t.assignee.includes(memberKey))

    if (filters.assignees.length) {
      result = result.filter(t => filters.assignees.some(a => t.assignee.includes(a)))
    }
    if (filters.statuses.length) {
      result = result.filter(t => filters.statuses.includes(t.status as never))
    }
    if (filters.tags.length) {
      result = result.filter(t => filters.tags.some(tag => t.tags?.includes(tag)))
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
  }, [tasks, space, projectId, myTasksOnly, memberKey, email, projects, filters])
}

import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useUiStore } from '../store/uiStore'
import { useAuthStore } from '../store/authStore'
import type { Task } from '../types'

export function useFilteredTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const { space, projectId, myTasksOnly, filters } = useUiStore()
  const memberKey = useAuthStore(s => s.memberKey)

  return useMemo(() => {
    let result = [...tasks]

    if (space) result = result.filter(t => t.cat === space)
    if (projectId) result = result.filter(t => t.projectId === projectId)
    if (myTasksOnly && memberKey) result = result.filter(t => t.assignee.includes(memberKey))

    if (filters.assignees.length) {
      result = result.filter(t => filters.assignees.some(a => t.assignee.includes(a)))
    }
    if (filters.statuses.length) {
      result = result.filter(t => filters.statuses.includes(t.status as never))
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
  }, [tasks, space, projectId, myTasksOnly, memberKey, filters])
}

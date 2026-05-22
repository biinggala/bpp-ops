import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useUiStore } from '../store/uiStore'
import type { Task } from '../types'

export function useFilteredTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const { space, filters } = useUiStore()

  return useMemo(() => {
    let result = [...tasks]

    // space filter (사이드바에서 선택)
    if (space) {
      result = result.filter(t => t.cat === space)
    }

    // assignee filter
    if (filters.assignees.length) {
      result = result.filter(t =>
        filters.assignees.some(a => t.assignee.includes(a))
      )
    }

    // status filter
    if (filters.statuses.length) {
      result = result.filter(t => filters.statuses.includes(t.status as never))
    }

    // search
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase()
      result = result.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.memo.toLowerCase().includes(q)
      )
    }

    // sort
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
  }, [tasks, space, filters])
}

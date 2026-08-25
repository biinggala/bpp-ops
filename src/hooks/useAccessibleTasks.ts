import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useAuthStore } from '../store/authStore'
import { useVisibleProjects } from './useVisibleProjects'
import { useUiStore } from '../store/uiStore'
import type { Task } from '../types'

// Returns tasks the current user is allowed to see, without applying any UI filters
// (status, assignee, tag, search). Use this to populate filter option dropdowns.
export function useAccessibleTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const email = useAuthStore(s => s.email)
  // 필터 메뉴가 내놓는 후보도 지금 서 있는 워크스페이스의 것만입니다 —
  // 안 그러면 다른 곳의 태그와 담당자가 메뉴에 서고, 고르면 빈 목록이
  // 나옵니다. 이 훅의 원래 취지(고를 수 있는 것만 내놓기)와 같습니다.
  const projects = useVisibleProjects()
  const projectId = useUiStore(s => s.projectId)

  return useMemo(() => {
    const accessibleIds = new Set(projects.map(p => p.id))
    const hasAccess = accessibleIds.size > 0
    let result = tasks.filter(t => t.projectId ? accessibleIds.has(t.projectId) : hasAccess)

    // Same rule as useFilteredTasks: archived projects contribute no options to
    // filter dropdowns, except while that archived project is the selected one.
    if (!projectId) {
      const archivedIds = new Set(projects.filter(p => p.archived).map(p => p.id))
      if (archivedIds.size) result = result.filter(t => !t.projectId || !archivedIds.has(t.projectId))
    }
    return result
  }, [tasks, email, projects, projectId])
}

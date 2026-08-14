import { useMemo } from 'react'
import { useTaskStore } from '../store/taskStore'
import { useAuthStore } from '../store/authStore'
import { useProjectStore } from '../store/projectStore'
import { useUiStore } from '../store/uiStore'
import { canAccessProject } from '../lib/utils'
import type { Task } from '../types'

// Returns tasks the current user is allowed to see, without applying any UI filters
// (status, assignee, tag, search). Use this to populate filter option dropdowns.
export function useAccessibleTasks(): Task[] {
  const tasks = useTaskStore(s => s.tasks)
  const email = useAuthStore(s => s.email)
  const projects = useProjectStore(s => s.projects)
  const projectId = useUiStore(s => s.projectId)

  return useMemo(() => {
    const accessibleIds = new Set(projects.filter(p => canAccessProject(p, email)).map(p => p.id))
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

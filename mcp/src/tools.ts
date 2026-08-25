import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  accessibleProjectIds,
  assigneeKeyToEmail,
  canAccessProject,
  isAssignedTo,
  isTaskVisible,
  parseAssignees,
} from './access.js'
import {
  createProject, mutateMilestones, mutateTasks, newId,
  readMilestones, readProjects, readTasks, readUserProfiles, writeProjectMeta,
  readDailyNote, readDailyNoteDates, writeDailyNote,
} from './store.js'
import { checklistHtml, noteToMarkdown, paragraphHtml, taskRefHtml } from './note.js'
import { PRIORITIES, STATUSES, type Milestone, type Priority, type Status, type Task, type TaskLink } from './types.js'

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Builds a link record from an address.
 *
 * A Drive URL is recognised as one, so the app can show the file's current name
 * instead of whatever it was called when the link was made. Everything else is
 * stored as typed.
 */
function makeLink(rawUrl: string, title?: string, note?: string): TaskLink {
  const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
  const driveId = href.match(
    /(?:drive|docs)\.google\.com\/(?:(?:file|document|spreadsheets|presentation|forms|drawings)\/d\/|(?:drive\/)?folders\/)([A-Za-z0-9_-]+)/
  )?.[1]
  return {
    id: newId(),
    title: title?.trim() || href.replace(/^https?:\/\//i, '').slice(0, 40),
    url: href,
    ...(driveId ? { driveId } : {}),
    ...(note?.trim() ? { note: note.trim() } : {}),
  }
}

function shiftYmd(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Identity the tools act as. Every read and write is scoped to this email. */
export interface Ctx {
  email: string
}

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
})

/** Trimmed shape for listings, so large result sets stay readable. */
function summarise(t: Task) {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    assignee: t.assignee || null,
    due: t.due || null,
    projectId: t.projectId ?? null,
    milestoneId: t.milestoneId ?? null,
    parentId: t.parentId ?? null,
    progress: t.progress,
  }
}

export function registerTools(server: McpServer, ctx: Ctx) {
  // ── Read ──────────────────────────────────────────────────────────────────

  server.registerTool(
    'list_projects',
    {
      title: '프로젝트 목록',
      description: 'Projects the caller is a member of. Archived ones are excluded unless include_archived is set.',
      inputSchema: { include_archived: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ include_archived }) => {
      const projects = (await readProjects(ctx.email)).filter(p => canAccessProject(p, ctx.email))
      const visible = include_archived ? projects : projects.filter(p => !p.archived)
      return text(visible.map(p => ({
        id: p.id,
        name: p.name,
        dueDate: p.dueDate ?? null,
        archived: !!p.archived,
        memberEmails: p.memberEmails ?? [],
      })))
    }
  )

  server.registerTool(
    'list_milestones',
    {
      title: '마일스톤 목록',
      description: 'Milestones belonging to projects the caller can access.',
      inputSchema: { project_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ project_id }) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      const milestones = (await readMilestones(ctx.email))
        .filter(m => ids.has(m.projectId))
        .filter(m => !project_id || m.projectId === project_id)
      return text(milestones)
    }
  )

  server.registerTool(
    'list_tasks',
    {
      title: '업무 목록',
      description:
        'Tasks visible to the caller, with optional filters. Project tasks follow project membership; tasks with no project are only visible to their creator or assignee.',
      inputSchema: {
        project_id: z.string().optional(),
        milestone_id: z.string().optional(),
        status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
        priority: z.enum(PRIORITIES as [Priority, ...Priority[]]).optional(),
        assigned_to_me: z.boolean().optional(),
        assignee: z.string().optional().describe('email or legacy key; matches any of the task\'s assignees'),
        unassigned: z.boolean().optional().describe('only tasks with nobody on them'),
        tag: z.string().optional(),
        due_before: YMD.optional().describe('inclusive'),
        due_after: YMD.optional().describe('inclusive'),
        no_due: z.boolean().optional().describe('only tasks with no due date'),
        overdue: z.boolean().optional().describe('only incomplete tasks past their due date'),
        include_done: z.boolean().optional().describe('default true; set false to hide 완료'),
        top_level_only: z.boolean().optional().describe('exclude subtasks'),
        search: z.string().optional().describe('case-insensitive match on name or memo'),
        sort: z.enum(['due', 'priority', 'name']).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      let tasks = (await readTasks(ctx.email)).filter(t => isTaskVisible(t, ctx.email, ids))

      if (args.project_id) tasks = tasks.filter(t => t.projectId === args.project_id)
      if (args.milestone_id) tasks = tasks.filter(t => t.milestoneId === args.milestone_id)
      if (args.status) tasks = tasks.filter(t => t.status === args.status)
      if (args.priority) tasks = tasks.filter(t => t.priority === args.priority)
      if (args.assigned_to_me) tasks = tasks.filter(t => isAssignedTo(t, ctx.email))
      if (args.assignee) tasks = tasks.filter(t => isAssignedTo(t, args.assignee!))
      if (args.unassigned) tasks = tasks.filter(t => !t.assignee?.trim())
      if (args.tag) tasks = tasks.filter(t => t.tags?.includes(args.tag!))
      if (args.due_before) tasks = tasks.filter(t => t.due && t.due <= args.due_before!)
      if (args.due_after) tasks = tasks.filter(t => t.due && t.due >= args.due_after!)
      if (args.no_due) tasks = tasks.filter(t => !t.due)
      if (args.include_done === false) tasks = tasks.filter(t => t.status !== '완료')
      if (args.top_level_only) tasks = tasks.filter(t => !t.parentId)
      if (args.overdue) tasks = tasks.filter(t => t.due && t.status !== '완료' && t.due < today())
      if (args.search) {
        const q = args.search.toLowerCase()
        tasks = tasks.filter(t =>
          t.name.toLowerCase().includes(q) || (t.memo ?? '').toLowerCase().includes(q))
      }

      if (args.sort === 'due') {
        // Undated last: no due date means "not scheduled", not "due long ago".
        tasks = [...tasks].sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || a.due.localeCompare(b.due))
      } else if (args.sort === 'priority') {
        const rank: Record<string, number> = { '높음': 0, '중간': 1, '낮음': 2 }
        tasks = [...tasks].sort((a, b) =>
          (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) ||
          (a.due ? 0 : 1) - (b.due ? 0 : 1) || a.due.localeCompare(b.due))
      } else if (args.sort === 'name') {
        tasks = [...tasks].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      }

      const total = tasks.length
      const limited = tasks.slice(0, args.limit ?? 100)
      return text({ total, returned: limited.length, tasks: limited.map(summarise) })
    }
  )

  server.registerTool(
    'get_task',
    {
      title: '업무 상세',
      description: 'Full record for one task, including memo, tags, links and subtasks.',
      inputSchema: { task_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ task_id }) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      const tasks = await readTasks(ctx.email)
      const task = tasks.find(t => t.id === task_id)
      if (!task || !isTaskVisible(task, ctx.email, ids)) {
        throw new Error('task not found or not accessible')
      }
      const subtasks = tasks.filter(t => t.parentId === task.id).map(summarise)
      return text({ ...task, subtasks })
    }
  )

  server.registerTool(
    'list_members',
    {
      title: '팀원 목록',
      description:
        "People on the caller's projects, with display names. Use this to turn a name in a request (\"민수한테 넘겨\") into the email the task fields actually store.",
      inputSchema: { project_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ project_id }) => {
      const projects = (await readProjects(ctx.email)).filter(p => canAccessProject(p, ctx.email))
      const scoped = project_id ? projects.filter(p => p.id === project_id) : projects
      if (project_id && !scoped.length) throw new Error('project not found or not accessible')

      const profiles = await readUserProfiles()
      const nameByEmail = new Map(
        Object.values(profiles)
          .filter(p => p.email)
          .map(p => [p.email!.toLowerCase(), p.name ?? null]),
      )

      const byEmail = new Map<string, { email: string; name: string | null; projects: string[] }>()
      for (const p of scoped) {
        for (const raw of p.memberEmails ?? []) {
          const email = raw.toLowerCase()
          let e = byEmail.get(email)
          if (!e) { e = { email, name: nameByEmail.get(email) ?? null, projects: [] }; byEmail.set(email, e) }
          e.projects.push(p.name)
        }
      }
      return text([...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email)))
    }
  )

  server.registerTool(
    'get_summary',
    {
      title: '현황 요약',
      description:
        'One call for "how are we doing": what is overdue, what lands today and this week, what has no date or nobody on it, plus a per-person and per-project breakdown and the milestones coming up. Built for standups and check-ins, where the alternative is a dozen list_tasks calls.',
      inputSchema: {
        project_id: z.string().optional(),
        mine_only: z.boolean().optional().describe('restrict every figure to the caller'),
        days: z.number().int().min(1).max(90).optional().describe('window for "coming up", default 7'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const projects = await readProjects(ctx.email)
      const ids = accessibleProjectIds(projects, ctx.email)
      const nameById = new Map(projects.map(p => [p.id, p.name]))
      const horizonDays = args.days ?? 7
      const from = today()
      const to = shiftYmd(from, horizonDays)

      let tasks = (await readTasks(ctx.email)).filter(t => isTaskVisible(t, ctx.email, ids))
      if (args.project_id) tasks = tasks.filter(t => t.projectId === args.project_id)
      if (args.mine_only) tasks = tasks.filter(t => isAssignedTo(t, ctx.email))
      const open = tasks.filter(t => t.status !== '완료')

      const overdue = open.filter(t => t.due && t.due < from)
      const dueToday = open.filter(t => t.due === from)
      const dueSoon = open.filter(t => t.due && t.due > from && t.due <= to)
      const noDue = open.filter(t => !t.due)
      const unassigned = open.filter(t => !t.assignee?.trim())

      const detail = (t: Task) => ({
        id: t.id, name: t.name, due: t.due || null, priority: t.priority,
        assignee: t.assignee || null, project: t.projectId ? nameById.get(t.projectId) ?? null : null,
      })

      // Per person, counted by each name on the task: a task owned by two people
      // is work on both their plates, not half a task each.
      const people = new Map<string, { email: string; open: number; overdue: number; dueSoon: number }>()
      for (const t of open) {
        for (const tok of parseAssignees(t.assignee)) {
          const email = assigneeKeyToEmail(tok)
          let e = people.get(email)
          if (!e) { e = { email, open: 0, overdue: 0, dueSoon: 0 }; people.set(email, e) }
          e.open++
          if (t.due && t.due < from) e.overdue++
          else if (t.due && t.due <= to) e.dueSoon++
        }
      }

      const byProject = [...ids]
        .filter(id => !args.project_id || id === args.project_id)
        .map(id => {
          const own = open.filter(t => t.projectId === id)
          return {
            id, name: nameById.get(id) ?? id,
            open: own.length,
            overdue: own.filter(t => t.due && t.due < from).length,
            dueSoon: own.filter(t => t.due && t.due > from && t.due <= to).length,
          }
        })
        .filter(p => p.open > 0)
        .sort((a, b) => b.overdue - a.overdue || b.open - a.open)

      const milestonesSoon = (await readMilestones(ctx.email))
        .filter(m => ids.has(m.projectId))
        .filter(m => !args.project_id || m.projectId === args.project_id)
        .filter(m => !m.done && m.dueDate && m.dueDate <= to)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map(m => ({
          id: m.id, name: m.name, dueDate: m.dueDate,
          project: nameById.get(m.projectId) ?? m.projectId,
          daysLeft: Math.round((Date.parse(m.dueDate) - Date.parse(from)) / 86400000),
        }))

      return text({
        asOf: from,
        horizonDays,
        scope: { projectId: args.project_id ?? null, mineOnly: !!args.mine_only },
        totals: {
          open: open.length,
          overdue: overdue.length,
          dueToday: dueToday.length,
          dueSoon: dueSoon.length,
          noDue: noDue.length,
          unassigned: unassigned.length,
        },
        // Capped: a summary that runs to three hundred rows is a list, and there
        // is already a tool for lists.
        overdue: overdue.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 20).map(detail),
        dueToday: dueToday.map(detail),
        dueSoon: dueSoon.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 20).map(detail),
        unassigned: unassigned.slice(0, 10).map(detail),
        byPerson: [...people.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open),
        byProject,
        milestonesSoon,
      })
    }
  )

  // ── Write ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'create_task',
    {
      title: '업무 추가',
      description: 'Creates a task. The target project must be one the caller belongs to.',
      inputSchema: {
        name: z.string().min(1),
        project_id: z.string().optional(),
        milestone_id: z.string().optional(),
        parent_id: z.string().optional().describe('create as a subtask of this task'),
        assignee: z.string().optional().describe('comma-separated emails'),
        status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
        priority: z.enum(PRIORITIES as [Priority, ...Priority[]]).optional(),
        due: z.string().optional().describe('YYYY-MM-DD'),
        start: z.string().optional().describe('YYYY-MM-DD'),
        memo: z.string().optional(),
        tags: z.array(z.string()).optional(),
        cat: z.string().optional().describe('space/category name'),
      },
    },
    async (args) => {
      const projects = await readProjects(ctx.email)
      const ids = accessibleProjectIds(projects, ctx.email)
      if (args.project_id && !ids.has(args.project_id)) {
        throw new Error('project not found or not accessible')
      }

      const created = await mutateTasks(tasks => {
        if (args.parent_id) {
          const parent = tasks.find(t => t.id === args.parent_id)
          if (!parent || !isTaskVisible(parent, ctx.email, ids)) {
            throw new Error('parent task not found or not accessible')
          }
        }
        // Undefined values are rejected by Firebase, so optional keys are omitted.
        const task: Task = {
          id: newId(),
          type: args.parent_id ? '세부' : '상위',
          name: args.name.trim(),
          cat: args.cat ?? '',
          assignee: args.assignee ?? '',
          start: args.start ?? '',
          due: args.due ?? '',
          priority: args.priority ?? '중간',
          status: args.status ?? '대기',
          progress: 0,
          memo: args.memo ?? '',
          createdBy: ctx.email,
          ...(args.parent_id ? { parentId: args.parent_id } : {}),
          ...(args.project_id ? { projectId: args.project_id } : {}),
          ...(args.milestone_id ? { milestoneId: args.milestone_id } : {}),
          ...(args.tags?.length ? { tags: args.tags } : {}),
        }
        return { tasks: [...tasks, task], result: task }
      }, ctx.email)

      return text({ created: summarise(created) })
    }
  )

  server.registerTool(
    'update_task',
    {
      title: '업무 수정',
      description: 'Updates fields on an existing task. Only the fields provided are changed.',
      inputSchema: {
        task_id: z.string(),
        name: z.string().optional(),
        status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
        priority: z.enum(PRIORITIES as [Priority, ...Priority[]]).optional(),
        assignee: z.string().optional(),
        due: z.string().optional(),
        start: z.string().optional(),
        progress: z.number().int().min(0).max(100).optional(),
        memo: z.string().optional(),
        tags: z.array(z.string()).optional(),
        milestone_id: z.string().nullable().optional().describe('null detaches from its milestone'),
        project_id: z.string().optional(),
        parent_id: z.string().nullable().optional().describe('null promotes a subtask to top level'),
        cat: z.string().optional().describe('space/category name'),
        blocked_by: z.array(z.string()).optional().describe('task ids this one waits on'),
        blocking: z.array(z.string()).optional().describe('task ids waiting on this one'),
      },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      if (args.project_id && !ids.has(args.project_id)) {
        throw new Error('target project not found or not accessible')
      }

      const updated = await mutateTasks(tasks => {
        const i = tasks.findIndex(t => t.id === args.task_id)
        if (i < 0 || !isTaskVisible(tasks[i], ctx.email, ids)) {
          throw new Error('task not found or not accessible')
        }
        const patch: Partial<Task> = {}
        if (args.name !== undefined) patch.name = args.name
        if (args.status !== undefined) patch.status = args.status
        if (args.priority !== undefined) patch.priority = args.priority
        if (args.assignee !== undefined) patch.assignee = args.assignee
        if (args.due !== undefined) patch.due = args.due
        if (args.start !== undefined) patch.start = args.start
        if (args.progress !== undefined) patch.progress = args.progress
        if (args.memo !== undefined) patch.memo = args.memo
        if (args.tags !== undefined) patch.tags = args.tags
        if (args.milestone_id !== undefined) patch.milestoneId = args.milestone_id ?? undefined
        if (args.project_id !== undefined) patch.projectId = args.project_id
        if (args.cat !== undefined) patch.cat = args.cat
        if (args.blocked_by !== undefined) patch.blockedBy = args.blocked_by
        if (args.blocking !== undefined) patch.blocking = args.blocking
        if (args.parent_id !== undefined) {
          patch.parentId = args.parent_id ?? undefined
          // type and parentId are two halves of one fact; letting them disagree
          // is how a subtask ends up drawn as a top-level row.
          patch.type = args.parent_id ? '세부' : '상위'
        }

        const next = [...tasks]
        next[i] = { ...tasks[i], ...patch }
        return { tasks: next, result: next[i] }
      }, ctx.email)

      return text({ updated: summarise(updated) })
    }
  )

  server.registerTool(
    'delete_task',
    {
      title: '업무 삭제',
      description:
        'Deletes a task. Subtasks are deleted with it; the tool reports how many were removed.',
      inputSchema: { task_id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ task_id }) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)

      const removed = await mutateTasks(tasks => {
        const target = tasks.find(t => t.id === task_id)
        if (!target || !isTaskVisible(target, ctx.email, ids)) {
          throw new Error('task not found or not accessible')
        }
        const doomed = new Set<string>([target.id])
        tasks.forEach(t => { if (t.parentId === target.id) doomed.add(t.id) })
        return {
          tasks: tasks.filter(t => !doomed.has(t.id)),
          result: { name: target.name, count: doomed.size },
        }
      }, ctx.email)

      return text({ deleted: removed.name, tasksRemoved: removed.count })
    }
  )

  // ── Milestones ────────────────────────────────────────────────────────────

  server.registerTool(
    'create_milestone',
    {
      title: '마일스톤 추가',
      description: 'Creates a milestone in a project the caller belongs to.',
      inputSchema: {
        project_id: z.string(),
        name: z.string().min(1),
        due_date: YMD,
      },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      if (!ids.has(args.project_id)) throw new Error('project not found or not accessible')

      const created = await mutateMilestones(args.project_id, list => {
        const milestone: Milestone = {
          id: newId(),
          projectId: args.project_id,
          name: args.name.trim(),
          dueDate: args.due_date,
        }
        return { milestones: [...list, milestone], result: milestone }
      })
      return text({ created })
    }
  )

  server.registerTool(
    'update_milestone',
    {
      title: '마일스톤 수정',
      description: 'Renames a milestone, moves its date, or marks it done. Only the fields provided change.',
      inputSchema: {
        milestone_id: z.string(),
        name: z.string().optional(),
        due_date: YMD.optional(),
        done: z.boolean().optional(),
      },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      const target = (await readMilestones(ctx.email)).find(m => m.id === args.milestone_id)
      if (!target || !ids.has(target.projectId)) throw new Error('milestone not found or not accessible')

      const updated = await mutateMilestones(target.projectId, list => {
        const i = list.findIndex(m => m.id === args.milestone_id)
        if (i < 0) throw new Error('milestone not found')
        const next = [...list]
        next[i] = {
          ...list[i],
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.due_date !== undefined ? { dueDate: args.due_date } : {}),
          ...(args.done !== undefined ? { done: args.done } : {}),
        }
        return { milestones: next, result: next[i] }
      })
      return text({ updated })
    }
  )

  server.registerTool(
    'delete_milestone',
    {
      title: '마일스톤 삭제',
      description:
        'Deletes a milestone. Its tasks are kept and detached, landing in 마일스톤 미배정 — deleting a container is not a decision to delete what was in it.',
      inputSchema: { milestone_id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ milestone_id }) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      const target = (await readMilestones(ctx.email)).find(m => m.id === milestone_id)
      if (!target || !ids.has(target.projectId)) throw new Error('milestone not found or not accessible')

      await mutateMilestones(target.projectId, list => ({
        milestones: list.filter(m => m.id !== milestone_id),
        result: null,
      }))
      const detached = await mutateTasks(tasks => {
        let n = 0
        const next = tasks.map(t => {
          if (t.milestoneId !== milestone_id) return t
          n++
          const { milestoneId: _m, ...rest } = t
          return rest as Task
        })
        return { tasks: next, result: n }
      }, ctx.email)
      return text({ deleted: target.name, tasksDetached: detached })
    }
  )

  // ── Projects ──────────────────────────────────────────────────────────────

  server.registerTool(
    'create_project',
    {
      title: '프로젝트 추가',
      description:
        'Creates a project with the caller as its first member. Membership changes after that are left to the app: who can see a project is the one thing here worth a human deciding in person.',
      inputSchema: {
        name: z.string().min(1),
        color: z.string().optional().describe('#RRGGBB'),
        due_date: YMD.optional(),
        client_name: z.string().optional(),
      },
    },
    async (args) => {
      const created = await createProject({
        id: newId(),
        name: args.name.trim(),
        color: args.color ?? '#2383E2',
        inviteCode: newId().slice(0, 8),
        memberEmails: [ctx.email.toLowerCase()],
        creatorEmail: ctx.email.toLowerCase(),
        ...(args.due_date ? { dueDate: args.due_date } : {}),
        ...(args.client_name ? { clientName: args.client_name } : {}),
      }, ctx.email)
      return text({ created: { id: created.id, name: created.name } })
    }
  )

  server.registerTool(
    'update_project',
    {
      title: '프로젝트 수정',
      description: 'Renames a project, sets its colour, deadline or sidebar group, or archives it. Membership is not editable here.',
      inputSchema: {
        project_id: z.string(),
        name: z.string().optional(),
        color: z.string().optional(),
        due_date: YMD.optional(),
        client_name: z.string().optional(),
        archived: z.boolean().optional(),
        // The sidebar shelf this project sits on, shared by everyone who can
        // see it. An empty string takes it off its shelf.
        group: z.string().optional(),
      },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      if (!ids.has(args.project_id)) throw new Error('project not found or not accessible')
      await writeProjectMeta(args.project_id, {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.color !== undefined ? { color: args.color } : {}),
        ...(args.due_date !== undefined ? { dueDate: args.due_date } : {}),
        ...(args.client_name !== undefined ? { clientName: args.client_name } : {}),
        ...(args.archived !== undefined ? { archived: args.archived } : {}),
        ...(args.group !== undefined ? { group: args.group || null } : {}),
      })
      return text({ updated: args.project_id })
    }
  )

  // ── Bulk and attachments ──────────────────────────────────────────────────

  server.registerTool(
    'bulk_update_tasks',
    {
      title: '업무 일괄 수정',
      description:
        'Applies one change to many tasks in a single write. shift_days moves each task\'s own dates by that many days, which is what "push everything a week" means — unlike `due`, which would stack them all on one date.',
      inputSchema: {
        task_ids: z.array(z.string()).min(1).max(200),
        status: z.enum(STATUSES as [Status, ...Status[]]).optional(),
        priority: z.enum(PRIORITIES as [Priority, ...Priority[]]).optional(),
        assignee: z.string().optional(),
        due: YMD.optional(),
        shift_days: z.number().int().min(-365).max(365).optional(),
        milestone_id: z.string().nullable().optional(),
        project_id: z.string().optional(),
        add_tags: z.array(z.string()).optional(),
        remove_tags: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      if (args.project_id && !ids.has(args.project_id)) {
        throw new Error('target project not found or not accessible')
      }
      const wanted = new Set(args.task_ids)

      const report = await mutateTasks(tasks => {
        const changed: string[] = []
        const skipped: string[] = []
        const next = tasks.map(t => {
          if (!wanted.has(t.id)) return t
          if (!isTaskVisible(t, ctx.email, ids)) { skipped.push(t.id); return t }

          let out: Task = { ...t }
          if (args.status !== undefined) out.status = args.status
          if (args.priority !== undefined) out.priority = args.priority
          if (args.assignee !== undefined) out.assignee = args.assignee
          if (args.due !== undefined) out.due = args.due
          if (args.shift_days) {
            if (out.due) out.due = shiftYmd(out.due, args.shift_days)
            if (out.start) out.start = shiftYmd(out.start, args.shift_days)
          }
          if (args.milestone_id !== undefined) {
            if (args.milestone_id) out.milestoneId = args.milestone_id
            else { const { milestoneId: _m, ...rest } = out; out = rest as Task }
          }
          if (args.project_id !== undefined) out.projectId = args.project_id
          if (args.add_tags?.length || args.remove_tags?.length) {
            const set = new Set(out.tags ?? [])
            args.add_tags?.forEach(x => set.add(x))
            args.remove_tags?.forEach(x => set.delete(x))
            out.tags = [...set]
          }
          changed.push(t.id)
          return out
        })
        const missing = args.task_ids.filter(id => !tasks.some(t => t.id === id))
        return { tasks: next, result: { changed, skipped, missing } }
      }, ctx.email)

      return text({
        updated: report.changed.length,
        notAccessible: report.skipped,
        notFound: report.missing,
      })
    }
  )

  server.registerTool(
    'add_task_link',
    {
      title: '자료 첨부',
      description:
        "Attaches a link to a task's 자료. A Google Drive URL is recognised as one, so the app shows the file's current name rather than whatever it was called when the link was made.",
      inputSchema: {
        task_id: z.string(),
        url: z.string().min(1),
        title: z.string().optional().describe('defaults to the host and path'),
        note: z.string().optional().describe('shown beside the name — how two links to one file are told apart'),
      },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      const link = await mutateTasks(tasks => {
        const i = tasks.findIndex(t => t.id === args.task_id)
        if (i < 0 || !isTaskVisible(tasks[i], ctx.email, ids)) {
          throw new Error('task not found or not accessible')
        }
        const entry = makeLink(args.url, args.title, args.note)
        const next = [...tasks]
        next[i] = { ...tasks[i], links: [...(tasks[i].links ?? []), entry] }
        return { tasks: next, result: entry }
      }, ctx.email)
      return text({ added: link })
    }
  )

  server.registerTool(
    'remove_task_link',
    {
      title: '자료 첨부 해제',
      description: 'Removes one link from a task. The file itself is untouched — this server never writes to Drive.',
      inputSchema: { task_id: z.string(), link_id: z.string() },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const ids = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      const removed = await mutateTasks(tasks => {
        const i = tasks.findIndex(t => t.id === args.task_id)
        if (i < 0 || !isTaskVisible(tasks[i], ctx.email, ids)) {
          throw new Error('task not found or not accessible')
        }
        const links = tasks[i].links ?? []
        const gone = links.find(l => l.id === args.link_id)
        if (!gone) throw new Error('link not found on this task')
        const next = [...tasks]
        next[i] = { ...tasks[i], links: links.filter(l => l.id !== args.link_id) }
        return { tasks: next, result: gone }
      }, ctx.email)
      return text({ removed })
    }
  )

  // ── Project materials ─────────────────────────────────────────────────────
  //
  // Distinct from a task's 자료, and stored separately. A 계약서 or a 브랜드
  // 가이드 belongs to the project — it is the shelf the work is done from, not
  // work anybody is doing.

  server.registerTool(
    'list_project_links',
    {
      title: '프로젝트 자료 목록',
      description:
        "Materials filed against the project itself, not against its tasks — a 계약서, a 브랜드 가이드, a reference folder. Returns each link's id, which is what remove_project_link takes. For files attached to a task, read the task.",
      inputSchema: { project_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ project_id }) => {
      const projects = (await readProjects(ctx.email)).filter(p => canAccessProject(p, ctx.email))
      const scoped = project_id ? projects.filter(p => p.id === project_id) : projects
      if (project_id && !scoped.length) throw new Error('project not found or not accessible')
      return text(scoped.map(p => ({
        projectId: p.id,
        project: p.name,
        driveFolderUrl: p.driveFolderUrl ?? null,
        links: p.links ?? [],
      })))
    }
  )

  server.registerTool(
    'add_project_link',
    {
      title: '프로젝트 자료 추가',
      description:
        'Files a link against the project. A Google Drive URL is recognised as one, so the app shows the file\'s current name rather than whatever it was called when the link was made. Use add_task_link instead for a file that belongs to one piece of work.',
      inputSchema: {
        project_id: z.string(),
        url: z.string().min(1),
        title: z.string().optional().describe('defaults to the host and path'),
        note: z.string().optional().describe('shown beside the name — how two links to one file are told apart'),
      },
    },
    async (args) => {
      const project = (await readProjects(ctx.email)).find(p => p.id === args.project_id)
      if (!project || !canAccessProject(project, ctx.email)) {
        throw new Error('project not found or not accessible')
      }
      const entry = makeLink(args.url, args.title, args.note)
      // Read-modify-write, as the app does: the list lives on one key, so two
      // additions landing in the same instant would leave only the later one.
      // Rare enough to accept, and the alternative is a lock this database has
      // no use for anywhere else.
      await writeProjectMeta(args.project_id, { links: [...(project.links ?? []), entry] })
      return text({ added: entry })
    }
  )

  server.registerTool(
    'remove_project_link',
    {
      title: '프로젝트 자료 해제',
      description: 'Removes one link from a project. The file itself is untouched — this server never writes to Drive.',
      inputSchema: { project_id: z.string(), link_id: z.string() },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const project = (await readProjects(ctx.email)).find(p => p.id === args.project_id)
      if (!project || !canAccessProject(project, ctx.email)) {
        throw new Error('project not found or not accessible')
      }
      const links = project.links ?? []
      const gone = links.find(l => l.id === args.link_id)
      if (!gone) throw new Error('link not found on this project')
      await writeProjectMeta(args.project_id, { links: links.filter(l => l.id !== args.link_id) })
      return text({ removed: gone })
    }
  )

  /* ── 데일리 노트 ───────────────────────────────────────────────────────── */

  /**
   * 노트는 부르는 사람의 것입니다.
   *
   * 경로가 ctx.email 로만 만들어집니다 — 이 서버는 관리자 권한이라 규칙이
   * 막아 주지 않고, 남의 노트를 가리킬 인자를 두지 않는 것이 유일한 울타리
   * 입니다. 그래서 '누구의' 를 받는 자리가 아예 없습니다.
   */
  server.registerTool(
    'get_daily_note',
    {
      title: '오늘 노트 읽기',
      description:
        "Reads the caller's daily note for a date (default today) as markdown. The note is where somebody plans their day: a mix of free checkboxes for small things and references to real tasks. Task references are resolved here — you see the task's current name and whether it is done, not the id. Use this to answer 'what am I doing today' or 'what did I write down about X'.",
      inputSchema: {
        date: YMD.optional().describe('YYYY-MM-DD, default today'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const date = args.date ?? today()
      const [html, tasks] = await Promise.all([readDailyNote(ctx.email, date), readTasks(ctx.email)])
      const markdown = noteToMarkdown(html, tasks)
      return text({ date, empty: !markdown, markdown })
    }
  )

  server.registerTool(
    'list_daily_notes',
    {
      title: '노트 있는 날',
      description:
        "Lists the dates the caller has a daily note for, newest first. Use it to find which day to read when somebody says 'last week I wrote something about…'.",
      inputSchema: { limit: z.number().int().min(1).max(120).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const dates = await readDailyNoteDates(ctx.email)
      return text({ dates: dates.slice(0, args.limit ?? 30), total: dates.length })
    }
  )

  server.registerTool(
    'append_daily_note',
    {
      title: '오늘 노트에 붙이기',
      description:
        "Appends to the caller's daily note (default today). Three kinds of line, and the difference matters: `task_ids` become live references — ticking one in the app completes the real task, and its name and status stay current; `todos` become plain checkboxes that live only in the note, for the small things not worth a task; `notes` are plain paragraphs. Existing content is never replaced.",
      inputSchema: {
        date: YMD.optional().describe('YYYY-MM-DD, default today'),
        task_ids: z.array(z.string()).optional().describe('existing tasks to put on the day'),
        todos: z.array(z.string()).optional().describe('personal checkboxes — not tasks, nobody else sees them'),
        notes: z.array(z.string()).optional().describe('plain lines of text'),
      },
    },
    async (args) => {
      const date = args.date ?? today()
      const ids = args.task_ids ?? []
      const todos = (args.todos ?? []).filter(t => t.trim())
      const notes = (args.notes ?? []).filter(t => t.trim())
      if (!ids.length && !todos.length && !notes.length) {
        throw new Error('nothing to append — pass task_ids, todos or notes')
      }

      // 있지도 않은 업무를 가리키는 줄은 만들지 않습니다. 노트에 '삭제된
      // 업무'가 처음부터 적혀 있는 건 아무에게도 쓸모가 없습니다.
      const tasks = await readTasks(ctx.email)
      const accessible = accessibleProjectIds(await readProjects(ctx.email), ctx.email)
      const known = new Set(
        tasks.filter(t => isTaskVisible(t, ctx.email, accessible)).map(t => t.id)
      )
      const missing = ids.filter(id => !known.has(id))
      if (missing.length) throw new Error(`task not found or not accessible: ${missing.join(', ')}`)

      const before = await readDailyNote(ctx.email, date)
      const added = taskRefHtml(ids) + checklistHtml(todos) + paragraphHtml(notes)
      await writeDailyNote(ctx.email, date, before + added)

      return text({
        date,
        appended: { tasks: ids.length, todos: todos.length, notes: notes.length },
        markdown: noteToMarkdown(before + added, tasks),
      })
    }
  )
}

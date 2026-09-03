import React, { useEffect, useMemo, useState } from 'react'
import { useUiStore } from '../../../store/uiStore'
import { useProjectStore } from '../../../store/projectStore'
import { useVisibleProjects } from '../../../hooks/useVisibleProjects'
import { useTaskStore } from '../../../store/taskStore'
import { useMilestoneStore } from '../../../store/milestoneStore'
import { useAccessibleTasks } from '../../../hooks/useAccessibleTasks'
import { useMobile } from '../../../hooks/useMobile'
import { useSyncStore } from '../../../store/syncStore'
import { gid, safeExternalUrl } from '../../../lib/utils'
import { haptic } from '../../../lib/haptics'
import { NOTION } from '../../../types'
import type { Project, Task, TaskLink } from '../../../types'
import {
  FileRow, DriveSearch, UrlAdd, AttachTabs,
  useResolvedLinks, useProjectFolderId, driveIdOf, linkFromDriveFile,
} from '../../shared/DriveFiles'
import { driveIdFromUrl } from '../../../lib/googleDrive'
import { useShallow } from 'zustand/react/shallow'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * ── 자료 ─────────────────────────────────────────────────────────────────────
 *
 * A project's materials come in two kinds, and only one of them had a home.
 *
 * Work-in-progress files belong to the task they are for, and that is where
 * they live. But a 계약서, a 브랜드 가이드, an 출연자 프로필 folder belongs to
 * the project — it is the shelf the work is done from, not work anybody is
 * doing. There was nowhere to file one except a task it did not belong to.
 *
 * So this view holds both, kept apart: the project's own shelf, which is
 * editable here, and a read-only index of everything attached to its tasks, so
 * "그 대본 어디 있더라" does not require remembering which task it was on. One
 * search box runs over both, because when you are looking for a file you do not
 * yet know which kind it was.
 */

export function FilesView() {
  const { projectId } = useUiStore(useShallow(s => ({ projectId: s.projectId })))
  // 지금 서 있는 워크스페이스의 것만. 여기가 스토어를 직접 읽고 있어서,
  // 다른 워크스페이스의 프로젝트 이름과 그 자료가 자료 탭에 그대로 섰습니다.
  const projects = useVisibleProjects()
  const tasks = useAccessibleTasks()
  const isMobile = useMobile()
  const syncReady = useSyncStore(s => s.ready)
  const [query, setQuery] = useState('')

  const visible = useMemo(
    () => projects.filter(p => !p.archived && (!projectId || p.id === projectId)),
    [projects, projectId],
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px 24px' : '20px 24px 40px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 22 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="자료 이름으로 찾기..."
          style={{
            width: '100%', boxSizing: 'border-box',
            border: '1px solid var(--bd)', borderRadius: 'var(--r2)',
            padding: '9px 12px', fontSize: 14,
            background: 'var(--bg2)', color: 'var(--t1)',
            outline: 'none', fontFamily: 'var(--font)',
          }}
        />

        {visible.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: 'var(--t3)' }}>
            {syncReady ? '프로젝트가 없습니다' : '불러오는 중…'}
          </div>
        )}

        {visible.map(project => (
          <ProjectFiles
            key={project.id}
            project={project}
            tasks={tasks.filter(t => t.projectId === project.id)}
            query={query.trim().toLowerCase()}
            standalone={visible.length === 1}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectFiles({ project, tasks, query, standalone }: {
  project: Project
  tasks: Task[]
  query: string
  /** Inside one project the heading would only repeat the top bar. */
  standalone: boolean
}) {
  const updateProject = useProjectStore(s => s.updateProject)
  const updateTask = useTaskStore(s => s.updateTask)
  const milestones = useMilestoneStore(s => s.milestones)
  const folderId = useProjectFolderId(project.id)
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<'drive' | 'url'>('drive')

  const shelf = project.links ?? []
  const matches = (l: TaskLink) => !query || l.title.toLowerCase().includes(query)

  // Task attachments, indexed by their milestone so a long list reads as the
  // project's own structure rather than an alphabet of filenames.
  const attached = useMemo(() => {
    const byMilestone = new Map<string, { name: string; items: { link: TaskLink; task: Task }[] }>()
    for (const t of tasks) {
      for (const link of t.links ?? []) {
        const key = t.milestoneId ?? '__none__'
        let group = byMilestone.get(key)
        if (!group) {
          group = {
            name: milestones.find(m => m.id === t.milestoneId)?.name ?? '마일스톤 미배정',
            items: [],
          }
          byMilestone.set(key, group)
        }
        group.items.push({ link, task: t })
      }
    }
    return [...byMilestone.values()]
  }, [tasks, milestones])

  const attachedTotal = attached.reduce((n, g) => n + g.items.length, 0)
  const filtered = attached
    .map(g => ({ ...g, items: g.items.filter(x => matches(x.link)) }))
    .filter(g => g.items.length > 0)
  const shelfShown = shelf.filter(matches)

  const shelfResolved = useResolvedLinks(shelfShown)
  const attachedResolved = useResolvedLinks(useMemo(
    () => filtered.flatMap(g => g.items.map(x => x.link)),
    [filtered],
  ))

  const attachedIds = useMemo(
    () => new Set(shelf.map(driveIdOf).filter((v): v is string => !!v)),
    [shelf],
  )

  // A project used to have a folder *and* a shelf: one row that opened Drive,
  // and a list of files underneath it. Two places to keep the same kind of
  // thing, and the folder could hold only one. The folder is a shelf entry now
  // — it is still what scopes Drive search, see useProjectFolderId — so the
  // old field is moved across the first time this project is drawn and then
  // never read again.
  useEffect(() => {
    const legacy = safeExternalUrl(project.driveFolderUrl)
    if (!legacy) return
    const already = shelf.some(l => l.url === legacy || (driveIdOf(l) && driveIdOf(l) === driveIdFromUrl(legacy)))
    updateProject(project.id, {
      driveFolderUrl: undefined,
      ...(already ? null : {
        links: [{ id: gid(), title: `${project.name} 폴더`, url: legacy, mimeType: FOLDER_MIME }, ...shelf],
      }),
    })
  }, [project.id, project.driveFolderUrl])

  const add = (link: TaskLink) => { haptic('toggle'); updateProject(project.id, { links: [...shelf, link] }) }
  const remove = (id: string) => updateProject(project.id, { links: shelf.filter(l => l.id !== id) })
  const setNote = (id: string, note: string) =>
    updateProject(project.id, { links: shelf.map(l => l.id === id ? withNote(l, note) : l) })

  // The index is read-only about *which* files exist, but the note is the one
  // thing you want to write from here — it is where you are looking when two
  // rows turn out to be the same document.
  const noteOnTask = (task: Task, linkId: string, note: string) =>
    updateTask(task.id, { links: (task.links ?? []).map(l => l.id === linkId ? withNote(l, note) : l) })

  // With a search running, a project with no hits is noise.
  if (query && shelfShown.length === 0 && filtered.length === 0) return null

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!standalone && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: project.color, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>{project.name}</span>
        </div>
      )}

      {/* ── The project's own shelf ──────────────────────────────────────── */}
      <div>
        <SectionHead
          label="프로젝트 자료"
          count={shelf.length}
          action={
            <button
              onClick={() => { haptic('tap'); setAdding(a => !a) }}
              style={{
                padding: '3px 9px', fontSize: 12, borderRadius: 'var(--r1)',
                border: '1px solid var(--bd)', background: 'transparent',
                color: adding ? 'var(--ac)' : 'var(--t2)', cursor: 'pointer',
                fontFamily: 'var(--font)',
              }}
            >{adding ? '닫기' : '+ 추가'}</button>
          }
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {shelfShown.map(l => (
            <FileRow
              key={l.id} link={l} file={shelfResolved.get(driveIdOf(l) ?? '')}
              onRemove={() => remove(l.id)}
              onNote={note => setNote(l.id, note)}
            />
          ))}
          {shelfShown.length === 0 && !adding && (
            <div style={{ fontSize: 12, color: 'var(--t3)', padding: '4px 2px' }}>
              {query ? '검색 결과가 없습니다' : '아직 없습니다 — 계약서, 브랜드 가이드처럼 프로젝트 전체에 걸린 자료를 여기에'}
            </div>
          )}
        </div>

        {adding && (
          <div style={{
            marginTop: 8, padding: 4, borderRadius: 'var(--r3)',
            border: '1px solid var(--bd)', background: 'var(--bg)',
            display: 'flex', flexDirection: 'column', maxHeight: 320, overflow: 'hidden',
          }}>
            <AttachTabs mode={mode} onChange={setMode} />
            {mode === 'drive'
              ? <DriveSearch folderId={folderId} attachedIds={attachedIds} onPick={(f, tab) => add(linkFromDriveFile(f, tab))} onClose={() => setAdding(false)} />
              : <UrlAdd onAdd={add} />}
          </div>
        )}
      </div>

      {/* ── Everything hanging off a task ────────────────────────────────── */}
      {attachedTotal > 0 && (
        <div>
          <SectionHead label="업무에 붙은 자료" count={attachedTotal} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((group, i) => (
              <div key={i}>
                <div style={{ fontSize: 11, color: NOTION.purple.text, marginBottom: 4, paddingLeft: 2 }}>
                  ◆ {group.name}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {group.items.map(({ link, task }) => (
                    <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FileRow
                          link={link}
                          file={attachedResolved.get(driveIdOf(link) ?? '')}
                          compact
                          onNote={note => noteOnTask(task, link.id, note)}
                        />
                      </div>
                      {/* Which task it hangs off — the thing the list is for. */}
                      <span
                        title={task.name}
                        style={{ flexShrink: 0, maxWidth: 150, fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >{task.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--t3)', padding: '4px 2px' }}>검색 결과가 없습니다</div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** Firebase rejects undefined, so an emptied note is dropped rather than blanked. */
function withNote(link: TaskLink, note: string): TaskLink {
  const { note: _old, ...rest } = link
  return note ? { ...rest, note } : rest
}

function SectionHead({ label, count, action }: { label: string; count: number; action?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, paddingBottom: 5, borderBottom: '1px solid var(--bd)' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      {count > 0 && <span style={{ fontSize: 11, color: 'var(--t3)' }}>{count}</span>}
      <span style={{ marginLeft: 'auto' }}>{action}</span>
    </div>
  )
}

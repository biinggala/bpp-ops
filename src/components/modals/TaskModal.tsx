import { useState, useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'
import { useTaskStore } from '../../store/taskStore'
import { gid } from '../../lib/utils'
import { CATEGORIES, STATUS_LIST, PRIORITY_LIST } from '../../types'
import type { Task } from '../../types'

const EMPTY: Omit<Task, 'id'> = {
  type: '세부', name: '', cat: 'Strategy', assignee: '',
  start: '', due: '', priority: '중간', status: '대기', progress: 0, memo: '',
}

export function TaskModal() {
  const { isTaskModalOpen, editTaskId, closeTaskModal } = useUiStore()
  const { tasks, addTask, updateTask } = useTaskStore()
  const [form, setForm] = useState<Omit<Task, 'id'>>(EMPTY)

  const editing = editTaskId ? tasks.find(t => t.id === editTaskId) : null

  useEffect(() => {
    if (!isTaskModalOpen) return
    setForm(editing ? { ...editing } : { ...EMPTY })
  }, [isTaskModalOpen, editTaskId])

  if (!isTaskModalOpen) return null

  const set = <K extends keyof Omit<Task, 'id'>>(k: K, v: Omit<Task, 'id'>[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return
    if (editing) updateTask(editing.id, form)
    else addTask(form)
    closeTaskModal()
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center backdrop-blur-[4px]"
      onClick={e => { if (e.target === e.currentTarget) closeTaskModal() }}
    >
      <div className="bg-white/97 backdrop-blur-[40px] rounded-[18px] w-[580px] max-h-[88vh] overflow-auto shadow-[0_20px_60px_rgba(0,0,0,.18),0_0_0_1px_rgba(0,0,0,.07)]">
        {/* Header */}
        <div className="px-[22px] py-[17px] border-b border-black/[.07] flex items-center gap-[9px] sticky top-0 bg-transparent z-10">
          <span className="text-[15px] font-bold">{editing ? '업무 수정' : '새 업무'}</span>
          <button onClick={closeTaskModal} className="ml-auto w-[26px] h-[26px] rounded-[5px] border-none bg-transparent cursor-pointer text-gray-400 text-[20px] flex items-center justify-center hover:bg-gray-100">×</button>
        </div>

        {/* Body */}
        <div className="px-[22px] py-[17px] flex flex-col gap-[13px]">
          <Field label="업무명">
            <input
              className="fi"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="업무명을 입력하세요"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-[11px]">
            <Field label="유형">
              <select className="fi" value={form.type} onChange={e => set('type', e.target.value as Task['type'])}>
                <option value="상위">상위</option>
                <option value="세부">세부</option>
              </select>
            </Field>
            <Field label="카테고리">
              <select className="fi" value={form.cat} onChange={e => set('cat', e.target.value as Task['cat'])}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="상태">
              <select className="fi" value={form.status} onChange={e => set('status', e.target.value as Task['status'])}>
                {STATUS_LIST.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="우선순위">
              <select className="fi" value={form.priority} onChange={e => set('priority', e.target.value as Task['priority'])}>
                {PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="시작일">
              <input className="fi" type="date" value={form.start} onChange={e => set('start', e.target.value)} />
            </Field>
            <Field label="마감일">
              <input className="fi" type="date" value={form.due} onChange={e => set('due', e.target.value)} />
            </Field>
          </div>

          <Field label="담당자">
            <div className="flex gap-[8px]">
              {(['YL', 'SJ', 'HC'] as const).map(key => {
                const on = form.assignee.includes(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      const keys = form.assignee.split(',').filter(Boolean)
                      set('assignee', on ? keys.filter(k => k !== key).join(',') : [...keys, key].join(','))
                    }}
                    className={`px-[12px] py-[6px] rounded-lg text-[11px] font-semibold border cursor-pointer transition-colors ${
                      on ? 'bg-[#007aff] text-white border-[#007aff]' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-[#007aff]'
                    }`}
                  >
                    {key === 'YL' ? '이연주' : key === 'SJ' ? '정세운' : '최희건'}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label={`진행률 ${form.progress}%`}>
            <input
              type="range" min={0} max={100} step={5}
              value={form.progress}
              onChange={e => set('progress', Number(e.target.value))}
              className="w-full accent-[#007aff]"
            />
          </Field>

          <Field label="메모">
            <textarea
              className="fi resize-none"
              rows={3}
              value={form.memo}
              onChange={e => set('memo', e.target.value)}
              placeholder="메모..."
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="px-[22px] py-[13px] border-t border-black/[.07] flex gap-[7px] justify-end sticky bottom-0 bg-white">
          <button onClick={closeTaskModal} className="px-[14px] py-[7px] rounded-[8px] border border-black/[.12] bg-transparent text-[12px] text-gray-500 cursor-pointer hover:bg-gray-50">
            취소
          </button>
          <button
            onClick={submit}
            className="px-[14px] py-[7px] rounded-[8px] bg-[#007aff] text-white text-[12px] font-semibold border-none cursor-pointer hover:bg-[#0066d6]"
          >
            {editing ? '저장' : '추가'}
          </button>
        </div>
      </div>

      <style>{`.fi{width:100%;padding:7px 10px;border:1px solid rgba(0,0,0,.1);border-radius:10px;font-size:12px;outline:none;color:#1c1c1e;transition:border .12s;font-family:inherit;background:rgba(255,255,255,.85)}.fi:focus{border-color:#007aff;box-shadow:0 0 0 3px rgba(0,122,255,.12)}`}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="text-[11px] font-semibold text-gray-500 tracking-[.3px]">{label}</div>
      {children}
    </div>
  )
}

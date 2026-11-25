// Chuyển từ OLD/src/components/TasksView.tsx (M6-1). Giữ giao diện; dữ liệu qua opsService (RPC 0015 + bảng qua PostgREST, RLS).
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { opsService as dataService, type TaskItem } from '../services/opsService.ts';
import type { UserProfile } from '../services/authService.ts';
import { TASK_PRIORITIES, TASK_TYPES } from '../../../shared/opsRules.ts';
import { CandidateTodoPanel } from './CandidateTodoPanel.tsx';

export const fmtIso = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const PRIO_CLS: Record<string, string> = { Cao: 'text-red-700 bg-red-50', 'Trung bình': 'text-amber-700 bg-amber-50', Thấp: 'text-slate-600 bg-slate-100' };

const VIEWS: { key: string; label: string; adminOnly?: boolean }[] = [
  { key: 'mine', label: 'Việc của tôi' },
  { key: 'upcoming', label: 'Sắp tới' },
  { key: 'overdue', label: 'Quá hạn' },
  { key: 'done', label: 'Đã xong' },
  { key: 'all', label: 'Tất cả', adminOnly: true },
];

/** The add-task form, used on the Tasks page and inside a candidate profile. */
export const TaskForm: React.FC<{ user: UserProfile; candidateId?: number; onSaved: () => void; compact?: boolean }> = ({ user, candidateId, onSaved, compact }) => {
  const [title, setTitle] = useState('');
  const [type, setType] = useState(TASK_TYPES[0]);
  const [due, setDue] = useState('');
  const [time, setTime] = useState('');
  const [priority, setPriority] = useState('Trung bình');
  const [owner, setOwner] = useState('');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user.role === 'admin') dataService.listUsers().then((u) => setUsers(u.filter((x) => x.active)), () => setUsers([]));
  }, [user.role]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await dataService.createTask({ title, type, due, due_time: time, priority, owner, candidate_id: candidateId || '' });
      setTitle('');
      setTime('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tạo được công việc.');
    } finally {
      setBusy(false);
    }
  };

  const cls = 'px-2 py-1.5 text-xs border border-slate-300 rounded bg-white';
  return (
    <div className="space-y-1.5">
      <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-7'}`}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tên công việc" className={`${cls} ${compact ? 'col-span-2' : 'md:col-span-2'}`} data-no-i18n />
        <select value={type} onChange={(e) => setType(e.target.value)} className={cls}>
          {TASK_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cls} title="Hạn" />
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cls} title="Giờ (không bắt buộc)" />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className={cls}>
          {TASK_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
        {user.role === 'admin' ? (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={cls} title="Người phụ trách">
            <option value="">Giao cho tôi</option>
            {users.map((u) => <option key={u.username} value={u.username}>{u.username}{u.pic_code ? ` (${u.pic_code})` : ''}</option>)}
          </select>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy || !title.trim() || !due} onClick={save} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" /> Thêm việc
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
};

/** A list of tasks with tick-to-finish and delete. */
export const TaskList: React.FC<{ tasks: TaskItem[]; today: string; onChanged: () => void; onOpenCandidate?: (id: number) => void; showCandidate?: boolean }> = ({ tasks, today, onChanged, onOpenCandidate, showCandidate = true }) => {
  const [error, setError] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được.');
    }
  };
  if (!tasks.length) return <p className="text-xs text-slate-400 py-3">Không có công việc.</p>;
  return (
    <div className="overflow-x-auto">
      {error && <p className="text-xs text-red-700 mb-1">{error}</p>}
      <table className="w-full text-xs min-w-[640px]">
        <tbody>
          {tasks.map((t) => {
            const late = t.status === 'open' && t.due < today;
            return (
              <tr key={t.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-2 w-6">
                  <input type="checkbox" checked={t.status === 'done'} onChange={(e) => act(() => dataService.updateTask(t.id, { status: e.target.checked ? 'done' : 'open' }))} title="Đánh dấu đã xong" />
                </td>
                <td className={`py-1.5 pr-2 min-w-[180px] ${t.status === 'done' ? 'line-through text-slate-400' : 'font-medium text-slate-900'}`} data-no-i18n>
                  {t.title}
                  {t.note && <div className="text-[11px] text-slate-500 font-normal">{t.note}</div>}
                </td>
                <td className="py-1.5 pr-2 text-slate-600 whitespace-nowrap">{t.type}</td>
                <td className={`py-1.5 pr-2 whitespace-nowrap ${late ? 'text-red-700 font-bold' : 'text-slate-700'}`} data-no-i18n>
                  {fmtIso(t.due)} {t.due_time}
                  {late && <span className="ml-1 text-[10px]">quá hạn</span>}
                </td>
                <td className="py-1.5 pr-2"><span className={`px-1.5 py-0.5 rounded text-[11px] ${PRIO_CLS[t.priority] || ''}`}>{t.priority}</span></td>
                {showCandidate && (
                  <td className="py-1.5 pr-2 whitespace-nowrap" data-no-i18n>
                    {t.candidate_id ? (
                      <button type="button" className="text-blue-700 underline" onClick={() => onOpenCandidate?.(t.candidate_id)}>{t.candidate_code} · {t.full_name}</button>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                )}
                <td className="py-1.5 pr-2 text-slate-500" data-no-i18n>{t.owner}</td>
                <td className="py-1.5 w-6">
                  <button type="button" onClick={() => window.confirm(`Xóa công việc "${t.title}"?`) && act(() => dataService.deleteTask(t.id))} className="text-slate-400 hover:text-red-600" title="Xóa">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/** Tasks page: My / Upcoming / Overdue / Completed (Admin also sees All). */
export const TasksView: React.FC<{ user: UserProfile; onOpenCandidate: (id: number) => void }> = ({ user, onOpenCandidate }) => {
  const [view, setView] = useState('mine');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await dataService.listTasks(view);
      setTasks(r.tasks);
      setToday(r.today);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được công việc.');
    }
  }, [view]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <CandidateTodoPanel onOpenCandidate={onOpenCandidate} />
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Thêm công việc</h3>
        <TaskForm user={user} onSaved={load} />
        <p className="text-[11px] text-slate-500 mt-2">Việc gắn với một ứng viên thì thêm ở mục “Công việc” trong cửa sổ chi tiết hồ sơ.</p>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {VIEWS.filter((v) => !v.adminOnly || user.role === 'admin').map((v) => (
            <button key={v.key} type="button" onClick={() => setView(v.key)} className={`px-3 py-1.5 text-xs rounded-md border ${view === v.key ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
              {v.label}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-700 mb-2">{error}</p>}
        <TaskList tasks={tasks} today={today} onChanged={load} onOpenCandidate={onOpenCandidate} />
      </div>
    </div>
  );
};

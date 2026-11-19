// Chuyển từ OLD/src/components/CandidateOpsPanel.tsx (M6-1). Giữ giao diện; dữ liệu qua opsService (RPC 0015 + bảng qua PostgREST, RLS).
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Plus, Trash2 } from 'lucide-react';
import { opsService as dataService, type HiringState, type InterviewItem, type TaskItem } from '../services/opsService.ts';
import type { CandidateRecord } from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';
import { INTERVIEW_RESULTS, INTERVIEW_ROUNDS } from '../../../shared/opsRules.ts';
import { hrEligible } from '../../../shared/hrInfoRules.ts';
import { TaskForm, TaskList, fmtIso } from './TasksView.tsx';

const box = 'border border-slate-200 rounded-lg p-3';
const h3 = 'text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 pb-1 border-b border-slate-200';
const input = 'px-2 py-1.5 text-xs border border-slate-300 rounded bg-white';

/** Interview history: R1 / R2 from the profile (read-only) plus the rounds recorded here. */
const InterviewsBox: React.FC<{ candidateId: number; canEdit: boolean }> = ({ candidateId, canEdit }) => {
  const [list, setList] = useState<InterviewItem[]>([]);
  const [profile, setProfile] = useState<InterviewItem[]>([]);
  const [form, setForm] = useState({ round: 'R1', round_name: '', date: '', time: '', interviewer: '', result: '', feedback: '' });
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await dataService.listInterviews(candidateId);
      setList(r.interviews);
      setProfile(r.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được lịch sử phỏng vấn.');
    }
  }, [candidateId]);
  useEffect(() => {
    load();
  }, [load]);
  const add = async () => {
    setError('');
    try {
      await dataService.createInterview(candidateId, form);
      setForm({ ...form, date: '', time: '', interviewer: '', result: '', feedback: '', round_name: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thêm được.');
    }
  };
  const rows = [...profile, ...list];
  return (
    <div className={box}>
      <div className={h3}>Lịch sử phỏng vấn</div>
      {rows.length === 0 && <p className="text-xs text-slate-400">Chưa có buổi phỏng vấn nào.</p>}
      <ul className="space-y-1.5">
        {rows.map((v, i) => (
          <li key={v.source + v.id + '-' + i} className="text-xs flex items-start gap-2">
            <span className="font-bold text-slate-800 w-28 shrink-0" data-no-i18n>{v.round === 'Khác' ? v.round_name : v.round}</span>
            <span className="flex-1" data-no-i18n>
              {fmtIso(v.date)} {v.time} {v.interviewer && `· ${v.interviewer}`} {v.result && <strong className="ml-1">{v.result}</strong>}
              {v.feedback && <div className="text-slate-500 whitespace-pre-wrap">{v.feedback}</div>}
            </span>
            {v.source === 'profile' ? (
              <span className="text-[10px] text-slate-400 shrink-0">từ hồ sơ</span>
            ) : canEdit ? (
              <button type="button" className="text-slate-400 hover:text-red-600" title="Xóa" onClick={() => window.confirm('Xóa buổi phỏng vấn này?') && dataService.deleteInterview(v.id).then(load, (e) => setError(e instanceof Error ? e.message : 'Không xóa được.'))}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <select value={form.round} onChange={(e) => setForm({ ...form, round: e.target.value })} className={input}>
            {INTERVIEW_ROUNDS.map((r) => <option key={r}>{r}</option>)}
          </select>
          {form.round === 'Khác' && <input value={form.round_name} onChange={(e) => setForm({ ...form, round_name: e.target.value })} placeholder="Tên vòng" className={input} />}
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} />
          <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={input} />
          <input value={form.interviewer} onChange={(e) => setForm({ ...form, interviewer: e.target.value })} placeholder="Người phỏng vấn" className={input} data-no-i18n />
          <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} className={input}>
            {INTERVIEW_RESULTS.map((r) => <option key={r} value={r}>{r || '— Kết quả —'}</option>)}
          </select>
          <input value={form.feedback} onChange={(e) => setForm({ ...form, feedback: e.target.value })} placeholder="Nhận xét" className={`${input} col-span-2`} data-no-i18n />
          <button type="button" disabled={!form.date} onClick={add} className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Thêm buổi PV
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
};

/** Hiring Operation checklist and "Xác nhận tuyển" for a candidate who passed round 2. */
// Hệ mới: trạng thái tự động (đủ giấy tờ, có ngày OB) tính từ hồ sơ trên trình duyệt nên truyền kèm hồ sơ.
const HiringBox: React.FC<{ candidate: CandidateRecord; candidateId: number; canEdit: boolean; isAdmin: boolean }> = ({ candidate, candidateId, canEdit, isAdmin }) => {
  const [st, setSt] = useState<HiringState | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => dataService.getHiring(candidateId, candidate).then(setSt, () => setSt(null)), [candidateId, candidate]);
  useEffect(() => {
    load();
  }, [load]);
  if (!st || !st.eligible) return null;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không thực hiện được.' });
    }
  };
  const all = st.items.every((i) => i.done);
  return (
    <div className={box}>
      <div className={h3}>Hiring Operation</div>
      <ul className="space-y-1">
        {st.items.map((it) => (
          <li key={it.key} className="flex items-center gap-2 text-xs">
            {it.auto ? (
              it.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Circle className="w-4 h-4 text-slate-300" />
            ) : (
              <input type="checkbox" checked={it.done} disabled={!canEdit || st.confirmed} onChange={(e) => run(() => dataService.setHiringItem(candidateId, it.key, e.target.checked, candidate), 'Đã lưu.')} />
            )}
            <span className={it.done ? 'text-slate-900' : 'text-slate-500'}>{it.label}</span>
            {it.auto && <span className="text-[10px] text-slate-400">tự động</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {st.confirmed ? (
          <>
            <span className="text-xs font-bold text-emerald-700" data-no-i18n>Đã xác nhận tuyển ({st.confirmed_by})</span>
            {isAdmin && <button type="button" onClick={() => run(() => dataService.confirmHiring(candidateId, false), 'Đã mở lại.')} className="text-xs text-amber-700 underline">Mở lại</button>}
          </>
        ) : canEdit ? (
          <button type="button" disabled={!all} onClick={() => window.confirm('Xác nhận tuyển ứng viên này? OB Status sẽ chuyển sang Accepted nếu đang trống hoặc Pending.') && run(() => dataService.confirmHiring(candidateId, true), 'Đã xác nhận tuyển.')} className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50" title={all ? '' : 'Hoàn thành tất cả các mục trước'}>
            Xác nhận tuyển
          </button>
        ) : null}
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</span>}
      </div>
    </div>
  );
};

const TasksBox: React.FC<{ candidateId: number; user: UserProfile; canEdit: boolean }> = ({ candidateId, user, canEdit }) => {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [today, setToday] = useState('');
  const load = useCallback(() => dataService.listTasks('all', candidateId).then((r) => { setTasks(r.tasks); setToday(r.today); }, () => setTasks([])), [candidateId]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className={box}>
      <div className={h3}>Công việc của hồ sơ</div>
      <TaskList tasks={tasks} today={today} onChanged={load} showCandidate={false} />
      {canEdit && <div className="mt-2"><TaskForm user={user} candidateId={candidateId} onSaved={load} compact /></div>}
    </div>
  );
};

/** Phase 5 inside the profile popup: interviews, hiring checklist (passed round 2) and tasks. Google version only. */
export const CandidateOpsPanel: React.FC<{ candidate: CandidateRecord; user: UserProfile; canEdit: boolean }> = ({ candidate, user, canEdit }) => {
  const id = Number(candidate.id);
  return (
    <section className="space-y-3">
      <InterviewsBox candidateId={id} canEdit={canEdit} />
      {hrEligible(candidate as unknown as Record<string, unknown>) && <HiringBox candidate={candidate} candidateId={id} canEdit={canEdit} isAdmin={user.role === 'admin'} />}
      <TasksBox candidateId={id} user={user} canEdit={canEdit} />
    </section>
  );
};

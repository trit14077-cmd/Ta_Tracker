// M6-1: Công việc, Phỏng vấn, Lịch, Target, checklist tuyển – thay các hàm tương ứng của dataService cũ (Ops.gs).
// Cùng tên hàm và kiểu trả về để các màn hình chép từ hệ cũ gần như nguyên văn.
// Đọc: RPC 0015 (list_tasks, list_interviews, calendar_range, target_list). Ghi: thẳng bảng qua PostgREST (RLS 0005);
// dữ liệu kiểm bằng chính shared/opsRules (validateTask / validateInterview / validateEvent) như server cũ.
import { supabase } from '../lib/supabase.ts';
import { ApiError, fnError, type CandidateRecord } from './candidateService.ts';
import type { UserProfile } from './authService.ts';
import {
  HIRING_ITEMS, TARGET_PERIODS, periodKeyOf, periodRange, validateEvent, validateInterview, validateTask,
  type TargetPeriod,
} from '../../../shared/opsRules.ts';
import { hrEligible } from '../../../shared/hrInfoRules.ts';
import { hiringView, type HiringRow, type HiringState } from '../../../supabase/functions/records-save/hiring.ts';
import { userAdminService } from './userAdminService.ts';

export interface CandidateBrief {
  candidate_id: number;
  candidate_code: string;
  full_name: string;
  pic: string;
}
export interface TaskItem extends CandidateBrief {
  id: number;
  title: string;
  type: string;
  due: string;
  due_time: string;
  priority: string;
  status: 'open' | 'done';
  owner: string;
  note: string;
  created_by: string;
  created_at: string;
  done_at: string;
}
export interface CalendarEvent extends CandidateBrief {
  id: string;
  kind: 'task' | 'interview' | 'r1' | 'r2' | 'ob' | 'event';
  title: string;
  date: string;
  time: string;
  end_time: string;
  done: boolean;
  status?: string;
  note: string;
  owner?: string;
}
export interface AlertsData {
  counts: { overdue: number; due_soon: number; passed_no_hr: number; missing_docs: number };
  overdue: TaskItem[];
  due_soon: TaskItem[];
  passed_no_hr: CandidateBrief[];
  missing_docs: (CandidateBrief & { detail: string })[];
  today: string;
}
export interface TargetRow {
  id: number;
  period_type: string;
  period_key: string;
  pic: string;
  position: string;
  dept: string;
  value: number;
  actual: number;
  pct: number | null;
}
export interface InterviewItem {
  id: number;
  candidate_id: number;
  round: string;
  round_name: string;
  date: string;
  time: string;
  interviewer: string;
  result: string;
  feedback: string;
  created_by: string;
  source: 'history' | 'profile';
}
export type { HiringState };

function invalid(errors: Record<string, string>): ApiError {
  return new ApiError('Dữ liệu chưa hợp lệ: ' + Object.values(errors).join(' '), 400, 'VALIDATION_FAILED', errors);
}
function dbError(error: { code?: string; message?: string } | null, fallback: string): ApiError {
  const code = error?.code || 'ERROR';
  if (code === '42501') return new ApiError('Bạn không có quyền thực hiện thao tác này.', 403, 'FORBIDDEN');
  if (code === '22023' && error?.message) return new ApiError(error.message, 400, 'INVALID_INPUT');
  return new ApiError(fallback, 500, code);
}
/** UPDATE/DELETE qua RLS: 0 dòng = không thấy hoặc không có quyền (hệ cũ trả 404/403). */
function noRow(what: string): ApiError {
  return new ApiError(`Không tìm thấy ${what} hoặc bạn không có quyền sửa.`, 404, 'NOT_FOUND');
}

let lastAlerts: AlertsData | null = null;
let myId: string | null = null;
async function uid(): Promise<string> {
  if (myId) return myId;
  const { data } = await supabase.auth.getUser();
  myId = data.user?.id || '';
  return myId;
}
/** Admin giao việc cho người khác bằng username (như hệ cũ); TA luôn giao cho chính mình. */
async function ownerIdOf(username: string): Promise<string | null> {
  const w = String(username || '').trim();
  if (!w) return uid();
  const { data } = await supabase.from('profiles').select('id, active').eq('username', w).maybeSingle();
  return data && data.active ? (data.id as string) : null;
}

export const opsService = {
  // ---------------- chuông (M6-3)
  /** Bản lần trước (hệ cũ giữ trong bộ nhớ đệm) để chuông hiện ngay khi mở trang. */
  peekAlerts(): AlertsData | null {
    return lastAlerts;
  },
  async getAlerts(): Promise<AlertsData> {
    const { data, error } = await supabase.rpc('alerts', {});
    if (error) throw dbError(error, 'Không tải được nhắc việc.');
    lastAlerts = data as AlertsData;
    return lastAlerts;
  },

  // ---------------- công việc
  async listTasks(view: string, candidateId?: number): Promise<{ tasks: TaskItem[]; today: string }> {
    const { data, error } = await supabase.rpc('list_tasks', { p_view: view, p_record_id: candidateId || null });
    if (error) throw dbError(error, 'Không tải được công việc.');
    return data as { tasks: TaskItem[]; today: string };
  },
  async createTask(t: Record<string, unknown>): Promise<void> {
    const v = validateTask(t);
    if (Object.keys(v.errors).length) throw invalid(v.errors);
    const owner = await ownerIdOf(String(t.owner || ''));
    if (!owner) throw invalid({ owner: 'Người phụ trách không tồn tại hoặc đã bị khóa.' });
    const cid = Number(t.candidate_id) || null;
    const { error } = await supabase.from('tasks').insert({
      record_id: cid, title: v.clean.title, type: v.clean.type, due: v.clean.due, due_time: v.clean.due_time || null,
      priority: v.clean.priority, note: v.clean.note, owner_id: owner, status: 'open',
    });
    if (error) throw error.code === '42501' ? new ApiError('Không tìm thấy hồ sơ ứng viên hoặc bạn không được giao việc cho người khác.', 403, 'FORBIDDEN') : dbError(error, 'Không tạo được công việc.');
  },
  async updateTask(id: number, patch: Record<string, unknown>): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) {
      if (patch.status !== 'open' && patch.status !== 'done') throw invalid({ status: 'Trạng thái không hợp lệ.' });
      row.status = patch.status; // done_at do trigger tg_task_done_at đặt
    }
    const fields = ['title', 'type', 'due', 'due_time', 'priority', 'note'] as const;
    if (fields.some((k) => patch[k] !== undefined)) {
      const { data: cur } = await supabase.from('tasks').select('title, type, due, due_time, priority, note').eq('id', id).maybeSingle();
      if (!cur) throw noRow('công việc');
      const merged: Record<string, unknown> = {};
      for (const k of fields) merged[k] = patch[k] !== undefined ? patch[k] : (cur as Record<string, unknown>)[k] ?? '';
      const v = validateTask(merged);
      if (Object.keys(v.errors).length) throw invalid(v.errors);
      Object.assign(row, { ...v.clean, due_time: v.clean.due_time || null });
    }
    if (patch.owner !== undefined) {
      const owner = await ownerIdOf(String(patch.owner || ''));
      if (!owner) throw invalid({ owner: 'Người phụ trách không tồn tại hoặc đã bị khóa.' });
      row.owner_id = owner;
    }
    const { data, error } = await supabase.from('tasks').update(row).eq('id', id).select('id');
    if (error) throw dbError(error, 'Không lưu được công việc.');
    if (!data?.length) throw noRow('công việc');
  },
  async deleteTask(id: number): Promise<void> {
    const { data, error } = await supabase.from('tasks').delete().eq('id', id).select('id');
    if (error) throw dbError(error, 'Không xóa được công việc.');
    if (!data?.length) throw noRow('công việc');
  },
  /** Người dùng còn hoạt động (để Admin giao việc). */
  async listUsers(): Promise<UserProfile[]> {
    return (await userAdminService.listUsers()).filter((u) => u.active);
  },

  // ---------------- phỏng vấn
  async listInterviews(candidateId: number): Promise<{ interviews: InterviewItem[]; profile: InterviewItem[] }> {
    const { data, error } = await supabase.rpc('list_interviews', { p_record_id: candidateId });
    if (error) throw dbError(error, 'Không tải được lịch sử phỏng vấn.');
    if (!data) throw new ApiError('Không tìm thấy hồ sơ ứng viên.', 404, 'NOT_FOUND');
    return data as { interviews: InterviewItem[]; profile: InterviewItem[] };
  },
  async createInterview(candidateId: number, values: Record<string, unknown>): Promise<void> {
    const v = validateInterview(values);
    if (Object.keys(v.errors).length) throw invalid(v.errors);
    const { error } = await supabase.from('interview_schedules').insert({ record_id: candidateId, ...v.clean, time: v.clean.time || null });
    if (error) throw error.code === '42501' ? new ApiError('Không tìm thấy hồ sơ ứng viên.', 404, 'NOT_FOUND') : dbError(error, 'Không thêm được buổi phỏng vấn.');
  },
  async updateInterview(id: number, values: Record<string, unknown>): Promise<void> {
    const { data: cur } = await supabase.from('interview_schedules').select('round, round_name, date, time, interviewer, result, feedback').eq('id', id).maybeSingle();
    if (!cur) throw noRow('buổi phỏng vấn');
    const merged: Record<string, unknown> = {};
    for (const k of ['round', 'round_name', 'date', 'time', 'interviewer', 'result', 'feedback']) merged[k] = values[k] !== undefined ? values[k] : (cur as Record<string, unknown>)[k] ?? '';
    const v = validateInterview(merged);
    if (Object.keys(v.errors).length) throw invalid(v.errors);
    const { data, error } = await supabase.from('interview_schedules').update({ ...v.clean, time: v.clean.time || null, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) throw dbError(error, 'Không lưu được buổi phỏng vấn.');
    if (!data?.length) throw noRow('buổi phỏng vấn');
  },
  async deleteInterview(id: number): Promise<void> {
    const { data, error } = await supabase.from('interview_schedules').delete().eq('id', id).select('id');
    if (error) throw dbError(error, 'Không xóa được buổi phỏng vấn.');
    if (!data?.length) throw noRow('buổi phỏng vấn');
  },

  // ---------------- checklist tuyển (M6-2). Hiển thị = hiringView dùng chung với Edge records-save.
  async getHiring(candidateId: number, candidate?: CandidateRecord): Promise<HiringState> {
    const { data, error } = await supabase.rpc('hiring_state', { p_record_id: candidateId });
    if (error) throw dbError(error, 'Không tải được checklist tuyển.');
    if (!data) throw new ApiError('Không tìm thấy hồ sơ ứng viên.', 404, 'NOT_FOUND');
    return hiringView((candidate || {}) as unknown as Record<string, unknown>, data as HiringRow);
  },
  /** Tick tay 1 mục (RLS hc_update: TA không sửa được khi đã xác nhận). */
  async setHiringItem(candidateId: number, key: string, done: boolean, candidate?: CandidateRecord): Promise<HiringState> {
    const item = HIRING_ITEMS.find((it) => it.key === key);
    if (!item || item.auto) throw new ApiError('Mục này không tick tay được.', 400, 'INVALID_INPUT');
    if (candidate && !hrEligible(candidate as unknown as Record<string, unknown>)) throw new ApiError('Chỉ dùng cho ứng viên đã đạt vòng 2.', 400, 'NOT_ELIGIBLE');
    const { data: st } = await supabase.rpc('hiring_state', { p_record_id: candidateId });
    const cur = st as HiringRow | null;
    if (!cur) throw new ApiError('Không tìm thấy hồ sơ ứng viên.', 404, 'NOT_FOUND');
    if (cur.confirmed) throw new ApiError('Đã xác nhận tuyển. Admin mở lại trước khi sửa.', 409, 'LOCKED');
    const { data: me } = await supabase.from('profiles').select('username').eq('id', await uid()).maybeSingle();
    const items = { ...(cur.items || {}), [key]: { done, by: me?.username || '', at: new Date().toISOString() } };
    const { error } = await supabase.from('hiring_checklists').upsert({ record_id: candidateId, items, updated_at: new Date().toISOString() });
    if (error) throw dbError(error, 'Không lưu được checklist.');
    return this.getHiring(candidateId, candidate);
  },
  /** Xác nhận tuyển (mọi người có quyền hồ sơ) / mở lại (Admin) qua Edge records-save – OB Status = Accepted nếu trống/Pending. */
  async confirmHiring(candidateId: number, confirmed: boolean): Promise<{ hiring: HiringState; ob_updated?: boolean }> {
    const { data, error } = await supabase.functions.invoke('records-save', { body: { op: confirmed ? 'confirm_hire' : 'reopen_hire', id: candidateId } });
    if (error) throw await fnError(error, 'Không thực hiện được xác nhận tuyển.');
    return data as { hiring: HiringState; ob_updated?: boolean };
  },

  // ---------------- target
  async getTargets(periodType: string, periodKey: string): Promise<{ period_type: string; period_key: string; from: string; to: string; targets: TargetRow[] }> {
    const type = (periodType || 'month') as TargetPeriod;
    if (!TARGET_PERIODS.includes(type)) throw new ApiError('Kỳ target không hợp lệ.', 400, 'INVALID_INPUT');
    const { data: tdy } = await supabase.rpc('rr_today');
    const key = periodKey || periodKeyOf(type, String(tdy || new Date().toISOString().slice(0, 10)));
    const range = periodRange(type, key);
    if (!range) throw new ApiError('Mã kỳ không đúng dạng (ngày YYYY-MM-DD, tuần YYYY-Www, tháng YYYY-MM, năm YYYY).', 400, 'INVALID_INPUT');
    const { data, error } = await supabase.rpc('target_list', { p_type: type, p_key: key, p_from: range[0], p_to: range[1] });
    if (error) throw dbError(error, 'Không tải được target.');
    return data as { period_type: string; period_key: string; from: string; to: string; targets: TargetRow[] };
  },
  /** Chỉ Admin (RLS tg_admin_write). Cùng kỳ + PIC + vị trí + phòng ban thì ghi đè (như hệ cũ). */
  async putTarget(t: Record<string, unknown>): Promise<void> {
    const type = String(t.period_type || '') as TargetPeriod;
    const key = String(t.period_key || '').trim();
    if (!TARGET_PERIODS.includes(type) || !periodRange(type, key)) throw invalid({ period_key: 'Kỳ target không hợp lệ.' });
    const value = Number(t.value);
    if (!Number.isFinite(value) || value < 0 || value > 100000 || Math.round(value) !== value) throw invalid({ value: 'Target phải là số nguyên từ 0 trở lên.' });
    const pic = String(t.pic || '').trim() || null;
    const { error } = await supabase.from('targets').upsert(
      { period_type: type, period_key: key, pic, position: String(t.position || '').trim(), dept: String(t.dept || '').trim().slice(0, 150), value, updated_at: new Date().toISOString() },
      { onConflict: 'period_type,period_key,pic,position,dept' }
    );
    if (error) throw error.code === '23503' ? invalid({ pic: 'Mã PIC không có trong Drop-list PIC.' }) : dbError(error, 'Không lưu được target.');
  },
  async deleteTarget(id: number): Promise<void> {
    const { data, error } = await supabase.from('targets').delete().eq('id', id).select('id');
    if (error) throw dbError(error, 'Không xóa được target.');
    if (!data?.length) throw noRow('target');
  },

  // ---------------- lịch
  async getCalendar(from: string, to: string, pic = ''): Promise<{ events: CalendarEvent[]; truncated: boolean; people_per_pic?: Record<string, number>; people_total?: number }> {
    const { data, error } = await supabase.rpc('calendar_range', { p_from: from, p_to: to, p_pic: pic });
    if (error) throw dbError(error, 'Không tải được lịch.');
    return data as { events: CalendarEvent[]; truncated: boolean; people_per_pic?: Record<string, number>; people_total?: number };
  },
  async createEvent(e: Record<string, unknown>): Promise<void> {
    const v = validateEvent(e);
    if (Object.keys(v.errors).length) throw invalid(v.errors);
    const { error } = await supabase.from('calendar_events').insert({
      ...v.clean, time: v.clean.time || null, end_time: v.clean.end_time || null, record_id: Number(e.candidate_id) || null,
    });
    if (error) throw error.code === '42501' ? new ApiError('Không tìm thấy hồ sơ ứng viên.', 404, 'NOT_FOUND') : dbError(error, 'Không tạo được sự kiện.');
  },
  async updateEvent(id: number, e: Record<string, unknown>): Promise<void> {
    const { data: cur } = await supabase.from('calendar_events').select('title, type, date, time, end_time, note').eq('id', id).maybeSingle();
    if (!cur) throw noRow('sự kiện');
    const merged: Record<string, unknown> = {};
    for (const k of ['title', 'type', 'date', 'time', 'end_time', 'note']) merged[k] = e[k] !== undefined ? e[k] : (cur as Record<string, unknown>)[k] ?? '';
    const v = validateEvent(merged);
    if (Object.keys(v.errors).length) throw invalid(v.errors);
    const { data, error } = await supabase.from('calendar_events').update({ ...v.clean, time: v.clean.time || null, end_time: v.clean.end_time || null }).eq('id', id).select('id');
    if (error) throw dbError(error, 'Không lưu được sự kiện.');
    if (!data?.length) throw new ApiError('Chỉ người tạo hoặc Admin mới sửa được sự kiện này.', 403, 'FORBIDDEN');
  },
  async deleteEvent(id: number): Promise<void> {
    const { data, error } = await supabase.from('calendar_events').delete().eq('id', id).select('id');
    if (error) throw dbError(error, 'Không xóa được sự kiện.');
    if (!data?.length) throw new ApiError('Chỉ người tạo hoặc Admin mới xóa được sự kiện này.', 403, 'FORBIDDEN');
  },
};

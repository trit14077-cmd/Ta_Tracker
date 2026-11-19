/**
 * Phase 5 and 6 rules shared by the browser and the Apps Script server: tasks, interview history, the hiring
 * checklist, target periods and calendar events. Dates are ISO (YYYY-MM-DD), times HH:mm.
 */

export const TASK_TYPES = ['Gọi điện', 'Hẹn phỏng vấn', 'Nhắc giấy tờ', 'Follow-up', 'Khác'];
export const TASK_PRIORITIES = ['Cao', 'Trung bình', 'Thấp'];
export const INTERVIEW_ROUNDS = ['R1', 'R2', 'Khác'];
export const INTERVIEW_RESULTS = ['', 'Pending', 'Passed', 'Failed', 'Canceled'];
export const EVENT_TYPES = ['Họp', 'Phỏng vấn', 'Follow-up', 'Khác'];
export const TARGET_PERIODS = ['day', 'week', 'month', 'year'] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];

/** Hiring Operation checklist. "auto" items are worked out from the profile; the others are ticked by the TA. */
export const HIRING_ITEMS: { key: string; label: string; auto: boolean }[] = [
  { key: 'offer_sent', label: 'Đã gửi offer', auto: false },
  { key: 'salary_agreed', label: 'Đã chốt lương đề xuất', auto: false },
  { key: 'offer_accepted', label: 'Ứng viên đã nhận offer', auto: false },
  { key: 'docs_complete', label: 'Đủ giấy tờ bắt buộc', auto: true },
  { key: 'hr_verified', label: 'Thông tin nhân sự đã xác nhận', auto: true },
  { key: 'ob_date_set', label: 'Đã có ngày onboard', auto: true },
];

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export function isTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
/** Monday-based ISO week: "2026-W47". */
export function isoWeekKey(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // Thursday of this week decides the year
  const year = date.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((date.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The period that contains a day. */
export function periodKeyOf(type: TargetPeriod, iso: string): string {
  if (type === 'day') return iso;
  if (type === 'month') return iso.slice(0, 7);
  if (type === 'year') return iso.slice(0, 4);
  return isoWeekKey(iso);
}

/** First and last day (inclusive) of a period, or null when the key does not fit the type. */
export function periodRange(type: TargetPeriod, key: string): [string, string] | null {
  if (type === 'day') return isIsoDate(key) ? [key, key] : null;
  if (type === 'year') return /^\d{4}$/.test(key) ? [`${key}-01-01`, `${key}-12-31`] : null;
  if (type === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
    return [`${key}-01`, `${key}-${String(last).padStart(2, '0')}`];
  }
  const w = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!w || +w[2] < 1 || +w[2] > 53) return null;
  // Monday of week 1 is the Monday on or before 4 January.
  const jan4 = new Date(Date.UTC(+w[1], 0, 4));
  const monday1 = addDays(jan4.toISOString().slice(0, 10), -((jan4.getUTCDay() + 6) % 7));
  const from = addDays(monday1, (+w[2] - 1) * 7);
  if (isoWeekKey(from) !== key) return null; // e.g. W53 in a 52-week year
  return [from, addDays(from, 6)];
}

export interface TaskInput {
  title: string;
  type: string;
  due: string;
  due_time: string;
  priority: string;
  note: string;
}
export function validateTask(t: Partial<TaskInput>): { clean: TaskInput; errors: Record<string, string> } {
  const clean: TaskInput = {
    title: String(t.title ?? '').trim().slice(0, 200),
    type: String(t.type ?? '').trim() || 'Khác',
    due: String(t.due ?? '').trim(),
    due_time: String(t.due_time ?? '').trim(),
    priority: String(t.priority ?? '').trim() || 'Trung bình',
    note: String(t.note ?? '').trim().slice(0, 2000),
  };
  const errors: Record<string, string> = {};
  if (!clean.title) errors.title = 'Hãy nhập tên công việc.';
  if (!TASK_TYPES.includes(clean.type)) errors.type = 'Loại công việc không hợp lệ.';
  if (!isIsoDate(clean.due)) errors.due = 'Hạn phải là một ngày hợp lệ.';
  if (clean.due_time && !isTime(clean.due_time)) errors.due_time = 'Giờ phải có dạng HH:mm.';
  if (!TASK_PRIORITIES.includes(clean.priority)) errors.priority = 'Mức ưu tiên không hợp lệ.';
  return { clean, errors };
}

export interface InterviewInput {
  round: string;
  round_name: string;
  date: string;
  time: string;
  interviewer: string;
  result: string;
  feedback: string;
}
export function validateInterview(v: Partial<InterviewInput>): { clean: InterviewInput; errors: Record<string, string> } {
  const clean: InterviewInput = {
    round: String(v.round ?? '').trim(),
    round_name: String(v.round_name ?? '').trim().slice(0, 100),
    date: String(v.date ?? '').trim(),
    time: String(v.time ?? '').trim(),
    interviewer: String(v.interviewer ?? '').trim().slice(0, 150),
    result: String(v.result ?? '').trim(),
    feedback: String(v.feedback ?? '').trim().slice(0, 3000),
  };
  const errors: Record<string, string> = {};
  if (!INTERVIEW_ROUNDS.includes(clean.round)) errors.round = 'Hãy chọn vòng phỏng vấn.';
  if (clean.round === 'Khác' && !clean.round_name) errors.round_name = 'Hãy ghi tên vòng phỏng vấn.';
  if (!isIsoDate(clean.date)) errors.date = 'Ngày phỏng vấn không hợp lệ.';
  if (clean.time && !isTime(clean.time)) errors.time = 'Giờ phải có dạng HH:mm.';
  if (!INTERVIEW_RESULTS.includes(clean.result)) errors.result = 'Kết quả không hợp lệ.';
  return { clean, errors };
}

export interface EventInput {
  title: string;
  type: string;
  date: string;
  time: string;
  end_time: string;
  note: string;
}
export function validateEvent(v: Partial<EventInput>): { clean: EventInput; errors: Record<string, string> } {
  const clean: EventInput = {
    title: String(v.title ?? '').trim().slice(0, 200),
    type: String(v.type ?? '').trim() || 'Khác',
    date: String(v.date ?? '').trim(),
    time: String(v.time ?? '').trim(),
    end_time: String(v.end_time ?? '').trim(),
    note: String(v.note ?? '').trim().slice(0, 2000),
  };
  const errors: Record<string, string> = {};
  if (!clean.title) errors.title = 'Hãy nhập tiêu đề sự kiện.';
  if (!EVENT_TYPES.includes(clean.type)) errors.type = 'Loại sự kiện không hợp lệ.';
  if (!isIsoDate(clean.date)) errors.date = 'Ngày không hợp lệ.';
  if (clean.time && !isTime(clean.time)) errors.time = 'Giờ bắt đầu phải có dạng HH:mm.';
  if (clean.end_time && !isTime(clean.end_time)) errors.end_time = 'Giờ kết thúc phải có dạng HH:mm.';
  if (clean.time && clean.end_time && clean.end_time <= clean.time) errors.end_time = 'Giờ kết thúc phải sau giờ bắt đầu.';
  return { clean, errors };
}

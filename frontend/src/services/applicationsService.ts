// M7-3: ứng tuyển online – trang công khai (Edge `apply`) và hộp "Ứng tuyển online" của TA/Admin (RPC 0024).
// Cùng giao diện các hàm của dataService hệ cũ (checkApplyLink, submitApplication, listApplications, …) để chép nguyên component.
import { supabase } from '../lib/supabase.ts';
import { ApiError, fnError } from './candidateService.ts';

/** What a candidate sends through the public application form. */
export interface ApplicationForm {
  full_name: string;
  phone: string;
  email: string;
  area: string;
  note: string;
  consent: boolean;
  /** Hidden honeypot field; people leave it empty. */
  website?: string;
  /** Hệ cũ gửi base64; hệ mới gửi thẳng file (multipart). */
  cv?: File | null;
}
/** One application in the staff inbox. */
export interface ApplicationItem {
  id: number;
  key: string;
  created_at: string;
  pic: string;
  full_name: string;
  phone: string;
  email: string;
  area: string;
  note: string;
  cv_name: string;
  status: 'new' | 'done' | 'skipped';
  candidate_code: string;
  handled_by: string;
  handled_at: string;
  dup: { count: number; codes: string[] } | null;
}

/** Trang tuyển dụng đi kèm app (khi Admin chưa đặt trang trên tên miền công ty). */
export function defaultApplyPage(): string {
  return typeof window !== 'undefined' ? `${window.location.origin}/apply.html` : '/apply.html';
}
function linkOf(code: string, pageUrl: string): string {
  const base = pageUrl || defaultApplyPage();
  return `${base}${base.includes('?') ? '&' : '?'}apply=${code}`;
}

async function rpc<T>(fn: string, args: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const status = /^PT\d{3}$/.test(error.code || '') ? Number(error.code.slice(2)) : 500;
    throw new ApiError(error.details || fallback, status, error.message || 'ERROR');
  }
  return data as T;
}

/** Lỗi mạng (không tới được máy chủ) => status 0 để trang tự gửi lại như hệ cũ. */
async function applyError(error: unknown, fallback: string): Promise<ApiError> {
  const ctx = (error as { context?: Response }).context;
  if (!ctx || typeof ctx.json !== 'function') return new ApiError('Mất kết nối. Đang thử lại…', 0, 'NETWORK');
  return fnError(error, fallback);
}

export const applicationsService = {
  /** Mã link (?apply=...) trên địa chỉ trang; '' = link chung. */
  launchApplyCode(): string {
    if (typeof window === 'undefined') return '';
    const c = new URLSearchParams(window.location.search).get('apply') || '';
    return /^[A-Za-z0-9]{12,40}$/.test(c) ? c : '';
  },
  /** Checks a public application link; returns the regions and provinces where the company recruits. */
  async checkApplyLink(code: string): Promise<{ regions: { region: string; locations: string[] }[] }> {
    const { data, error } = await supabase.functions.invoke('apply', { body: { op: 'info', code } });
    if (error) throw await applyError(error, 'Link ứng tuyển không đúng.');
    return { regions: (data as { regions?: { region: string; locations: string[] }[] }).regions || [] };
  },
  async submitApplication(code: string, form: ApplicationForm): Promise<{ received: boolean }> {
    const fd = new FormData();
    fd.append('op', 'submit');
    fd.append('code', code);
    for (const k of ['full_name', 'phone', 'email', 'area', 'note', 'website'] as const) fd.append(k, String(form[k] ?? ''));
    fd.append('consent', form.consent ? 'true' : 'false');
    if (form.cv) fd.append('cv', form.cv, form.cv.name);
    const { data, error } = await supabase.functions.invoke('apply', { body: fd });
    if (error) throw await applyError(error, 'Chưa gửi được hồ sơ. Vui lòng thử lại.');
    return data as { received: boolean };
  },

  // ----- nhân viên -----
  async listApplications(status: string, pic = ''): Promise<{
    items: ApplicationItem[];
    counts: Record<string, number>;
    links: { mine?: string; general?: string; page_url?: string };
  }> {
    const r = await rpc<{ items: ApplicationItem[]; counts: Record<string, number>; page_url: string | null }>(
      'applications_list', { p_status: status, p_pic: pic, p_count_only: false }, 'Không tải được hồ sơ ứng tuyển.');
    return { items: r.items, counts: r.counts, links: r.page_url === null ? {} : { page_url: r.page_url } };
  },
  async countApplications(): Promise<Record<string, number>> {
    return (await rpc<{ counts: Record<string, number> }>('applications_list', { p_status: 'new', p_pic: '', p_count_only: true }, '')).counts;
  },
  async applicationLink(pic: string): Promise<{ pic: string; url: string }> {
    const r = await rpc<{ pic: string; code: string; page_url: string }>('apply_link', { p_pic: pic }, 'Chưa lấy được link ứng tuyển.');
    return { pic: r.pic, url: linkOf(r.code, r.page_url) };
  },
  /** Admin: the careers page on the company domain that the links should use ('' = trang đi kèm app). */
  async setApplyPageUrl(url: string): Promise<{ page_url: string; link: string }> {
    const r = await rpc<{ page_url: string }>('apply_set_page_url', { p_url: url }, 'Chưa lưu được.');
    return { page_url: r.page_url, link: (await this.applicationLink('')).url };
  },
  async setApplicationStatus(app: { id: number; key: string }, status: 'new' | 'done' | 'skipped'): Promise<ApplicationItem> {
    return rpc('application_set_status', { p_id: app.id, p_status: status }, 'Không cập nhật được.');
  },
  async convertApplication(app: { id: number; key: string }, candidateId: number): Promise<{ application: ApplicationItem; cv_attached: boolean }> {
    return rpc('application_convert', { p_id: app.id, p_record_id: candidateId }, 'Chưa đánh dấu được hồ sơ ứng tuyển.');
  },
  async downloadApplicationCv(id: number, name = 'CV'): Promise<void> {
    const { data, error } = await supabase.functions.invoke('files', { body: { op: 'app_cv', application_id: id } });
    if (error) throw await fnError(error, 'Không tải được CV.');
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart]));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

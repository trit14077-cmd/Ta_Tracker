import { supabase } from '../lib/supabase.ts';
import { FIELD_CATALOG } from '../../../shared/fieldCatalog.ts';
import {
  formatIsoDateToDisplay,
  computeObMonth,
  normalizeAndValidatePhone,
  sanitizeCellForSpreadsheet,
  type DropdownConfigBundle,
} from '../../../shared/validation.ts';
import { INITIAL_DROPDOWN_LISTS } from '../../../shared/seedData.ts';
import { buildConfig } from '../../../supabase/functions/records-save/logic.ts';
import type { DupInfo } from '../../../shared/dup.ts';

export interface CandidateRecord {
  id: number;
  row_version: number;
  is_archived: boolean;
  updated_at: string;
  dup?: DupInfo | null;
  cccd_dup?: DupInfo | null;
  tenor?: string;
  board_col?: string;
  board_sub?: string;
  cv_file?: string | null;
  [fieldKey: string]: unknown;
}

export interface CandidateListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
  pic?: string;
  position?: string;
  site?: string;
  source?: string;
  r1_status?: string;
  r2_status?: string;
  ob_status?: string;
  emp_status?: string;
  tenor?: string;
  date_from?: string;
  date_to?: string;
  ob_month?: string;
  region?: string;
  location?: string;
  archived?: boolean;
  dup?: boolean;
  box?: string;
  sub?: string;
}

export interface CandidateListResponse {
  items: CandidateRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CandidateComment {
  id: number;
  candidate_id: number;
  author_username: string;
  author_role: 'admin' | 'pic';
  body: string;
  created_at: string;
  updated_at: string;
}

export interface DropdownDataResponse extends DropdownConfigBundle {
  pics: string[];
  listMeta?: { listKey: string; label: string }[];
}

export interface ColumnPrefs {
  visible: string[] | null;
  order: string[];
}

export interface FormInfo {
  id: number;
  pic_code: string;
  form_code: string;
  link: string;
  status: 'active' | 'disabled' | 'none';
  template_version: number;
  created_at: string;
  link_reset_at: string;
  last_submit_at: string;
  submissions: number;
}

export interface AttachmentKindInfo {
  key: string;
  label: string;
  hint: string;
  applicable: boolean;
}

export interface AttachmentInfo {
  id: number;
  candidate_id: number;
  kind: string;
  file_name: string;
  size: number;
  uploaded_by: string;
  uploaded_at: string;
}

export interface HrInfoRecord {
  data: Record<string, string>;
  status: 'draft' | 'submitted' | 'verified';
  updated_by: string;
  updated_at: string;
  verified_by: string;
  verified_at: string;
}

export interface HrDuplicates {
  count: number;
  own: string[];
  others: number;
  with: { code: string; pic: string }[];
}

export interface HrFormResponse {
  info: HrInfoRecord | null;
  history?: unknown[];
}

/** Thẻ Kanban (= boardCard_ của Pipeline.gs; RPC board_page / board_cards – 0013). */
export interface BoardCard {
  id: number;
  candidate_code: string;
  full_name: string;
  phone: string;
  pic: string;
  position: string;
  region: string;
  location: string;
  site: string;
  row_version: number;
  updated_at: string;
  failed_at: '' | 'r1' | 'r2' | 'ob';
}
export interface BoardFilters {
  position?: string;
  region?: string;
}
export interface BoardData {
  counts: Record<string, { total: number; failed: number }>;
  columns: Record<string, BoardCard[]>;
  page_size: number;
}
/** Một lần chuyển vòng bằng Kanban (status_history STAGE_MOVE + người làm từ audit_logs – RPC stage_history). */
export interface StageHistoryItem {
  id: number;
  created_at: string;
  actor_username: string;
  from_box: string;
  to_box: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  currentRow?: CandidateRecord;

  constructor(message: string, status: number, code: string, fields?: Record<string, string>, currentRow?: CandidateRecord) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.currentRow = currentRow;
  }
}

/** Hydrate raw database row into format ready for display & inline editing */
export function hydrateCandidate(raw: Record<string, unknown>): CandidateRecord {
  const out: CandidateRecord = {
    id: Number(raw.id),
    row_version: Number(raw.row_version || 1),
    is_archived: Boolean(raw.is_archived),
    updated_at: String(raw.updated_at || ''),
    dup: (raw.dup as DupInfo) || null,
    cccd_dup: (raw.cccd_dup as DupInfo) || null,
    tenor: String(raw.tenor || ''),
    board_col: String(raw.board_col || ''),
    board_sub: String(raw.board_sub || ''),
    cv_file: raw.cv_file ? String(raw.cv_file) : null,
  };

  for (const f of FIELD_CATALOG) {
    const val = raw[f.key] != null ? String(raw[f.key]) : '';
    if (f.type === 'date') {
      out[f.key] = formatIsoDateToDisplay(val);
      out[`${f.key}_iso`] = val;
    } else if (f.key === 'ob_month') {
      out.ob_month = computeObMonth(String(raw.ob_date || ''));
    } else {
      out[f.key] = val;
    }
  }

  // Retain any remaining fields
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in out)) out[k] = v;
  }

  return out;
}

/** Chức năng thuộc giai đoạn sau: báo rõ thay vì giả vờ thành công. */
const notYet = (what: string, phase: string) =>
  new ApiError(`${what} chưa có trong hệ thống mới (làm ở ${phase}). Trong thời gian chuyển đổi, vui lòng dùng hệ thống cũ cho việc này.`, 501, 'NOT_AVAILABLE');

type DupRow = { id: number; candidate_code: string; full_name: string; pic: string; position?: string };

/** Lỗi từ Edge Function ({error:{code,message,fields,details}}) -> ApiError mà các màn hình cũ hiểu.
 *  VERSION_CONFLICT đổi thành ROW_CONFLICT + currentRow như API cũ (ConflictResolutionModal). */
async function fnError(error: unknown, fallback: string): Promise<ApiError> {
  const ctx = (error as { context?: Response }).context;
  let status = 500;
  let body: { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: { current?: Record<string, unknown> } } } = {};
  if (ctx && typeof ctx.json === 'function') {
    status = ctx.status || 500;
    try {
      body = await ctx.json();
    } catch {
      body = {};
    }
  }
  const e = body.error || {};
  if (e.code === 'VERSION_CONFLICT') {
    const cur = e.details?.current;
    return new ApiError(e.message || 'Hồ sơ vừa được người khác cập nhật.', 409, 'ROW_CONFLICT', undefined, cur ? hydrateCandidate(cur) : undefined);
  }
  return new ApiError(e.message || fallback, status, e.code || 'ERROR', e.fields);
}

async function callRecordsSave(body: Record<string, unknown>, fallback: string) {
  const { data, error } = await supabase.functions.invoke('records-save', { body });
  if (error) throw await fnError(error, fallback);
  const res = data as { record: Record<string, unknown>; notices?: Record<string, string>; duplicates?: { phone?: DupRow[] } };
  return { candidate: hydrateCandidate(res.record), notices: res.notices || {}, phoneDuplicates: res.duplicates?.phone || [] };
}

const COLS_KEY = 'ta_col_prefs';
const LIST_LABELS: Record<string, string> = Object.fromEntries(INITIAL_DROPDOWN_LISTS.map((l) => [l.listKey, l.label]));

function toComment(c: Record<string, unknown>): CandidateComment {
  return {
    id: Number(c.id),
    candidate_id: Number(c.record_id),
    author_username: String(c.author_username || ''),
    author_role: c.author_role === 'admin' ? 'admin' : 'pic',
    body: String(c.body || ''),
    created_at: String(c.created_at || ''),
    updated_at: String(c.updated_at || ''),
  };
}

export const candidateService = {
  async listCandidates(params: CandidateListParams): Promise<CandidateListResponse> {
    const filters: Record<string, string> = {};
    const exactKeys = ['pic', 'position', 'site', 'source', 'r1_status', 'r2_status', 'ob_status', 'emp_status', 'ob_month', 'region', 'location'] as const;
    for (const k of exactKeys) if (params[k]) filters[k] = params[k]!;
    const { data, error } = await supabase.rpc('list_candidates', {
      p_page: params.page || 1,
      p_page_size: params.pageSize || 25,
      p_sort_by: params.sortBy || 'id',
      p_sort_dir: params.sortDir || 'desc',
      p_search: params.search || '',
      p_filters: filters,
      p_box: params.box || '',
      p_sub: params.sub || '',
      p_tenor: params.tenor || '',
      p_dup: Boolean(params.dup),
      p_archived: Boolean(params.archived),
      p_date_from: params.date_from || '',
      p_date_to: params.date_to || '',
    });
    if (error) throw new ApiError('Không tải được danh sách ứng viên.', 500, error.code || 'LIST_FAILED');
    const res = data as { items: Record<string, unknown>[]; total: number; page: number; pageSize: number; totalPages: number };
    return {
      items: (res.items || []).map(hydrateCandidate),
      total: Number(res.total || 0),
      page: Number(res.page || 1),
      pageSize: Number(res.pageSize || 25),
      totalPages: Number(res.totalPages || 1),
    };
  },

  async getCandidate(id: number): Promise<CandidateRecord> {
    const { data, error } = await supabase.rpc('get_candidate', { p_id: id });
    if (error || !data) throw new ApiError('Không tìm thấy hồ sơ ứng viên.', 404, 'NOT_FOUND');
    return hydrateCandidate(data as Record<string, unknown>);
  },

  async createCandidate(record: Record<string, unknown>): Promise<{ candidate: CandidateRecord; notices: Record<string, string>; phoneDuplicates: DupRow[] }> {
    return callRecordsSave({ op: 'create', values: record }, 'Không tạo được hồ sơ.');
  },

  async updateCandidate(id: number, payload: { row_version?: number; [key: string]: unknown }) {
    const { row_version, id: _id, ...changes } = payload;
    return callRecordsSave({ op: 'patch', id, expected_version: Number(row_version || 0), changes }, 'Không lưu được hồ sơ.');
  },

  async toggleArchiveCandidate(id: number, archived: boolean, rowVersion = 1): Promise<CandidateRecord> {
    const r = await callRecordsSave({ op: archived ? 'archive' : 'restore', id, expected_version: rowVersion }, 'Không lưu trữ được hồ sơ.');
    return r.candidate;
  },

  async moveCandidate(id: number, to: string, rowVersion: number): Promise<CandidateRecord> {
    const r = await callRecordsSave({ op: 'move', id, expected_version: rowVersion, target_box: to }, 'Không chuyển được hồ sơ.');
    return r.candidate;
  },

  supportsAttachments(): boolean {
    return true; // bật thanh KPI + banner HR; thao tác file/HR chưa làm sẽ báo NOT_AVAILABLE
  },
  supportsWorkspaces(): boolean {
    return false; // D-09: bỏ workspace
  },

  async nextCandidateCode(pic: string): Promise<string> {
    if (!pic) return '';
    const { data, error } = await supabase.rpc('next_candidate_code', { p_pic: pic });
    return !error && typeof data === 'string' ? data : '';
  },

  /** Xuất CSV theo bộ lọc đang xem (TA chỉ hồ sơ của mình nhờ RLS), chống formula injection như hệ cũ. */
  async downloadCandidatesExport(params: CandidateListParams): Promise<void> {
    const items: CandidateRecord[] = [];
    for (let page = 1; ; page++) {
      const res = await this.listCandidates({ ...params, page, pageSize: 200 });
      items.push(...res.items);
      if (page >= res.totalPages) break;
    }
    const headers = FIELD_CATALOG.map((f) => f.excelHeader || f.label);
    const rows = items.map((item) => FIELD_CATALOG.map((f) => sanitizeCellForSpreadsheet(item[f.key] ?? '')));
    const csv = '﻿' + [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidates_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ===== file CV / giấy tờ / đính kèm: Edge `files` + Google Drive (D-03) – M7-1 =====
  async uploadCv(_id: number, _file: File): Promise<CandidateRecord> {
    throw notYet('Tải file CV', 'M7-1');
  },
  async downloadCv(_id: number, _fileName: string): Promise<void> {
    throw notYet('Tải xuống CV', 'M7-1');
  },
  async deleteCv(_id: number): Promise<CandidateRecord> {
    throw notYet('Xóa file CV', 'M7-1');
  },
  async uploadDoc(_id: number, _key: string, _file: File): Promise<CandidateRecord> {
    throw notYet('Tải giấy tờ', 'M7-1');
  },
  async downloadDoc(_id: number, _key: string, _fileName: string): Promise<void> {
    throw notYet('Tải xuống giấy tờ', 'M7-1');
  },
  async deleteDoc(_id: number, _key: string): Promise<CandidateRecord> {
    throw notYet('Xóa giấy tờ', 'M7-1');
  },
  async listAttachments(_candidateId: number): Promise<{ kinds: AttachmentKindInfo[]; attachments: AttachmentInfo[]; max_per_kind: number }> {
    return { kinds: [], attachments: [], max_per_kind: 20 };
  },
  async uploadAttachment(_candidateId: number, _kind: string, _file: File): Promise<{ message?: string; attachment?: AttachmentInfo }> {
    throw notYet('Đính kèm file', 'M7-1');
  },
  async deleteAttachment(_candidateId: number, _attachmentId: number): Promise<void> {
    throw notYet('Xóa đính kèm', 'M7-1');
  },

  // ===== Drop-list =====
  /** Đề xuất thêm giá trị Drop-list (TA) – Admin duyệt (bảng dropdown_requests, RLS ddreq_insert). */
  async submitDropdownRequest(payload: { listKey: string; proposedValue: string; parentValue?: string; mappedSource?: string; reason?: string }): Promise<void> {
    const { error } = await supabase.from('dropdown_requests').insert({
      list_key: payload.listKey,
      proposed_value: payload.proposedValue.trim(),
      parent_value: payload.parentValue || '',
      mapped_source: payload.mappedSource || '',
      reason: payload.reason || '',
    });
    if (error) throw new ApiError('Không gửi được đề xuất. Vui lòng thử lại.', 400, 'DROPDOWN_REQUEST_FAILED');
  },

  async getDropdowns(): Promise<DropdownDataResponse> {
    const [o, p, s, h] = await Promise.all([
      supabase.from('dropdown_options').select('list_key, value, active').order('sort_order'),
      supabase.from('pics').select('code, active').order('sort_order').order('code'),
      supabase.from('sub_source_map').select('sub_source, source'),
      supabase.from('hierarchy').select('parent_type, parent_value, child_value'),
    ]);
    if (o.error || p.error || s.error || h.error) throw new ApiError('Không tải được danh mục Drop-list.', 500, 'DROPDOWNS_FAILED');
    const cfg = buildConfig(o.data!, p.data!, s.data!, h.data!);
    const listMeta = Object.keys(cfg.lists).filter((k) => k !== 'pic').map((k) => ({ listKey: k, label: LIST_LABELS[k] || k }));
    return { ...cfg, pics: p.data!.filter((x) => x.active).map((x) => x.code), listMeta };
  },

  // ===== HR Info: đọc được; ghi qua Edge hr-info-save (validate hrInfoRules) – M6-4 =====
  async getHrInfo(candidateId: number): Promise<{ info: HrInfoRecord | null }> {
    const { data, error } = await supabase.from('hr_info').select('data, status, updated_at, verified_at').eq('record_id', candidateId).maybeSingle();
    if (error || !data) return { info: null };
    return {
      info: {
        data: (data.data as Record<string, string>) || {},
        status: data.status as HrInfoRecord['status'],
        updated_by: '',
        updated_at: data.updated_at || '',
        verified_by: '',
        verified_at: data.verified_at || '',
      },
    };
  },
  async hrFormLink(_candidateId: number): Promise<{ url: string }> {
    throw notYet('Link Google Form thông tin nhân sự', 'M6-4');
  },
  async saveHrInfo(_candidateId: number, _data: Record<string, string>): Promise<void> {
    throw notYet('Lưu thông tin nhân sự', 'M6-4');
  },
  async verifyHrInfo(_candidateId: number): Promise<void> {
    throw notYet('Xác nhận thông tin nhân sự', 'M6-4');
  },
  async checkHrDuplicates(_candidateId: number, _idNumber: string): Promise<HrDuplicates> {
    return { count: 0, own: [], others: 0, with: [] };
  },

  async getMyForm(): Promise<FormInfo | null> {
    return null; // D-09: bỏ form nhập riêng mỗi TA
  },

  async checkPhoneDuplicate(phone: string, excludeCandidateCodeOrId?: string | number): Promise<{
    normalized: string; wasNormalized: boolean; notice?: string; duplicates: DupRow[];
  }> {
    const norm = normalizeAndValidatePhone(phone);
    const excludeId = typeof excludeCandidateCodeOrId === 'number' ? excludeCandidateCodeOrId : null;
    const { data, error } = await supabase.rpc('check_phone', { p_phone: norm.normalized || phone, p_exclude_id: excludeId });
    const dups = !error && data ? ((data as { duplicates?: DupRow[] }).duplicates || []) : [];
    return { normalized: norm.normalized, wasNormalized: norm.wasNormalized, notice: norm.notice, duplicates: dups };
  },

  // ===== thẻ KPI: đếm ở server (RPC board_counts), không tải dòng về trình duyệt =====
  /** Số thẻ + 30 thẻ đầu mỗi ô. pic chỉ có tác dụng với Admin (server bỏ qua với TA, như hệ cũ). */
  async getBoard(pic: string, q: string, extra: BoardFilters = {}): Promise<BoardData> {
    const { data, error } = await supabase.rpc('board_page', { p_filters: { pic, ...extra }, p_q: q });
    if (error || !data) throw new ApiError('Không tải được Kanban.', 500, error?.code || 'BOARD_FAILED');
    return data as BoardData;
  },
  peekBoard(_pic: string, _q: string, _extra: BoardFilters = {}): BoardData | null {
    return null; // hệ cũ giữ bản sao trong bộ nhớ đệm trình duyệt; bản mới tải thẳng (RPC nhanh)
  },
  async getBoardCards(col: string, offset: number, pic: string, q: string, extra: BoardFilters = {}): Promise<{ cards: BoardCard[]; total: number }> {
    const { data, error } = await supabase.rpc('board_cards', { p_col: col, p_offset: offset, p_filters: { pic, ...extra }, p_q: q });
    if (error || !data) throw new ApiError('Không tải thêm được thẻ.', 500, error?.code || 'BOARD_FAILED');
    return data as { cards: BoardCard[]; total: number };
  },
  async getStageHistory(recordId: number): Promise<StageHistoryItem[]> {
    const { data, error } = await supabase.rpc('stage_history', { p_record_id: recordId });
    if (error) throw new ApiError('Không tải được lịch sử chuyển vòng.', 500, error.code || 'HISTORY_FAILED');
    return ((data as Record<string, unknown>[]) || []).map((h) => ({
      id: Number(h.id), created_at: String(h.at || ''), actor_username: String(h.actor_username || ''),
      from_box: String(h.from_box || ''), to_box: String(h.to_box || ''),
    }));
  },

  async getBoardCounts(pic?: string): Promise<{ counts: Record<string, { total: number; failed: number }>; subs: Record<string, number> }> {
    const { data, error } = await supabase.rpc('board_counts', { p_pic: pic || '' });
    if (error || !data) throw new ApiError('Không tải được số liệu thẻ KPI.', 500, 'BOARD_COUNTS_FAILED');
    return data as { counts: Record<string, { total: number; failed: number }>; subs: Record<string, number> };
  },
  peekBoardCounts(_pic?: string): { counts: Record<string, { total: number; failed: number }>; subs: Record<string, number> } | null {
    return null;
  },
  peekCandidates(_params?: CandidateListParams): CandidateListResponse | null {
    return null;
  },

  // ===== cột hiển thị: lưu theo người dùng ở bảng user_preferences (bản sao trong trình duyệt để hiện ngay) =====
  peekColumnPrefs(): ColumnPrefs | null {
    try {
      const v = localStorage.getItem(COLS_KEY);
      return v ? (JSON.parse(v) as ColumnPrefs) : null;
    } catch {
      return null;
    }
  },
  async getColumnPrefs(): Promise<ColumnPrefs> {
    const { data } = await supabase.from('user_preferences').select('columns').maybeSingle();
    const prefs = (data?.columns as ColumnPrefs) || this.peekColumnPrefs() || { visible: null, order: [] };
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(prefs));
    } catch {
      // trình duyệt chặn lưu trữ: chỉ không nhớ bản sao
    }
    return prefs;
  },
  /** Trả ngay (màn hình cũ gọi đồng bộ), ghi DB phía sau. */
  setColumnPrefs(prefs: ColumnPrefs): ColumnPrefs {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(prefs));
    } catch {
      // bỏ qua
    }
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) void supabase.from('user_preferences').upsert({ user_id: data.user.id, columns: prefs });
    });
    return prefs;
  },

  // ===== bình luận (RLS: chỉ hồ sơ mình xem được; tác giả lấy từ tài khoản) =====
  async getComments(candidateId: number): Promise<CandidateComment[]> {
    const { data, error } = await supabase
      .from('comments')
      .select('id, record_id, author_username, author_role, body, created_at, updated_at')
      .eq('record_id', candidateId)
      .order('created_at', { ascending: true });
    if (error) throw new ApiError('Không tải được bình luận.', 500, error.code);
    return (data || []).map(toComment);
  },
  async addComment(candidateId: number, body: string): Promise<CandidateComment> {
    const { data, error } = await supabase
      .from('comments')
      .insert({ record_id: candidateId, body: body.trim() })
      .select('id, record_id, author_username, author_role, body, created_at, updated_at')
      .single();
    if (error) throw new ApiError('Không thêm được bình luận.', 500, error.code);
    return toComment(data);
  },
  async editComment(id: number, body: string): Promise<void> {
    const { data, error } = await supabase.from('comments').update({ body: body.trim() }).eq('id', id).select('id');
    if (error || !data?.length) throw new ApiError('Không sửa được bình luận (chỉ tác giả hoặc Admin).', 403, 'FORBIDDEN');
  },
  async deleteComment(id: number): Promise<void> {
    const { data, error } = await supabase.from('comments').delete().eq('id', id).select('id');
    if (error || !data?.length) throw new ApiError('Không xóa được bình luận (chỉ tác giả hoặc Admin).', 403, 'FORBIDDEN');
  },
};

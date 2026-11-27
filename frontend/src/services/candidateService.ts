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
import { downloadXlsx } from './xlsxDownload.ts';
import { translationHash } from '../../../shared/attachmentRules.ts';
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

/** Bản tiếng Anh của 1 ô chữ tự do (= TranslationInfo của hệ cũ; RPC 0023). */
export interface TranslationInfo {
  field_key: string;
  source_text: string;
  en_text: string;
  status: 'none' | 'translated' | 'outdated';
  updated_by: string;
  updated_at: string;
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

type DupRow = { id: number; candidate_code: string; full_name: string; pic: string; position?: string };

/** Lỗi từ Edge Function ({error:{code,message,fields,details}}) -> ApiError mà các màn hình cũ hiểu.
 *  VERSION_CONFLICT đổi thành ROW_CONFLICT + currentRow như API cũ (ConflictResolutionModal). */
export async function fnError(error: unknown, fallback: string): Promise<ApiError> {
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

// ----- Edge `files` (M7-1) -----
async function filesCall<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('files', { body });
  if (error) throw await fnError(error, fallback);
  return data as T;
}
async function filesUpload(recordId: number, kind: string, file: File, replaceId?: number) {
  const fd = new FormData();
  fd.append('op', 'upload');
  fd.append('record_id', String(recordId));
  fd.append('kind', kind);
  if (replaceId) fd.append('file_id', String(replaceId));
  fd.append('file', file, file.name);
  const { data, error } = await supabase.functions.invoke('files', { body: fd });
  if (error) throw await fnError(error, 'Không tải được file lên.');
  return data as { file: Record<string, unknown>; record: Record<string, unknown> };
}
async function filesDownload(body: Record<string, unknown>, fileName: string): Promise<void> {
  const data = await filesCall<Blob>({ op: 'download', ...body }, 'Không tải được file.');
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart]));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const COLS_KEY = 'ta_col_prefs';

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
    // = hệ cũ: file .xlsx, mọi cột theo fieldCatalog (tên cột Excel), giá trị như trên màn hình, chặn công thức (sanitize)
    const headers = FIELD_CATALOG.map((f) => f.excelHeader);
    const rows = items.map((item) => FIELD_CATALOG.map((f) => sanitizeCellForSpreadsheet(item[f.key] ?? '')));
    const stamp = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    await downloadXlsx(`TA_TRACKER_UngVien_${stamp}.xlsx`, [headers, ...rows], 'TA_Tracker_Candidates');
  },

  // ===== file CV / giấy tờ / đính kèm: Edge `files` + Google Drive (M7-1) =====
  async uploadCv(id: number, file: File): Promise<CandidateRecord> {
    return hydrateCandidate((await filesUpload(id, 'cv', file)).record);
  },
  async downloadCv(id: number, fileName: string): Promise<void> {
    await filesDownload({ record_id: id, kind: 'cv' }, fileName);
  },
  async deleteCv(id: number): Promise<CandidateRecord> {
    return hydrateCandidate((await filesCall<{ record: Record<string, unknown> }>({ op: 'delete', record_id: id, kind: 'cv' }, 'Không xóa được file CV.')).record);
  },
  async uploadDoc(id: number, key: string, file: File): Promise<CandidateRecord> {
    return hydrateCandidate((await filesUpload(id, key, file)).record);
  },
  async downloadDoc(id: number, key: string, fileName: string): Promise<void> {
    await filesDownload({ record_id: id, kind: key }, fileName);
  },
  async deleteDoc(id: number, key: string): Promise<CandidateRecord> {
    return hydrateCandidate((await filesCall<{ record: Record<string, unknown> }>({ op: 'delete', record_id: id, kind: key }, 'Không xóa được file.')).record);
  },
  async listAttachments(candidateId: number): Promise<{ kinds: AttachmentKindInfo[]; attachments: AttachmentInfo[]; max_per_kind: number }> {
    return filesCall({ op: 'list', record_id: candidateId }, 'Không tải được danh sách tài liệu.');
  },
  async uploadAttachment(candidateId: number, kind: string, file: File, replaceId?: number): Promise<{ message?: string; attachment?: AttachmentInfo }> {
    const r = await filesUpload(candidateId, kind, file, replaceId);
    return { attachment: r.file as unknown as AttachmentInfo };
  },
  async downloadAttachment(candidateId: number, attachmentId: number, fileName: string): Promise<void> {
    await filesDownload({ record_id: candidateId, file_id: attachmentId }, fileName);
  },
  async deleteAttachment(candidateId: number, attachmentId: number): Promise<void> {
    await filesCall({ op: 'delete', record_id: candidateId, file_id: attachmentId }, 'Không xóa được file.');
  },

  // ===== bản tiếng Anh (M7-2, RPC 0023): trạng thái tính như transStatus_ của hệ cũ =====
  async getTranslations(candidateId: number): Promise<TranslationInfo[]> {
    const { data, error } = await supabase.rpc('translation_list', { p_record_id: candidateId });
    if (error) throw new ApiError(error.details || 'Không tải được bản dịch.', 404, error.message || 'NOT_FOUND');
    return ((data || []) as (Omit<TranslationInfo, 'status'> & { source_hash: string })[]).map(({ source_hash, ...t }) => ({
      ...t,
      status: !t.en_text ? 'none' : source_hash === translationHash(t.source_text) ? 'translated' : 'outdated',
    }));
  },
  async putTranslation(candidateId: number, fieldKey: string, enText: string): Promise<void> {
    const list = await this.getTranslations(candidateId);
    const source = list.find((t) => t.field_key === fieldKey)?.source_text ?? '';
    const { error } = await supabase.rpc('translation_save', {
      p_record_id: candidateId, p_field_key: fieldKey, p_en_text: enText, p_source_hash: translationHash(source),
    });
    if (error) throw new ApiError(error.details || 'Không lưu được bản dịch.', 400, error.message || 'TRANSLATION_FAILED');
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
    // = hGetDropdowns_ của hệ cũ: mọi danh mục trong INITIAL_DROPDOWN_LISTS (có PIC – Admin quản lý ở trang Drop-list)
    const listMeta = INITIAL_DROPDOWN_LISTS.map((m) => ({ listKey: m.listKey, label: m.label }));
    return { ...cfg, pics: p.data!.filter((x) => x.active).map((x) => x.code), listMeta };
  },

  // ===== HR Info: đọc được; ghi qua Edge hr-info-save (validate hrInfoRules) – M6-4 =====
  // HR Info / Google Form HR: services/hrService.ts (M6-4).

  async getMyForm(): Promise<FormInfo | null> {
    return null; // D-09: bỏ form nhập riêng mỗi TA
  },

  async checkPhoneDuplicate(phone: string, excludeCandidateCodeOrId?: string | number): Promise<{
    normalized: string; wasNormalized: boolean; notice?: string; duplicates: DupRow[]; checkFailed?: boolean;
  }> {
    const norm = normalizeAndValidatePhone(phone);
    const excludeId = typeof excludeCandidateCodeOrId === 'number' ? excludeCandidateCodeOrId : null;
    const { data, error } = await supabase.rpc('check_phone', { p_phone: norm.normalized || phone, p_exclude_id: excludeId });
    const dups = !error && data ? ((data as { duplicates?: DupRow[] }).duplicates || []) : [];
    return { normalized: norm.normalized, wasNormalized: norm.wasNormalized, notice: norm.notice, duplicates: dups, checkFailed: !!error };
  },

  async checkEmailDuplicate(email: string, excludeId?: number | null): Promise<{ duplicates: DupRow[]; checkFailed: boolean }> {
    const { data, error } = await supabase.rpc('check_email', { p_email: email.trim(), p_exclude_id: excludeId ?? null });
    const dups = !error && data ? ((data as { duplicates?: DupRow[] }).duplicates || []) : [];
    return { duplicates: dups, checkFailed: !!error };
  },

  /** Task #14: hồ sơ khác cùng Mã nhân viên (Emp_ID). Chỉ cảnh báo, không chặn lưu. */
  async checkEmpIdDuplicate(empId: string, excludeId?: number | null): Promise<{ duplicates: DupRow[]; checkFailed: boolean }> {
    const { data, error } = await supabase.rpc('check_emp_id', { p_emp_id: empId.trim(), p_exclude_id: excludeId ?? null });
    const dups = !error && data ? ((data as { duplicates?: DupRow[] }).duplicates || []) : [];
    return { duplicates: dups, checkFailed: !!error };
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

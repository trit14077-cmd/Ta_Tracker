// Quy trình 1 – tạo mã ghế. Ghi trực tiếp bảng seat_requests (RLS + trigger, migration 0038); cấp mã qua RPC seat_issue_codes.
// Kiểm dữ liệu bằng chính shared/seatCodeRules (cùng quy tắc với DB). Xuất file đúng cột tab NhapLieu.
import { supabase } from '../lib/supabase.ts';
import { downloadXlsx } from './xlsxDownload.ts';
import {
  SEAT_ORG_LEVELS,
  SEAT_ORG_MSG_DUP,
  SEAT_ORG_MSG_HOLE,
  parseSeatOrgDbError,
  seatOrgClean,
  seatOrgError,
  seatOrgPathError,
  seatOrgRenamePlan,
  type SeatOrgLevel,
  type SeatOrgPath,
} from '../../../shared/seatOrgTree.ts';
import {
  SEAT_EXPORT_HEADERS,
  toSeatExportRow,
  validateSeatRequest,
  type SeatInput,
  type SeatInputKey,
  type SeatStatus,
} from '../../../shared/seatCodeRules.ts';

export interface SeatRequest extends Omit<SeatInput, 'so_luong'> {
  id: number;
  owner_id: string;
  status: SeatStatus;
  ngay_gui: string | null;
  so_luong: number;
  ma_ghe: string[];
  cost_center: string;
  created_at: string;
  issued_at: string | null;
  owner?: { username: string; full_name: string } | null;
}

/** Một dòng của RPC seat_summary (0039). */
export interface SeatSummaryRow {
  thang: string;
  ta: string;
  vung: string;
  status: SeatStatus;
  so_dong: number;
  so_ghe: number;
}

/** Một nhánh của cây đơn vị (bảng seat_org_paths, 0041) – màn hình admin thấy cả nhánh đã tắt. */
export interface SeatOrgRow extends SeatOrgPath {
  id: number;
  active: boolean;
  created_at: string;
}

export class SeatValidationError extends Error {
  constructor(public errors: Partial<Record<SeatInputKey, string>>) {
    super('Dữ liệu chưa đạt quy tắc nhập.');
    this.name = 'SeatValidationError';
  }
}

// Mã lỗi từ trigger/RPC (migration 0038) → câu tiếng Việt cho người dùng.
const SEAT_ERRORS: [string, string][] = [
  ['SEAT_ISSUED_LOCKED', 'Dòng đã cấp mã ghế, không sửa được.'],
  ['SEAT_ADMIN_ONLY', 'Chỉ HRSS (admin) thực hiện bước này.'],
  ['SEAT_BAD_TRANSITION', 'Chuyển trạng thái không hợp lệ.'],
  ['SEAT_CODE_LOCKED', 'Mã ghế chỉ được cấp qua chức năng cấp mã.'],
  ['SEAT_CODE_RANGE_EXHAUSTED', 'Hết dải mã 8 chữ số.'],
  ['SEAT_COUNTER_NO_ROLLBACK', 'Không được đặt bộ đếm lùi lại, sẽ cấp trùng mã.'],
  ['SEAT_COUNTER_RANGE', 'Giá trị bộ đếm phải là số 8 chữ số hợp lệ.'],
];

function seatError(e: { message?: string; code?: string } | null, fallback: string): Error {
  const msg = e?.message ?? '';
  const org = parseSeatOrgDbError(msg);  // 0041: Ban → Đơn vị → Phòng → Đội → Tổ sai nhánh
  if (org) return new SeatValidationError({ [org.key]: org.msg });
  const hit = SEAT_ERRORS.find(([code]) => msg.includes(code));
  if (hit) return new Error(hit[1]);
  if (e?.code === '42501') return new Error('Bạn không có quyền thực hiện thao tác này.');
  if (e?.code === '23514') return new Error('Dữ liệu không đạt quy tắc nhập (kiểm tra lại các trường).');
  return new Error(fallback);
}

// Lỗi khi admin ghi bảng seat_org_paths: UNIQUE (23505), CHECK cấp giữa trống (23514), RLS (42501).
function orgTreeError(e: { message?: string; code?: string }, fallback: string): Error {
  if (e.code === '23505') return new Error(SEAT_ORG_MSG_DUP);
  if (e.code === '23514') return new Error(SEAT_ORG_MSG_HOLE);
  if (e.code === '42501') return new Error('Chỉ admin sửa được cây đơn vị.');
  return new Error(fallback);
}
// RLS không báo lỗi khi update/delete bị chặn, chỉ trả 0 dòng.
function orgTreeCount(data: unknown[] | null): number {
  const n = data?.length ?? 0;
  if (!n) throw new Error('Không có nhánh nào được đổi (cần quyền admin hoặc nhánh đã bị xóa).');
  return n;
}

const SEAT_COLS ='id, owner_id, status, ngay_gui, ban, don_vi, phong, doi, to_nhom, nhom_site, vung, nhom_chuc_danh, ranking_ap, ranking_offer, vi_tri_ap, vi_tri_offer_vi, vi_tri_offer_en, so_luong, quan_ly_truc_tiep, cost_center, note, ma_ghe, created_at, issued_at, owner:profiles!seat_requests_owner_id_fkey(username, full_name)';

export const seatService = {
  /** Danh sách theo quyền: TA chỉ thấy dòng của mình, admin thấy tất cả (RLS). */
  async list(): Promise<SeatRequest[]> {
    const { data, error } = await supabase.from('seat_requests').select(SEAT_COLS).order('created_at', { ascending: false }).limit(5000);
    if (error) throw seatError(error, 'Không tải được danh sách mã ghế.');
    return (data ?? []) as unknown as SeatRequest[];
  },

  /** Danh mục Ban → Đơn vị → Phòng → Đội → Tổ đang dùng (bảng seat_org_paths, migration 0041). */
  async orgPaths(): Promise<SeatOrgPath[]> {
    const { data, error } = await supabase.from('seat_org_paths').select('ban, don_vi, phong, doi, to_nhom').eq('active', true).limit(5000);
    if (error) throw seatError(error, 'Không tải được danh mục Ban/Đơn vị/Phòng/Đội/Tổ.');
    return (data ?? []) as SeatOrgPath[];
  },

  /** Admin: toàn bộ cây, cả nhánh đã tắt. */
  async orgPathsAll(): Promise<SeatOrgRow[]> {
    const { data, error } = await supabase.from('seat_org_paths').select('id, ban, don_vi, phong, doi, to_nhom, active, created_at').limit(5000);
    if (error) throw orgTreeError(error, 'Không tải được cây đơn vị.');
    return (data ?? []) as SeatOrgRow[];
  },

  /** Admin: thêm (id = null) hoặc sửa 1 nhánh. Giá trị được chuẩn hóa trước khi lưu. */
  async orgPathSave(id: number | null, values: Partial<SeatOrgPath>, existing: readonly SeatOrgRow[]): Promise<void> {
    const err = seatOrgPathError(values, existing, id);
    if (err) throw new SeatValidationError({ [err.key]: err.msg });
    const row = seatOrgClean(values);
    if (id === null) {
      const { error } = await supabase.from('seat_org_paths').insert(row);
      if (error) throw orgTreeError(error, 'Không thêm được nhánh.');
    } else {
      const { data, error } = await supabase.from('seat_org_paths').update(row).eq('id', id).select('id');
      if (error) throw orgTreeError(error, 'Không sửa được nhánh.');
      orgTreeCount(data);
    }
  },

  /** Admin: tắt (TA không chọn được nữa, dòng cũ giữ nguyên) hoặc bật lại. */
  async orgPathSetActive(ids: number[], active: boolean): Promise<number> {
    const { data, error } = await supabase.from('seat_org_paths').update({ active }).in('id', ids).select('id');
    if (error) throw orgTreeError(error, 'Không đổi được trạng thái nhánh.');
    return orgTreeCount(data);
  },

  /** Admin: xóa hẳn nhánh. Dòng mã ghế lưu chữ, không tham chiếu id, nên không bị mất. */
  async orgPathRemove(ids: number[]): Promise<number> {
    const { data, error } = await supabase.from('seat_org_paths').delete().in('id', ids).select('id');
    if (error) throw orgTreeError(error, 'Không xóa được nhánh.');
    return orgTreeCount(data);
  },

  /** Admin: đổi tên 1 giá trị ở cấp `level` cho mọi nhánh cùng tiền tố với `from` (1 lệnh, trùng thì cả lệnh không chạy). */
  async orgRename(level: SeatOrgLevel, from: SeatOrgPath, to: string, existing: readonly SeatOrgRow[]): Promise<number> {
    const name = seatOrgClean({ [level]: to })[level];
    if (!name) throw new Error('Tên mới không được để trống. Muốn bỏ giá trị này thì sửa hoặc tắt từng nhánh.');
    const plan = seatOrgRenamePlan(existing, level, from, name);
    if (plan.conflicts) throw new Error(`Đổi tên sẽ làm ${plan.conflicts} nhánh trùng với nhánh có sẵn. Xóa hoặc sửa nhánh trùng trước.`);
    // Lọc theo đúng chữ đang lưu trong bảng (from là 1 dòng vừa tải về).
    let query = supabase.from('seat_org_paths').update({ [level]: name });
    for (const k of SEAT_ORG_LEVELS.slice(0, SEAT_ORG_LEVELS.indexOf(level) + 1)) query = query.eq(k, from[k]);
    const { data, error } = await query.select('id');
    if (error) throw orgTreeError(error, 'Không đổi được tên.');
    return orgTreeCount(data);
  },

  /** Tạo mới (id = null) hoặc sửa. Dòng đã gửi/đã cấp: RLS và trigger chặn, báo lỗi rõ ràng.
   *  paths: danh mục đã tải -> kiểm nhánh ngay trên trình duyệt (DB vẫn kiểm lại). */
  async save(id: number | null, input: Record<string, unknown>, paths?: readonly SeatOrgPath[]): Promise<void> {
    const v = validateSeatRequest(input as Partial<Record<SeatInputKey, unknown>>);
    const org = paths?.length ? seatOrgError(paths, v.clean) : null;
    if (org && !v.errors[org.key]) v.errors[org.key] = org.msg;
    if (Object.keys(v.errors).length) throw new SeatValidationError(v.errors);
    const row = { ...v.clean, so_luong: Number(v.clean.so_luong) };
    if (id === null) {
      const { error } = await supabase.from('seat_requests').insert({ ...row, status: 'nhap' });
      if (error) throw seatError(error, 'Không lưu được dòng mã ghế.');
    } else {
      const { error } = await supabase.from('seat_requests').update(row).eq('id', id);
      if (error) throw seatError(error, 'Không lưu được dòng mã ghế.');
    }
  },

  /** Xóa dòng nháp (RLS: chỉ status nhap). */
  async remove(ids: number[]): Promise<number> {
    const { data, error } = await supabase.from('seat_requests').delete().in('id', ids).eq('status', 'nhap').select('id');
    if (error) throw seatError(error, 'Không xóa được dòng nháp.');
    return data?.length ?? 0;
  },

  /** Chuyển trạng thái có điều kiện (from → to). Trả về số dòng thực sự đổi. Trigger kiểm quyền và luồng. */
  async move(ids: number[], from: SeatStatus, to: SeatStatus): Promise<number> {
    const { data, error } = await supabase.from('seat_requests').update({ status: to }).in('id', ids).eq('status', from).select('id');
    if (error) throw seatError(error, 'Không chuyển được trạng thái.');
    return data?.length ?? 0;
  },

  /** HRSS cấp mã cho các dòng đã HRBP xác nhận. Mỗi ghế một mã, liên tiếp. */
  async issueCodes(ids: number[]): Promise<SeatRequest[]> {
    const { data, error } = await supabase.rpc('seat_issue_codes', { p_ids: ids });
    if (error) throw seatError(error, 'Không cấp được mã ghế.');
    return (data ?? []) as unknown as SeatRequest[];
  },

  /** Mã đã cấp gần nhất (admin); null nếu không phải admin. */
  async counterGet(): Promise<number | null> {
    const { data, error } = await supabase.rpc('seat_counter_get');
    if (error) throw seatError(error, 'Không đọc được bộ đếm mã.');
    return data === null || data === undefined ? null : Number(data);
  },

  async counterSet(last: number): Promise<number> {
    const { data, error } = await supabase.rpc('seat_counter_set', { p_last: last });
    if (error) throw seatError(error, 'Không đặt được bộ đếm mã.');
    return Number(data);
  },

  /** Tổng hợp số dòng / số ghế theo tháng gửi, TA, vùng, trạng thái (RLS: TA chỉ thấy số của mình). */
  async summary(from?: string, to?: string): Promise<SeatSummaryRow[]> {
    const { data, error } = await supabase.rpc('seat_summary', { p_from: from ?? null, p_to: to ?? null });
    if (error) throw seatError(error, 'Không tải được bảng tổng hợp.');
    return (data ?? []) as SeatSummaryRow[];
  },

  /** Xuất file .xlsx đúng cột tab NhapLieu + cột Trạng thái. */
  async exportXlsx(rows: SeatRequest[], filename: string): Promise<void> {
    const body = rows.map((r) => toSeatExportRow(r));
    const widths = [12, 22, 22, 26, 26, 24, 16, 14, 14, 14, 14, 14, 34, 34, 34, 10, 24, 14, 24, 16];
    await downloadXlsx(filename, [[...SEAT_EXPORT_HEADERS], ...body], 'NhapLieu', widths);
  },
};

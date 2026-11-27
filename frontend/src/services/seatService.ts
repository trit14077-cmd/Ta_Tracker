// Quy trình 1 – tạo mã ghế. Ghi trực tiếp bảng seat_requests (RLS + trigger, migration 0038); cấp mã qua RPC seat_issue_codes.
// Kiểm dữ liệu bằng chính shared/seatCodeRules (cùng quy tắc với DB). Xuất file đúng cột tab NhapLieu.
import { supabase } from '../lib/supabase.ts';
import { downloadXlsx } from './xlsxDownload.ts';
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
  const hit = SEAT_ERRORS.find(([code]) => msg.includes(code));
  if (hit) return new Error(hit[1]);
  if (e?.code === '42501') return new Error('Bạn không có quyền thực hiện thao tác này.');
  if (e?.code === '23514') return new Error('Dữ liệu không đạt quy tắc nhập (kiểm tra lại các trường).');
  return new Error(fallback);
}

const SEAT_COLS = 'id, owner_id, status, ngay_gui, ban, don_vi, phong, doi, to_nhom, nhom_site, vung, nhom_chuc_danh, ranking_ap, ranking_offer, vi_tri_ap, vi_tri_offer_vi, vi_tri_offer_en, so_luong, quan_ly_truc_tiep, cost_center, note, ma_ghe, created_at, issued_at, owner:profiles!seat_requests_owner_id_fkey(username, full_name)';

export const seatService = {
  /** Danh sách theo quyền: TA chỉ thấy dòng của mình, admin thấy tất cả (RLS). */
  async list(): Promise<SeatRequest[]> {
    const { data, error } = await supabase.from('seat_requests').select(SEAT_COLS).order('created_at', { ascending: false }).limit(5000);
    if (error) throw seatError(error, 'Không tải được danh sách mã ghế.');
    return (data ?? []) as unknown as SeatRequest[];
  },

  /** Tạo mới (id = null) hoặc sửa. Dòng đã gửi/đã cấp: RLS và trigger chặn, báo lỗi rõ ràng. */
  async save(id: number | null, input: Record<string, unknown>): Promise<void> {
    const v = validateSeatRequest(input as Partial<Record<SeatInputKey, unknown>>);
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

// Quy trình 2 – chốt danh sách OB ngày 25 và CnB kiểm hồ sơ. RPC ở migration 0040; quy tắc ở shared/cnbRules.ts,
// template xuất ở shared/cnbTemplate.ts. Đọc theo RLS: TA chỉ thấy hồ sơ của mình, admin thấy tất cả.
import { supabase } from '../lib/supabase.ts';
import { downloadXlsx } from './xlsxDownload.ts';
import { cleanCnbCheck, cycleOf, type CnbCheckKey, type CnbReason } from '../../../shared/cnbRules.ts';
import {
  CNB_CHECK_HEADERS,
  CNB_DEFAULT_CONSTANTS,
  CNB_FULL_HEADERS,
  CNB_SHORT_HEADERS,
  toCnbCheckRow,
  toCnbFullRow,
  toCnbShortRow,
  type CnbConstants,
  type CnbSource,
} from '../../../shared/cnbTemplate.ts';

export interface CnbPreviewRow extends CnbSource {
  record_id: number;
  candidate_code: string;
  reasons: CnbReason[];
}

export interface CnbBatch {
  id: number;
  cycle_key: string;
  status: 'mo' | 'da_chot';
  item_count: number;
  locked_at: string | null;
  locked_by: string | null;
}

export interface CnbItem {
  id: number;
  batch_id: number;
  record_id: number;
  pic: string | null;
  src: CnbSource;
  added_late: boolean;
  late_reason: string;
  cnb_check: Partial<Record<CnbCheckKey, string>>;
  cnb_note: string;
  checked_at: string | null;
}

const CNB_ERRORS: [string, string][] = [
  ['CNB_ADMIN_ONLY', 'Chỉ Admin được thực hiện bước này.'],
  ['CNB_ALREADY_LOCKED', 'Kỳ này đã chốt. Mở lại kỳ trước khi chốt lại.'],
  ['CNB_NOT_LOCKED', 'Kỳ này chưa chốt.'],
  ['CNB_REASON_REQUIRED', 'Cần ghi lý do.'],
  ['CNB_ITEM_EXISTS', 'Hồ sơ đã có trong danh sách chốt.'],
  ['CNB_BAD_CYCLE', 'Kỳ OB không hợp lệ.'],
  ['INVALID_INPUT', 'Dữ liệu kiểm hồ sơ không hợp lệ (chỉ nhận x hoặc o).'],
  ['NOT_FOUND', 'Không tìm thấy hồ sơ.'],
];

function cnbError(e: { message?: string; code?: string } | null, fallback: string): Error {
  const msg = e?.message ?? '';
  const hit = CNB_ERRORS.find(([code]) => msg.includes(code));
  if (hit) return new Error(hit[1]);
  if (e?.code === '42501') return new Error('Bạn không có quyền thực hiện thao tác này.');
  return new Error(fallback);
}

const ITEM_COLS = 'id, batch_id, record_id, pic, src, added_late, late_reason, cnb_check, cnb_note, checked_at';

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export const cnbService = {
  /** Mọi hồ sơ có OBD trong kỳ (không lưu trữ), kèm lý do bị loại tính tại hôm nay. */
  async preview(cycle: string): Promise<CnbPreviewRow[]> {
    const { data, error } = await supabase.rpc('cnb_ob_preview', { p_cycle: cycle });
    if (error) throw cnbError(error, 'Không tải được danh sách kỳ OB.');
    return (data ?? []) as CnbPreviewRow[];
  },

  async batch(cycle: string): Promise<CnbBatch | null> {
    const { data, error } = await supabase.from('cnb_ob_batches').select('id, cycle_key, status, item_count, locked_at, locked_by').eq('cycle_key', cycle).maybeSingle();
    if (error) throw cnbError(error, 'Không tải được trạng thái kỳ.');
    return (data ?? null) as CnbBatch | null;
  },

  async items(batchId: number): Promise<CnbItem[]> {
    const { data, error } = await supabase.from('cnb_ob_items').select(ITEM_COLS).eq('batch_id', batchId).order('id').limit(5000);
    if (error) throw cnbError(error, 'Không tải được danh sách đã chốt.');
    return (data ?? []) as unknown as CnbItem[];
  },

  async lock(cycle: string): Promise<{ count: number; removed: number }> {
    const { data, error } = await supabase.rpc('cnb_ob_lock', { p_cycle: cycle });
    if (error) throw cnbError(error, 'Không chốt được kỳ.');
    return data as { count: number; removed: number };
  },

  async reopen(cycle: string, reason: string): Promise<void> {
    const { error } = await supabase.rpc('cnb_ob_reopen', { p_cycle: cycle, p_reason: reason });
    if (error) throw cnbError(error, 'Không mở lại được kỳ.');
  },

  async addLate(cycle: string, recordId: number, reason: string): Promise<void> {
    const { error } = await supabase.rpc('cnb_ob_add_late', { p_cycle: cycle, p_record_id: recordId, p_reason: reason });
    if (error) throw cnbError(error, 'Không bổ sung được hồ sơ.');
  },

  async removeItem(itemId: number, reason: string): Promise<void> {
    const { error } = await supabase.rpc('cnb_ob_remove_item', { p_item_id: itemId, p_reason: reason });
    if (error) throw cnbError(error, 'Không bỏ được hồ sơ khỏi danh sách.');
  },

  async check(itemId: number, check: Record<string, string>, note?: string): Promise<Partial<Record<CnbCheckKey, string>>> {
    const v = cleanCnbCheck(check);
    if (v.errors.length) throw new Error(v.errors.join('; '));
    const { data, error } = await supabase.rpc('cnb_item_check', { p_item_id: itemId, p_check: v.check, p_note: note ?? null });
    if (error) throw cnbError(error, 'Không lưu được kết quả kiểm hồ sơ.');
    return data as Partial<Record<CnbCheckKey, string>>;
  },

  /** Tập đoàn / P&L / Công ty pháp lý cho template đầy đủ (app_settings 'cnb_constants'); thiếu thì dùng mặc định. */
  async constants(): Promise<CnbConstants> {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'cnb_constants').maybeSingle();
    return { ...CNB_DEFAULT_CONSTANTS, ...((data?.value ?? {}) as Partial<CnbConstants>) };
  },

  async exportShort(cycle: string, rows: CnbSource[]): Promise<void> {
    const body = rows.map((r) => toCnbShortRow(r));
    const widths = [10, 26, 26, 22, 12, 10, 14, 18, 18, 18, 12, 9, 9, 9, 9, 24];
    await downloadXlsx(`CnB_${cycleOf(cycle).label.replace('/', '-')}_gon_${stamp()}.xlsx`, [[...CNB_SHORT_HEADERS], ...body], cycleOf(cycle).label.replace('/', '-'), widths);
  },

  async exportFull(cycle: string, rows: CnbSource[]): Promise<void> {
    const c = await cnbService.constants();
    const body = rows.map((r, i) => toCnbFullRow(r, i + 1, c));
    await downloadXlsx(`CnB_${cycleOf(cycle).label.replace('/', '-')}_day_du_${stamp()}.xlsx`, [[...CNB_FULL_HEADERS], ...body], cycleOf(cycle).label.replace('/', '-'), CNB_FULL_HEADERS.map(() => 16));
  },

  async exportCheck(cycle: string, items: CnbItem[]): Promise<void> {
    const body = items.map((it, i) => toCnbCheckRow(it.src, it.cnb_check, it.cnb_note, i + 1));
    const widths = [6, 10, 26, 8, 14, 9, 9, 9, 9, 9, 9, 9, 30, 18];
    await downloadXlsx(`CnB_check_HS_${cycleOf(cycle).label.replace('/', '-')}_${stamp()}.xlsx`, [[...CNB_CHECK_HEADERS], ...body], 'Check HS', widths);
  },
};

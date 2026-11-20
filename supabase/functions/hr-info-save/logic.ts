// Edge hr-info-save (M6-4, API_SPEC §4.6) – phần thuần, theo HrInfo.gs (hHrPut_, hHrVerify_). Test bằng Vitest.
// PO chốt 20/11/2026: giữ như hệ cũ – TA phụ trách hồ sơ và Admin đều lưu / gửi / xác nhận / mở lại được.
import { HR_FIELD_BY_KEY, hrEligible, validateHrInfo } from '../../../shared/hrInfoRules.ts';

export interface ApiError { status: number; code: string; message: string; fields?: Record<string, string> }
export type HrRequest =
  | { op: 'save'; record_id: number; mode: 'draft' | 'submit'; data: Record<string, unknown> }
  | { op: 'verify'; record_id: number; verified: boolean };
export interface HrCurrent { status: 'draft' | 'submitted' | 'verified'; data: Record<string, unknown> }

const err = (status: number, code: string, message: string, fields?: Record<string, string>): ApiError => ({ status, code, message, ...(fields ? { fields } : {}) });

export function parseHrRequest(body: unknown): { ok: true; req: HrRequest } | { ok: false; error: ApiError } {
  const bad = (m: string) => ({ ok: false as const, error: err(422, 'VALIDATION_FAILED', m) });
  if (!body || typeof body !== 'object') return bad('Thiếu nội dung yêu cầu.');
  const b = body as Record<string, unknown>;
  if (typeof b.record_id !== 'number' || !Number.isInteger(b.record_id) || b.record_id <= 0) return bad('Thiếu hoặc sai record_id.');
  if (b.op === 'save') {
    if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) return bad('Thiếu data.');
    // như hệ cũ: mode khác 'submit' coi là nháp
    return { ok: true, req: { op: 'save', record_id: b.record_id, mode: b.mode === 'submit' ? 'submit' : 'draft', data: b.data as Record<string, unknown> } };
  }
  if (b.op === 'verify') return { ok: true, req: { op: 'verify', record_id: b.record_id, verified: b.verified !== false } };
  return { ok: false, error: err(422, 'INVALID_OP', 'op phải là save hoặc verify.') };
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const labels = (keys: string[]) => keys.map((k) => HR_FIELD_BY_KEY[k]?.label ?? k);

/** = hHrPut_: kiểm điều kiện, validate, tính trạng thái mới và dòng nhật ký (chỉ tên trường đổi, không ghi giá trị). */
export function planHrSave(record: Record<string, unknown>, cur: HrCurrent | null, mode: 'draft' | 'submit', data: Record<string, unknown>):
  { ok: true; status: 'draft' | 'submitted'; clean: Record<string, string>; idNumber: string; audit: string } | { ok: false; error: ApiError } {
  if (!hrEligible(record)) return { ok: false, error: err(400, 'NOT_ELIGIBLE', 'Chỉ nhập thông tin nhân sự cho ứng viên đã đạt vòng 2 (Passed).') };
  if (cur?.status === 'verified') return { ok: false, error: err(409, 'LOCKED', 'Thông tin nhân sự đã được xác nhận. Hãy mở lại trước khi sửa.') };
  const v = validateHrInfo(data, mode);
  if (Object.keys(v.errors).length) return { ok: false, error: err(400, 'VALIDATION_FAILED', 'Thông tin chưa hợp lệ.', v.errors) };
  const before = cur?.data || {};
  const changed = Object.keys(v.clean).filter((k) => s(before[k]) !== v.clean[k]);
  return {
    ok: true,
    status: mode === 'submit' ? 'submitted' : 'draft',
    clean: v.clean,
    idNumber: v.clean.id_number ?? '',
    audit: (mode === 'submit' ? 'Nhập đủ' : 'Lưu nháp') + (changed.length ? ': ' + labels(changed).join(', ').slice(0, 300) : ' (không đổi)'),
  };
}

/** = hHrVerify_: xác nhận cần dữ liệu đủ + hợp lệ; mở lại chỉ khi đang xác nhận. */
export function planHrVerify(cur: HrCurrent | null, verify: boolean):
  { ok: true; status: 'verified' | 'submitted'; audit: string } | { ok: false; error: ApiError } {
  if (!cur) return { ok: false, error: err(404, 'NO_HR_INFO', 'Hồ sơ này chưa có thông tin nhân sự.') };
  if (verify) {
    if (cur.status === 'verified') return { ok: false, error: err(409, 'LOCKED', 'Thông tin nhân sự đã được xác nhận.') };
    const v = validateHrInfo(cur.data || {}, 'submit');
    if (Object.keys(v.errors).length) return { ok: false, error: err(400, 'VALIDATION_FAILED', 'Thông tin chưa đủ hoặc chưa hợp lệ nên chưa xác nhận được.', v.errors) };
    return { ok: true, status: 'verified', audit: 'Xác nhận thông tin nhân sự' };
  }
  if (cur.status !== 'verified') return { ok: false, error: err(409, 'NOT_VERIFIED', 'Thông tin chưa được xác nhận nên không cần mở lại.') };
  return { ok: true, status: 'submitted', audit: 'Mở lại thông tin nhân sự để sửa' };
}

/** Lỗi RPC hr_info_write (PTxxx, message = mã) -> lỗi API. */
export function mapHrRpcError(e: { code?: string; message?: string; details?: string | null }): ApiError {
  const status = /^PT\d{3}$/.test(e.code ?? '') ? Number(e.code!.slice(2)) : 500;
  if (status === 500) return err(500, 'SERVER_ERROR', 'Lỗi máy chủ khi lưu thông tin nhân sự. Vui lòng thử lại.');
  const code = e.message || 'ERROR';
  const msg: Record<string, string> = {
    NOT_FOUND: 'Không tìm thấy hồ sơ ứng viên.',
    NO_HR_INFO: 'Hồ sơ này chưa có thông tin nhân sự.',
    LOCKED: 'Thông tin nhân sự đã được xác nhận. Hãy mở lại trước khi sửa.',
    NOT_VERIFIED: 'Thông tin chưa được xác nhận nên không cần mở lại.',
    CHANGED: 'Thông tin nhân sự vừa được người khác sửa. Hãy tải lại rồi thử lại.',
  };
  return err(status, code, msg[code] || e.details || code);
}

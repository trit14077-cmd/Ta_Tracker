// Edge records-import (M7-4, API_SPEC §4.2) – phần thuần, theo Api2.gs hImportChunk_ / hImportFinish_. Test bằng Vitest.
// Trình duyệt (gasImport) đọc file, ghép trùng, chọn sheet, xem trước; server KIỂM LẠI từng dòng bằng cùng quy tắc
// (applyLegacyImportTransformations + validateAndComputeCandidate lenient) nên trình duyệt bị sửa cũng không lách được.
// Không bao giờ ghi đè: mã đã có => bỏ qua (RPC import_records kiểm lại trong giao dịch).
import { applyLegacyImportTransformations, validateAndComputeCandidate, type DropdownConfigBundle } from '../../../shared/validation.ts';
import { toDbValues, type ApiError } from '../records-save/logic.ts';

export const MAX_CHUNK = 1500; // = hệ cũ
export type ImportRequest =
  | { op: 'chunk'; batch_id: number | null; file_name: string; rows: Record<string, unknown>[]; meta: { sheet?: string; rowNumber?: number }[] }
  | { op: 'finish'; batch_id: number | null; file_name: string; imported: number; invalid: number; duplicates: number; rejected: number };

const err = (status: number, code: string, message: string): ApiError => ({ status, code, message });
const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

export function parseImportRequest(body: unknown): { ok: true; req: ImportRequest } | { ok: false; error: ApiError } {
  if (!body || typeof body !== 'object') return { ok: false, error: err(422, 'VALIDATION_FAILED', 'Thiếu nội dung yêu cầu.') };
  const b = body as Record<string, unknown>;
  const batch = b.batch_id === undefined || b.batch_id === null ? null : int(b.batch_id) || null;
  const file = String(b.file_name ?? b.fileName ?? '').slice(0, 200);
  if (b.op === 'chunk') {
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (rows.length > MAX_CHUNK) return { ok: false, error: err(400, 'CHUNK_TOO_LARGE', 'Mỗi lần gửi tối đa 1.500 dòng.') };
    if (rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) return { ok: false, error: err(422, 'VALIDATION_FAILED', 'Dòng dữ liệu không hợp lệ.') };
    const meta = Array.isArray(b.meta) ? (b.meta as { sheet?: string; rowNumber?: number }[]) : [];
    return { ok: true, req: { op: 'chunk', batch_id: batch, file_name: file, rows: rows as Record<string, unknown>[], meta } };
  }
  if (b.op === 'finish') {
    return { ok: true, req: { op: 'finish', batch_id: batch, file_name: file, imported: int(b.imported), invalid: int(b.invalid), duplicates: int(b.duplicates), rejected: int(b.rejected) } };
  }
  return { ok: false, error: err(422, 'INVALID_OP', 'op phải là chunk hoặc finish.') };
}

/** Timestamp của file (dd/mm/yyyy [hh:mm[:ss]] hoặc yyyy-mm-dd…) -> ISO giờ VN; không đọc được -> null (DB dùng giờ hiện tại). */
export function importCreatedAt(v: string): string | null {
  const s = String(v || '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
    const p = (x: string) => x.padStart(2, '0');
    const iso = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se)}+07:00`;
    return Number.isNaN(Date.parse(iso)) || Number(mo) > 12 || Number(d) > 31 ? null : iso;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    const [, y, mo, d, h = '00', mi = '00', se = '00'] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}+07:00`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  return null;
}

export interface PreparedRow { index: number; values: Record<string, string | null>; created_at: string | null; sheet: string; row_number: number }

/** = phần kiểm từng dòng của hImportChunk_ (trước khi ghi). Trả dòng đạt (giá trị DB) và dòng bị từ chối (lỗi theo trường). */
export function prepareRows(rows: Record<string, unknown>[], meta: { sheet?: string; rowNumber?: number }[], cfg: DropdownConfigBundle):
  { accepted: PreparedRow[]; rejected: { index: number; errors: Record<string, string> }[] } {
  const accepted: PreparedRow[] = [];
  const rejected: { index: number; errors: Record<string, string> }[] = [];
  const seen = new Set<string>();
  rows.forEach((raw, index) => {
    const strRow: Record<string, string> = {};
    for (const k of Object.keys(raw || {})) strRow[k] = raw[k] === null || raw[k] === undefined ? '' : String(raw[k]);
    const v = validateAndComputeCandidate(applyLegacyImportTransformations(strRow), cfg, { lenient: true });
    const code = String(v.sanitized.candidate_code || '').trim();
    if (!code) {
      v.errors.candidate_code = v.errors.candidate_code || 'Thiếu mã ứng viên.';
      v.valid = false;
    } else if (seen.has(code)) {
      v.errors.candidate_code = `Mã ứng viên "${code}" đã tồn tại (không ghi đè).`;
      v.valid = false;
    }
    if (!v.valid) {
      rejected.push({ index, errors: v.errors });
      return;
    }
    seen.add(code);
    const values = toDbValues(v.sanitized);
    values.candidate_code = code;
    values.pic = String(v.sanitized.pic || '').trim() || null;
    const m = meta[index] || {};
    accepted.push({ index, values, created_at: importCreatedAt(String(v.sanitized.created_at || strRow.created_at || '')), sheet: String(m.sheet || ''), row_number: Number(m.rowNumber) || 0 });
  });
  return { accepted, rejected };
}

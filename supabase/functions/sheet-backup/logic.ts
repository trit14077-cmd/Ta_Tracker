// Sao lưu một chiều Supabase -> Google Sheet (Edge sheet-backup). Phần thuần, có test.
// Ghi bằng valueInputOption=RAW: Sheet không tính công thức, nên "=...", "+..." không bị thực thi; số điện thoại giữ nguyên số 0 đầu.

export const CELL_MAX = 49000; // Google Sheets giới hạn 50.000 ký tự/ô

export function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > CELL_MAX ? s.slice(0, CELL_MAX) : s;
}

/** Danh sách object -> ma trận (hàng đầu là tiêu đề). Cột ưu tiên đứng trước, cột còn lại theo thứ tự xuất hiện. */
export function toMatrix(rows: Record<string, unknown>[], preferred: string[] = []): string[][] {
  const seen = new Set<string>();
  const header: string[] = [];
  for (const k of preferred) if (!seen.has(k)) { seen.add(k); header.push(k); }
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); header.push(k); }
  return [header, ...rows.map((r) => header.map((k) => cell(r[k])))];
}

export interface HrRow {
  record_id: number; data: Record<string, unknown> | null; status: string | null; id_number: string | null;
  updated_at: string | null; verified_at: string | null;
}

/** HR Info -> các dòng phẳng: cột cố định + từng trường trong data (trùng tên cột cố định thì thêm tiền tố "data."). */
export function flattenHr(rows: HrRow[], codeById: Map<number, string>): Record<string, unknown>[] {
  return rows.map((h) => {
    const base: Record<string, unknown> = {
      record_id: h.record_id, candidate_code: codeById.get(h.record_id) ?? '', status: h.status, id_number: h.id_number,
      updated_at: h.updated_at, verified_at: h.verified_at,
    };
    for (const [k, v] of Object.entries(h.data ?? {})) base[k in base ? `data.${k}` : k] = v;
    return base;
  });
}

/** So sánh token chống dò theo thời gian trả lời. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

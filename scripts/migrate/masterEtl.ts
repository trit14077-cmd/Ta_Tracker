// M8-1/M8-2: bảng Master (Excel người dùng, dữ liệu thật duy nhất của hệ cũ – PO xác nhận 20/11/2026) -> recruitment_records.
// Đi đúng đường của chức năng Nhập Excel (gasImport.ts, chép từ hệ cũ): dò dòng tiêu đề, ghép tên cột theo fieldCatalog,
// applyLegacyImportTransformations, validateAndComputeCandidate. Khác: kiểm CHẶT (Q5a – dòng lỗi KHÔNG nạp, ra báo cáo ngoại lệ
// để sửa ở nguồn); mã trùng khác người (E1a) – dòng sau không nạp. Hàm thuần: không đọc file, không gọi mạng.
import { FIELD_BY_KEY, FIELD_CATALOG } from '../../shared/fieldCatalog.ts';
import { applyLegacyImportTransformations, validateAndComputeCandidate, type DropdownConfigBundle } from '../../shared/validation.ts';

const HEADER_SCAN_ROWS = 10;
const MIN_MATCHED = 5;

/** = mapHeaderToFieldKey của gasImport.ts */
function mapHeaderToFieldKey(rawHeader: string): string | null {
  const clean = String(rawHeader ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!clean) return null;
  for (const field of FIELD_CATALOG) {
    if (field.key.toLowerCase() === clean || field.excelHeader.toLowerCase() === clean || field.label.toLowerCase() === clean) return field.key;
    if (field.aliases) for (const a of field.aliases) if (a.toLowerCase() === clean) return field.key;
  }
  return null;
}

/** = mapHeaderRow của gasImport.ts (cột AA "R1_CDD_FB" thứ 2 là R2_CDD_FB; cột lặp lại thì bỏ cột sau) */
export function mapHeaderRow(cells: unknown[]): { colIndex: number; header: string; fieldKey: string | null }[] {
  const mapping = cells.map((h, idx) => ({ colIndex: idx, header: String(h ?? '').replace(/\s+/g, ' ').trim(), fieldKey: mapHeaderToFieldKey(String(h ?? '')) }));
  const r1fb = mapping.filter((c) => c.fieldKey === 'r1_cdd_fb');
  if (r1fb.length > 1) r1fb[1].fieldKey = 'r2_cdd_fb';
  const seen = new Set<string>();
  for (const c of mapping) {
    if (!c.fieldKey) continue;
    if (seen.has(c.fieldKey)) c.fieldKey = null;
    else seen.add(c.fieldKey);
  }
  return mapping;
}

/** Số ngày Excel -> "DD/MM/YYYY" (= excelSerialToDisplayDate của gasImport.ts) */
export function excelSerialToDisplayDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const d = new Date(Math.floor(serial - 25569) * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export interface ParsedRow { sheet: string; rowNumber: number; raw: Record<string, string> }
export interface SheetInfo { sheet: string; headerRow: number; matched: number; unmapped: string[]; rows: number }

/** Dò dòng tiêu đề tốt nhất trong 10 dòng đầu (như gasImport) rồi đọc từng dòng thành {fieldKey: chuỗi}. */
export function parseSheet(sheet: string, matrix: unknown[][]): { info: SheetInfo | null; rows: ParsedRow[] } {
  let bestIdx = -1, bestScore = 0;
  let best: ReturnType<typeof mapHeaderRow> = [];
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, matrix.length); i++) {
    const m = mapHeaderRow(matrix[i] || []);
    const score = m.filter((c) => c.fieldKey).length;
    if (score > bestScore) { bestScore = score; bestIdx = i; best = m; }
  }
  if (bestIdx < 0 || bestScore < MIN_MATCHED || !best.some((c) => c.fieldKey === 'candidate_code')) return { info: null, rows: [] };
  const rows: ParsedRow[] = [];
  for (let r = bestIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    if (cells.every((c) => String(c ?? '').trim() === '')) continue;
    const raw: Record<string, string> = {};
    for (const col of best) {
      if (!col.fieldKey) continue;
      const cell = cells[col.colIndex];
      const def = FIELD_BY_KEY[col.fieldKey];
      if (def?.type === 'date' && typeof cell === 'number' && cell > 10000) {
        const t = excelSerialToDisplayDate(cell);
        if (t) { raw[col.fieldKey] = t; continue; }
      }
      raw[col.fieldKey] = cell === null || cell === undefined ? '' : String(cell).trim();
    }
    rows.push({ sheet, rowNumber: r + 1, raw });
  }
  return {
    info: { sheet, headerRow: bestIdx + 1, matched: bestScore, unmapped: best.filter((c) => c.header && !c.fieldKey).map((c) => c.header), rows: rows.length },
    rows,
  };
}

/** Nhóm ngoại lệ theo MIGRATION_PLAN §4. */
export type ExcCode = 'E1' | 'E3' | 'E4' | 'E5' | 'E7' | 'E8' | 'E9' | 'DM';
export const EXC_LABEL: Record<ExcCode, string> = {
  E1: 'Mã ứng viên trùng nhưng khác người (E1a: không nạp dòng sau, cấp mã mới ở nguồn)',
  E3: 'Trạng thái / lý do không đúng quy tắc (Q5a: sửa ở nguồn)',
  E4: 'Kho / tỉnh / vùng không khớp phân cấp (Q5a: sửa ở nguồn hoặc danh mục)',
  E5: 'SĐT / email sai (Q5a: sửa ở nguồn)',
  E7: 'Ngày / giờ sai định dạng',
  E8: 'PIC không có trong danh mục',
  E9: 'Thiếu mã ứng viên',
  DM: 'Giá trị ngoài danh mục Drop-list (vị trí, nguồn, …)',
};
const HIER = new Set(['region', 'location', 'site', 'unit', 'dept']);
export function excCodeOf(field: string): ExcCode {
  const f = FIELD_BY_KEY[field];
  if (field === 'candidate_code') return 'E9';
  if (field === 'pic') return 'E8';
  if (field === 'phone' || field === 'email') return 'E5';
  if (HIER.has(field)) return 'E4';
  if (f && (f.type === 'date' || f.type === 'time' || field === 'birth')) return 'E7';
  if (/(_status|_sub_status|_reason|_sub_reason)$/.test(field)) return 'E3';
  return 'DM';
}

export interface Exception { sheet: string; rowNumber: number; candidate_code: string; code: ExcCode; field: string; message: string }
export interface EtlResult {
  records: { sheet: string; rowNumber: number; values: Record<string, string> }[];
  exceptions: Exception[];
  /** dòng trùng hoàn toàn cùng người (đã gộp ô trống vào dòng đầu) */
  merged: { sheet: string; rowNumber: number; candidate_code: string; into: number }[];
  /** E6 – không phải lỗi: cùng SĐT, khác mã */
  phoneGroups: { phone: string; codes: string[] }[];
  total: number;
}

const same = (a: string, b: string) => !a || !b || a === b;

/** Chạy toàn bộ dòng: tổng = nạp + gộp + số dòng có ngoại lệ (mỗi dòng lỗi có thể có nhiều ngoại lệ). */
export function transformMaster(rows: ParsedRow[], config: DropdownConfigBundle): EtlResult {
  const exceptions: Exception[] = [];
  const merged: EtlResult['merged'] = [];
  type Kept = { sheet: string; rowNumber: number; raw: Record<string, string>; values: Record<string, string> | null; errors: Record<string, string> };
  const kept: Kept[] = [];
  const byCode = new Map<string, number>();
  const evaluate = (raw: Record<string, string>) => validateAndComputeCandidate(applyLegacyImportTransformations({ ...raw }), config, {});

  for (const r of rows) {
    const v = evaluate(r.raw);
    const code = v.sanitized.candidate_code || String(r.raw.candidate_code || '').trim();
    const idx = code ? byCode.get(code) : undefined;
    if (idx !== undefined) {
      const first = kept[idx];
      const firstName = first.values?.full_name ?? first.raw.full_name ?? '';
      const firstPhone = first.values?.phone ?? first.raw.phone ?? '';
      if (same(firstName, v.sanitized.full_name || r.raw.full_name || '') && same(firstPhone, v.sanitized.phone || '')) {
        // cùng người: bổ sung ô trống vào dòng đầu rồi kiểm lại (như gasImport)
        let filled = 0;
        for (const [k, val] of Object.entries(r.raw)) if (val !== '' && !first.raw[k]) { first.raw[k] = val; filled++; }
        if (filled) {
          const again = evaluate(first.raw);
          first.values = again.valid ? again.sanitized : null;
          first.errors = again.errors;
        }
        merged.push({ sheet: r.sheet, rowNumber: r.rowNumber, candidate_code: code, into: first.rowNumber });
      } else {
        exceptions.push({ sheet: r.sheet, rowNumber: r.rowNumber, candidate_code: code, code: 'E1', field: 'candidate_code',
          message: `Mã "${code}" đã dùng cho người khác ở dòng ${first.rowNumber} (khác họ tên hoặc SĐT).` });
      }
      continue;
    }
    if (code) byCode.set(code, kept.length);
    kept.push({ sheet: r.sheet, rowNumber: r.rowNumber, raw: { ...r.raw }, values: v.valid ? v.sanitized : null, errors: v.errors });
  }

  const records: EtlResult['records'] = [];
  for (const k of kept) {
    if (k.values && !Object.keys(k.errors).length) {
      records.push({ sheet: k.sheet, rowNumber: k.rowNumber, values: { ...k.values, created_at: k.raw.created_at ?? '' } });
      continue;
    }
    const code = k.values?.candidate_code || k.raw.candidate_code || '';
    for (const [field, message] of Object.entries(k.errors)) {
      exceptions.push({ sheet: k.sheet, rowNumber: k.rowNumber, candidate_code: code, code: excCodeOf(field), field, message });
    }
  }

  const phones = new Map<string, Set<string>>();
  for (const r of records) {
    const p = r.values.phone;
    if (p) (phones.get(p) ?? phones.set(p, new Set()).get(p)!).add(r.values.candidate_code);
  }
  const phoneGroups = [...phones].filter(([, s]) => s.size > 1).map(([phone, s]) => ({ phone, codes: [...s].sort() }))
    .sort((a, b) => a.phone.localeCompare(b.phone));
  exceptions.sort((a, b) => a.rowNumber - b.rowNumber || a.field.localeCompare(b.field));
  return { records, exceptions, merged, phoneGroups, total: rows.length };
}

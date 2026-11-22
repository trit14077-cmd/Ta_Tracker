// M8-4 – sổ duyệt ngoại lệ cho PO (chạy thử trên bản sao production): dựng nội dung các sheet .xlsx từ kết quả ETL.
// Thuần (không đọc/ghi file) để test; master.ts ghi ra etl-out/migrate/master_exceptions_review.xlsx.
// Mỗi ngoại lệ kèm PIC + giá trị hiện tại để TA sửa ở nguồn (Q5a/E1a); cột "PO quyết định" để PO điền khi duyệt.
// So với lần chạy trước (tùy chọn): "Mới" / "Còn" cho từng lỗi, và số lỗi "Đã sửa" ở trang tổng hợp.
import { FIELD_BY_KEY } from '../../shared/fieldCatalog.ts';
import { sanitizeCellForSpreadsheet } from '../../shared/validation.ts';
import { EXC_LABEL, type ExcCode, type Exception, type ParsedRow } from './masterEtl.ts';

export const EXC_FIX: Record<ExcCode, string> = {
  E1: 'Cấp mã mới ở nguồn theo quy tắc mã của PIC cho dòng sau, rồi chạy lại ETL (ETL không tự cấp mã).',
  E3: 'Sửa trạng thái / lý do ở nguồn cho đúng quy tắc (bảng lý do theo vòng).',
  E4: 'Sửa kho / tỉnh / vùng ở nguồn; nếu kho thật sự phục vụ tỉnh đó thì đề xuất bổ sung danh mục phân cấp.',
  E5: 'Sửa SĐT / email ở nguồn.',
  E7: 'Sửa ngày / giờ ở nguồn về đúng định dạng.',
  E8: 'Sửa PIC ở dòng, hoặc thêm PIC vào danh mục nếu là TA thật.',
  E9: 'Bổ sung mã ứng viên ở nguồn.',
  DM: 'Sửa giá trị ở nguồn, hoặc đề xuất thêm vào Drop-list (Admin duyệt).',
};

export const excKey = (x: Pick<Exception, 'sheet' | 'rowNumber' | 'field' | 'code'>) => `${x.sheet}#${x.rowNumber}#${x.field}#${x.code}`;

export interface ReportMeta { file: string; source_sha256: string; at: string; total: number; loadable: number; merged: number }
export interface ReportSheet { name: string; rows: unknown[][] }
export interface ExceptionReport { sheets: ReportSheet[]; stats: { rows: number; issues: number; isNew: number; still: number; fixed: number | null } }

const cell = (v: unknown) => sanitizeCellForSpreadsheet(v ?? '');

/** prevKeys: tập excKey của lần chạy trước (null = không so). */
export function buildExceptionReport(exceptions: Exception[], parsed: ParsedRow[], meta: ReportMeta, prevKeys: Set<string> | null = null): ExceptionReport {
  const rowOf = new Map(parsed.map((r) => [`${r.sheet}#${r.rowNumber}`, r]));
  const picOf = (x: Exception) => rowOf.get(`${x.sheet}#${x.rowNumber}`)?.raw.pic?.trim() || '(chưa có PIC)';
  const valueOf = (x: Exception) => rowOf.get(`${x.sheet}#${x.rowNumber}`)?.raw[x.field] ?? '';
  const sorted = [...exceptions].sort((a, b) =>
    picOf(a).localeCompare(picOf(b)) || a.sheet.localeCompare(b.sheet) || a.rowNumber - b.rowNumber || a.field.localeCompare(b.field));

  const curKeys = new Set(exceptions.map(excKey));
  const isNew = prevKeys ? exceptions.filter((x) => !prevKeys.has(excKey(x))).length : 0;
  const fixed = prevKeys ? [...prevKeys].filter((k) => !curKeys.has(k)).length : null;
  const rowsWithExc = new Set(exceptions.map((x) => `${x.sheet}#${x.rowNumber}`)).size;

  // ---------- Tổng hợp ----------
  const codes = Object.keys(EXC_LABEL) as ExcCode[];
  const summary: unknown[][] = [
    ['SỔ DUYỆT NGOẠI LỆ CHUYỂN DỮ LIỆU (M8-4) – chạy thử, KHÔNG ghi vào hệ thống'],
    ['File nguồn', cell(meta.file)],
    ['SHA-256 nguồn', meta.source_sha256],
    ['Thời điểm chạy', meta.at],
    ['Tổng dòng', meta.total],
    ['Nạp được', meta.loadable],
    ['Gộp (trùng hoàn toàn cùng người)', meta.merged],
    ['Dòng có ngoại lệ (không nạp)', rowsWithExc],
    ['Số lỗi', exceptions.length],
  ];
  if (prevKeys) summary.push(['So với lần chạy trước', `Mới ${isNew} · Còn ${exceptions.length - isNew} · Đã sửa ${fixed}`]);
  summary.push([], ['Nhóm', 'Mô tả', 'Số dòng', 'Số lỗi', 'Cách xử lý']);
  for (const c of codes) {
    const xs = exceptions.filter((x) => x.code === c);
    if (!xs.length) continue;
    summary.push([c, EXC_LABEL[c], new Set(xs.map((x) => `${x.sheet}#${x.rowNumber}`)).size, xs.length, EXC_FIX[c]]);
  }
  const usedCodes = codes.filter((c) => exceptions.some((x) => x.code === c));
  summary.push([], ['PIC', 'Số dòng', 'Số lỗi', ...usedCodes]);
  const pics = [...new Set(sorted.map(picOf))];
  for (const p of pics) {
    const xs = exceptions.filter((x) => picOf(x) === p);
    summary.push([cell(p), new Set(xs.map((x) => `${x.sheet}#${x.rowNumber}`)).size, xs.length,
      ...usedCodes.map((c) => xs.filter((x) => x.code === c).length || '')]);
  }

  // ---------- Chi tiết ----------
  const head = ['PIC', 'Sheet', 'Dòng', 'Mã ứng viên', 'Nhóm', 'Cột (Excel)', 'Giá trị hiện tại', 'Lỗi', 'Cách xử lý',
    ...(prevKeys ? ['So với lần trước'] : []), 'PO quyết định', 'Ghi chú'];
  const detail: unknown[][] = [head, ...sorted.map((x) => [
    cell(picOf(x)), cell(x.sheet), x.rowNumber, cell(x.candidate_code), x.code, cell(FIELD_BY_KEY[x.field]?.excelHeader ?? x.field),
    cell(valueOf(x)), cell(x.message), EXC_FIX[x.code], ...(prevKeys ? [prevKeys.has(excKey(x)) ? 'Còn' : 'Mới'] : []), '', '',
  ])];

  return {
    sheets: [{ name: 'Tổng hợp', rows: summary }, { name: 'Chi tiết', rows: detail }],
    stats: { rows: rowsWithExc, issues: exceptions.length, isNew, still: exceptions.length - isNew, fixed },
  };
}

/** Đọc lại khóa lỗi từ master_exceptions.csv của lần chạy trước (cột sheet, dong, …, nhom, …, truong). */
export function prevKeysFromCsv(text: string): Set<string> {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/).filter(Boolean);
  const parse = (line: string): string[] => {
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = parse(lines[0] ?? '');
  const ix = (n: string) => head.indexOf(n);
  const [iS, iD, iN, iT] = [ix('sheet'), ix('dong'), ix('nhom'), ix('truong')];
  if ([iS, iD, iN, iT].some((i) => i < 0)) throw new Error('File ngoại lệ lần trước không đúng định dạng master_exceptions.csv.');
  return new Set(lines.slice(1).map(parse).map((c) => excKey({ sheet: c[iS], rowNumber: Number(c[iD]), field: c[iT], code: c[iN] as ExcCode })));
}

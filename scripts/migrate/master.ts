// M8-1/M8-2 – chạy ETL bảng Master: đọc bản chụp .xlsx, kiểm từng dòng như hệ cũ, ghi kết quả + báo cáo ngoại lệ ra máy.
// Chạy:  npx tsx scripts/migrate/master.ts "D:\Ta_Tracker-main\The Supra.xlsx" [thư mục ra] [--prev=<thư mục lần trước>]
// M8-4: ghi thêm master_exceptions_review.xlsx (sổ duyệt ngoại lệ cho PO: theo PIC, giá trị hiện tại, cách xử lý, cột PO quyết định);
// --prev so với master_exceptions.csv của lần chạy trước (Mới / Còn / Đã sửa) – dùng khi TA sửa ở nguồn rồi chạy lại.
// Danh mục Drop-list (pics, dropdown_options, sub_source_map, hierarchy) đọc từ DB đích qua PostgREST (CHỈ ĐỌC) bằng
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY trong .env (không in khóa). KHÔNG ghi DB – nạp là bước riêng.
// Dữ liệu thật: mọi file ra nằm trong etl-out/ (ngoài git). Màn hình chỉ in số đếm, không in nội dung hồ sơ.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { buildConfig } from '../../supabase/functions/records-save/logic.ts';
import { EXC_LABEL, parseSheet, transformMaster, type ExcCode, type ParsedRow, type SheetInfo } from './masterEtl.ts';
import { buildExceptionReport, prevKeysFromCsv } from './exceptionReport.ts';
import { POSITION_RENAMES } from '../../shared/positionCatalog.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const prevArg = process.argv.slice(2).find((a) => a.startsWith('--prev='))?.slice('--prev='.length);
const src = args[0];
if (!src) {
  console.error('Cách dùng: npx tsx scripts/migrate/master.ts <file .xlsx> [thư mục ra]');
  process.exit(2);
}
const out = resolve(args[1] ?? 'etl-out/migrate');
// đọc lỗi lần trước TRƯỚC khi ghi đè (thư mục lần trước có thể trùng thư mục ra)
let prevKeys: Set<string> | null = null;
if (prevArg) {
  const pf = join(resolve(prevArg), 'master_exceptions.csv');
  if (!existsSync(pf)) {
    console.error(`Không thấy ${pf} để so với lần trước.`);
    process.exit(2);
  }
  prevKeys = prevKeysFromCsv(readFileSync(pf, 'utf8'));
}

function env(): Record<string, string> {
  const p = resolve('.env');
  if (!existsSync(p)) throw new Error('Thiếu file .env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  const o: Record<string, string> = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return o;
}
async function readTable<T>(e: Record<string, string>, table: string, select: string): Promise<T[]> {
  const r = await fetch(`${e.SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
    headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Không đọc được ${table}: HTTP ${r.status}`);
  return (await r.json()) as T[];
}
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]) => '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const buf = readFileSync(src);
const srcSha = createHash('sha256').update(buf).digest('hex');
const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, dense: true });
const rows: ParsedRow[] = [];
const sheets: SheetInfo[] = [];
for (const name of wb.SheetNames) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
  const p = parseSheet(name, matrix);
  if (p.info) {
    sheets.push(p.info);
    rows.push(...p.rows);
  }
}
if (!sheets.length) {
  console.error('Không sheet nào có dòng tiêu đề khớp danh mục trường (cần cột Mã ứng viên "No.").');
  process.exit(1);
}

const e = env();
const [o, p, s, h] = await Promise.all([
  readTable<{ list_key: string; value: string; active: boolean }>(e, 'dropdown_options', 'list_key,value,active'),
  readTable<{ code: string; active: boolean }>(e, 'pics', 'code,active'),
  readTable<{ sub_source: string; source: string }>(e, 'sub_source_map', 'sub_source,source'),
  readTable<{ parent_type: string; parent_value: string; child_value: string }>(e, 'hierarchy', 'parent_type,parent_value,child_value'),
]);
// ETL đổi vị trí sang tên chuẩn 18.11 (validation.ts → normalizePosition). Danh mục đích phải có sẵn các tên đó (migration 0027),
// nếu không mọi hồ sơ mang tên cũ thành ngoại lệ DM giả (22/11: 921 dòng). Dừng TRƯỚC khi ghi bất kỳ file nào.
const activePositions = new Set(o.filter((x) => x.list_key === 'position' && x.active).map((x) => x.value));
const missingPositions = [...new Set(Object.values(POSITION_RENAMES))].filter((v) => !activePositions.has(v));
if (missingPositions.length) {
  console.error(`DỪNG: danh mục vị trí của DB đích thiếu ${missingPositions.length} tên chuẩn 18.11 (ví dụ "${missingPositions[0]}").`);
  console.error('Áp migration 0027_position_normalize lên DB đích rồi chạy lại. Chưa ghi file nào.');
  process.exit(2);
}
const res = transformMaster(rows, buildConfig(o, p, s, h));

mkdirSync(out, { recursive: true });
const recordsText = res.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
const recordsSha = createHash('sha256').update(recordsText).digest('hex');
writeFileSync(join(out, 'master_records.jsonl'), recordsText);
writeFileSync(join(out, 'master_exceptions.csv'), csv([
  ['sheet', 'dong', 'ma_ung_vien', 'nhom', 'mo_ta_nhom', 'truong', 'loi'],
  ...res.exceptions.map((x) => [x.sheet, x.rowNumber, x.candidate_code, x.code, EXC_LABEL[x.code], x.field, x.message]),
]));
writeFileSync(join(out, 'master_merged.csv'), csv([['sheet', 'dong', 'ma_ung_vien', 'gop_vao_dong'], ...res.merged.map((m) => [m.sheet, m.rowNumber, m.candidate_code, m.into])]));
writeFileSync(join(out, 'master_phone_groups.csv'), csv([['sdt', 'so_ho_so', 'ma_ung_vien'], ...res.phoneGroups.map((g) => [g.phone, g.codes.length, g.codes.join(' ')])]));

const rowsWithExc = new Set(res.exceptions.map((x) => `${x.sheet}#${x.rowNumber}`)).size;
const byCode: Record<string, { rows: number; issues: number }> = {};
for (const code of Object.keys(EXC_LABEL) as ExcCode[]) {
  const xs = res.exceptions.filter((x) => x.code === code);
  if (xs.length) byCode[code] = { rows: new Set(xs.map((x) => `${x.sheet}#${x.rowNumber}`)).size, issues: xs.length };
}
const byField: Record<string, number> = {};
for (const x of res.exceptions) byField[x.field] = (byField[x.field] ?? 0) + 1;
const summary = {
  file: basename(src), source_sha256: srcSha, records_sha256: recordsSha, at: new Date().toISOString(), sheets,
  total: res.total, loadable: res.records.length, merged_same_person: res.merged.length, rows_with_exceptions: rowsWithExc,
  balanced: res.records.length + res.merged.length + rowsWithExc === res.total,
  exceptions_by_code: byCode, exceptions_by_field: byField, phone_groups_E6: res.phoneGroups.length,
};
writeFileSync(join(out, 'master_summary.json'), JSON.stringify(summary, null, 2));

const review = buildExceptionReport(res.exceptions, rows,
  { file: basename(src), source_sha256: srcSha, at: summary.at, total: res.total, loadable: res.records.length, merged: res.merged.length }, prevKeys);
const rwb = XLSX.utils.book_new();
for (const sh of review.sheets) XLSX.utils.book_append_sheet(rwb, XLSX.utils.aoa_to_sheet(sh.rows), sh.name);
writeFileSync(join(out, 'master_exceptions_review.xlsx'), XLSX.write(rwb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);

console.log(`File: ${basename(src)}  SHA-256 nguồn: ${srcSha.slice(0, 16)}…`);
for (const si of sheets) console.log(`Sheet "${si.sheet}": tiêu đề dòng ${si.headerRow}, khớp ${si.matched} cột, ${si.rows} dòng; cột không nhận ra: ${si.unmapped.join(', ') || '(không)'}`);
console.log(`Tổng ${res.total} dòng = nạp được ${res.records.length} + gộp cùng người ${res.merged.length} + có ngoại lệ ${rowsWithExc}  ${summary.balanced ? '(khớp)' : '(KHÔNG KHỚP)'}`);
for (const [code, c] of Object.entries(byCode)) console.log(`  ${code}: ${c.rows} dòng / ${c.issues} lỗi – ${EXC_LABEL[code as ExcCode]}`);
console.log(`  E6 (không phải lỗi): ${res.phoneGroups.length} nhóm cùng SĐT khác mã`);
console.log(`SHA-256 kết quả nạp: ${recordsSha.slice(0, 16)}… (chạy lại phải giống)  -> ${out}`);
console.log(`Sổ duyệt ngoại lệ cho PO: ${join(out, 'master_exceptions_review.xlsx')}` + (prevKeys ? ` (so với lần trước: mới ${review.stats.isNew}, còn ${review.stats.still}, đã sửa ${review.stats.fixed})` : ''));

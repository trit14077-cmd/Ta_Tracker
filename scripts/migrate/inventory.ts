// M8-1 bước 0 – kiểm kê bản chụp "The Supra" (.xlsx tải về máy): SHA-256, từng sheet có đủ cột như hệ cũ không, số dòng.
// Chạy (Node ≥ 22.6, tự bỏ kiểu TS):  node scripts/migrate/inventory.ts "D:\Ta_Tracker-main\The Supra.xlsx" [thư mục ra]
// Thư mục ra mặc định etl-out/migrate (ngoài git). CHỈ ĐỌC file nguồn; không ghi DB; không in dữ liệu cá nhân (chỉ tên cột + số dòng).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { OLD_SHEETS, checkSheet } from './oldSchema.ts';

const src = process.argv[2];
if (!src) {
  console.error('Cách dùng: node scripts/migrate/inventory.ts <file .xlsx> [thư mục ra]');
  process.exit(2);
}
const out = resolve(process.argv[3] ?? 'etl-out/migrate');
const buf = readFileSync(src);
const sha256 = createHash('sha256').update(buf).digest('hex');
const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, dense: true });

const checks = OLD_SHEETS.map((def) => {
  const ws = wb.Sheets[def.name];
  const matrix = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true }) : null;
  return checkSheet(def, matrix);
});
const known = new Set(OLD_SHEETS.map((s) => s.name));
const unknownSheets = wb.SheetNames.filter((n) => !known.has(n));

mkdirSync(out, { recursive: true });
const report = { file: basename(src), sha256, at: new Date().toISOString(), sheets: checks, unknownSheets };
writeFileSync(join(out, 'inventory.json'), JSON.stringify(report, null, 2));

console.log(`File: ${basename(src)}  SHA-256: ${sha256}`);
for (const c of checks) {
  const state = !c.found ? (c.optional ? 'chưa có (không bắt buộc)' : 'THIẾU SHEET') : c.ok ? 'OK' : `THIẾU CỘT: ${c.missingCols.join(', ')}`;
  const extra = c.extraCols.length ? `  (cột lạ: ${c.extraCols.join(', ')})` : '';
  console.log(`${c.sheet.padEnd(15)} ${String(c.rows).padStart(7)} dòng  -> ${c.skip ? 'không migrate' : c.target.padEnd(26)}  ${state}${extra}`);
}
if (unknownSheets.length) console.log(`Sheet khác (không thuộc hệ cũ): ${unknownSheets.join(', ')}`);
const bad = checks.filter((c) => !c.ok);
console.log(bad.length ? `=> ${bad.length} sheet chưa đạt, xem ${join(out, 'inventory.json')}` : '=> Bản chụp đủ cấu trúc để chạy ETL.');
process.exit(bad.length ? 1 : 0);

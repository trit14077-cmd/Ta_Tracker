// M8 – nạp kết quả ETL bảng Master vào Supabase DEV ở dạng ĐÃ ẨN DANH (DEV-DATA a). Thay lô ETL cũ trên DEV.
// Chạy (từ NEW, sau master.ts):
//   npx tsx scripts/migrate/loadDev.ts --dry-run     # ẩn danh + kiểm tra, KHÔNG ghi gì lên DEV
//   npx tsx scripts/migrate/loadDev.ts               # nạp thật
// An toàn: .env phải có SUPABASE_ENV=dev; ẩn danh làm TRÊN MÁY và kiểm "không còn SĐT/email/tên/mã NV thật" trước khi gửi;
// dừng nếu còn sót. Nạp qua RPC import_records (như Nhập Excel: không ghi đè mã đã có, kiểm PIC, liên kết applicant,
// ngày tạo theo file, nhật ký IMPORT từng dòng) theo lô 500; cuối cùng import_finish ghi 1 dòng tổng.
// Xóa lô cũ: hồ sơ thuộc các import_batches có source bắt đầu bằng "etl:" (file/giấy tờ gắn vào chúng bị xóa theo).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toDbValues } from '../../supabase/functions/records-save/logic.ts';
import { importCreatedAt } from '../../supabase/functions/records-import/logic.ts';
import { anonymize, excelSerialToDateTime } from './anonymize.ts';

const dry = process.argv.includes('--dry-run');
const dir = resolve('etl-out/migrate');
const SOURCE = 'etl:master_anon';
const CHUNK = 500;

function env(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of readFileSync(resolve('.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return o;
}
const e = env();
if (e.SUPABASE_ENV !== 'dev') {
  console.error('DỪNG: .env phải có SUPABASE_ENV=dev (chỉ nạp DEV).');
  process.exit(2);
}
const H = { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${e.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${r.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const src = join(dir, 'master_records.jsonl');
if (!existsSync(src)) {
  console.error('Chưa có etl-out/migrate/master_records.jsonl – chạy scripts/migrate/master.ts trước.');
  process.exit(2);
}
const summary = JSON.parse(readFileSync(join(dir, 'master_summary.json'), 'utf8')) as { file: string; source_sha256: string };
const recs = readFileSync(src, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { sheet: string; rowNumber: number; values: Record<string, string> });

const anon = anonymize(recs.map((r) => r.values));
const a = anon.report;
console.log(`Ẩn danh ${a.rows} hồ sơ trên máy: họ tên ${a.names}, SĐT ${a.phones}, email ${a.emails}, mã NV ${a.empIds} giá trị (một-một).`);
console.log(`Kiểm tra còn sót giá trị thật: SĐT ${a.leftPhone}, email ${a.leftEmail}, họ tên ${a.leftName}, mã NV ${a.leftEmp}`);
if (a.leftPhone || a.leftEmail || a.leftName || a.leftEmp) {
  console.error('DỪNG: còn sót dữ liệu thật, không gửi gì lên DEV.');
  process.exit(1);
}
const rows = anon.rows.map((v, i) => ({
  index: i,
  values: toDbValues(v),
  created_at: importCreatedAt(excelSerialToDateTime(v.created_at ?? '')),
  sheet: recs[i].sheet,
  row_number: recs[i].rowNumber,
}));
const noCreated = rows.filter((r) => !r.created_at).length;
console.log(`Chuẩn bị ${rows.length} dòng (${noCreated} dòng không đọc được Timestamp => ngày tạo = lúc nạp).`);

const admin = (await api<{ id: string }[]>('profiles?role=eq.admin&active=eq.true&select=id&order=created_at&limit=1'))[0];
if (!admin) throw new Error('DEV chưa có tài khoản Admin đang hoạt động.');
const oldBatches = await api<{ id: number; source: string }[]>('import_batches?source=like.etl:*&select=id,source');
const oldIds = oldBatches.map((b) => b.id);
const [{ count: oldRows }] = oldIds.length
  ? await api<{ count: number }[]>(`recruitment_records?import_batch_id=in.(${oldIds.join(',')})&select=count`)
  : [{ count: 0 }];
console.log(`Lô ETL cũ trên DEV: ${oldIds.join(', ') || '(không có)'} – ${oldRows} hồ sơ sẽ bị thay.`);
if (dry) {
  console.log('--dry-run: dừng ở đây, chưa ghi gì lên DEV.');
  process.exit(0);
}

if (oldIds.length) {
  await api(`recruitment_records?import_batch_id=in.(${oldIds.join(',')})`, { method: 'DELETE' });
  await api(`import_batches?id=in.(${oldIds.join(',')})`, { method: 'DELETE' });
}
const [batch] = await api<{ id: number }[]>('import_batches?select=id', {
  method: 'POST', headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ source: SOURCE, note: `M8: ${summary.file} (SHA-256 ${summary.source_sha256.slice(0, 16)}…), ẩn danh`, created_by: admin.id }),
});
let imported = 0;
const rejected: { index: number; errors: unknown }[] = [];
for (let i = 0; i < rows.length; i += CHUNK) {
  const res = await api<{ imported: number; rejected: { index: number; errors: unknown }[] }>('rpc/import_records', {
    method: 'POST', body: JSON.stringify({ p_actor: admin.id, p_batch_id: batch.id, p_rows: rows.slice(i, i + CHUNK) }),
  });
  imported += res.imported;
  rejected.push(...res.rejected);
  process.stdout.write(`\r  đã nạp ${imported}/${rows.length}`);
}
console.log('');
await api('rpc/import_finish', {
  method: 'POST',
  body: JSON.stringify({ p_actor: admin.id, p_batch_id: batch.id, p_file: summary.file + ' (ẩn danh, M8)', p_imported: imported, p_invalid: 0, p_duplicates: 0, p_rejected: rejected.length }),
});
writeFileSync(join(dir, 'load_dev_rejected.json'), JSON.stringify(rejected.map((r) => ({ ...r, row_number: rows[r.index].row_number })), null, 2));
console.log(`Xong lô ${batch.id}: nạp ${imported}, máy chủ từ chối ${rejected.length} (chi tiết: etl-out/migrate/load_dev_rejected.json).`);

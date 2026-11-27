// Nhập một lần "Tình trạng chi lương" + "Tình trạng ký HĐTV" từ các tab OB của sheet C&B, khớp theo Mã NV (emp_id).
// KHÔNG kết nối DB. Script chỉ: kiểm file đầu vào -> dry-run trên bản ETL (in số đếm) -> sinh file SQL để Admin tự chạy.
//
// Đầu vào: CSV có tiêu đề  tab,emp_id,contract_sign_status,salary_pay_status
//   (xuất từ sheet C&B: OB_T10/26 lấy cột C, J, K; OBT11/26 lấy cột A, I, J). Chỉ cần đúng 4 cột này, không lấy tên/SĐT.
// Chạy (từ NEW):
//   npx tsx scripts/migrate/cnbStatusImport.ts --input <file.csv>                       # dry-run, chỉ in số đếm
//   npx tsx scripts/migrate/cnbStatusImport.ts --input <file.csv> --out <file.sql>      # + sinh SQL
//   thêm --overwrite để ghi đè ô đã có giá trị khác (mặc định chỉ điền ô trống)
//   thêm --records <file.jsonl> để dry-run trên file khác (mặc định etl-out/migrate/master_records.jsonl)
// File SQL chứa Mã NV: để ngoài repo (scratchpad / etl-out), không commit.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildUpdateSql, parseCsv, prepareInput, simulate, type CnbTargetRecord } from './cnbStatusLib.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const input = arg('--input');
const out = arg('--out');
const overwrite = process.argv.includes('--overwrite');
const recordsPath = resolve(arg('--records') ?? 'etl-out/migrate/master_records.jsonl');
if (!input) {
  console.error('Thiếu --input <file.csv> (cột: tab,emp_id,contract_sign_status,salary_pay_status)');
  process.exit(2);
}

const raw = parseCsv(readFileSync(resolve(input), 'utf8'));
const need = ['tab', 'emp_id', 'contract_sign_status', 'salary_pay_status'];
const missing = need.filter((k) => raw.length && !(k in raw[0]));
if (missing.length) {
  console.error(`File thiếu cột: ${missing.join(', ')}`);
  process.exit(2);
}
const { rows, issues } = prepareInput(raw);

const byTab = new Map<string, { dong: number; chi_luong: number; khong_chi: number; hdtv: number }>();
for (const r of raw) {
  const t = byTab.get(r.tab) ?? { dong: 0, chi_luong: 0, khong_chi: 0, hdtv: 0 };
  t.dong++;
  if (r.salary_pay_status?.trim() === 'Chi lương') t.chi_luong++;
  if (r.salary_pay_status?.trim() === 'Không chi lương') t.khong_chi++;
  if (r.contract_sign_status?.trim()) t.hdtv++;
  byTab.set(r.tab, t);
}
console.log('== Đầu vào ==');
console.table(Object.fromEntries(byTab));
console.log(`Mã NV hợp lệ sau gộp: ${rows.length}. Dòng có vấn đề: ${issues.length}`);
const issueCount = new Map<string, number>();
for (const i of issues) issueCount.set(i.issue, (issueCount.get(i.issue) ?? 0) + 1);
if (issues.length) console.table(Object.fromEntries(issueCount));

if (existsSync(recordsPath)) {
  const recs: CnbTargetRecord[] = [];
  for (const line of readFileSync(recordsPath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const v = (JSON.parse(line) as { values: Record<string, unknown> }).values;
    recs.push({
      emp_id: String(v.emp_id ?? ''),
      salary_pay_status: String(v.salary_pay_status ?? ''),
      contract_sign_status: String(v.contract_sign_status ?? ''),
    });
  }
  const st = simulate(rows, recs, overwrite);
  console.log(`\n== Dry-run trên ${recordsPath} (${recs.length} hồ sơ) ==`);
  console.table({
    tong: { 'Mã NV': st.input, 'không tìm thấy': st.khong_tim_thay, 'trùng hồ sơ (bỏ qua)': st.trung_ho_so, 'khớp': st.khop, 'hồ sơ sẽ đổi': st.ho_so_doi },
  });
  console.table({
    salary_pay_status: { 'sẽ điền': st.se_dien.salary_pay_status, 'đã có giá trị khác (giữ)': st.khac_gia_tri.salary_pay_status, 'giống rồi': st.giong_roi.salary_pay_status },
    contract_sign_status: { 'sẽ điền': st.se_dien.contract_sign_status, 'đã có giá trị khác (giữ)': st.khac_gia_tri.contract_sign_status, 'giống rồi': st.giong_roi.contract_sign_status },
  });
  console.log('Lưu ý: bản ETL có thể cũ hơn DB thật; con số trên DB thật in ở cuối khi chạy file SQL.');
} else {
  console.log(`\n(Bỏ qua dry-run: không thấy ${recordsPath})`);
}

if (out) {
  const sources = [...byTab.keys()].join(', ');
  writeFileSync(resolve(out), buildUpdateSql(rows, { overwrite, source: sources }), 'utf8');
  console.log(`\nĐã sinh SQL: ${resolve(out)} (${rows.length} Mã NV). Chưa chạy lên DB nào.`);
}

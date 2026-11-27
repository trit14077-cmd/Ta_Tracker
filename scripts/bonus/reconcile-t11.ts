// Đối chiếu hàm tính bonus (shared/bonus) với file Excel kỳ T11/2026 trong docs/bonus/ (gitignored, có dữ liệu lương thật).
// Chỉ in tổng tiền / số dòng / số ca lệch – KHÔNG in tên hay mã nhân viên.
// Chạy (từ D:\ viết hoa):  npx tsx scripts/bonus/reconcile-t11.ts [thư mục chứa file xlsx]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { fmtVnd } from '../../shared/bonus/period.ts';
import { REFERRAL_DEFAULT_RATES, buildReferralPeriod, type ReferralSource, type YesNo } from '../../shared/bonus/referral.ts';

const DIR = process.argv[2] ?? join(process.cwd(), 'docs/bonus/Template file tính toán');
const PERIOD = '2026-11';

type Row = Record<string, unknown>;
function sheetRows(file: string, sheet: string): Row[] {
  const p = join(DIR, file);
  if (!existsSync(p)) throw new Error(`Không thấy file: ${file}`);
  const wb = XLSX.read(readFileSync(p), { cellDates: true });
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Không thấy sheet "${sheet}" trong ${file}`);
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 'A', defval: null, raw: true });
}
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const yn = (v: unknown): YesNo => (str(v) === 'Yes' ? 'Yes' : str(v) === 'No' ? 'No' : '');

let fail = 0;
function check(label: string, got: number, want: number) {
  const ok = got === want;
  if (!ok) fail = 1;
  console.log(`${ok ? 'KHỚP ' : 'LỆCH '} ${label}: app ${fmtVnd(got)} | Excel ${fmtVnd(want)}`);
}

// ---------------- #8 Referral ----------------
function referral() {
  const rows = sheetRows("Referral Payment_Nov'2026 (1).xlsx", 'Nov26 Referral List').filter((r) => typeof r.E === 'number');
  const sources: ReferralSource[] = rows.map((r, i) => ({
    record_id: i + 1, candidate_code: `R${i + 1}`, full_name: '', emp_id: str(r.E), rank: str(r.F), region: str(r.B), dc: str(r.C),
    ob_date: iso(r.G), emp_status: str(r.H), attrition_date: iso(r.K), pic: null,
    referrer_name: str(r.O), referrer_emp_id: str(r.P), referrer_rank: str(r.Q), referrer_dc: '', referrer_status: str(r.R),
    referrer_last_day: iso(r.T), disciplinary: str(r.J) === 'Yes',
    candidate_eligible: yn(r.L), referrer_eligible: yn(r.U), note: str(r.X),
  }));
  const res = buildReferralPeriod(sources, new Map(), PERIOD, REFERRAL_DEFAULT_RATES);
  const excelCand = rows.reduce((s, r) => s + (Number(r.M) || 0), 0);
  const excelRef = rows.reduce((s, r) => s + (Number(r.V) || 0), 0);
  console.log(`\n#8 Referral – ${rows.length} dòng, vào kỳ ${res.rows.length}, chờ ${res.pending.length}`);
  check('tiền ứng viên', res.totals.candidate, excelCand);
  check('tiền người giới thiệu', res.totals.referrer, excelRef);
  check('TỔNG Referral', res.totals.total, 17_000_000);
  const fixed = sources.filter((s) => s.referrer_eligible === 'No' || s.candidate_eligible === 'No').length;
  console.log(`   dòng có Eligible = No (chịu ảnh hưởng của sửa lỗi): ${fixed}`);
}

for (const [name, fn] of [['referral', referral]] as const) {
  try {
    fn();
  } catch (e) {
    fail = 1;
    console.log(`LỖI ${name}: ${(e as Error).message}`);
  }
}
process.exit(fail);

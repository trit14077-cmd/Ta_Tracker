// Đối chiếu hàm tính bonus (shared/bonus) với file Excel kỳ T11/2026 trong docs/bonus/ (gitignored, có dữ liệu lương thật).
// Chỉ in tổng tiền / số dòng / số ca lệch – KHÔNG in tên hay mã nhân viên.
// Chạy (từ D:\ viết hoa):  npx tsx scripts/bonus/reconcile-t11.ts [thư mục chứa file xlsx]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { fmtVnd, periodKeyOfLabel } from '../../shared/bonus/period.ts';
import {
  SIGNON_DEFAULT_SCHEMES, autoScheme, buildSignonPeriod, partOf, suggestFlag,
  type SignonFlag, type SignonPaidMap, type SignonSource,
} from '../../shared/bonus/signon.ts';
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

// ---------------- #9 Sign-on ----------------
// Cờ Passed/Failed của Excel dùng làm cờ sửa tay; ô trống = Excel chưa xét → 'Hold'. Mốc đã có Payment Status
// của kỳ trước = đã chốt. Ngày chốt kỳ Nov'26 = 25/11/2026 (mốc trễ nhất trả trong kỳ).
function signon() {
  const rows = sheetRows("Sign-on Bonus Payment _ Nov'26 Pay Period.xlsx", 'Sign-on Details').filter((r) => r.E instanceof Date);
  const MS = [['I', 'J', 'K', 'L'], ['M', 'N', 'O', 'P'], ['Q', 'R', 'S', 'T'], ['U', 'V', 'W', 'X']] as const;
  const paid: SignonPaidMap = new Map();
  let autoDiff = 0;
  let suggestDiff = 0;
  const sources: SignonSource[] = rows.map((r, i) => {
    const flags: Record<string, SignonFlag> = {};
    const p: Record<string, { period: string; amount: number }> = {};
    MS.forEach(([, e, b, st], k) => {
      const f = str(r[e]);
      flags[partOf(k)] = f === 'Passed' || f === 'Failed' ? f : f === 'Not Applicable' ? '' : 'Hold';
      const key = periodKeyOfLabel(r[st]);
      if (key && key < PERIOD) p[partOf(k)] = { period: key, amount: Number(r[b]) || 0 };
    });
    if (Object.keys(p).length) paid.set(i + 1, p);
    const src: SignonSource = {
      record_id: i + 1, candidate_code: `S${i + 1}`, full_name: '', emp_id: str(r.D), rank: '6A', dc: str(r.C),
      ob_date: iso(r.E), emp_status: str(r.G), attrition_date: iso(r.F), pic: null, scheme_code: str(r.H), flags, note: '',
    };
    if (autoScheme(src.dc, src.ob_date, SIGNON_DEFAULT_SCHEMES)?.code !== src.scheme_code) autoDiff += 1;
    MS.forEach(([d, e]) => {
      const f = str(r[e]);
      if ((f === 'Passed' || f === 'Failed') && r[d] instanceof Date && suggestFlag(src, iso(r[d]) as string) !== f) suggestDiff += 1;
    });
    return src;
  });
  const res = buildSignonPeriod(sources, paid, PERIOD, '2026-11-25', SIGNON_DEFAULT_SCHEMES);
  const excelNov = rows.reduce((s, r) => s + (Number(r.AD) || 0), 0);
  const sheetNov = sheetRows("Sign-on Bonus Payment _ Nov'26 Pay Period.xlsx", '112026').filter((r) => typeof r.B === 'number' && typeof r.J === 'number');
  console.log(`\n#9 Sign-on – ${rows.length} người, ${res.lines.length} mốc vào kỳ, ${res.unassigned.length} chưa có scheme`);
  console.log(`   scheme tự gán khác Excel: ${autoDiff} | cờ gợi ý khác Excel: ${suggestDiff} (admin sửa tay)`);
  for (const [part, amt] of Object.entries(res.totals.byPart).sort()) console.log(`   ${part}: ${fmtVnd(amt)}`);
  check('Sign-on cột AD (Nov)', res.totals.total, excelNov);
  check('Số người được trả (sheet 112026)', res.totals.people, sheetNov.length);
  check('TỔNG Sign-on', res.totals.total, 50_000_000);
}

for (const [name, fn] of [['referral', referral], ['signon', signon]] as const) {
  try {
    fn();
  } catch (e) {
    fail = 1;
    console.log(`LỖI ${name}: ${(e as Error).message}`);
  }
}
process.exit(fail);

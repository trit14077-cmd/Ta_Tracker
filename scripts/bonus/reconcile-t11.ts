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
import {
  TA_CREDIT_DEFAULT_CONFIG, TA_LEVELS, buildTaCreditPeriod, obCredits, type TaCreditSource, type TaProfile,
} from '../../shared/bonus/taCredit.ts';
import { FREELANCER_DEFAULT_CONFIG, buildFreelancerPeriod, type Freelancer, type FreelancerSource } from '../../shared/bonus/freelancer.ts';
import { buildPayoutSummary, type SummaryKind } from '../../shared/bonus/summary.ts';
import type { BonusLineInput } from '../../shared/bonus/period.ts';
import { ONSITE_DEFAULT_CONFIG, buildOnsitePeriod, type OnsiteDay } from '../../shared/bonus/onsite.ts';
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
// Ngày theo giờ Việt Nam: vài ô lưu 00:00 +07 (= 17:00 UTC hôm trước) do xuất từ Google Sheets.
const iso = (v: unknown): string | null => (v instanceof Date ? new Date(v.getTime() + 7 * 3_600_000).toISOString().slice(0, 10) : null);
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const yn = (v: unknown): YesNo => (str(v) === 'Yes' ? 'Yes' : str(v) === 'No' ? 'No' : '');

let fail = 0;
const computed: Partial<Record<SummaryKind, BonusLineInput[]>> = {};
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
// của kỳ trước = đã chốt. Ngày chốt kỳ Nov'26 = 26/11/2026 (mốc trễ nhất trả trong kỳ).
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
  const res = buildSignonPeriod(sources, paid, PERIOD, '2026-11-26', SIGNON_DEFAULT_SCHEMES);
  const excelNov = rows.reduce((s, r) => s + (Number(r.AD) || 0), 0);
  const sheetNov = sheetRows("Sign-on Bonus Payment _ Nov'26 Pay Period.xlsx", '112026').filter((r) => typeof r.B === 'number' && typeof r.J === 'number');
  console.log(`\n#9 Sign-on – ${rows.length} người, ${res.lines.length} mốc vào kỳ, ${res.unassigned.length} chưa có scheme`);
  console.log(`   scheme tự gán khác Excel: ${autoDiff} | cờ gợi ý khác Excel: ${suggestDiff} (admin sửa tay)`);
  for (const [part, amt] of Object.entries(res.totals.byPart).sort()) console.log(`   ${part}: ${fmtVnd(amt)}`);
  check('Sign-on cột AD (Nov)', res.totals.total, excelNov);
  check('Số người được trả (sheet 112026)', res.totals.people, sheetNov.length);
  check('TỔNG Sign-on', res.totals.total, 50_000_000);
}

// ---------------- #10 TA Credit ----------------
// OB tháng 10 (sheet ob_list_Oct'26) trả ở kỳ Nov'26. Level / Region của TA lấy ở settings!O:R (PIC, Region, Level, chức danh).
function taCredit() {
  const FILE = 'TA_Credit_Bonus_Nov26 (2).xlsx';
  const obs = sheetRows(FILE, "ob_list_Oct'26").filter((r) => r.N instanceof Date && str(r.B));
  const sources: TaCreditSource[] = obs.map((r, i) => ({
    record_id: i + 1, candidate_code: `C${i + 1}`, full_name: '', emp_id: str(r.P), pic: str(r.B), rank: str(r.F), region: str(r.I), unit: str(r.K),
    site: str(r.M), ob_date: iso(r.N), ob_status: str(r.O), emp_status: str(r.Q), attrition_date: iso(r.R),
  }));
  const profiles: TaProfile[] = sheetRows(FILE, 'settings')
    .filter((r) => str(r.O) && (str(r.P) === 'North' || str(r.P) === 'South') && (TA_LEVELS as readonly string[]).includes(str(r.Q)))
    .map((r) => ({
      pic: str(r.O), name: '', emp_id: '', region: str(r.P) as TaProfile['region'], level: str(r.Q) as TaProfile['level'],
      title: str(r.R), is_freelancer: false, onsite: false, active: true,
    }));
  const cfg = TA_CREDIT_DEFAULT_CONFIG;
  const res = buildTaCreditPeriod(sources, profiles, PERIOD, '2026-11-26', cfg);
  const excelCredits = obs.reduce((s, r) => s + (Number(r.H) || 0), 0);
  const creditDiff = sources.filter((s, i) => obCredits(s, cfg) !== Number(obs[i].H)).length;
  const noIntern = buildTaCreditPeriod(sources, profiles, PERIOD, '2026-11-26', { ...cfg, internBaseRate: 0 }).totals.amount;
  console.log(`\n#10 TA Credit – ${obs.length} OB, ${profiles.length} hồ sơ TA, ${res.rows.filter((r) => r.problem).length} PIC thiếu hồ sơ, ${res.skipped.length} OB bị loại`);
  console.log(`   OB có credit khác cột H: ${creditDiff} | nếu Intern Base trả 0: ${fmtVnd(noIntern)}`);
  check('Tổng credit', Math.round(res.totals.credits * 10), Math.round(excelCredits * 10));
  check('Số OB eligible', res.totals.eligible, 70);
  check('TỔNG TA Credit', res.totals.amount, 3_220_000);
  computed.ta_credit = res.lines;
}

// ---------------- #10 Onsite ----------------
// Sheet "Onsite Allowance": hàng 3+ = ngày (cột B), cột D.. = TA (ô = 1), các hàng cuối là Total / Rate / Amount.
// Kỳ Nov'26 trả ngày onsite của chính tháng 11. So với tổng cột (3) ở sheet Summary.
function onsite() {
  const FILE = 'TA_Credit_Bonus_Nov26 (2).xlsx';
  const rows = sheetRows(FILE, 'Onsite Allowance');
  const head = rows.find((r) => str(r.B) === 'Onsite Date') ?? {};
  const cols = Object.keys(head).filter((k) => k >= 'D' && k.length === 1 && str(head[k]));
  const days: OnsiteDay[] = rows.filter((r) => r.B instanceof Date)
    .flatMap((r) => cols.filter((k) => Number(r[k]) === 1).map((k) => ({ pic: `TA-${k}`, day: iso(r.B) ?? '' })));
  const profiles: TaProfile[] = cols.map((k) => ({
    pic: `TA-${k}`, name: '', emp_id: '', region: 'North', level: '', title: '', is_freelancer: false, onsite: true, active: true,
  }));
  const res = buildOnsitePeriod(days, profiles, PERIOD, ONSITE_DEFAULT_CONFIG);
  const summary = sheetRows(FILE, "Summary Nov'26").filter((r) => typeof r.B === 'number').reduce((s, r) => s + (Number(r.H) || 0), 0);
  const outside = days.filter((d) => !d.day.startsWith(PERIOD)).length;
  console.log(`
#10 Onsite – ${cols.length} TA, ${days.length} ô onsite, ${outside} ngày ngoài tháng ${PERIOD}`);
  check('Tổng ngày onsite', res.totals.days, days.length - outside);
  check('TỔNG Onsite (so với Summary cột 3)', res.totals.amount, summary);
  check('TỔNG Onsite', res.totals.amount, 5_000_000);
  computed.onsite = res.lines;
}

// ---------------- #10 Freelancer ----------------
// Sheet "Freelancer Bonus": mỗi dòng một ứng viên (B = CTV, D = Emp ID, E = Working Status, F = DC, H = OBD, I/J/K = Bonus/PIT/Net).
// Tên CTV chỉ dùng để gom (đổi thành id trong bộ nhớ, không in). Ngày chốt 26/11/2026.
function freelancer() {
  const FILE = 'TA_Credit_Bonus_Nov26 (2).xlsx';
  const rows = sheetRows(FILE, 'Freelancer Bonus').filter((r) => str(r.B) && r.H instanceof Date);
  const ids = new Map<string, number>();
  for (const r of rows) if (!ids.has(str(r.B))) ids.set(str(r.B), ids.size + 1);
  const fl: Freelancer[] = [...ids.values()].map((id) => ({ id, name: `CTV ${id}`, phone: '', region: '', note: '', active: true }));
  const sources: FreelancerSource[] = rows.map((r, i) => ({
    record_id: i + 1, candidate_code: `C${i + 1}`, full_name: '', emp_id: str(r.D), position: str(r.G), site: str(r.F), sub_source: 'Freelancer',
    pic: null, ob_date: iso(r.H), ob_status: 'Joined', emp_status: str(r.E), attrition_date: null, freelancer_id: ids.get(str(r.B)) ?? null, flag: '', note: '',
  }));
  const res = buildFreelancerPeriod(sources, fl, new Map(), PERIOD, '2026-11-26', FREELANCER_DEFAULT_CONFIG);
  const sum = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const perRowDiff = res.lines.filter((l) => l.amount !== Number(rows[(l.record_id ?? 0) - 1].I)).length;
  console.log(`
#10 Freelancer – ${rows.length} ứng viên, ${ids.size} CTV, ${res.rows.filter((r) => r.state !== 'due').length} không vào kỳ, ${perRowDiff} dòng lệch mức`);
  check('Số ứng viên được trả', res.totals.people, rows.length);
  check('PIT', res.totals.pit, sum('J'));
  check('Net', res.totals.net, sum('K'));
  check('TỔNG Freelancer', res.totals.amount, sum('I'));
  check('TỔNG Freelancer (mốc)', res.totals.amount, 7_500_000);
  computed.freelancer = res.lines;
}

// ---------------- #10 Tổng hợp (sheet Summary) ----------------
// Gộp khoản của 3 loại theo người nhận; so dòng tổng (hàng có cột J mà không có số thứ tự ở cột B).
function summary() {
  const rows = sheetRows('TA_Credit_Bonus_Nov26 (2).xlsx', "Summary Nov'26");
  const total = rows.find((r) => typeof r.B !== 'number' && typeof r.J === 'number' && typeof r.G === 'number');
  if (!total) throw new Error('Không thấy dòng tổng của sheet Summary');
  const s = buildPayoutSummary(computed);
  // Excel không có mã PIC ở sheet Onsite / Nov'26 Bonus nên script không gộp được TA Onsite với TA Credit theo người
  // (app gộp theo PIC). Chỉ so số CTV và số TA có Onsite.
  const data = rows.filter((r) => typeof r.B === 'number');
  console.log(`
#10 Tổng hợp – app ${s.rows.length} dòng người nhận, Excel ${data.length} dòng`);
  check('Số CTV', s.rows.filter((r) => r.type === 'freelancer').length, data.filter((r) => Number(r.I) > 0).length);
  check('Số TA có Onsite', s.rows.filter((r) => r.onsite > 0).length, data.filter((r) => Number(r.H) > 0).length);
  check('(2) TA Credit', s.totals.credit, Number(total.G));
  check('(3) Onsite', s.totals.onsite, Number(total.H));
  check('(4) Freelancer', s.totals.freelancer, Number(total.I));
  check('(1) TỔNG CHI TRẢ', s.totals.total, Number(total.J));
}

for (const [name, fn] of [['referral', referral], ['signon', signon], ['ta_credit', taCredit], ['onsite', onsite], ['freelancer', freelancer], ['summary', summary]] as const) {
  try {
    fn();
  } catch (e) {
    fail = 1;
    console.log(`LỖI ${name}: ${(e as Error).message}`);
  }
}
process.exit(fail);

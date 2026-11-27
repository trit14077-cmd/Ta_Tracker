/**
 * Task #9 – Sign-on Bonus. Quy tắc chốt ngày 27/11/2026 (docs/bonus/PHAN_TICH_BONUS.md, không vào Git):
 *  - Đối tượng: Rank 6 đã Joined tại các site có scheme (DC Hải Phòng, DC Hưng Yên, TTPP Hải Phòng, TTPP Hưng Yên).
 *  - Scheme gán tự động theo site + ngày vào (scheme mới nhất có hiệu lực ≤ ngày vào), admin sửa tay được.
 *  - Mốc = Join Date + days (NGÀY LỊCH, như công thức Excel E+6/E+14/E+29/E+59). Mức tiền theo scheme;
 *    amount = null → "Not Applicable" (scheme DCHP 11.05.2026 không có mốc 1, 2).
 *  - Cờ Passed/Failed: app GỢI Ý (nghỉ việc TRƯỚC ngày mốc → Failed; nghỉ đúng ngày mốc vẫn Passed), admin sửa
 *    được; 'Hold' = chưa xét, để kỳ sau.
 *  - Kỳ lương theo NGÀY CHỐT: mốc đạt ≤ ngày chốt, chưa trả ở kỳ đã chốt trước → vào kỳ này (mốc trễ vào kỳ sau).
 *    Mốc Failed cũng tạo khoản 0 đ để không quay lại kỳ sau. Mỗi mốc của một hồ sơ chỉ chốt một lần.
 * DB: migration 0046 (bonus_signon_schemes, bonus_signon_records); khoản tiền ở bonus_lines (kind 'signon', part 'm1'…).
 */
import { addDays, toIsoDate, type BonusLineInput } from './period.ts';

export interface SignonMilestone {
  days: number;
  /** null = Not Applicable (scheme không có mốc này). */
  amount: number | null;
}

export interface SignonScheme {
  code: string;
  sites: string[];
  effective_from: string;
  effective_to: string | null;
  milestones: SignonMilestone[];
  active: boolean;
  note: string;
}

const STD: SignonMilestone[] = [
  { days: 6, amount: 500_000 },
  { days: 14, amount: 500_000 },
  { days: 29, amount: 1_000_000 },
  { days: 59, amount: 1_000_000 },
];

/** 3 scheme đang áp dụng theo file Nov'26 (seed của migration 0046). */
export const SIGNON_DEFAULT_SCHEMES: SignonScheme[] = [
  {
    code: 'DCHP 11.05.2026', sites: ['DC Hải Phòng'], effective_from: '2026-05-11', effective_to: null, active: true, note: '',
    milestones: [{ days: 6, amount: null }, { days: 14, amount: null }, { days: 29, amount: 1_000_000 }, { days: 59, amount: 1_000_000 }],
  },
  { code: 'DCHP + DCHY 01.06.2026', sites: ['DC Hải Phòng', 'DC Hưng Yên'], effective_from: '2026-06-01', effective_to: null, active: true, note: '', milestones: STD },
  { code: 'TTPP HY + TTPPHP_13.08.2026', sites: ['TTPP Hưng Yên', 'TTPP Hải Phòng'], effective_from: '2026-08-13', effective_to: null, active: true, note: '', milestones: STD },
];

export const SIGNON_MAX_MILESTONES = 6;
export const SIGNON_FLAGS = ['', 'Passed', 'Failed', 'Hold'] as const;
export type SignonFlag = (typeof SIGNON_FLAGS)[number];
export type SignonDecision = Exclude<SignonFlag, ''>;

export const partOf = (i: number) => `m${i + 1}`;

export interface SignonSource {
  record_id: number;
  candidate_code: string;
  full_name: string;
  emp_id: string;
  rank: string;
  dc: string;
  ob_date: string | null;
  emp_status: string;
  attrition_date: string | null;
  pic: string | null;
  /** Scheme admin chọn tay; '' = tự gán. */
  scheme_code: string;
  /** Cờ admin sửa tay theo mốc ('m1'…); '' / thiếu = theo gợi ý. */
  flags: Record<string, SignonFlag>;
  note: string;
}

export type MilestoneState = 'na' | 'future' | 'hold' | 'due' | 'paid_before';

export interface SignonMilestoneRow {
  part: string;
  days: number;
  date: string;
  /** Mức của scheme; null = Not Applicable. */
  rate: number | null;
  suggested: SignonDecision;
  /** Cờ áp dụng (tay nếu có, không thì gợi ý); 'Not Applicable' khi rate = null. */
  flag: SignonDecision | 'Not Applicable';
  overridden: boolean;
  state: MilestoneState;
  /** Tiền của mốc: due → theo cờ; paid_before → số đã chốt; còn lại 0. */
  bonus: number;
  /** Kỳ trả (due = kỳ đang xem, paid_before = kỳ đã chốt). */
  period: string;
}

export type SignonWarning = 'no_scheme' | 'no_join_date' | 'resigned_no_date' | 'scheme_manual' | 'flag_manual';

export const SIGNON_WARNING_LABELS: Record<SignonWarning, string> = {
  no_scheme: 'Chưa có scheme',
  no_join_date: 'Thiếu ngày vào',
  resigned_no_date: 'Đã nghỉ nhưng thiếu ngày nghỉ',
  scheme_manual: 'Scheme chọn tay',
  flag_manual: 'Cờ sửa tay khác gợi ý',
};

export interface SignonRow extends SignonSource {
  scheme: string;
  scheme_auto: string;
  milestones: SignonMilestoneRow[];
  /** Tiền vào kỳ đang xem. */
  period_amount: number;
  /** Tổng tiền đã chốt + vào kỳ này (cột TOTAL SIGN-ON BONUS). */
  total_amount: number;
  warnings: SignonWarning[];
}

export interface SignonPeriodResult {
  /** Người có ít nhất một mốc vào kỳ. */
  rows: SignonRow[];
  /** Mọi người trong phạm vi (sheet Sign-on Details). */
  all: SignonRow[];
  /** Trong phạm vi nhưng chưa gán được scheme / thiếu ngày vào. */
  unassigned: SignonRow[];
  lines: BonusLineInput[];
  totals: { total: number; people: number; lines: number; byPart: Record<string, number> };
}

/** Kỳ + số tiền đã chốt của từng mốc: record_id → { m1: { period, amount } … }. */
export type SignonPaidMap = Map<number, Record<string, { period: string; amount: number }>>;

const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim();

/** Rank 6 ('6A', '6B', 'Rank 6'…): chữ số đầu tiên là 6. */
export function isSignonRank(rank: string): boolean {
  return /\d/.exec(norm(rank))?.[0] === '6';
}

export function cleanSignonFlag(v: unknown): SignonFlag {
  const s = norm(v);
  return (SIGNON_FLAGS as readonly string[]).includes(s) ? (s as SignonFlag) : '';
}

/** Kiểm + chuẩn hóa scheme (dùng cho form admin và dữ liệu đọc từ DB). Lỗi → message tiếng Việt. */
export function cleanSignonScheme(raw: Partial<SignonScheme> & Record<string, unknown>): { scheme: SignonScheme | null; error: string } {
  const code = norm(raw.code);
  if (!code || code.length > 80) return { scheme: null, error: 'Mã scheme trống hoặc quá dài.' };
  const sites = [...new Set((Array.isArray(raw.sites) ? raw.sites : []).map(norm).filter(Boolean))];
  if (!sites.length) return { scheme: null, error: 'Cần ít nhất một site.' };
  const from = toIsoDate(raw.effective_from);
  if (!from) return { scheme: null, error: 'Ngày hiệu lực không hợp lệ.' };
  const to = raw.effective_to ? toIsoDate(raw.effective_to) : '';
  if (raw.effective_to && (!to || to < from)) return { scheme: null, error: 'Ngày hết hiệu lực không hợp lệ.' };
  const ms = Array.isArray(raw.milestones) ? raw.milestones : [];
  if (!ms.length || ms.length > SIGNON_MAX_MILESTONES) return { scheme: null, error: `Cần 1–${SIGNON_MAX_MILESTONES} mốc.` };
  const milestones: SignonMilestone[] = [];
  for (const m of ms as unknown[]) {
    const o = (m ?? {}) as Record<string, unknown>;
    const days = Number(o.days);
    const amount = o.amount == null || o.amount === '' ? null : Number(o.amount);
    if (!Number.isInteger(days) || days < 0 || days > 400) return { scheme: null, error: 'Số ngày của mốc phải là số nguyên 0–400.' };
    if (amount !== null && (!Number.isInteger(amount) || amount < 0)) return { scheme: null, error: 'Mức tiền của mốc phải là số nguyên ≥ 0.' };
    milestones.push({ days, amount });
  }
  return {
    scheme: { code, sites, effective_from: from, effective_to: to || null, milestones, active: raw.active !== false, note: norm(raw.note).slice(0, 500) },
    error: '',
  };
}

/** Scheme tự gán: đang dùng, có site, hiệu lực ≤ ngày vào (≤ ngày hết hiệu lực nếu có); mới nhất thắng. */
export function autoScheme(dc: string, obDate: string | null, schemes: SignonScheme[]): SignonScheme | null {
  const d = toIsoDate(obDate);
  const site = norm(dc);
  if (!d || !site) return null;
  const hit = schemes
    .filter((s) => s.active && s.sites.includes(site) && s.effective_from <= d && (!s.effective_to || d <= s.effective_to))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return hit[0] ?? null;
}

/** Hồ sơ thuộc phạm vi Sign-on: có scheme chọn tay, hoặc Rank 6 tại một site có scheme đang dùng. */
export function inSignonScope(src: Pick<SignonSource, 'rank' | 'dc' | 'scheme_code'>, schemes: SignonScheme[]): boolean {
  if (norm(src.scheme_code)) return true;
  return isSignonRank(src.rank) && schemes.some((s) => s.active && s.sites.includes(norm(src.dc)));
}

const resigned = (src: Pick<SignonSource, 'emp_status' | 'attrition_date'>) => norm(src.emp_status) === 'Resigned' || Boolean(toIsoDate(src.attrition_date));

/** Gợi ý cờ cho mốc: nghỉ TRƯỚC ngày mốc → Failed; đã nghỉ mà thiếu ngày nghỉ → Hold; còn lại Passed. */
export function suggestFlag(src: Pick<SignonSource, 'emp_status' | 'attrition_date'>, milestoneDate: string): SignonDecision {
  const att = toIsoDate(src.attrition_date);
  if (att) return att < milestoneDate ? 'Failed' : 'Passed';
  return norm(src.emp_status) === 'Resigned' ? 'Hold' : 'Passed';
}

function evaluate(src: SignonSource, scheme: SignonScheme | null, auto: SignonScheme | null, paid: SignonPaidMap, periodKey: string, cutoff: string): SignonRow {
  const p = paid.get(src.record_id) ?? {};
  const join = toIsoDate(src.ob_date);
  const milestones: SignonMilestoneRow[] = [];
  const warnings: SignonWarning[] = [];
  if (!join) warnings.push('no_join_date');
  if (!scheme) warnings.push('no_scheme');
  if (norm(src.scheme_code) && scheme && auto?.code !== scheme.code) warnings.push('scheme_manual');
  if (norm(src.emp_status) === 'Resigned' && !toIsoDate(src.attrition_date)) warnings.push('resigned_no_date');
  if (scheme && join) {
    scheme.milestones.forEach((m, i) => {
      const part = partOf(i);
      const date = addDays(join, m.days);
      const suggested = suggestFlag(src, date);
      const manual = cleanSignonFlag(src.flags?.[part]);
      const decision: SignonDecision = manual || suggested;
      const prev = p[part];
      let state: MilestoneState;
      if (prev && prev.period !== periodKey) state = 'paid_before';
      else if (m.amount === null) state = 'na';
      else if (date > cutoff) state = 'future';
      else if (decision === 'Hold') state = 'hold';
      else state = 'due';
      const bonus = state === 'paid_before' ? prev!.amount : state === 'due' && decision === 'Passed' ? (m.amount ?? 0) : 0;
      if (manual && manual !== suggested && state !== 'na') warnings.push('flag_manual');
      milestones.push({
        part, days: m.days, date, rate: m.amount, suggested,
        flag: state === 'paid_before' ? (bonus > 0 ? 'Passed' : 'Failed') : m.amount === null ? 'Not Applicable' : decision,
        overridden: Boolean(manual),
        state, bonus, period: state === 'paid_before' ? prev!.period : state === 'due' ? periodKey : '',
      });
    });
  }
  const period_amount = milestones.filter((m) => m.state === 'due').reduce((s, m) => s + m.bonus, 0);
  const total_amount = milestones.reduce((s, m) => s + (m.state === 'due' || m.state === 'paid_before' ? m.bonus : 0), 0);
  return {
    ...src, scheme: scheme?.code ?? '', scheme_auto: auto?.code ?? '', milestones, period_amount, total_amount,
    warnings: [...new Set(warnings)],
  };
}

/** Ảnh chụp lưu trong bonus_lines.detail.src (đủ để xuất lại file của kỳ đã chốt). */
export function signonSnapshot(src: SignonSource): SignonSource {
  return { ...src, flags: { ...src.flags } };
}

/**
 * Tính kỳ `periodKey` với ngày chốt `cutoff` (ISO). `paid` = mốc đã chốt ở các kỳ (kể cả kỳ này nếu đang xem lại).
 * Mốc vào kỳ: có mức tiền, ngày mốc ≤ ngày chốt, chưa chốt ở kỳ khác, cờ Passed/Failed (Hold thì chờ).
 */
export function buildSignonPeriod(sources: SignonSource[], paid: SignonPaidMap, periodKey: string, cutoff: string, schemes: SignonScheme[]): SignonPeriodResult {
  const byCode = new Map(schemes.map((s) => [s.code, s]));
  const rows: SignonRow[] = [];
  const all: SignonRow[] = [];
  const unassigned: SignonRow[] = [];
  const lines: BonusLineInput[] = [];
  const byPart: Record<string, number> = {};
  let total = 0;
  const cut = toIsoDate(cutoff);
  if (!cut) throw new Error(`Ngày chốt không hợp lệ: ${cutoff}`);

  for (const src0 of sources) {
    const flags: Record<string, SignonFlag> = {};
    for (const [k, v] of Object.entries(src0.flags ?? {})) if (cleanSignonFlag(v)) flags[k] = cleanSignonFlag(v);
    const src: SignonSource = { ...src0, scheme_code: norm(src0.scheme_code), flags };
    if (!inSignonScope(src, schemes)) continue;
    const auto = autoScheme(src.dc, src.ob_date, schemes);
    const scheme = src.scheme_code ? (byCode.get(src.scheme_code) ?? null) : auto;
    const row = evaluate(src, scheme, auto, paid, periodKey, cut);
    if (!row.milestones.length) {
      unassigned.push(row);
      continue;
    }
    all.push(row);
    const due = row.milestones.filter((m) => m.state === 'due');
    if (!due.length) continue;
    rows.push(row);
    const snap = signonSnapshot(src);
    for (const m of due) {
      byPart[m.part] = (byPart[m.part] ?? 0) + m.bonus;
      total += m.bonus;
      lines.push({
        record_id: src.record_id, part: m.part, payee_type: 'employee',
        payee_key: norm(src.emp_id) || `code:${src.candidate_code}`, payee_name: norm(src.full_name), emp_id: norm(src.emp_id),
        ta_pic: null, amount: m.bonus, pit: 0, net: m.bonus,
        detail: { src: snap, scheme: row.scheme, date: m.date, days: m.days, rate: m.rate, flag: m.flag, cutoff: cut },
      });
    }
  }
  const people = rows.filter((r) => r.period_amount > 0).length;
  return { rows, all, unassigned, lines, totals: { total, people, lines: lines.length, byPart } };
}

/** Dựng lại danh sách của một kỳ đã chốt từ bonus_lines (detail.src + mốc). */
export function signonRowsFromLines(
  lines: { record_id: number | null; part: string; amount: number; detail: Record<string, unknown> }[],
  periodKey: string,
): SignonRow[] {
  const m = new Map<number, SignonRow>();
  for (const l of lines) {
    if (l.record_id == null) continue;
    const d = l.detail ?? {};
    const src = (d.src ?? null) as SignonSource | null;
    if (!src) continue;
    const row = m.get(l.record_id) ?? {
      ...src, scheme: String(d.scheme ?? ''), scheme_auto: '', milestones: [], period_amount: 0, total_amount: 0, warnings: [],
    } as SignonRow;
    const flag = String(d.flag ?? '') as SignonMilestoneRow['flag'];
    row.milestones.push({
      part: l.part, days: Number(d.days ?? 0), date: String(d.date ?? ''), rate: d.rate == null ? null : Number(d.rate),
      suggested: flag === 'Failed' ? 'Failed' : 'Passed', flag, overridden: false, state: 'due', bonus: l.amount, period: periodKey,
    });
    row.milestones.sort((a, b) => a.part.localeCompare(b.part));
    row.period_amount += l.amount;
    row.total_amount += l.amount;
    m.set(l.record_id, row);
  }
  return [...m.values()];
}

/** Một dòng tổng theo kỳ (sheet "summary" + MoM). */
export interface SignonMomRow { period: string; people: number; milestones: number; passed: number; total: number }

export function signonMom(periods: { period: string; lines: Pick<BonusLineInput, 'record_id' | 'amount'>[] }[]): SignonMomRow[] {
  return periods.map(({ period, lines }) => ({
    period,
    people: new Set(lines.filter((l) => l.amount > 0).map((l) => l.record_id)).size,
    milestones: lines.length,
    passed: lines.filter((l) => l.amount > 0).length,
    total: lines.reduce((s, l) => s + l.amount, 0),
  }));
}

/**
 * Task #8 – Referral bonus (thưởng giới thiệu nội bộ). Thay file "Referral Payment_<Mon>'<YYYY>.xlsx".
 *
 * Quy tắc (đã chốt 27/11/2026):
 *  - Danh sách: hồ sơ sub_source = 'Referrals', OB 'Joined'. Thông tin người giới thiệu do admin nhập ở màn Bonus
 *    (bảng bonus_referrals), không có trong form hồ sơ.
 *  - Eligible nhập tay (Yes / No), hai cờ như Excel: ứng viên (cột L) và người giới thiệu (cột U).
 *  - Ứng viên: Eligible = Yes → 500.000, khác → 0.
 *  - Người giới thiệu: chỉ được khi ứng viên Yes VÀ người giới thiệu Yes; mức theo DC của ứng viên
 *    (DC Hưng Yên 1.500.000, nơi khác 1.000.000). Excel cũ trả 1.000.000 cả khi Eligible = No – đã sửa.
 *  - Mức tiền cấu hình được (bonus_settings 'referral'); ảnh chụp mức lưu theo kỳ khi chốt.
 *  - Mỗi phần (ứng viên / người giới thiệu) của một hồ sơ chỉ chốt một lần. Phần đã chốt ở kỳ khác không vào kỳ này.
 */
import { periodLabel, type BonusLineInput } from './period.ts';

export type YesNo = 'Yes' | 'No' | '';

export interface ReferralRates {
  candidate: number;
  referrerDefault: number;
  /** Mức riêng theo DC của ứng viên (tên site như trong hồ sơ). */
  referrerByDc: Record<string, number>;
}

export const REFERRAL_DEFAULT_RATES: ReferralRates = {
  candidate: 500_000,
  referrerDefault: 1_000_000,
  referrerByDc: { 'DC Hưng Yên': 1_500_000 },
};

/** Một hồ sơ Referral: cột của recruitment_records + bonus_referrals. */
export interface ReferralSource {
  record_id: number;
  candidate_code: string;
  full_name: string;
  emp_id: string;
  rank: string;
  region: string;
  /** DC / site của ứng viên (recruitment_records.site). */
  dc: string;
  ob_date: string | null;
  emp_status: string;
  attrition_date: string | null;
  pic: string | null;
  // ---- bonus_referrals (nhập tay)
  referrer_name: string;
  referrer_emp_id: string;
  referrer_rank: string;
  referrer_dc: string;
  /** 'Active' | 'Resigned' | '' */
  referrer_status: string;
  referrer_last_day: string | null;
  disciplinary: boolean;
  candidate_eligible: YesNo;
  referrer_eligible: YesNo;
  note: string;
}

export type ReferralPart = 'candidate' | 'referrer';
/** pending = chưa xác nhận Eligible; due = vào kỳ đang xem; paid_before = đã chốt ở kỳ khác. */
export type PartState = 'pending' | 'due' | 'paid_before';

export type ReferralWarning = 'cand_resigned' | 'ref_resigned' | 'disciplinary' | 'no_referrer' | 'no_emp_id' | 'self_referral';

export const REFERRAL_WARNING_LABELS: Record<ReferralWarning, string> = {
  cand_resigned: 'Ứng viên đã nghỉ việc',
  ref_resigned: 'Người giới thiệu đã nghỉ việc',
  disciplinary: 'Có vi phạm kỷ luật',
  no_referrer: 'Chưa nhập người giới thiệu',
  no_emp_id: 'Ứng viên chưa có mã nhân viên',
  self_referral: 'Người giới thiệu trùng mã với ứng viên',
};

export interface ReferralRow extends ReferralSource {
  candidate_amount: number;
  referrer_amount: number;
  candidate_state: PartState;
  referrer_state: PartState;
  /** Kỳ đã chốt phần này (khi paid_before) hoặc kỳ đang xem (khi due). */
  candidate_period: string;
  referrer_period: string;
  warnings: ReferralWarning[];
}

export interface ReferralPeriodResult {
  /** Hồ sơ có ít nhất một phần vào kỳ này (= sheet "<Mon> Referral List"). */
  rows: ReferralRow[];
  /** Hồ sơ còn chờ xác nhận Eligible (chưa vào kỳ nào). */
  pending: ReferralRow[];
  /** Khoản gửi khi chốt, kể cả khoản 0 đ (Eligible = No) để hồ sơ không quay lại kỳ sau. */
  lines: BonusLineInput[];
  totals: { candidate: number; referrer: number; total: number; hired: number; eligible: number };
}

const norm = (s: unknown) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const yn = (v: unknown): YesNo => {
  const s = norm(v).toLowerCase();
  return s === 'yes' ? 'Yes' : s === 'no' ? 'No' : '';
};

/** Gộp cấu hình đọc từ DB với mặc định; bỏ giá trị không phải số nguyên ≥ 0. */
export function cleanReferralRates(raw: unknown): ReferralRates {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : d);
  const byDc: Record<string, number> = {};
  const src = o.referrerByDc && typeof o.referrerByDc === 'object' ? (o.referrerByDc as Record<string, unknown>) : REFERRAL_DEFAULT_RATES.referrerByDc;
  for (const [k, v] of Object.entries(src)) {
    const key = norm(k);
    if (key && typeof v === 'number' && Number.isInteger(v) && v >= 0) byDc[key] = v;
  }
  return {
    candidate: num(o.candidate, REFERRAL_DEFAULT_RATES.candidate),
    referrerDefault: num(o.referrerDefault, REFERRAL_DEFAULT_RATES.referrerDefault),
    referrerByDc: byDc,
  };
}

export function referrerRate(dc: string, rates: ReferralRates): number {
  const k = norm(dc);
  return Object.prototype.hasOwnProperty.call(rates.referrerByDc, k) ? rates.referrerByDc[k] : rates.referrerDefault;
}

/** Tiền mỗi phần theo cờ Eligible (không xét đã chốt hay chưa). */
export function referralAmounts(src: Pick<ReferralSource, 'dc' | 'candidate_eligible' | 'referrer_eligible'>, rates: ReferralRates): { candidate: number; referrer: number } {
  const cand = yn(src.candidate_eligible) === 'Yes';
  const ref = cand && yn(src.referrer_eligible) === 'Yes';
  return { candidate: cand ? rates.candidate : 0, referrer: ref ? referrerRate(src.dc, rates) : 0 };
}

export function candidateResigned(src: Pick<ReferralSource, 'emp_status' | 'attrition_date'>): boolean {
  return norm(src.emp_status) === 'Resigned' || Boolean(src.attrition_date);
}

export function referrerResigned(src: Pick<ReferralSource, 'referrer_status' | 'referrer_last_day'>): boolean {
  return norm(src.referrer_status) === 'Resigned' || Boolean(src.referrer_last_day);
}

export function hasReferrer(src: Pick<ReferralSource, 'referrer_name' | 'referrer_emp_id'>): boolean {
  return Boolean(norm(src.referrer_name) || norm(src.referrer_emp_id));
}

/** Cảnh báo để admin xét Eligible (app không tự quyết). */
export function referralWarnings(src: ReferralSource): ReferralWarning[] {
  const w: ReferralWarning[] = [];
  if (candidateResigned(src)) w.push('cand_resigned');
  if (hasReferrer(src) && referrerResigned(src)) w.push('ref_resigned');
  if (src.disciplinary) w.push('disciplinary');
  if (!hasReferrer(src)) w.push('no_referrer');
  if (!norm(src.emp_id)) w.push('no_emp_id');
  if (norm(src.referrer_emp_id) && norm(src.referrer_emp_id) === norm(src.emp_id)) w.push('self_referral');
  return w;
}

/** Gợi ý Eligible (admin bấm áp dụng hoặc tự chọn): có lý do loại → 'No', không thì để trống. */
export function suggestEligible(src: ReferralSource): { candidate: YesNo; referrer: YesNo } {
  const candNo = candidateResigned(src) || src.disciplinary;
  return { candidate: candNo ? 'No' : '', referrer: candNo || (hasReferrer(src) && referrerResigned(src)) ? 'No' : '' };
}

/** Kỳ đã chốt mỗi phần của hồ sơ (đọc từ bonus_lines của các kỳ referral đã chốt). */
export type ReferralPaidMap = Map<number, Partial<Record<ReferralPart, string>>>;

function partState(paidPeriod: string | undefined, periodKey: string, decided: boolean): PartState {
  if (paidPeriod && paidPeriod !== periodKey) return 'paid_before';
  return decided ? 'due' : 'pending';
}

/** Ảnh chụp lưu trong bonus_lines.detail.src (đủ để xuất lại file Excel của kỳ đã chốt). */
export function referralSnapshot(src: ReferralSource): ReferralSource {
  return { ...src };
}

/**
 * Tính kỳ `periodKey`. `paid` = phần đã chốt ở các kỳ (kể cả chính kỳ này nếu đang xem lại kỳ đã chốt).
 * Ứng viên vào kỳ khi đã có cờ Eligible của ứng viên. Phần người giới thiệu vào kỳ khi:
 *  ứng viên No (0 đ), hoặc ứng viên Yes + đã nhập người giới thiệu + có cờ Eligible của người giới thiệu.
 */
export function buildReferralPeriod(sources: ReferralSource[], paid: ReferralPaidMap, periodKey: string, rates: ReferralRates): ReferralPeriodResult {
  const rows: ReferralRow[] = [];
  const pending: ReferralRow[] = [];
  const lines: BonusLineInput[] = [];
  const totals = { candidate: 0, referrer: 0, total: 0, hired: 0, eligible: 0 };

  for (const src0 of sources) {
    const src: ReferralSource = { ...src0, candidate_eligible: yn(src0.candidate_eligible), referrer_eligible: yn(src0.referrer_eligible) };
    const p = paid.get(src.record_id) ?? {};
    const amt = referralAmounts(src, rates);
    const candDecided = src.candidate_eligible !== '';
    const refDecided = src.candidate_eligible === 'No' || (src.candidate_eligible === 'Yes' && hasReferrer(src) && src.referrer_eligible !== '');
    const cs = partState(p.candidate, periodKey, candDecided);
    const rs = partState(p.referrer, periodKey, refDecided);
    const row: ReferralRow = {
      ...src,
      candidate_amount: amt.candidate,
      referrer_amount: amt.referrer,
      candidate_state: cs,
      referrer_state: rs,
      candidate_period: cs === 'paid_before' ? (p.candidate as string) : cs === 'due' ? periodKey : '',
      referrer_period: rs === 'paid_before' ? (p.referrer as string) : rs === 'due' ? periodKey : '',
      warnings: referralWarnings(src),
    };
    if (cs !== 'due' && rs !== 'due') {
      if (cs === 'pending' || rs === 'pending') pending.push(row);
      continue;
    }
    rows.push(row);
    const snap = referralSnapshot(src);
    if (cs === 'due') {
      totals.hired += 1;
      if (src.candidate_eligible === 'Yes') totals.eligible += 1;
      totals.candidate += amt.candidate;
      lines.push({
        record_id: src.record_id, part: 'candidate', payee_type: 'candidate',
        payee_key: norm(src.emp_id) || `code:${src.candidate_code}`, payee_name: norm(src.full_name), emp_id: norm(src.emp_id),
        ta_pic: null, amount: amt.candidate, pit: 0, net: amt.candidate, detail: { src: snap },
      });
    }
    if (rs === 'due') {
      totals.referrer += amt.referrer;
      lines.push({
        record_id: src.record_id, part: 'referrer', payee_type: 'referrer',
        payee_key: norm(src.referrer_emp_id) || (norm(src.referrer_name) ? `name:${norm(src.referrer_name)}` : `code:${src.candidate_code}`),
        payee_name: norm(src.referrer_name), emp_id: norm(src.referrer_emp_id),
        ta_pic: null, amount: amt.referrer, pit: 0, net: amt.referrer, detail: { src: snap },
      });
    }
  }
  totals.total = totals.candidate + totals.referrer;
  return { rows, pending, lines, totals };
}

/** Chữ cột Payment Status: kỳ của phần đó khi có tiền, trống khi 0 đ / chưa vào kỳ. */
export function paymentStatusText(state: PartState, period: string, amount: number): string {
  if (!period || state === 'pending') return '';
  if (state === 'due' && amount === 0) return '';
  return periodLabel(period);
}

/** Dựng lại các dòng danh sách của một kỳ đã chốt từ bonus_lines (detail.src). */
export function referralRowsFromLines(
  lines: { record_id: number | null; part: string; amount: number; detail: Record<string, unknown> }[],
  periodKey: string,
): ReferralRow[] {
  const m = new Map<number, ReferralRow>();
  for (const l of lines) {
    if (l.record_id == null) continue;
    const src = (l.detail?.src ?? null) as ReferralSource | null;
    if (!src) continue;
    const row = m.get(l.record_id) ?? {
      ...src,
      candidate_amount: 0, referrer_amount: 0, candidate_state: 'pending', referrer_state: 'pending',
      candidate_period: '', referrer_period: '', warnings: referralWarnings(src),
    } as ReferralRow;
    if (l.part === 'candidate') {
      row.candidate_amount = l.amount; row.candidate_state = 'due'; row.candidate_period = periodKey;
    } else if (l.part === 'referrer') {
      row.referrer_amount = l.amount; row.referrer_state = 'due'; row.referrer_period = periodKey;
    }
    m.set(l.record_id, row);
  }
  return [...m.values()];
}

/** Một dòng MoM (sheet "Sheet1" của file Excel): theo các kỳ đã chốt. */
export interface ReferralMomRow { period: string; hired: number; eligible: number; pctEligible: number; total: number }

export function referralMom(periods: { period: string; lines: Pick<BonusLineInput, 'part' | 'amount'>[] }[]): ReferralMomRow[] {
  return periods.map(({ period, lines }) => {
    const cand = lines.filter((l) => l.part === 'candidate');
    const hired = cand.length;
    const eligible = cand.filter((l) => l.amount > 0).length;
    return { period, hired, eligible, pctEligible: hired ? eligible / hired : 0, total: lines.reduce((s, l) => s + l.amount, 0) };
  });
}

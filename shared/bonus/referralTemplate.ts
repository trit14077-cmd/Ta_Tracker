/**
 * Task #8 – file Excel Referral theo mẫu "Referral Payment_<Mon>'<YYYY>.xlsx" (gửi mail [APPROVAL NEEDED]):
 *  - "<Mon><YY> Referral List": 24 cột, 2 dòng tiêu đề (nhóm ứng viên / người giới thiệu).
 *  - "Summary": gộp theo Employee ID – trái: ứng viên, phải: người giới thiệu, góc phải: tổng.
 *  - "MoM": theo các kỳ đã chốt (Month, Hired, Eligible for payment, % Eligible, Referral Bonus).
 * Chỉ dựng mảng ô (AOA), phần ghi file nằm ở frontend (xlsxDownload).
 */
import { displayDateVn, periodLabel, periodShort, type BonusLineInput } from './period.ts';
import { candidateResigned, paymentStatusText, referrerResigned, type ReferralMomRow, type ReferralRow } from './referral.ts';

export type Cell = string | number;

export const REFERRAL_LIST_GROUPS: Cell[] = ['No', 'Region', 'DC', 'REFERRED CANDIDATE - INFORMATION', '', '', '', '', '', '', '', '', '', '',
  'REFERRING EMPLOYEE - INFORMATION', '', '', '', '', '', '', '', '', ''];

export const REFERRAL_LIST_HEADERS = [
  'No', 'Region', 'DC',
  'REFERRED CANDIDATE Name', 'Employee ID', 'Rank', 'Join Date', 'Working Status', 'Resignation Record',
  'Disciplinary violation Record', 'Last working date', 'Eligible for payment', 'BONUS (For referred candidate)', 'Payment Status',
  'REFERRING EMPLOYEE Name', 'Employee ID', 'Rank', 'Working Status', 'Resignation Record', 'Last working date',
  'Eligible for payment', 'BONUS (For referring employee)', 'Payment Status', 'Remark',
] as const;

export const REFERRAL_LIST_WIDTHS = [5, 11, 16, 26, 12, 8, 12, 12, 11, 12, 12, 10, 14, 18, 26, 12, 8, 12, 11, 12, 10, 14, 18, 24];

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export function referralListRow(r: ReferralRow, no: number): Cell[] {
  return [
    no, r.region, r.dc,
    r.full_name, r.emp_id, r.rank, displayDateVn(r.ob_date), r.emp_status || 'Active', yesNo(candidateResigned(r)),
    yesNo(r.disciplinary), displayDateVn(r.attrition_date), r.candidate_eligible, r.candidate_amount,
    paymentStatusText(r.candidate_state, r.candidate_period, r.candidate_amount),
    r.referrer_name, r.referrer_emp_id, r.referrer_rank, r.referrer_status || (r.referrer_name ? 'Active' : ''),
    r.referrer_name ? yesNo(referrerResigned(r)) : '', displayDateVn(r.referrer_last_day),
    r.referrer_eligible, r.referrer_amount, paymentStatusText(r.referrer_state, r.referrer_period, r.referrer_amount), r.note,
  ];
}

export function referralListSheet(rows: ReferralRow[]): Cell[][] {
  return [REFERRAL_LIST_GROUPS, [...REFERRAL_LIST_HEADERS], ...rows.map((r, i) => referralListRow(r, i + 1))];
}

/** Tên sheet danh sách như file cũ: "Nov26 Referral List". */
export function referralListSheetName(periodKey: string): string {
  return `${periodShort(periodKey).replace("'", '')} Referral List`;
}

type SummaryLine = Pick<BonusLineInput, 'part' | 'payee_key' | 'payee_name' | 'emp_id' | 'amount' | 'detail'>;

function gather(lines: SummaryLine[], part: 'candidate' | 'referrer') {
  const m = new Map<string, { emp: string; name: string; dc: string; amount: number }>();
  for (const l of lines) {
    if (l.part !== part) continue;
    const src = (l.detail?.src ?? {}) as { dc?: string };
    const g = m.get(l.payee_key) ?? { emp: l.emp_id, name: l.payee_name, dc: src.dc ?? '', amount: 0 };
    g.amount += l.amount;
    m.set(l.payee_key, g);
  }
  return [...m.values()].filter((g) => g.amount > 0);
}

export function referralSummarySheet(lines: SummaryLine[], periodKey: string): Cell[][] {
  const cand = gather(lines, 'candidate');
  const ref = gather(lines, 'referrer');
  const tc = cand.reduce((s, g) => s + g.amount, 0);
  const tr = ref.reduce((s, g) => s + g.amount, 0);
  const label = periodLabel(periodKey);
  const out: Cell[][] = [
    ['', '', '', '', '', '', '', '', '', '', '', '', '', `1. REFERRAL BONUS SUMMARY - ${label}`],
    ['', '2. TOTAL BONUS (For referred candidate)', '', '', '', '', '', '3. TOTAL BONUS (For referring employee)', '', '', '', '', '', 'TOTAL BONUS (For referred candidate)', tc],
    ['', 'No', 'Employee ID', 'REFERRED CANDIDATE Name', 'DC', 'BONUS (For referred candidate)', '', 'No', 'Employee ID', 'REFERRING EMPLOYEE Name', 'DC', 'BONUS (For referring employee)', '', 'TOTAL BONUS (For referring employee)', tr],
    ['', '', '', '', 'Total', tc, '', '', '', '', 'Total', tr, '', `TOTAL REFFERRAL BONUS - ${label}`, tc + tr],
  ];
  const n = Math.max(cand.length, ref.length);
  for (let i = 0; i < n; i++) {
    const a = cand[i];
    const b = ref[i];
    out.push([
      '', a ? i + 1 : '', a?.emp ?? '', a?.name ?? '', a?.dc ?? '', a ? a.amount : '',
      '', b ? i + 1 : '', b?.emp ?? '', b?.name ?? '', b?.dc ?? '', b ? b.amount : '',
    ]);
  }
  return out;
}

export function referralMomSheet(rows: ReferralMomRow[]): Cell[][] {
  return [
    ['Month', 'Hired', 'Eligible for payment', '% Eligible', 'Referral Bonus', 'Remark'],
    ...rows.map((r) => [periodShort(r.period), r.hired, r.eligible, `${Math.round(r.pctEligible * 100)}%`, r.total, '']),
  ];
}

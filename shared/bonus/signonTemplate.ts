/**
 * Task #9 – file Excel Sign-on theo mẫu "Sign-on Bonus Payment _ <Mon>'<YY> Pay Period.xlsx":
 *  - "Sign-on Details": mọi người trong phạm vi, mỗi mốc 4 cột (ngày đạt / Eligible / Bonus / Payment Status),
 *    TOTAL SIGN-ON BONUS, rồi một cột tiền cho mỗi kỳ.
 *  - "<MM><YYYY>" (VD "112026"): người được trả trong kỳ + số tiền kỳ đó.
 *  - "summary": tổng theo các kỳ đã chốt.
 * Chỉ dựng mảng ô (AOA), phần ghi file nằm ở frontend (xlsxDownload).
 */
import { displayDateVn, periodLabel, periodShort } from './period.ts';
import type { SignonMilestoneRow, SignonMomRow, SignonRow } from './signon.ts';

export type Cell = string | number;

const BASE_HEADERS = ['No', 'Employee Name', 'DC', 'Employee ID', 'Join Date', 'Resignation Date', 'Working Status', 'Scheme'];

/** Số ngày của mốc i lấy từ dòng đầu tiên có mốc đó (scheme chuẩn: 6/14/29/59 → "07/15/30/60 days"). */
function milestoneDays(rows: SignonRow[], n: number): number[] {
  return Array.from({ length: n }, (_, i) => rows.find((r) => r.milestones[i])?.milestones[i].days ?? 0);
}

const dd = (n: number) => String(n + 1).padStart(2, '0');

function milestoneCells(m: SignonMilestoneRow | undefined): Cell[] {
  if (!m) return ['', '', '', ''];
  const eligible = m.state === 'future' || m.state === 'hold' ? '' : m.flag;
  const status = m.state === 'na' ? '-' : m.bonus > 0 && m.period ? periodLabel(m.period) : '';
  return [displayDateVn(m.date), eligible, m.bonus, status];
}

/** `periods` = các kỳ cần cột tiền (tăng dần), thường là các kỳ đã chốt + kỳ đang xem. */
export function signonDetailsSheet(rows: SignonRow[], periods: string[]): Cell[][] {
  const n = Math.max(0, ...rows.map((r) => r.milestones.length));
  const days = milestoneDays(rows, n);
  const perTotals = periods.map((p) => rows.reduce((s, r) => s + r.milestones.filter((m) => m.period === p).reduce((a, m) => a + m.bonus, 0), 0));
  const group: Cell[] = [...BASE_HEADERS.map(() => '')];
  const head: Cell[] = [...BASE_HEADERS];
  days.forEach((d, i) => {
    group.push(`Milestone ${i + 1} - ${dd(d)} days`, '', '', '');
    head.push(`Complete ${dd(d)} days`, `Milestone ${i + 1}\nEligible for payment`, `Milestone ${i + 1}\nBonus`, `Milestone ${i + 1}\nPayment Status`);
  });
  group.push(rows.reduce((s, r) => s + r.total_amount, 0), ...perTotals, '');
  head.push('TOTAL SIGN-ON BONUS', ...periods.map(periodLabel), 'Remark');
  const body = rows.map((r, i) => {
    const cells: Cell[] = [i + 1, r.full_name, r.dc, r.emp_id, displayDateVn(r.ob_date), displayDateVn(r.attrition_date), r.emp_status || 'Active', r.scheme];
    for (let k = 0; k < n; k++) cells.push(...milestoneCells(r.milestones[k]));
    cells.push(r.total_amount, ...periods.map((p) => r.milestones.filter((m) => m.period === p).reduce((a, m) => a + m.bonus, 0)), r.note);
    return cells;
  });
  return [group, head, ...body];
}

export function signonDetailsWidths(rows: SignonRow[], periods: string[]): number[] {
  const n = Math.max(0, ...rows.map((r) => r.milestones.length));
  return [5, 26, 16, 12, 12, 12, 12, 26, ...Array.from({ length: n }, () => [12, 12, 11, 18]).flat(), 14, ...periods.map(() => 14), 24];
}

/** Tên sheet của kỳ như file cũ: '2026-11' → "112026". */
export function signonPeriodSheetName(periodKey: string): string {
  return `${periodKey.slice(5, 7)}${periodKey.slice(0, 4)}`;
}

export const SIGNON_PERIOD_WIDTHS = [5, 26, 16, 12, 12, 12, 12, 26, 16, 24];

/** Sheet của kỳ: chỉ người có tiền trong kỳ. */
export function signonPeriodSheet(rows: SignonRow[], periodKey: string): Cell[][] {
  const paid = rows.filter((r) => r.period_amount > 0);
  const total = paid.reduce((s, r) => s + r.period_amount, 0);
  return [
    ['', '', '', '', '', '', '', `${periodLabel(periodKey)} - Total`, total],
    [...BASE_HEADERS, periodLabel(periodKey), 'Remark'],
    ...paid.map((r, i) => [
      i + 1, r.full_name, r.dc, r.emp_id, displayDateVn(r.ob_date), displayDateVn(r.attrition_date), r.emp_status || 'Active', r.scheme,
      r.period_amount, r.note,
    ]),
  ];
}

export function signonSummarySheet(rows: SignonMomRow[]): Cell[][] {
  return [
    ['Month', 'Sign-on Bonus', 'Employees paid', 'Milestones passed'],
    ...rows.map((r) => [periodShort(r.period), r.total, r.people, r.passed]),
    ['Total', rows.reduce((s, r) => s + r.total, 0), '', ''],
  ];
}

/**
 * Task #10 – sheet "Summary <Mon>'<YY>" (tổng chi trả theo người nhận) + "MoM" theo mẫu TA_Credit_Bonus_<Mon><YY>.xlsx.
 * Chỉ dựng mảng ô (AOA), phần ghi file nằm ở frontend (xlsxDownload).
 */
import { periodShort } from './period.ts';
import type { SummaryMomRow, SummaryRow } from './summary.ts';

export type Cell = string | number;

export function summarySheetName(periodKey: string): string {
  return `Summary ${periodShort(periodKey)}`;
}

export function summaryHeaders(periodKey: string): string[] {
  return ['No', 'TA Name', 'Region', 'Title/Scope', 'Employee ID', '(2) Bonus\n(TA Credit Scheme)', '(3) Onsite Allowance\n(Total Onsite days x 100k per day)',
    '(4) Recruitment Bonus\n(For Freelancer only)', `(1) Total Payout - ${periodShort(periodKey)}\n(2) + (3) + (4)`];
}
export const SUMMARY_WIDTHS = [5, 26, 9, 44, 12, 16, 20, 18, 20];

export function summarySheet(rows: SummaryRow[], totals: Pick<SummaryRow, 'credit' | 'onsite' | 'freelancer' | 'total'>, periodKey: string): Cell[][] {
  const z = (n: number) => (n ? n : '');
  return [
    summaryHeaders(periodKey),
    ...rows.map((r, i) => [i + 1, r.name, r.region, r.title, r.emp_id, r.type === 'ta' ? r.credit : '', z(r.onsite), z(r.freelancer), r.total]),
    ['', 'Total', '', '', '', totals.credit, totals.onsite, totals.freelancer, totals.total],
  ];
}

export const MOM_HEADERS = ['Pay Period', 'TA Credit', 'Onsite', 'Freelancer (gross)', 'Total'];
export const MOM_WIDTHS = [14, 14, 14, 16, 14];

export function summaryMomSheet(rows: SummaryMomRow[]): Cell[][] {
  return [MOM_HEADERS, ...rows.map((r) => [`${periodShort(r.period)} Pay Period`, r.credit, r.onsite, r.freelancer, r.total])];
}

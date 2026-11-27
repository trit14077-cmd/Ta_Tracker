/**
 * Task #10 (3) – sheet "Onsite Allowance" theo mẫu file TA_Credit_Bonus_<Mon><YY>.xlsx:
 * hàng = ngày có ít nhất một TA onsite (Onsite Date, Week day), cột = TA, ô = 1; cuối bảng: Total days / Rate / Amount.
 * Chỉ dựng mảng ô (AOA), phần ghi file nằm ở frontend (xlsxDownload).
 */
import { displayDateVn, periodShort } from './period.ts';
import { weekdayShort, type OnsiteRow } from './onsite.ts';

export type Cell = string | number;

export const ONSITE_SHEET_NAME = 'Onsite Allowance';

export function onsiteSheetWidths(n: number): number[] {
  return [12, 10, ...Array.from({ length: n }, () => 22), 14];
}

/** Chỉ các TA có ngày (đúng các khoản được trả). rate = đơn giá của kỳ. */
export function onsiteSheet(rows: OnsiteRow[], periodKey: string, rate: number): Cell[][] {
  const tas = rows.filter((r) => r.count > 0 && !r.problem);
  const dates = [...new Set(tas.flatMap((r) => r.days))].sort();
  const sets = tas.map((r) => new Set(r.days));
  const total = tas.reduce((s, r) => s + r.amount, 0);
  return [
    [`TA ONSITE ALLOWANCE - ${periodShort(periodKey)} Pay Period`, '', ...tas.map(() => ''), 'Total'],
    ['Onsite Date', 'Week day', ...tas.map((r) => `${r.profile?.name || r.pic}\n(${r.pic})`), ''],
    ...dates.map((d) => [displayDateVn(d), weekdayShort(d), ...sets.map((s) => (s.has(d) ? 1 : '')), '']),
    ['Total days', '', ...tas.map((r) => r.count), tas.reduce((s, r) => s + r.count, 0)],
    ['Rate', '', ...tas.map(() => rate), ''],
    ['Amount', '', ...tas.map((r) => r.amount), total],
  ];
}

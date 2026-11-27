/**
 * Task #10 (2) – file Excel TA Credit theo mẫu "TA_Credit_Bonus_<Mon><YY>.xlsx":
 *  - "<Mon>'<YY> Bonus": mỗi TA một dòng (Region, Title/Scope, Employee ID, Onboarding, Eligible, Credits, Tier, Bonus).
 *  - "ob_list_<Mon>'<YY>": các OB của tháng tính (credit từng OB, số ngày làm, lý do bị loại).
 * Chỉ dựng mảng ô (AOA), phần ghi file nằm ở frontend (xlsxDownload).
 */
import { displayDateVn, periodShort } from './period.ts';
import { OB_SKIP_LABELS, type TaCreditOb, type TaCreditRow } from './taCredit.ts';

export type Cell = string | number;

export const TA_BONUS_HEADERS = ['No', 'TA Name', 'PIC', 'Region', 'Title/Scope', 'Level', 'Employee ID', 'Onboarding', 'Eligible for Bonus',
  'Credits Achieved', 'Tier', 'Bonus'];
export const TA_BONUS_WIDTHS = [5, 24, 14, 9, 40, 9, 12, 11, 11, 11, 15, 13];

/** "Nov'26 Bonus" */
export function taBonusSheetName(periodKey: string): string {
  return `${periodShort(periodKey)} Bonus`;
}

export function taBonusSheet(rows: TaCreditRow[], periodKey: string): Cell[][] {
  const paid = rows.filter((r) => !r.problem);
  const total = paid.reduce((s, r) => s + r.amount, 0);
  return [
    ['', `TA CREDIT BONUS - ${periodShort(periodKey)} Pay Period`, '', '', '', '', '', '', '', '', 'Total', total],
    TA_BONUS_HEADERS,
    ...paid.map((r, i) => [
      i + 1, r.profile?.name ?? '', r.pic, r.profile?.region ?? '', r.profile?.title ?? '', r.profile?.level ?? '', r.profile?.emp_id ?? '',
      r.onboarded, r.eligible, r.credits, r.tier, r.amount,
    ]),
  ];
}

export const OB_LIST_HEADERS = ['No.', 'PIC', 'Candidate code', 'Name', 'Rank', 'credit points', 'Region', 'Unit', 'Site', 'OBD', 'OB Status',
  'Emp_ID', 'Emp_STT', 'Attrition_Date', 'Working_Days', 'Remark'];
export const OB_LIST_WIDTHS = [5, 14, 12, 24, 8, 10, 11, 18, 18, 11, 10, 11, 10, 12, 11, 28];

/** "ob_list_Oct'26" – tháng tính của kỳ. */
export function obListSheetName(perfMonth: string): string {
  return `ob_list_${periodShort(perfMonth)}`;
}

export function obListSheet(obs: TaCreditOb[]): Cell[][] {
  return [
    OB_LIST_HEADERS,
    ...obs.map((o, i) => [
      i + 1, o.pic ?? '', o.candidate_code, o.full_name, o.rank, o.credits, o.region, o.unit, o.site, displayDateVn(o.ob_date), o.ob_status,
      o.emp_id, o.emp_status || 'Active', displayDateVn(o.attrition_date), o.days, o.skip ? OB_SKIP_LABELS[o.skip] : '',
    ]),
  ];
}

/**
 * Task #10 (4) – file Excel Freelancer theo sheet "Freelancer Bonus" của TA_Credit_Bonus_<Mon><YY>.xlsx:
 *  - "Freelancer Bonus": mỗi ứng viên một dòng (CTV, ứng viên, Emp ID, trạng thái, DC, vị trí, OBD, Bonus, PIT, Net, Pay Period).
 *  - "Freelancer Summary": mỗi CTV một dòng (số ứng viên, mức / ứng viên, Bonus, PIT, Net) – thay bảng pivot.
 * Chỉ dựng mảng ô (AOA), phần ghi file nằm ở frontend (xlsxDownload).
 */
import { displayDateVn, periodShort } from './period.ts';
import { groupLineViews, type FreelancerLineView } from './freelancer.ts';

export type Cell = string | number;

export const FREELANCER_SHEET_NAME = 'Freelancer Bonus';
export const FREELANCER_SUMMARY_SHEET_NAME = 'Freelancer Summary';

export const FREELANCER_HEADERS = ['No', 'Freelancer Name', 'Referred Candidate Name', 'Employee ID\n(Referred Candidate)', 'Working Status', 'DC',
  'Position', 'OBD', 'Bonus Amount', 'PIT deduction', 'Net Amount', 'Pay Period'];
export const FREELANCER_WIDTHS = [5, 22, 24, 14, 10, 18, 20, 11, 12, 12, 12, 11];

export const FREELANCER_SUMMARY_HEADERS = ['No', 'Freelancer Name', 'Region', 'Eligible candidates', 'Bonus / candidate', 'Bonus Amount', 'PIT deduction', 'Net Amount'];
export const FREELANCER_SUMMARY_WIDTHS = [5, 24, 9, 12, 13, 13, 13, 13];

function sorted(views: FreelancerLineView[]): FreelancerLineView[] {
  const order = new Map(groupLineViews(views).map((g, i) => [g.freelancer_id, i]));
  return [...views].sort((a, b) => (order.get(a.freelancer_id)! - order.get(b.freelancer_id)!) || String(a.ob_date).localeCompare(String(b.ob_date)));
}

export function freelancerSheet(views: FreelancerLineView[], periodKey: string): Cell[][] {
  const tot = views.reduce((s, v) => ({ a: s.a + v.amount, p: s.p + v.pit, n: s.n + v.net }), { a: 0, p: 0, n: 0 });
  return [
    [`FREELANCER RECRUITMENT BONUS - ${periodShort(periodKey)} Pay Period`, '', '', '', '', '', '', 'Total', tot.a, tot.p, tot.n, ''],
    FREELANCER_HEADERS,
    ...sorted(views).map((v, i) => [
      i + 1, v.freelancer_name, v.full_name, v.cand_emp_id, v.emp_status || 'Active', v.site, v.position, displayDateVn(v.ob_date),
      v.amount, v.pit, v.net, periodShort(periodKey),
    ]),
  ];
}

export function freelancerSummarySheet(views: FreelancerLineView[]): Cell[][] {
  const gs = groupLineViews(views);
  return [
    FREELANCER_SUMMARY_HEADERS,
    ...gs.map((g, i) => [i + 1, g.name, g.region, g.count, g.rate, g.amount, g.pit, g.net]),
    ['', 'Grand Total', '', gs.reduce((s, g) => s + g.count, 0), '', gs.reduce((s, g) => s + g.amount, 0), gs.reduce((s, g) => s + g.pit, 0), gs.reduce((s, g) => s + g.net, 0)],
  ];
}

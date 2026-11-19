// M5-3: ghép kết quả RPC báo cáo (0011) thành đúng kiểu dữ liệu mà giao diện cũ dùng (shared/dashboardCalc.ts).
// File thuần (không gọi mạng) để test được: tests/frontend/reportAdapters.test.ts so với donuts() của hệ cũ.
import type { DonutData, Totals } from '../../../shared/dashboardCalc.ts';

/** Kết quả public.report_reasons */
export interface ReportReasons {
  r1_fail: [string, number][];
  lu_no: number;
  no_show: [string, number][];
  r2_fail: [string, number][];
  ob_no: [string, number][];
}

/** = donuts(rows, from, to, t) của dashboardCalc, nhưng lý do lấy từ server. Chữ giữ nguyên văn hệ cũ. */
export function donutsFromReasons(t: Totals, rs: ReportReasons): DonutData[] {
  return [
    { key: 'r1', title: 'R1 Passed', sub: 'Screening Passed', pass: t.r1, total: t.r1Total, nonLabel: 'Screening Failed',
      reasonsTitle: 'Lý do rớt sàng lọc', note: 'R1 không đạt', reasons: rs.r1_fail },
    { key: 'lu', title: 'LU', sub: 'Line Up', pass: t.lu, total: Math.max(t.r1, t.lu), nonLabel: 'Not Scheduled',
      reasonsTitle: 'Chưa có lịch phỏng vấn R2', note: 'Đậu R1 nhưng chưa có lịch R2',
      reasons: [...(rs.lu_no ? [['Đậu R1, chưa có lịch R2', rs.lu_no] as [string, number]] : []), ...rs.r1_fail] },
    { key: 'su', title: 'SU', sub: 'Show Up', pass: t.su, total: Math.max(t.lu, t.su), nonLabel: 'No-show',
      reasonsTitle: 'Có lịch R2 nhưng không đến', note: 'Có lịch R2, chưa đến hoặc hủy', reasons: rs.no_show },
    { key: 'r2', title: 'R2 Passed', sub: 'Pass Interview', pass: t.r2, total: Math.max(t.su, t.r2), nonLabel: 'Interview Failed',
      reasonsTitle: 'Lý do rớt phỏng vấn', note: 'Đã đến phỏng vấn nhưng không đạt', reasons: rs.r2_fail },
    { key: 'ob', title: 'OB', sub: 'Joined', pass: t.ob, total: Math.max(t.r2, t.ob), nonLabel: 'Offer Declined',
      reasonsTitle: 'Noshow / Canceled', note: 'Đã đạt R2 nhưng không nhận việc', reasons: rs.ob_no },
  ];
}

/** Bộ lọc báo cáo (khóa = tên cột DB). Bỏ giá trị rỗng. */
export type ReportFilters = Partial<Record<'pic' | 'site' | 'source' | 'sub_source' | 'region' | 'dept' | 'position', string>>;
export function cleanFilters(f: ReportFilters): ReportFilters {
  const out: ReportFilters = {};
  for (const [k, v] of Object.entries(f)) if (v) out[k as keyof ReportFilters] = v;
  return out;
}

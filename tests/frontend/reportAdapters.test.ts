// M5-3: donutsFromReasons (ghép kết quả report_reasons + Totals) phải ra đúng donuts() của hệ cũ.
// Lý do lấy từ golden (donuts() tính trên 410 hồ sơ) rồi ghép ngược lại: tiêu đề, nhãn, pass/total, danh sách lý do.
import { describe, expect, it } from 'vitest';
import { donuts, totals } from '../../shared/dashboardCalc.ts';
import { computeOutputs, makeRecords, RANGES, TODAY, toReportRow } from '../golden/golden.ts';
import { cleanFilters, donutsFromReasons, type ReportReasons } from '../../frontend/src/services/reportAdapters.ts';

const LU_NO = 'Đậu R1, chưa có lịch R2';
const recs = makeRecords();
const rows = recs.map(toReportRow);
const out = computeOutputs(recs);

describe('donutsFromReasons = donuts()', () => {
  for (const [k, [f, t]] of Object.entries(RANGES)) {
    it(`khoảng ${k}`, () => {
      const tt = totals(rows, f, t, TODAY);
      const d = out.reasons[k];
      const lu = d[1].reasons;
      const rs: ReportReasons = {
        r1_fail: d[0].reasons,
        lu_no: lu.length && lu[0][0] === LU_NO ? lu[0][1] : 0,
        no_show: d[2].reasons,
        r2_fail: d[3].reasons,
        ob_no: d[4].reasons,
      };
      expect(donutsFromReasons(tt, rs)).toEqual(donuts(rows, f, t, tt));
    });
  }
});

describe('cleanFilters', () => {
  it('bỏ giá trị rỗng', () => {
    expect(cleanFilters({ pic: 'A', site: '', source: undefined, sub_source: 'x' })).toEqual({ pic: 'A', sub_source: 'x' });
  });
});

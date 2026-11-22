// M8-3: phần thuần của bộ đối chiếu (scripts/migrate/reconcileLib.ts).
import { describe, expect, it } from 'vitest';
import {
  boardCounts, columnHash, compareCounts, compareRows, distribution, flattenBoard, flattenGroups, kpiGroups, kpiTotals, norm, toReportRows,
  visibility, vnDate,
} from '../../scripts/migrate/reconcileLib.ts';
import { boardPosition, boardSub } from '../../shared/pipelineRules.ts';
import { totals } from '../../shared/dashboardCalc.ts';

const base = { pic: 'TA1', site: 'DC A', position: 'Nhân viên Kho', source: 'Internal', sub_source: 'Referrals' };
const src = [
  { ...base, candidate_code: 'UV1', r1_date: '2026-11-01', r1_status: 'Passed', r2_date: '2026-11-05', r2_status: 'Passed', ob_date: '2026-11-10', ob_status: 'Joined', emp_status: 'Active' },
  { ...base, candidate_code: 'UV2', r1_date: '2026-11-02', r1_status: 'Failed', r1_sub_status: 'Độ tuổi' },
  { ...base, candidate_code: 'UV3', pic: 'TA2', created_at: '2026-11-03T02:00:00Z' },
];

describe('norm', () => {
  it('null/undefined = rỗng; ngày có giờ cắt còn ngày; vị trí theo danh mục 18.11', () => {
    expect(norm('pic', null)).toBe('');
    expect(norm('pic', ' TA1 ')).toBe('TA1');
    expect(norm('r1_date', '2026-11-01T00:00:00+00:00')).toBe('2026-11-01');
    expect(norm('position', 'Trưởng Kho')).toBe('Trưởng kho');
  });
});

describe('compareRows', () => {
  it('giống nhau (kể cả null ⇔ rỗng, vị trí tên cũ ⇔ mới) => ok', () => {
    const dst = src.map((r) => ({ ...r, r2_sub_status: null }));
    const r = compareRows(src, dst);
    expect(r.ok).toBe(true);
  });
  it('báo thiếu, thừa, trùng mã và ô lệch kèm mẫu', () => {
    const dst = [
      { ...src[0], ob_status: 'Noshow' },
      { ...src[2] },
      { ...base, candidate_code: 'UV9' },
      { ...base, candidate_code: 'UV9' },
    ];
    const r = compareRows(src, dst);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['UV2']);
    expect(r.extra).toEqual(['UV9']);
    expect(r.duplicateCodes).toEqual(['UV9']);
    expect(r.columns.ob_status).toEqual({ mismatches: 1, samples: [{ candidate_code: 'UV1', source: 'Joined', target: 'Noshow' }] });
    expect(r.columns.pic.mismatches).toBe(0);
  });
});

describe('columnHash / distribution / compareCounts', () => {
  it('hash không phụ thuộc thứ tự dòng, đổi khi 1 ô đổi', () => {
    expect(columnHash(src, 'pic')).toBe(columnHash([...src].reverse(), 'pic'));
    expect(columnHash(src, 'pic')).not.toBe(columnHash([{ ...src[0], pic: 'TA9' }, src[1], src[2]], 'pic'));
  });
  it('đếm theo giá trị (rỗng = "(trống)"), diff = đích − nguồn', () => {
    expect(distribution(src, 'r1_status')).toEqual({ Passed: 1, Failed: 1, '(trống)': 1 });
    expect(compareCounts({ a: 2, b: 1 }, { a: 2, c: 1 })).toEqual({ ok: false, diffs: { b: -1, c: 1 } });
    expect(compareCounts({ a: 2 }, { a: 2 }).ok).toBe(true);
  });
});

describe('KPI và Kanban dùng hàm chung', () => {
  it('vnDate: giờ UTC sang ngày VN', () => {
    expect(vnDate('2026-11-03T18:00:00Z')).toBe('2026-11-04');
    expect(vnDate('')).toBe('');
  });
  it('dòng báo cáo: lead = R1 date, không có thì ngày tạo (giờ VN); bỏ lưu trữ', () => {
    const rr = toReportRows([...src, { ...base, candidate_code: 'UV4', is_archived: true, r1_date: '2026-11-01' }]);
    expect(rr.map((r) => r.lead)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });
  it('kpiTotals = dashboardCalc.totals trên dòng báo cáo', () => {
    const t = kpiTotals(src, '2026-11-20');
    expect(t).toEqual(totals(toReportRows(src), '2000-01-01', '2026-11-20', '2026-11-20'));
    expect([t.leads, t.r1Total, t.r1, t.ob]).toEqual([3, 2, 1, 1]);
  });
  it('boardCounts = boardPosition/boardSub từng hồ sơ; bỏ lưu trữ', () => {
    const b = boardCounts([...src, { ...base, candidate_code: 'UV5', is_archived: true }]);
    const s = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')]));
    for (const r of src) {
      const p = boardPosition(s(r));
      expect(b.counts[p.col].total).toBeGreaterThan(0);
      const sub = boardSub(s(r));
      if (sub) expect(b.subs[sub]).toBeGreaterThan(0);
    }
    const flat = flattenBoard(b);
    expect(Object.entries(flat).filter(([k]) => k.endsWith('.total')).reduce((n, [, v]) => n + v, 0)).toBe(3);
    expect(flat['counts.r1.failed']).toBe(1);
  });
});

describe('visibility (RLS theo pic)', () => {
  it('pic lạ => lỗi; pic chưa có tài khoản => cảnh báo; pic rỗng => đếm', () => {
    const v = visibility([...src, { candidate_code: 'X', pic: 'LA' }, { candidate_code: 'Y', pic: null }], ['TA1', 'TA2'], ['TA1']);
    expect(v.ok).toBe(false);
    expect(v.unknownPics).toEqual({ LA: 1 });
    expect(v.picsWithoutUser).toEqual({ TA2: 1 });
    expect(v.noPic).toBe(1);
    expect(visibility(src, ['TA1', 'TA2'], ['TA1', 'TA2']).ok).toBe(true);
  });
});

describe('KPI theo nhóm (so với report_totals p_group_by)', () => {
  it('kpiGroups = groupTotals làm phẳng; không phụ thuộc thứ tự nhóm', () => {
    const g = kpiGroups(src, 'pic', '2000-01-01', '2026-11-20', '2026-11-20');
    expect(g['TA1.leads']).toBe(2);
    expect(g['TA2.leads']).toBe(1);
    const server: [string, Record<string, number>][] = [['TA2', { leads: 1 }], ['TA1', { leads: 2 }]];
    const flat = flattenGroups(server);
    expect(flat).toEqual({ 'TA2.leads': 1, 'TA1.leads': 2 });
    expect(compareCounts({ 'TA1.leads': 2, 'TA2.leads': 1 }, flat).ok).toBe(true);
  });
});

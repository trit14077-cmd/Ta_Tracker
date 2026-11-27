// Task #9 – Sign-on bonus. Dữ liệu giả, không có người thật.
import { describe, expect, it } from 'vitest';
import {
  SIGNON_DEFAULT_SCHEMES,
  autoScheme,
  buildSignonPeriod,
  cleanSignonFlag,
  cleanSignonScheme,
  inSignonScope,
  isSignonRank,
  signonMom,
  signonRowsFromLines,
  suggestFlag,
  type SignonPaidMap,
  type SignonSource,
} from '../../shared/bonus/signon.ts';
import {
  signonDetailsSheet,
  signonPeriodSheet,
  signonPeriodSheetName,
  signonSummarySheet,
} from '../../shared/bonus/signonTemplate.ts';

const S = SIGNON_DEFAULT_SCHEMES;

function src(id: number, over: Partial<SignonSource> = {}): SignonSource {
  return {
    record_id: id, candidate_code: `TA${10000 + id}`, full_name: `Nhân viên ${id}`, emp_id: String(9000000 + id), rank: '6A',
    dc: 'DC Hưng Yên', ob_date: '2026-10-01', emp_status: 'Active', attrition_date: null, pic: 'TA1-A',
    scheme_code: '', flags: {}, note: '', ...over,
  };
}

describe('scheme + phạm vi', () => {
  it('Rank 6 theo chữ số đầu tiên', () => {
    expect(isSignonRank('6A')).toBe(true);
    expect(isSignonRank('Rank 6')).toBe(true);
    expect(isSignonRank('5B')).toBe(false);
    expect(isSignonRank('')).toBe(false);
  });

  it('tự gán scheme mới nhất theo site + ngày vào', () => {
    expect(autoScheme('DC Hải Phòng', '2026-05-20', S)?.code).toBe('DCHP 11.05.2026');
    expect(autoScheme('DC Hải Phòng', '2026-06-01', S)?.code).toBe('DCHP + DCHY 01.06.2026');
    expect(autoScheme('DC Hưng Yên', '2026-05-20', S)).toBeNull();
    expect(autoScheme('TTPP Hải Phòng', '2026-08-12', S)).toBeNull();
    expect(autoScheme('TTPP Hải Phòng', '2026-08-13', S)?.code).toBe('TTPP HY + TTPPHP_13.08.2026');
    expect(autoScheme('DC Hà Nội', '2026-10-01', S)).toBeNull();
    expect(autoScheme('DC Hưng Yên', null, S)).toBeNull();
  });

  it('bỏ qua scheme ngừng dùng / hết hiệu lực', () => {
    const off = S.map((s) => (s.code === 'DCHP + DCHY 01.06.2026' ? { ...s, active: false } : s));
    expect(autoScheme('DC Hải Phòng', '2026-07-01', off)?.code).toBe('DCHP 11.05.2026');
    const ended = S.map((s) => (s.code === 'DCHP 11.05.2026' ? { ...s, effective_to: '2026-05-15' } : s));
    expect(autoScheme('DC Hải Phòng', '2026-05-20', ended)).toBeNull();
  });

  it('phạm vi: Rank 6 tại site có scheme, hoặc scheme chọn tay', () => {
    expect(inSignonScope(src(1), S)).toBe(true);
    expect(inSignonScope(src(1, { rank: '5A' }), S)).toBe(false);
    expect(inSignonScope(src(1, { dc: 'DC Hà Nội' }), S)).toBe(false);
    expect(inSignonScope(src(1, { rank: '5A', scheme_code: 'DCHP 11.05.2026' }), S)).toBe(true);
  });

  it('cleanSignonScheme kiểm dữ liệu form', () => {
    const ok = cleanSignonScheme({ code: ' X ', sites: ['A', 'A', ''], effective_from: '2026-01-01', milestones: [{ days: 6, amount: null }, { days: 29, amount: 1000 }] });
    expect(ok.error).toBe('');
    expect(ok.scheme).toMatchObject({ code: 'X', sites: ['A'], effective_to: null, active: true });
    expect(ok.scheme?.milestones).toEqual([{ days: 6, amount: null }, { days: 29, amount: 1000 }]);
    expect(cleanSignonScheme({ code: '', sites: ['A'], effective_from: '2026-01-01', milestones: [{ days: 1, amount: 1 }] }).error).not.toBe('');
    expect(cleanSignonScheme({ code: 'X', sites: [], effective_from: '2026-01-01', milestones: [{ days: 1, amount: 1 }] }).error).not.toBe('');
    expect(cleanSignonScheme({ code: 'X', sites: ['A'], effective_from: 'bad', milestones: [{ days: 1, amount: 1 }] }).error).not.toBe('');
    expect(cleanSignonScheme({ code: 'X', sites: ['A'], effective_from: '2026-02-01', effective_to: '2026-01-01', milestones: [{ days: 1, amount: 1 }] }).error).not.toBe('');
    expect(cleanSignonScheme({ code: 'X', sites: ['A'], effective_from: '2026-01-01', milestones: [] }).error).not.toBe('');
    expect(cleanSignonScheme({ code: 'X', sites: ['A'], effective_from: '2026-01-01', milestones: [{ days: 1.5, amount: 1 }] }).error).not.toBe('');
    expect(cleanSignonScheme({ code: 'X', sites: ['A'], effective_from: '2026-01-01', milestones: [{ days: 1, amount: -1 }] }).error).not.toBe('');
  });
});

describe('gợi ý cờ', () => {
  it('nghỉ trước ngày mốc → Failed; nghỉ đúng ngày mốc → Passed', () => {
    expect(suggestFlag({ emp_status: 'Resigned', attrition_date: '2026-10-06' }, '2026-10-07')).toBe('Failed');
    expect(suggestFlag({ emp_status: 'Resigned', attrition_date: '2026-10-07' }, '2026-10-07')).toBe('Passed');
    expect(suggestFlag({ emp_status: 'Active', attrition_date: null }, '2026-10-07')).toBe('Passed');
  });
  it('đã nghỉ mà thiếu ngày nghỉ → Hold', () => {
    expect(suggestFlag({ emp_status: 'Resigned', attrition_date: null }, '2026-10-07')).toBe('Hold');
  });
  it('cleanSignonFlag', () => {
    expect(cleanSignonFlag(' Passed ')).toBe('Passed');
    expect(cleanSignonFlag('Hold')).toBe('Hold');
    expect(cleanSignonFlag('Yes')).toBe('');
  });
});

describe('buildSignonPeriod', () => {
  const P = '2026-11';
  const CUT = '2026-11-25';

  it('mốc đạt ≤ ngày chốt vào kỳ; mốc sau ngày chốt chờ kỳ sau', () => {
    // vào 01/10: m1 07/10, m2 15/10, m3 30/10, m4 29/11 (> chốt)
    const res = buildSignonPeriod([src(1)], new Map(), P, CUT, S);
    expect(res.lines.map((l) => l.part)).toEqual(['m1', 'm2', 'm3']);
    expect(res.totals.total).toBe(2_000_000);
    expect(res.totals.people).toBe(1);
    expect(res.rows[0].milestones.map((m) => m.state)).toEqual(['due', 'due', 'due', 'future']);
    expect(res.rows[0].milestones.map((m) => m.date)).toEqual(['2026-10-07', '2026-10-15', '2026-10-30', '2026-11-29']);
    expect(res.lines[0]).toMatchObject({ record_id: 1, payee_type: 'employee', payee_key: '9000001', ta_pic: null, amount: 500_000, pit: 0, net: 500_000 });
    expect(res.lines[0].detail).toMatchObject({ scheme: 'DCHP + DCHY 01.06.2026', date: '2026-10-07', flag: 'Passed', cutoff: CUT });
  });

  it('mốc đã chốt ở kỳ trước không vào lại; mốc trễ vẫn vào kỳ này', () => {
    const paid: SignonPaidMap = new Map([[1, { m1: { period: '2026-10', amount: 500_000 } }]]);
    const res = buildSignonPeriod([src(1)], paid, P, CUT, S);
    expect(res.lines.map((l) => l.part)).toEqual(['m2', 'm3']);
    expect(res.rows[0].milestones[0]).toMatchObject({ state: 'paid_before', period: '2026-10', bonus: 500_000, flag: 'Passed' });
    expect(res.rows[0].period_amount).toBe(1_500_000);
    expect(res.rows[0].total_amount).toBe(2_000_000);
  });

  it('đang xem lại kỳ đã chốt: mốc chốt ở chính kỳ này vẫn là due', () => {
    const paid: SignonPaidMap = new Map([[1, { m1: { period: P, amount: 500_000 } }]]);
    const res = buildSignonPeriod([src(1)], paid, P, CUT, S);
    expect(res.lines.map((l) => l.part)).toEqual(['m1', 'm2', 'm3']);
  });

  it('nghỉ trước mốc → Failed, tạo khoản 0 đ để không quay lại', () => {
    const res = buildSignonPeriod([src(1, { emp_status: 'Resigned', attrition_date: '2026-10-10' })], new Map(), P, CUT, S);
    expect(res.lines.map((l) => [l.part, l.amount])).toEqual([['m1', 500_000], ['m2', 0], ['m3', 0]]);
    expect(res.rows[0].milestones[3].state).toBe('future');
    expect(res.totals.total).toBe(500_000);
  });

  it('cờ sửa tay thắng gợi ý; Hold để kỳ sau', () => {
    const res = buildSignonPeriod([src(1, { flags: { m1: 'Failed', m2: 'Hold' } })], new Map(), P, CUT, S);
    expect(res.lines.map((l) => [l.part, l.amount])).toEqual([['m1', 0], ['m3', 1_000_000]]);
    expect(res.rows[0].milestones[1].state).toBe('hold');
    expect(res.rows[0].warnings).toContain('flag_manual');
  });

  it('người không có mốc nào vào kỳ: không nằm trong rows nhưng có trong all', () => {
    const res = buildSignonPeriod([src(1, { ob_date: '2026-11-22' })], new Map(), P, CUT, S);
    expect(res.rows).toHaveLength(0);
    expect(res.all).toHaveLength(1);
    expect(res.lines).toHaveLength(0);
  });

  it('scheme DCHP 11.05.2026: mốc 1, 2 Not Applicable, không tạo khoản', () => {
    const res = buildSignonPeriod([src(1, { dc: 'DC Hải Phòng', ob_date: '2026-05-15' })], new Map(), '2026-07', '2026-07-25', S);
    expect(res.rows[0].milestones.map((m) => m.flag)).toEqual(['Not Applicable', 'Not Applicable', 'Passed', 'Passed']);
    expect(res.lines.map((l) => l.part)).toEqual(['m3', 'm4']);
    expect(res.totals.total).toBe(2_000_000);
  });

  it('scheme chọn tay (khác tự gán) + cảnh báo; scheme không tồn tại → chưa gán', () => {
    const res = buildSignonPeriod([
      src(1, { dc: 'DC Hải Phòng', ob_date: '2026-05-05', scheme_code: 'DCHP 11.05.2026' }),
      src(2, { scheme_code: 'KHÔNG CÓ' }),
      src(3, { ob_date: '2026-05-01' }),
    ], new Map(), '2026-07', '2026-07-25', S);
    expect(res.all.map((r) => r.record_id)).toEqual([1]);
    expect(res.all[0].warnings).toContain('scheme_manual');
    expect(res.unassigned.map((r) => r.record_id)).toEqual([2, 3]);
    expect(res.unassigned[0].warnings).toContain('no_scheme');
  });

  it('ngoài phạm vi (rank khác / site khác) bị bỏ qua', () => {
    const res = buildSignonPeriod([src(1, { rank: '4C' }), src(2, { dc: 'DC Hà Nội' })], new Map(), P, CUT, S);
    expect(res.all).toHaveLength(0);
    expect(res.unassigned).toHaveLength(0);
  });

  it('không có Emp_ID → payee_key theo mã ứng viên; ngày chốt sai → lỗi', () => {
    const res = buildSignonPeriod([src(1, { emp_id: '' })], new Map(), P, CUT, S);
    expect(res.lines[0].payee_key).toBe('code:TA10001');
    expect(() => buildSignonPeriod([], new Map(), P, 'x', S)).toThrow();
  });
});

describe('dựng lại kỳ đã chốt + MoM + Excel', () => {
  const P = '2026-11';
  const res = buildSignonPeriod([src(1), src(2, { emp_status: 'Resigned', attrition_date: '2026-10-10' })], new Map(), P, '2026-11-25', S);

  it('signonRowsFromLines dựng lại tiền kỳ', () => {
    const rows = signonRowsFromLines(res.lines, P);
    expect(rows.map((r) => [r.record_id, r.period_amount])).toEqual([[1, 2_000_000], [2, 500_000]]);
    expect(rows[1].milestones.map((m) => m.flag)).toEqual(['Passed', 'Failed', 'Failed']);
  });

  it('signonMom', () => {
    const mom = signonMom([{ period: P, lines: res.lines }]);
    expect(mom).toEqual([{ period: P, people: 2, milestones: 6, passed: 4, total: 2_500_000 }]);
  });

  it('sheet Details / kỳ / summary', () => {
    const d = signonDetailsSheet(res.all, ['2026-10', P]);
    expect(d[0][8]).toBe('Milestone 1 - 07 days');
    expect(d[1].slice(0, 9)).toEqual(['No', 'Employee Name', 'DC', 'Employee ID', 'Join Date', 'Resignation Date', 'Working Status', 'Scheme', 'Complete 07 days']);
    expect(d[1].slice(-4)).toEqual(['TOTAL SIGN-ON BONUS', "Oct'26 Pay Period", "Nov'26 Pay Period", 'Remark']);
    expect(d[2].slice(8, 12)).toEqual(['07/10/2026', 'Passed', 500_000, "Nov'26 Pay Period"]);
    expect(d[2].slice(20, 24)).toEqual(['29/11/2026', '', 0, '']);
    expect(d[0].slice(-4, -1)).toEqual([2_500_000, 0, 2_500_000]);

    expect(signonPeriodSheetName(P)).toBe('112026');
    const ps = signonPeriodSheet(res.rows, P);
    expect(ps[0].slice(-2)).toEqual(["Nov'26 Pay Period - Total", 2_500_000]);
    expect(ps).toHaveLength(4);
    expect(ps[2][8]).toBe(2_000_000);

    const sm = signonSummarySheet(signonMom([{ period: '2026-10', lines: [] }, { period: P, lines: res.lines }]));
    expect(sm.at(-1)).toEqual(['Total', 2_500_000, '', '']);
    expect(sm[2][0]).toBe("Nov'26");
  });
});

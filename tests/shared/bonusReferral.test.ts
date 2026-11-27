// Task #8 – Referral bonus + phần dùng chung của bonus (kỳ lương, ngày). Dữ liệu giả, không có người thật.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  cleanAmount,
  daysBetween,
  fmtVnd,
  groupByPayee,
  periodKeyOfLabel,
  periodLabel,
  periodMonthRange,
  periodOfDate,
  recentPeriodKeys,
  shiftPeriod,
  sumLines,
  toIsoDate,
} from '../../shared/bonus/period.ts';
import {
  REFERRAL_DEFAULT_RATES,
  buildReferralPeriod,
  cleanReferralRates,
  referralAmounts,
  referralMom,
  referralRowsFromLines,
  referralWarnings,
  suggestEligible,
  type ReferralPaidMap,
  type ReferralSource,
} from '../../shared/bonus/referral.ts';
import {
  REFERRAL_LIST_HEADERS,
  referralListSheet,
  referralListSheetName,
  referralMomSheet,
  referralSummarySheet,
} from '../../shared/bonus/referralTemplate.ts';

const R = REFERRAL_DEFAULT_RATES;

function src(id: number, over: Partial<ReferralSource> = {}): ReferralSource {
  return {
    record_id: id, candidate_code: `TA${10000 + id}`, full_name: `Ứng viên ${id}`, emp_id: String(9000000 + id), rank: 'Rank 6',
    region: 'Miền Bắc', dc: 'DC Hưng Yên', ob_date: '2026-10-07', emp_status: 'Active', attrition_date: null, pic: 'TA1-A',
    referrer_name: `Người GT ${id}`, referrer_emp_id: String(8000000 + id), referrer_rank: 'Rank 6', referrer_dc: 'DC Hưng Yên',
    referrer_status: 'Active', referrer_last_day: null, disciplinary: false,
    candidate_eligible: 'Yes', referrer_eligible: 'Yes', note: '',
    ...over,
  };
}

describe('kỳ lương và ngày', () => {
  it('nhãn kỳ như cột Payment Status', () => {
    expect(periodLabel('2026-11')).toBe("Nov'26 Pay Period");
    expect(periodKeyOfLabel("Nov'26 Pay Period")).toBe('2026-11');
    expect(periodKeyOfLabel("Oct'2026")).toBe('2026-10');
    expect(periodKeyOfLabel('Kỳ lương tháng 11')).toBe('');
    expect(() => periodLabel('2026-13')).toThrow();
  });
  it('dời kỳ qua năm, kỳ gần nhất, tháng của ngày', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    expect(recentPeriodKeys(3, '2026-02')).toEqual(['2026-02', '2026-01', '2025-12']);
    expect(periodOfDate('2026-11-26T10:00:00Z')).toBe('2026-11');
    expect(periodMonthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('ngày lịch: Join Date + 6 như Excel', () => {
    expect(addDays('2026-10-28', 6)).toBe('2026-11-03');
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
    expect(toIsoDate('2026-02-30')).toBe('');
  });
  it('tiền', () => {
    expect(fmtVnd(17_000_000)).toBe('17.000.000');
    expect(cleanAmount('1.500.000')).toBe(1_500_000);
    expect(cleanAmount(-1)).toBeNull();
    expect(cleanAmount(1.5)).toBeNull();
    expect(sumLines([{ amount: 900_000, pit: 90_000, net: 810_000 }, { amount: 700_000, pit: 70_000, net: 630_000 }]))
      .toEqual({ amount: 1_600_000, pit: 160_000, net: 1_440_000 });
    const g = groupByPayee([{ payee_key: 'A', payee_name: 'a', amount: 1 }, { payee_key: '', payee_name: 'b', amount: 2 }, { payee_key: 'A', payee_name: 'a', amount: 3 }]);
    expect(g.map((x) => [x.key || x.name, x.amount])).toEqual([['A', 4], ['b', 2]]);
  });
});

describe('Referral – mức tiền', () => {
  it('DC Hưng Yên 1.500.000, nơi khác 1.000.000, ứng viên 500.000', () => {
    expect(referralAmounts(src(1), R)).toEqual({ candidate: 500_000, referrer: 1_500_000 });
    expect(referralAmounts(src(1, { dc: 'DC Bình Dương 1' }), R)).toEqual({ candidate: 500_000, referrer: 1_000_000 });
  });
  it('sửa lỗi Excel: ứng viên No → người giới thiệu cũng 0 (Excel cũ vẫn trả 1.000.000)', () => {
    expect(referralAmounts(src(1, { candidate_eligible: 'No', referrer_eligible: 'Yes', dc: 'DC Bình Dương 1' }), R)).toEqual({ candidate: 0, referrer: 0 });
  });
  it('ứng viên Yes, người giới thiệu No → chỉ trả ứng viên', () => {
    expect(referralAmounts(src(1, { referrer_eligible: 'No' }), R)).toEqual({ candidate: 500_000, referrer: 0 });
  });
  it('cấu hình: thiếu / sai thì dùng mặc định; DC chuẩn hóa khoảng trắng', () => {
    expect(cleanReferralRates(null)).toEqual(R);
    const c = cleanReferralRates({ candidate: 600_000, referrerDefault: 'x', referrerByDc: { ' DC  Hải Phòng ': 2_000_000, Bad: -1 } });
    expect(c).toEqual({ candidate: 600_000, referrerDefault: 1_000_000, referrerByDc: { 'DC Hải Phòng': 2_000_000 } });
    expect(referralAmounts(src(1, { dc: 'DC Hải Phòng' }), c).referrer).toBe(2_000_000);
    expect(referralAmounts(src(1), c).referrer).toBe(1_000_000);
  });
});

describe('Referral – cảnh báo và gợi ý', () => {
  it('nghỉ việc / kỷ luật → gợi ý No', () => {
    const s = src(1, { emp_status: 'Resigned', attrition_date: '2026-11-02' });
    expect(referralWarnings(s)).toContain('cand_resigned');
    expect(suggestEligible(s)).toEqual({ candidate: 'No', referrer: 'No' });
    expect(suggestEligible(src(2, { referrer_status: 'Resigned' }))).toEqual({ candidate: '', referrer: 'No' });
    expect(suggestEligible(src(3, { disciplinary: true })).candidate).toBe('No');
  });
  it('thiếu người giới thiệu, tự giới thiệu', () => {
    expect(referralWarnings(src(1, { referrer_name: '', referrer_emp_id: '' }))).toContain('no_referrer');
    expect(referralWarnings(src(1, { referrer_emp_id: '9000001' }))).toContain('self_referral');
  });
});

describe('Referral – tính kỳ', () => {
  it('cấu trúc như kỳ T11/2026: 4 ca DC Hưng Yên + 6 ca DC khác, tất cả Yes → 5.000.000 + 12.000.000 = 17.000.000', () => {
    const rows = [
      ...[1, 2, 3, 4].map((i) => src(i)),
      ...[5, 6, 7, 8, 9, 10].map((i) => src(i, { dc: i === 5 ? 'DC Bình Dương PL' : 'DC Bình Dương 1', region: 'Miền Nam' })),
    ];
    const r = buildReferralPeriod(rows, new Map(), '2026-11', R);
    expect(r.totals).toEqual({ candidate: 5_000_000, referrer: 12_000_000, total: 17_000_000, hired: 10, eligible: 10 });
    expect(r.lines).toHaveLength(20);
    expect(r.rows).toHaveLength(10);
  });
  it('chưa có cờ Eligible → chờ, không vào kỳ', () => {
    const r = buildReferralPeriod([src(1, { candidate_eligible: '', referrer_eligible: '' })], new Map(), '2026-11', R);
    expect(r.rows).toHaveLength(0);
    expect(r.pending).toHaveLength(1);
    expect(r.lines).toHaveLength(0);
  });
  it('ứng viên No → vào kỳ với 0 đ cho cả hai phần (để không quay lại kỳ sau)', () => {
    const r = buildReferralPeriod([src(1, { candidate_eligible: 'No', referrer_eligible: '' })], new Map(), '2026-11', R);
    expect(r.lines.map((l) => [l.part, l.amount])).toEqual([['candidate', 0], ['referrer', 0]]);
    expect(r.totals).toMatchObject({ total: 0, hired: 1, eligible: 0 });
  });
  it('ứng viên Yes nhưng chưa nhập người giới thiệu → trả ứng viên, phần người giới thiệu chờ', () => {
    const r = buildReferralPeriod([src(1, { referrer_name: '', referrer_emp_id: '', referrer_eligible: '' })], new Map(), '2026-11', R);
    expect(r.rows[0].candidate_state).toBe('due');
    expect(r.rows[0].referrer_state).toBe('pending');
    expect(r.lines.map((l) => l.part)).toEqual(['candidate']);
  });
  it('phần đã chốt ở kỳ trước không vào kỳ này; xem lại chính kỳ đã chốt thì vẫn hiện', () => {
    const paid: ReferralPaidMap = new Map([[1, { candidate: '2026-10' }], [2, { candidate: '2026-10', referrer: '2026-10' }]]);
    const r = buildReferralPeriod([src(1), src(2)], paid, '2026-11', R);
    expect(r.rows.map((x) => x.record_id)).toEqual([1]);
    expect(r.lines.map((l) => l.part)).toEqual(['referrer']);
    expect(r.rows[0].candidate_state).toBe('paid_before');
    expect(r.totals.hired).toBe(0);
    const again = buildReferralPeriod([src(2)], paid, '2026-10', R);
    expect(again.lines).toHaveLength(2);
  });
  it('khoản gửi lên: khóa người nhận = Emp_ID, net = amount', () => {
    const [c, f] = buildReferralPeriod([src(1)], new Map(), '2026-11', R).lines;
    expect(c).toMatchObject({ part: 'candidate', payee_type: 'candidate', payee_key: '9000001', amount: 500_000, pit: 0, net: 500_000, ta_pic: null });
    expect(f).toMatchObject({ part: 'referrer', payee_type: 'referrer', payee_key: '8000001', amount: 1_500_000 });
    expect((c.detail.src as ReferralSource).candidate_code).toBe('TA10001');
  });
  it('dựng lại danh sách kỳ đã chốt từ khoản đã lưu', () => {
    const r = buildReferralPeriod([src(1), src(2, { referrer_eligible: 'No' })], new Map(), '2026-11', R);
    const back = referralRowsFromLines(r.lines, '2026-11');
    expect(back.map((x) => [x.record_id, x.candidate_amount, x.referrer_amount])).toEqual([[1, 500_000, 1_500_000], [2, 500_000, 0]]);
  });
  it('MoM theo các kỳ đã chốt', () => {
    const m = referralMom([{ period: '2026-11', lines: [{ part: 'candidate', amount: 500_000 }, { part: 'candidate', amount: 0 }, { part: 'referrer', amount: 1_000_000 }] }]);
    expect(m).toEqual([{ period: '2026-11', hired: 2, eligible: 1, pctEligible: 0.5, total: 1_500_000 }]);
  });
});

describe('Referral – file Excel', () => {
  const r = buildReferralPeriod([src(1), src(2, { dc: 'DC Bình Dương 1' }), src(3, { referrer_emp_id: '8000001' })], new Map(), '2026-11', R);
  it('danh sách 24 cột, 2 dòng tiêu đề, Payment Status = kỳ', () => {
    const s = referralListSheet(r.rows);
    expect(REFERRAL_LIST_HEADERS).toHaveLength(24);
    expect(s[0]).toHaveLength(24);
    expect(s[2]).toHaveLength(24);
    expect(s[2][12]).toBe(500_000);
    expect(s[2][13]).toBe("Nov'26 Pay Period");
    expect(s[2][21]).toBe(1_500_000);
    expect(referralListSheetName('2026-11')).toBe('Nov26 Referral List');
  });
  it('Summary gộp người giới thiệu theo Emp_ID, tổng đúng', () => {
    const s = referralSummarySheet(r.lines, '2026-11');
    expect(s[3][14]).toBe(1_500_000 + 4_000_000);
    expect(s[1][14]).toBe(1_500_000);
    expect(s[2][14]).toBe(4_000_000);
    const refRows = s.slice(4).filter((x) => x[8]);
    expect(refRows.map((x) => [x[8], x[11]])).toEqual([['8000001', 3_000_000], ['8000002', 1_000_000]]);
  });
  it('MoM', () => {
    expect(referralMomSheet([{ period: '2026-11', hired: 10, eligible: 9, pctEligible: 0.9, total: 17_000_000 }])[1]).toEqual(["Nov'26", 10, 9, '90%', 17_000_000, '']);
  });
});

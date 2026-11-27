// Task #10 (4) – Freelancer / CTV bonus. Dữ liệu giả, không có người thật.
import { describe, expect, it } from 'vitest';
import {
  FREELANCER_DEFAULT_CONFIG,
  buildFreelancerPeriod,
  cleanFreelancerConfig,
  cleanFreelancerFlag,
  eligibleDate,
  evaluateFreelancerRecord,
  freelancerLineViews,
  freelancerRate,
  groupLineViews,
  suggestFreelancerFlag,
  type Freelancer,
  type FreelancerPaidMap,
  type FreelancerSource,
} from '../../shared/bonus/freelancer.ts';
import { freelancerSheet, freelancerSummarySheet } from '../../shared/bonus/freelancerTemplate.ts';

const C = FREELANCER_DEFAULT_CONFIG;
const P = '2026-11';
const ASOF = '2026-11-26';
const NONE: FreelancerPaidMap = new Map();

const FL: Freelancer[] = [1, 2, 3].map((id) => ({ id, name: `CTV ${id}`, phone: '', region: 'South', note: '', active: true }));

function rec(id: number, over: Partial<FreelancerSource> = {}): FreelancerSource {
  return {
    record_id: id, candidate_code: `C${id}`, full_name: `UV ${id}`, emp_id: `7${id}`, position: 'Picker', site: 'DC Bình Dương 1',
    sub_source: 'Freelancer', pic: 'TA1', ob_date: '2026-10-01', ob_status: 'Joined', emp_status: 'Active', attrition_date: null,
    freelancer_id: 1, flag: '', note: '', ...over,
  };
}

describe('mức theo số ứng viên', () => {
  it('1 → 700k; 2–3 → 800k; 4–6 → 900k; > 6 → 1tr; 0 → 0', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 20].map((n) => freelancerRate(n, C))).toEqual([0, 700_000, 800_000, 800_000, 900_000, 900_000, 1_000_000, 1_000_000]);
  });
  it('cleanFreelancerConfig: hợp lệ giữ nguyên, sai → mặc định', () => {
    expect(cleanFreelancerConfig(JSON.parse(JSON.stringify(C)))).toEqual(C);
    expect(cleanFreelancerConfig(null)).toEqual(C);
    const bad = (tiers: unknown) => cleanFreelancerConfig({ ...C, tiers }).tiers;
    expect(bad([{ max: 3, amount: 1 }, { max: 2, amount: 2 }, { max: null, amount: 3 }])).toEqual(C.tiers);
    expect(bad([{ max: 3, amount: 1 }])).toEqual(C.tiers);
    expect(bad([{ max: null, amount: 500_000 }])).toEqual([{ max: null, amount: 500_000 }]);
    expect(cleanFreelancerConfig({ ...C, pitRate: 1.5 }).pitRate).toBe(0.1);
    expect(cleanFreelancerConfig({ ...C, minDays: -1 }).minDays).toBe(30);
  });
  it('cờ lạ → rỗng', () => {
    expect(cleanFreelancerFlag('Hold')).toBe('Hold');
    expect(cleanFreelancerFlag('x')).toBe('');
  });
});

describe('đủ điều kiện 30 ngày lịch', () => {
  it('ngày đủ điều kiện = OBD + 30', () => {
    expect(eligibleDate('2026-10-27', C)).toBe('2026-11-26');
    expect(eligibleDate(null, C)).toBe('');
  });
  it('gợi ý: nghỉ trước ngày đủ điều kiện → Failed; nghỉ đúng / sau → Passed; Resigned thiếu ngày → Failed', () => {
    expect(suggestFreelancerFlag({ emp_status: 'Resigned', attrition_date: '2026-10-30' }, '2026-10-31')).toBe('Failed');
    expect(suggestFreelancerFlag({ emp_status: 'Resigned', attrition_date: '2026-10-31' }, '2026-10-31')).toBe('Passed');
    expect(suggestFreelancerFlag({ emp_status: 'Resigned', attrition_date: null }, '2026-10-31')).toBe('Failed');
    expect(suggestFreelancerFlag({ emp_status: 'Active', attrition_date: null }, '2026-10-31')).toBe('Passed');
  });
  it('tình trạng từng hồ sơ', () => {
    const st = (over: Partial<FreelancerSource>, paid = NONE) => evaluateFreelancerRecord(rec(1, over), paid, P, ASOF, C).state;
    expect(st({})).toBe('due');
    expect(st({ ob_date: '2026-10-27' })).toBe('due');
    expect(st({ ob_date: '2026-10-28' })).toBe('future');
    expect(st({ freelancer_id: null })).toBe('no_freelancer');
    expect(st({ ob_status: 'Withdrawn' })).toBe('not_joined');
    expect(st({ flag: 'Hold' })).toBe('hold');
    expect(st({ emp_status: 'Resigned', attrition_date: '2026-10-15' })).toBe('failed');
    expect(st({ emp_status: 'Resigned', attrition_date: '2026-10-15', flag: 'Passed' })).toBe('due');
    expect(st({ flag: 'Failed' })).toBe('failed');
    expect(st({}, new Map([[1, { period: '2026-10', amount: 700_000 }]]))).toBe('paid_before');
    expect(st({}, new Map([[1, { period: P, amount: 700_000 }]]))).toBe('due');
  });
  it('cảnh báo', () => {
    const w = (over: Partial<FreelancerSource>) => evaluateFreelancerRecord(rec(1, over), NONE, P, ASOF, C).warnings;
    expect(w({ emp_status: 'Resigned' })).toContain('resigned_no_date');
    expect(w({ sub_source: 'Referrals' })).toEqual(['not_freelancer_source']);
    expect(w({ flag: 'Failed' })).toEqual(['flag_manual']);
    expect(w({ flag: 'Hold' })).toEqual([]);
  });
});

describe('buildFreelancerPeriod', () => {
  it('kiểu file Nov\'26: CTV 1 có 6 UV × 900k, 3 CTV khác 1 UV × 700k → 7,5tr gross, PIT 10%', () => {
    const fl: Freelancer[] = [1, 2, 3, 4].map((id) => ({ id, name: `CTV ${id}`, phone: '', region: 'South', note: '', active: true }));
    const srcs = [
      ...[1, 2, 3, 4, 5, 6].map((i) => rec(i, { freelancer_id: 1, ob_date: i <= 3 ? '2026-09-26' : '2026-10-01' })),
      rec(7, { freelancer_id: 2, ob_date: '2026-09-05' }), rec(8, { freelancer_id: 3, ob_date: '2026-10-12' }), rec(9, { freelancer_id: 4, ob_date: '2026-10-14' }),
    ];
    const r = buildFreelancerPeriod(srcs, fl, NONE, P, ASOF, C);
    expect(r.totals).toEqual({ amount: 7_500_000, pit: 750_000, net: 6_750_000, people: 9, freelancers: 4 });
    expect(r.groups.map((g) => [g.freelancer_id, g.count, g.rate, g.amount])).toEqual([[1, 6, 900_000, 5_400_000], [2, 1, 700_000, 700_000], [3, 1, 700_000, 700_000], [4, 1, 700_000, 700_000]]);
    expect(r.lines[0]).toMatchObject({ record_id: 1, part: 'freelancer', payee_type: 'freelancer', payee_key: 'FL-1', payee_name: 'CTV 1', emp_id: '', ta_pic: null, amount: 900_000, pit: 90_000, net: 810_000 });
    expect(r.lines[0].detail).toMatchObject({ freelancer_id: 1, count: 6, rate: 900_000, cand_emp_id: '71' });
  });

  it('chỉ hồ sơ due được đếm vào mức của CTV (đã trả / chưa đủ ngày / Hold không đếm)', () => {
    const paid: FreelancerPaidMap = new Map([[1, { period: '2026-10', amount: 700_000 }]]);
    const r = buildFreelancerPeriod([rec(1), rec(2), rec(3), rec(4, { ob_date: '2026-11-01' }), rec(5, { flag: 'Hold' })], FL, paid, P, ASOF, C);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ count: 2, rate: 800_000, amount: 1_600_000 });
    expect(r.rows.map((x) => x.state)).toEqual(['paid_before', 'due', 'due', 'future', 'hold']);
    expect(r.rows[0]).toMatchObject({ period: '2026-10', amount: 700_000 });
  });

  it('ngày chốt sai → lỗi', () => {
    expect(() => buildFreelancerPeriod([], FL, NONE, P, 'x', C)).toThrow();
  });
});

describe('dựng lại + Excel', () => {
  const r = buildFreelancerPeriod([rec(1), rec(2), rec(3, { freelancer_id: 2, ob_date: '2026-09-20' })], FL, NONE, P, ASOF, C);
  const views = freelancerLineViews(r.lines);
  it('dòng từ khoản + gom theo CTV', () => {
    expect(views.map((v) => [v.freelancer_name, v.candidate_code, v.amount, v.pit, v.net])).toEqual([
      ['CTV 1', 'C1', 800_000, 80_000, 720_000], ['CTV 1', 'C2', 800_000, 80_000, 720_000], ['CTV 2', 'C3', 700_000, 70_000, 630_000],
    ]);
    expect(groupLineViews(views).map((g) => [g.name, g.count, g.rate, g.net])).toEqual([['CTV 1', 2, 800_000, 1_440_000], ['CTV 2', 1, 700_000, 630_000]]);
  });
  it('sheet Freelancer Bonus + Summary', () => {
    const s = freelancerSheet(views, P);
    expect(s[0].slice(7)).toEqual(['Total', 2_300_000, 230_000, 2_070_000, '']);
    expect(s[1][1]).toBe('Freelancer Name');
    expect(s[2]).toEqual([1, 'CTV 1', 'UV 1', '71', 'Active', 'DC Bình Dương 1', 'Picker', '01/10/2026', 800_000, 80_000, 720_000, "Nov'26"]);
    const sum = freelancerSummarySheet(views);
    expect(sum[1]).toEqual([1, 'CTV 1', 'South', 2, 800_000, 1_600_000, 160_000, 1_440_000]);
    expect(sum.at(-1)).toEqual(['', 'Grand Total', '', 3, '', 2_300_000, 230_000, 2_070_000]);
  });
});

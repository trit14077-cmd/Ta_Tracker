// Task #10 (2) – TA Credit bonus. Dữ liệu giả, không có người thật.
import { describe, expect, it } from 'vitest';
import {
  TA_CREDIT_DEFAULT_CONFIG,
  belowBaseStreak,
  buildTaCreditPeriod,
  cleanTaCreditConfig,
  evaluateOb,
  obCredits,
  performanceMonth,
  rankKey,
  taCreditRowsFromLines,
  tierBonus,
  workingDays,
  type TaCreditSource,
  type TaProfile,
} from '../../shared/bonus/taCredit.ts';
import { obListSheet, obListSheetName, taBonusSheet, taBonusSheetName } from '../../shared/bonus/taCreditTemplate.ts';

const C = TA_CREDIT_DEFAULT_CONFIG;
const P = '2026-11';
const ASOF = '2026-11-26';

function ob(id: number, over: Partial<TaCreditSource> = {}): TaCreditSource {
  return {
    record_id: id, candidate_code: `TA${10000 + id}`, full_name: `Ứng viên ${id}`, emp_id: String(9000000 + id), pic: 'TA1-A',
    rank: '6A', region: 'Miền Bắc', unit: 'Chuỗi Cung ứng', site: 'DC Hà Nội', ob_date: '2026-10-05', ob_status: 'Joined',
    emp_status: 'Active', attrition_date: null, ...over,
  };
}
function prof(pic: string, over: Partial<TaProfile> = {}): TaProfile {
  return { pic, name: `TA ${pic}`, emp_id: '6000001', region: 'North', level: 'Middle', title: 'Recruitment Executive', is_freelancer: false, onsite: false, active: true, ...over };
}

describe('credit từng OB', () => {
  it('site HY/HP = 3 credit bất kể rank', () => {
    expect(obCredits(ob(1, { site: 'TTPP Hải Phòng', rank: '2A' }), C)).toBe(3);
  });
  it('theo rank + vùng của OB', () => {
    expect(obCredits(ob(1, { rank: '6B' }), C)).toBe(1.5);
    expect(obCredits(ob(1, { rank: '6B', region: 'Miền Nam' }), C)).toBe(1);
    expect(obCredits(ob(1, { rank: '5A', region: 'Miền Trung' }), C)).toBe(1.5);
    expect(obCredits(ob(1, { rank: '4C' }), C)).toBe(4);
    expect(obCredits(ob(1, { rank: '2A', region: 'Miền Nam' }), C)).toBe(20);
  });
  it('Rank 3 Back Office tách 9 / 7', () => {
    expect(rankKey('3A', 'Khối Văn phòng', C)).toBe('3BO');
    expect(obCredits(ob(1, { rank: '3A' }), C)).toBe(8);
    expect(obCredits(ob(1, { rank: '3A', unit: 'Khối Văn phòng' }), C)).toBe(9);
    expect(obCredits(ob(1, { rank: '3A', unit: 'Khối Văn phòng', region: 'Miền Nam' }), C)).toBe(7);
  });
  it('rank lạ → null', () => {
    expect(obCredits(ob(1, { rank: '1A' }), C)).toBeNull();
    expect(obCredits(ob(1, { rank: '' }), C)).toBeNull();
  });
});

describe('điều kiện OB', () => {
  it('số ngày làm = (ngày nghỉ hoặc ngày chốt) − OBD', () => {
    expect(workingDays(ob(1), ASOF)).toBe(52);
    expect(workingDays(ob(1, { attrition_date: '2026-10-11' }), ASOF)).toBe(6);
  });
  it('tháng N trả ở kỳ N+1', () => {
    expect(performanceMonth('2026-11')).toBe('2026-10');
    expect(performanceMonth('2027-01')).toBe('2026-12');
  });
  it('lý do bị loại', () => {
    expect(evaluateOb(ob(1, { attrition_date: '2026-10-11' }), '2026-10', ASOF, C).skip).toBe('short');
    expect(evaluateOb(ob(1, { attrition_date: '2026-10-12' }), '2026-10', ASOF, C).skip).toBe('');
    expect(evaluateOb(ob(1, { ob_status: 'Withdrawn' }), '2026-10', ASOF, C).skip).toBe('not_joined');
    expect(evaluateOb(ob(1, { pic: '' }), '2026-10', ASOF, C).skip).toBe('no_pic');
    expect(evaluateOb(ob(1, { rank: '' }), '2026-10', ASOF, C).skip).toBe('no_rank');
    expect(evaluateOb(ob(1, { ob_date: '2026-11-01' }), '2026-10', ASOF, C).skip).toBe('outside_month');
    expect(evaluateOb(ob(1, { ob_date: '2026-10-31' }), '2026-10', ASOF, C).skip).toBe('');
  });
});

describe('khung lũy tiến', () => {
  it('Base không tiền, Target 70k, Outperformance 120k, Outstanding 200k', () => {
    expect(tierBonus(12, 'North', 'Senior', C)).toMatchObject({ amount: 0, tier: 'Base' });
    expect(tierBonus(18, 'North', 'Middle', C)).toMatchObject({ amount: 420_000, tier: 'Target' });
    expect(tierBonus(11.5, 'North', 'Junior', C).amount).toBe(105_000);
    // 50 credit North Senior: 15 base, 15 × 70k, 10 × 120k, 10 × 200k
    expect(tierBonus(50, 'North', 'Senior', C)).toMatchObject({ amount: 1_050_000 + 1_200_000 + 2_000_000, tier: 'Outstanding' });
    expect(tierBonus(22, 'South', 'Senior', C).amount).toBe(0);
    expect(tierBonus(23, 'South', 'Senior', C).amount).toBe(70_000);
  });
  it('Intern: phần Base trả 70k như Excel; tắt được', () => {
    expect(tierBonus(3, 'North', 'Intern', C).amount).toBe(210_000);
    expect(tierBonus(9.5, 'North', 'Intern', C).amount).toBe(665_000);
    expect(tierBonus(9.5, 'North', 'Intern', { ...C, internBaseRate: 0 }).amount).toBe(315_000);
  });
});

describe('buildTaCreditPeriod', () => {
  it('gom theo PIC, mỗi TA một khoản', () => {
    const res = buildTaCreditPeriod(
      [ob(1), ob(2, { site: 'DC Hưng Yên' }), ob(3, { pic: 'TA2-B' }), ob(4, { ob_date: '2026-09-30' })],
      [prof('TA1-A', { level: 'Junior' }), prof('TA2-B', { level: 'Intern' }), prof('TA3-C')], P, ASOF, C,
    );
    expect(res.perfMonth).toBe('2026-10');
    expect(res.rows.map((r) => [r.pic, r.eligible, r.credits])).toEqual([['TA1-A', 2, 4.5], ['TA2-B', 1, 1.5], ['TA3-C', 0, 0]]);
    expect(res.lines.map((l) => [l.payee_key, l.ta_pic, l.part, l.payee_type, l.amount])).toEqual([
      ['TA1-A', 'TA1-A', 'credit', 'ta', 0], ['TA2-B', 'TA2-B', 'credit', 'ta', 105_000], ['TA3-C', 'TA3-C', 'credit', 'ta', 0],
    ]);
    expect(res.lines[0].record_id).toBeNull();
    expect((res.lines[0].detail.obs as unknown[]).length).toBe(2);
    expect(res.totals).toMatchObject({ amount: 105_000, credits: 6, eligible: 3, onboarded: 3, tas: 3 });
  });
  it('PIC thiếu hồ sơ / hồ sơ tắt / thiếu level → không có khoản', () => {
    const res = buildTaCreditPeriod([ob(1, { pic: 'X' }), ob(2, { pic: 'Y' }), ob(3, { pic: 'Z' })],
      [prof('Y', { active: false }), prof('Z', { level: '' })], P, ASOF, C);
    expect(res.rows.map((r) => [r.pic, r.problem])).toEqual([['X', 'no_profile'], ['Y', 'inactive'], ['Z', 'no_level']]);
    expect(res.lines).toHaveLength(0);
  });
  it('OB bị loại nằm trong skipped, vẫn đếm Onboarding', () => {
    const res = buildTaCreditPeriod([ob(1), ob(2, { attrition_date: '2026-10-06' }), ob(3, { pic: null })], [prof('TA1-A')], P, ASOF, C);
    expect(res.skipped.map((o) => o.skip)).toEqual(['short', 'no_pic']);
    expect(res.rows[0]).toMatchObject({ onboarded: 2, eligible: 1, credits: 1.5 });
  });
  it('freelancer không vào danh sách TA', () => {
    const res = buildTaCreditPeriod([], [prof('F', { is_freelancer: true })], P, ASOF, C);
    expect(res.rows).toHaveLength(0);
  });
  it('ngày chốt sai → lỗi', () => {
    expect(() => buildTaCreditPeriod([], [], P, 'x', C)).toThrow();
  });
});

describe('cấu hình + phụ trợ', () => {
  it('cleanTaCreditConfig giữ giá trị hợp lệ, bỏ giá trị sai', () => {
    const c = cleanTaCreditConfig({ minDays: 10, internBaseRate: 0, rates: [0, 1, 2, 3], tiers: { North: { Senior: [1, 2, 3], Middle: [3, 2, 1] } }, creditSites: { A: 2, B: -1 } });
    expect(c.minDays).toBe(10);
    expect(c.internBaseRate).toBe(0);
    expect(c.rates).toEqual([0, 1, 2, 3]);
    expect(c.tiers.North.Senior).toEqual([1, 2, 3]);
    expect(c.tiers.North.Middle).toEqual([12, 25, 40]);
    expect(c.creditSites).toEqual({ A: 2 });
    expect(cleanTaCreditConfig(null)).toEqual(C);
  });
  it('dựng lại từ khoản đã chốt', () => {
    const res = buildTaCreditPeriod([ob(1), ob(2)], [prof('TA1-A')], P, ASOF, C);
    const rows = taCreditRowsFromLines(res.lines);
    expect(rows[0]).toMatchObject({ pic: 'TA1-A', eligible: 2, credits: 3, tier: 'Base', amount: 0 });
    expect(rows[0].profile?.level).toBe('Middle');
  });
  it('belowBaseStreak', () => {
    const h = [new Map([['A', 'Base' as const]]), new Map([['A', 'Base' as const]]), new Map([['A', 'Target' as const]])];
    expect(belowBaseStreak('A', 'Base', h)).toBe(3);
    expect(belowBaseStreak('A', 'Target', h)).toBe(0);
    expect(belowBaseStreak('B', 'Base', h)).toBe(1);
  });
  it('sheet Excel', () => {
    const res = buildTaCreditPeriod([ob(1), ob(2, { attrition_date: '2026-10-06' })], [prof('TA1-A', { level: 'Intern' })], P, ASOF, C);
    expect(taBonusSheetName(P)).toBe("Nov'26 Bonus");
    const s = taBonusSheet(res.rows, P);
    expect(s[0].slice(-2)).toEqual(['Total', 105_000]);
    expect(s[2]).toEqual([1, 'TA TA1-A', 'TA1-A', 'North', 'Recruitment Executive', 'Intern', '6000001', 2, 1, 1.5, 'Base', 105_000]);
    expect(obListSheetName(res.perfMonth)).toBe("ob_list_Oct'26");
    const o = obListSheet(res.rows[0].obs);
    expect(o).toHaveLength(3);
    expect(o[2][o[2].length - 1]).toBe('Chưa đủ số ngày làm');
  });
});

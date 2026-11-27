// Task #10 – tổng hợp chi trả theo người nhận. Dữ liệu giả, không có người thật.
import { describe, expect, it } from 'vitest';
import type { BonusLineInput } from '../../shared/bonus/period.ts';
import { buildPayoutSummary, payoutMom } from '../../shared/bonus/summary.ts';
import { summaryMomSheet, summarySheet, summarySheetName } from '../../shared/bonus/summaryTemplate.ts';

function ln(over: Partial<BonusLineInput>): BonusLineInput {
  return { record_id: null, part: 'x', payee_type: 'ta', payee_key: '', payee_name: '', emp_id: '', ta_pic: null, amount: 0, pit: 0, net: 0, detail: {}, ...over };
}
const ta = (pic: string, amount: number, detail: Record<string, unknown> = {}) =>
  ln({ payee_key: pic, payee_name: `Tên ${pic}`, emp_id: `E${pic}`, ta_pic: pic, amount, net: amount, detail });
const fl = (id: number, amount: number, rid: number) =>
  ln({ record_id: rid, payee_type: 'freelancer', payee_key: `FL-${id}`, payee_name: `CTV ${id}`, amount, pit: amount / 10, net: amount * 0.9, detail: { region: 'South' } });

describe('buildPayoutSummary', () => {
  const s = buildPayoutSummary({
    ta_credit: [ta('A', 0, { region: 'North', title: 'Lead' }), ta('B', 420_000, { region: 'North', title: 'Staff' }), ta('C', 0, { region: 'South', title: 'Staff' })],
    onsite: [ta('A', 1_000_000, { region: 'North' }), ta('B', 2_000_000), ta('D', 500_000, { region: 'North', title: 'Intern' })],
    freelancer: [fl(1, 900_000, 1), fl(1, 900_000, 2), fl(2, 700_000, 3)],
  });
  it('gom theo người nhận: TA trước (theo TA Credit, rồi Onsite), CTV sau', () => {
    expect(s.rows.map((r) => [r.key, r.credit, r.onsite, r.freelancer, r.total])).toEqual([
      ['ta:A', 0, 1_000_000, 0, 1_000_000], ['ta:B', 420_000, 2_000_000, 0, 2_420_000], ['ta:C', 0, 0, 0, 0], ['ta:D', 0, 500_000, 0, 500_000],
      ['fl:FL-1', 0, 0, 1_800_000, 1_800_000], ['fl:FL-2', 0, 0, 700_000, 700_000],
    ]);
    expect(s.totals).toEqual({ credit: 420_000, onsite: 3_500_000, freelancer: 2_500_000, pit: 250_000, total: 6_420_000 });
  });
  it('thông tin người nhận lấy từ khoản (TA Credit trước), CTV có chức danh Recruitment Freelance', () => {
    expect(s.rows[0]).toMatchObject({ name: 'Tên A', region: 'North', title: 'Lead', emp_id: 'EA', type: 'ta' });
    expect(s.rows[3]).toMatchObject({ region: 'North', title: 'Intern' });
    expect(s.rows[4]).toMatchObject({ name: 'CTV 1', region: 'South', title: 'Recruitment Freelance', emp_id: '', type: 'freelancer', pit: 180_000 });
  });
  it('không có khoản → rỗng', () => {
    expect(buildPayoutSummary({})).toEqual({ rows: [], totals: { credit: 0, onsite: 0, freelancer: 0, pit: 0, total: 0 } });
  });
  it('sheet Summary', () => {
    const sh = summarySheet(s.rows, s.totals, '2026-11');
    expect(summarySheetName('2026-11')).toBe("Summary Nov'26");
    expect(sh[0].at(-1)).toBe("(1) Total Payout - Nov'26\n(2) + (3) + (4)");
    expect(sh[1]).toEqual([1, 'Tên A', 'North', 'Lead', 'EA', 0, 1_000_000, '', 1_000_000]);
    expect(sh[5]).toEqual([5, 'CTV 1', 'South', 'Recruitment Freelance', '', '', '', 1_800_000, 1_800_000]);
    expect(sh.at(-1)).toEqual(['', 'Total', '', '', '', 420_000, 3_500_000, 2_500_000, 6_420_000]);
  });
});

describe('payoutMom', () => {
  it('cộng từng loại theo kỳ, tăng dần', () => {
    const m = payoutMom([
      { kind: 'onsite', period: '2026-11', lines: [{ amount: 5_000_000 }] },
      { kind: 'ta_credit', period: '2026-10', lines: [{ amount: 1_000_000 }, { amount: 200_000 }] },
      { kind: 'ta_credit', period: '2026-11', lines: [{ amount: 3_220_000 }] },
      { kind: 'freelancer', period: '2026-11', lines: [{ amount: 7_500_000 }] },
    ]);
    expect(m).toEqual([
      { period: '2026-10', credit: 1_200_000, onsite: 0, freelancer: 0, total: 1_200_000 },
      { period: '2026-11', credit: 3_220_000, onsite: 5_000_000, freelancer: 7_500_000, total: 15_720_000 },
    ]);
    expect(summaryMomSheet(m)[2]).toEqual(["Nov'26 Pay Period", 3_220_000, 5_000_000, 7_500_000, 15_720_000]);
  });
});

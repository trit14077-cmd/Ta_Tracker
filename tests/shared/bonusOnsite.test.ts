// Task #10 (3) – TA Onsite Allowance. Dữ liệu giả, không có người thật.
import { describe, expect, it } from 'vitest';
import {
  ONSITE_DEFAULT_CONFIG,
  buildOnsitePeriod,
  cleanOnsiteConfig,
  cleanOnsiteDays,
  isWeekend,
  monthDays,
  onsitePics,
  onsiteRowsFromLines,
  weekdayShort,
  type OnsiteDay,
} from '../../shared/bonus/onsite.ts';
import type { TaProfile } from '../../shared/bonus/taCredit.ts';
import { ONSITE_SHEET_NAME, onsiteSheet } from '../../shared/bonus/onsiteTemplate.ts';

const C = ONSITE_DEFAULT_CONFIG;
const P = '2026-11';

function prof(pic: string, over: Partial<TaProfile> = {}): TaProfile {
  return { pic, name: `Tên ${pic}`, emp_id: `E-${pic}`, region: 'North', level: 'Junior', title: 'Recruitment Staff', is_freelancer: false, onsite: true, active: true, ...over };
}
const on = (pic: string, ...days: number[]): OnsiteDay[] => days.map((d) => ({ pic, day: `2026-11-${String(d).padStart(2, '0')}` }));

describe('ngày trong tháng', () => {
  it('monthDays / thứ / cuối tuần', () => {
    expect(monthDays('2026-11')).toHaveLength(30);
    expect(monthDays('2028-02')).toHaveLength(29);
    expect(monthDays('2026-11')[0]).toBe('2026-11-01');
    expect(weekdayShort('2026-11-02')).toBe('Mon');
    expect(weekdayShort('2026-11-30')).toBe('Mon');
    expect(isWeekend('2026-11-01')).toBe(true);
    expect(isWeekend('2026-11-27')).toBe(false);
  });
  it('cleanOnsiteDays: bỏ trùng, ngày sai, ngày ngoài tháng; sắp xếp', () => {
    expect(cleanOnsiteDays(['2026-11-05', '2026-11-02', '2026-11-05', '2026-10-31', '2026-12-01', 'x', '2026-11-31', null], P))
      .toEqual(['2026-11-02', '2026-11-05']);
  });
});

describe('cấu hình', () => {
  it('mặc định 100.000 / ngày; giá trị sai → mặc định', () => {
    expect(cleanOnsiteConfig(null)).toEqual({ ratePerDay: 100_000 });
    expect(cleanOnsiteConfig({ ratePerDay: 150_000 })).toEqual({ ratePerDay: 150_000 });
    expect(cleanOnsiteConfig({ ratePerDay: -1 })).toEqual({ ratePerDay: 100_000 });
    expect(cleanOnsiteConfig({ ratePerDay: 1.5 })).toEqual({ ratePerDay: 100_000 });
  });
});

describe('buildOnsitePeriod', () => {
  it('kiểu file Nov\'26: 4 TA 10/20/10/10 ngày → 5.000.000; ngày ngoài tháng không tính', () => {
    const allWeekdays = monthDays(P).filter((d) => !isWeekend(d)).slice(0, 20).map((d) => Number(d.slice(8)));
    const days = [
      ...on('A', 2, 6, 10, 13, 16, 17, 18, 20, 25, 30),
      ...on('B', ...allWeekdays),
      ...on('C', 10, 12, 13, 16, 17, 18, 25, 26, 27, 30),
      ...on('D', 2, 6, 10, 13, 16, 17, 18, 20, 25, 30),
      { pic: 'A', day: '2026-10-30' },
    ];
    const r = buildOnsitePeriod(days, ['A', 'B', 'C', 'D'].map((p) => prof(p)), P, C);
    expect(r.rows.map((x) => x.count)).toEqual([10, 20, 10, 10]);
    expect(r.totals).toEqual({ amount: 5_000_000, days: 50, tas: 4 });
    const l = r.lines[1];
    expect(l).toMatchObject({ record_id: null, part: 'onsite', payee_type: 'ta', payee_key: 'B', ta_pic: 'B', emp_id: 'E-B', amount: 2_000_000, pit: 0, net: 2_000_000 });
    expect(l.detail).toMatchObject({ month: P, count: 20, rate: 100_000 });
  });

  it('TA bật Onsite nhưng chưa có ngày: có cột, không có khoản', () => {
    const r = buildOnsitePeriod(on('A', 3), [prof('A'), prof('B')], P, C);
    expect(r.rows.map((x) => [x.pic, x.count, x.amount])).toEqual([['A', 1, 100_000], ['B', 0, 0]]);
    expect(r.lines).toHaveLength(1);
  });

  it('cột: chỉ hồ sơ bật + cờ Onsite, cộng PIC đã có ngày', () => {
    const ps = [prof('A'), prof('B', { onsite: false }), prof('C', { active: false })];
    expect(onsitePics(ps, [])).toEqual(['A']);
    expect(onsitePics(ps, [...on('Z', 2), ...on('B', 3), ...on('A', 4)])).toEqual(['A', 'B', 'Z']);
  });

  it('PIC có ngày nhưng không có hồ sơ / hồ sơ tắt: không tạo khoản, có lý do', () => {
    const r = buildOnsitePeriod([...on('X', 2, 3), ...on('C', 4)], [prof('C', { active: false })], P, C);
    expect(r.rows.map((x) => [x.pic, x.problem, x.amount])).toEqual([['C', 'inactive', 0], ['X', 'no_profile', 0]]);
    expect(r.lines).toHaveLength(0);
  });

  it('hồ sơ tắt cờ Onsite nhưng đã có ngày: vẫn trả (cờ chỉ để hiện cột)', () => {
    const r = buildOnsitePeriod(on('B', 2, 3), [prof('B', { onsite: false })], P, C);
    expect(r.totals.amount).toBe(200_000);
  });

  it('đơn giá theo cấu hình', () => {
    expect(buildOnsitePeriod(on('A', 2, 3, 4), [prof('A')], P, { ratePerDay: 150_000 }).totals.amount).toBe(450_000);
  });

  it('dựng lại từ khoản đã chốt', () => {
    const r = buildOnsitePeriod(on('A', 2, 3), [prof('A')], P, C);
    const back = onsiteRowsFromLines(r.lines);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ pic: 'A', count: 2, amount: 200_000, days: ['2026-11-02', '2026-11-03'], problem: '' });
    expect(back[0].profile?.name).toBe('Tên A');
  });
});

describe('sheet Onsite Allowance', () => {
  it('hàng = ngày có người onsite, cột = TA được trả, cuối bảng Total days / Rate / Amount', () => {
    const r = buildOnsitePeriod([...on('A', 2, 6), ...on('B', 6), ...on('X', 9)], [prof('A'), prof('B'), prof('C')], P, C);
    const s = onsiteSheet(r.rows, P, 100_000);
    expect(ONSITE_SHEET_NAME).toBe('Onsite Allowance');
    expect(s[0][0]).toBe("TA ONSITE ALLOWANCE - Nov'26 Pay Period");
    expect(s[1]).toEqual(['Onsite Date', 'Week day', 'Tên A\n(A)', 'Tên B\n(B)', '']);
    expect(s.slice(2, 4)).toEqual([['02/11/2026', 'Mon', 1, '', ''], ['06/11/2026', 'Fri', 1, 1, '']]);
    expect(s.at(-3)).toEqual(['Total days', '', 2, 1, 3]);
    expect(s.at(-2)).toEqual(['Rate', '', 100_000, 100_000, '']);
    expect(s.at(-1)).toEqual(['Amount', '', 200_000, 100_000, 300_000]);
  });
});

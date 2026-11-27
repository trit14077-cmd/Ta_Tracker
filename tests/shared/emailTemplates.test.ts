// Mẫu email theo quy trình (task tracking #1–#3).
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTRAS, EMAIL_TEMPLATES, composeEmail, flowOfRank, longVnDate, suggestEmails } from '../../shared/emailTemplates.ts';

const sender = { name: 'Nguyen Van A', title: 'Talent Acquisition Specialist', phone: '0900000000', email: 'a@example.com' };
const cand = {
  full_name: 'Nguyễn Văn B',
  emp_id: '6300001',
  position: 'HSE Supervisor',
  rank: '5B',
  dept: 'HSE',
  unit: 'Chuỗi Cung Ứng',
  region: 'Miền Nam',
  site: 'DC Khánh Hòa',
  ob_date: '2026-07-23',
};

describe('emailTemplates', () => {
  it('chia luồng theo rank', () => {
    expect(flowOfRank('6A')).toBe('rank6');
    expect(flowOfRank(' 6C')).toBe('rank6');
    expect(flowOfRank('5B')).toBe('rank5up');
    expect(flowOfRank('3A')).toBe('rank5up');
    expect(flowOfRank('')).toBe('rank5up');
  });

  it('tính thứ từ ngày thay vì gõ tay', () => {
    expect(longVnDate('2026-07-23')).toBe('Thứ 5, ngày 23 tháng 07 năm 2026');
    expect(longVnDate('2026-11-29')).toBe('Chủ nhật, ngày 29 tháng 11 năm 2026');
    expect(longVnDate('')).toBe('');
  });

  it('dựng đủ 5 mẫu, có tiêu đề và chữ ký', () => {
    for (const t of EMAIL_TEMPLATES) {
      const m = composeEmail(t.id, cand, { ...DEFAULT_EXTRAS, sendDate: '2026-11-26' }, sender);
      expect(m.subject.length).toBeGreaterThan(10);
      expect(m.text).toContain('Nguyen Van A');
      expect(m.html).toContain('THE SUPRA CORPORATION');
    }
  });

  it('tiêu đề theo đúng quy ước file "Thứ tự gửi mail"', () => {
    const x = { ...DEFAULT_EXTRAS, sendDate: '2026-11-26' };
    expect(composeEmail('r6_new_hire', cand, x, sender).subject).toBe('[26.11.2026] THÔNG BÁO NHÂN SỰ MỚI - DC KHÁNH HÒA');
    expect(composeEmail('support_prep', cand, x, sender).subject).toBe('THE SUPRA - THÔNG TIN HỖ TRỢ NHÂN SỰ MỚI NHẬN VIỆC - NGUYỄN VĂN B');
    expect(composeEmail('ob_schedule', cand, x, sender).subject).toBe('THÔNG TIN NHÂN SỰ NHẬN VIỆC NGÀY 23/07/2026');
    expect(composeEmail('reminder', cand, x, sender).subject).toBe('[THE SUPRA] REMINDER: THÔNG TIN NHẬN VIỆC');
  });

  it('báo thiếu dữ liệu và để chỗ trống thay vì bịa', () => {
    const m = composeEmail('ob_schedule', { ...cand, emp_id: '' }, DEFAULT_EXTRAS, sender);
    expect(m.missing).toEqual(expect.arrayContaining(['MSNV', 'Email']));
    expect(m.text).toContain('MSNV: [MSNV]');
  });

  it('escape HTML từ dữ liệu ứng viên', () => {
    const m = composeEmail('support_prep', { ...cand, full_name: '<b>x</b>' }, DEFAULT_EXTRAS, sender);
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('mail sau OB dùng "Anh/Chị", không xưng "Anh" trống', () => {
    const m = composeEmail('after_ob_contacts', cand, DEFAULT_EXTRAS, sender);
    expect(m.text).not.toMatch(/(^|[^/])Anh (vui lòng|có thể|đừng)/);
  });

  it('gợi ý mail cần gửi theo rank và ngày OB', () => {
    const due = (c: Record<string, unknown>, today: string) => suggestEmails(c, today).map((t) => `${t.id}:${t.due}`);
    expect(due({ ...cand, ob_date: '' }, '2026-07-01')).toEqual(['support_prep:need_ob_date', 'ob_schedule:need_ob_date', 'reminder:need_ob_date', 'after_ob_contacts:need_ob_date']);
    expect(due(cand, '2026-07-20')).toEqual(['support_prep:now', 'ob_schedule:now', 'reminder:now', 'after_ob_contacts:later']);
    expect(due(cand, '2026-07-23')).toEqual(['support_prep:later', 'ob_schedule:later', 'reminder:later', 'after_ob_contacts:now']);
    expect(due({ ...cand, rank: '6A' }, '2026-07-20')).toEqual(['r6_new_hire:now']);
  });

  it('không còn tên/email người phụ trách gắn cứng', () => {
    for (const t of EMAIL_TEMPLATES) {
      const m = composeEmail(t.id, cand, DEFAULT_EXTRAS, sender);
      expect(m.text).not.toMatch(/@supra\.masangroup|@crownx|Mr\.? |Ms\.? /);
    }
  });
});

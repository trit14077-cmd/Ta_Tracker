// hr-form op:"response": tìm câu trả lời Google Form theo SĐT rồi CCCD, lấy lần gửi mới nhất, đặt cột theo tiêu đề.
import { describe, expect, it } from 'vitest';
import { findHrAnswer } from '../../supabase/functions/hr-form/logic.ts';

const HEAD = ['Dấu thời gian', 'Họ tên (viết hoa)', 'Số điện thoại', 'Số Căn cước công dân (CCCD)', 'Ngày cấp', 'Số điện thoại người thân để báo tin', 'Ghi chú thêm'];
const ROWS = [
  ['01/11/2026 09:00:00', 'NGUYỄN VĂN A', '0901234567', '079123456789', '20/10/2021', '0912000000', ''],
  ['02/11/2026 10:00:00', 'TRẦN THỊ B', '0987654321', '79111222333', '01/01/2022', '', ''],
  ['03/11/2026 11:30:00', 'NGUYỄN VĂN A', '+84 901 234 567', '079123456789', '21/10/2021', '0912000001', 'lần 2'],
];

describe('findHrAnswer', () => {
  it('sheet trống', () => {
    expect(findHrAnswer([HEAD], '901234567', '')).toMatchObject({ found: false, reason: 'empty' });
    expect(findHrAnswer([], '901234567', '')).toMatchObject({ found: false, reason: 'empty' });
  });
  it('theo SĐT (mọi kiểu gõ), nhiều lần gửi => lấy lần mới nhất', () => {
    const r = findHrAnswer([HEAD, ...ROWS], '901234567', '');
    expect(r).toMatchObject({ found: true, match_by: 'phone', count: 2, row: 4, submitted_at: '03/11/2026 11:30:00' });
    expect(r.mapped).toMatchObject({ full_name: 'NGUYỄN VĂN A', id_issue_date: '21/10/2021', emergency_phone: '0912000001', id_number: '079123456789' });
    expect(r.mapped?.phone).toBe('+84 901 234 567');
  });
  it('SĐT không khớp thì tìm theo CCCD (sheet mất số 0 đầu)', () => {
    const r = findHrAnswer([HEAD, ...ROWS], '900000000', '079111222333');
    expect(r).toMatchObject({ found: true, match_by: 'cccd', count: 1, row: 3 });
    expect(r.mapped?.full_name).toBe('TRẦN THỊ B');
  });
  it('không khớp gì', () => {
    expect(findHrAnswer([HEAD, ...ROWS], '900000000', '')).toMatchObject({ found: false, reason: 'no_match', searched: { phone: '900000000', cccd: false } });
  });
  it('cột theo tiêu đề, không theo vị trí; bỏ ô trống khỏi mapped', () => {
    const head = [HEAD[0], HEAD[2], 'Cột thêm tay', HEAD[1]];
    const r = findHrAnswer([head, ['t', '0901234567', 'x', 'A']], '901234567', '');
    expect(r.mapped).toEqual({ phone: '0901234567', full_name: 'A' });
    expect(r.answers?.map((a) => a.key)).toEqual(['submitted_at', 'phone', '', 'full_name']);
  });
});

// M8: ẩn danh trên máy trước khi nạp DEV – một-một, giữ trạng thái, không sót giá trị thật. Dữ liệu giả.
import { describe, expect, it } from 'vitest';
import { anonymize, excelSerialToDateTime } from '../../scripts/migrate/anonymize.ts';

const KEY = Buffer.alloc(32, 7);
const rows = [
  { candidate_code: 'TA1', pic: 'P1', full_name: 'Nguyễn Thật', phone: '901111111', email: 'that@x.vn', emp_id: 'E1', r1_status: 'Passed',
    r1_note: 'ghi chú riêng', basic_salary: '9000000', address: '12 Đường A', birth: '15/08/1999', health_check: 'DRV|giay.pdf', id_card: 'Yes' },
  { candidate_code: 'TA2', pic: 'P1', full_name: 'Nguyễn Thật', phone: '901111111', email: '', emp_id: '', r1_status: 'Failed',
    r1_note: '', basic_salary: '', address: '', birth: '1990', health_check: '', id_card: '' },
];

describe('anonymize', () => {
  const { rows: out, report } = anonymize(rows, KEY);
  it('giữ mã, PIC, trạng thái; một-một (2 dòng cùng người vẫn cùng tên/SĐT giả)', () => {
    expect(out.map((r) => [r.candidate_code, r.pic, r.r1_status])).toEqual([['TA1', 'P1', 'Passed'], ['TA2', 'P1', 'Failed']]);
    expect(out[0].full_name).toBe(out[1].full_name);
    expect(out[0].phone).toBe(out[1].phone);
    expect(out[0].phone).toMatch(/^99\d{7}$/);
    expect(out[0].email).toMatch(/@example\.invalid$/);
  });
  it('không sót giá trị thật; ẩn ghi chú, bỏ lương/địa chỉ, chỉ giữ năm sinh, giấy tờ có file => Yes', () => {
    expect(report).toMatchObject({ leftPhone: 0, leftEmail: 0, leftName: 0, leftEmp: 0, names: 1, phones: 1 });
    expect(out[0]).toMatchObject({ r1_note: '[đã ẩn]', basic_salary: '', address: '', birth: '1999', health_check: 'Yes', id_card: 'Yes' });
    expect(out[1]).toMatchObject({ r1_note: '', email: '', emp_id: '', birth: '1990' });
  });
  it('khóa khác => giá trị giả khác (không suy ngược được nếu không có khóa)', () => {
    expect(anonymize(rows, Buffer.alloc(32, 9)).rows[0].full_name === out[0].full_name && anonymize(rows, Buffer.alloc(32, 9)).rows[0].phone === out[0].phone).toBe(false);
  });
});

it('excelSerialToDateTime: số ngày Excel -> DD/MM/YYYY HH:mm:ss; chuỗi giữ nguyên', () => {
  expect(excelSerialToDateTime('45996')).toBe('05/12/2025 00:00:00');
  expect(excelSerialToDateTime('45996.5')).toBe('05/12/2025 12:00:00');
  expect(excelSerialToDateTime('05/12/2025 08:30')).toBe('05/12/2025 08:30');
  expect(excelSerialToDateTime('')).toBe('');
});

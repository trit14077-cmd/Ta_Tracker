// Sao lưu Supabase -> Google Sheet (Edge sheet-backup): phần thuần.
import { expect, it } from 'vitest';
import { CELL_MAX, flattenHr, safeEqual, toMatrix } from '../../supabase/functions/sheet-backup/logic.ts';

it('toMatrix: cột ưu tiên đứng trước, thiếu cột thì để trống, đối tượng thành JSON', () => {
  const m = toMatrix([{ b: 1, a: 'x' }, { c: { k: 1 }, a: null }], ['a']);
  expect(m[0]).toEqual(['a', 'b', 'c']);
  expect(m[1]).toEqual(['x', '1', '']);
  expect(m[2]).toEqual(['', '', '{"k":1}']);
});

it('toMatrix: giữ nguyên chuỗi (số 0 đầu, công thức) và cắt ô quá dài', () => {
  const m = toMatrix([{ phone: '0912345678', f: '=SUM(A1)', long: 'x'.repeat(CELL_MAX + 10) }]);
  expect(m[1][0]).toBe('0912345678');
  expect(m[1][1]).toBe('=SUM(A1)');
  expect(m[1][2].length).toBe(CELL_MAX);
});

it('flattenHr: gắn mã ứng viên, trường data trùng tên cột cố định thì thêm tiền tố', () => {
  const rows = flattenHr(
    [{ record_id: 5, data: { full_name: 'A', status: 'dup' }, status: 'submitted', id_number: '123', updated_at: null, verified_at: null }],
    new Map([[5, 'TA1']]),
  );
  expect(rows[0].candidate_code).toBe('TA1');
  expect(rows[0].status).toBe('submitted');
  expect(rows[0]['data.status']).toBe('dup');
  expect(rows[0].full_name).toBe('A');
});

it('safeEqual: rỗng hoặc khác độ dài thì sai', () => {
  expect(safeEqual('abc', 'abc')).toBe(true);
  expect(safeEqual('abc', 'abd')).toBe(false);
  expect(safeEqual('', '')).toBe(false);
  expect(safeEqual('ab', 'abc')).toBe(false);
});

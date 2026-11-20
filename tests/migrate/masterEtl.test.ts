// M8-1/M8-2: ETL bảng Master – tiêu đề 2 tầng như file thật, kiểm chặt (Q5a), mã trùng (E1a), gộp cùng người, nhóm SĐT (E6).
// Dữ liệu giả hoàn toàn.
import { describe, expect, it } from 'vitest';
import { buildConfig } from '../../supabase/functions/records-save/logic.ts';
import { excCodeOf, excelSerialToDisplayDate, mapHeaderRow, parseSheet, transformMaster } from '../../scripts/migrate/masterEtl.ts';

const config = buildConfig(
  [
    { list_key: 'position', value: 'Nhân viên Kho', active: true },
    { list_key: 'r1_status', value: 'Passed', active: true },
  ],
  [{ code: 'TA1', active: true }],
  [],
  [],
);
const GROUP = ['SCREENING', '', '', '', '', '', ''];
const HEAD = ['No.', 'PIC', 'Name', 'Phone', 'Email', 'Position', 'R1_STT'];

describe('parseSheet', () => {
  it('nhận dòng tiêu đề thứ 2 (dòng 1 là nhóm), bỏ dòng trống, đổi số ngày Excel', () => {
    const p = parseSheet('Master', [GROUP, HEAD, ['TA1001', 'TA1', 'A', '0901234567', '', 'Nhân viên Kho', ''], ['', '', '', '', '', '', '']]);
    expect(p.info).toMatchObject({ sheet: 'Master', headerRow: 2, matched: 7, rows: 1 });
    expect(p.rows[0]).toMatchObject({ rowNumber: 3, raw: { candidate_code: 'TA1001', full_name: 'A', pic: 'TA1' } });
    expect(excelSerialToDisplayDate(46000)).toBe('09/12/2025');
  });
  it('không có cột mã ứng viên => không nhận sheet', () => {
    expect(parseSheet('X', [['Name', 'Phone', 'Email', 'Position', 'PIC', 'R1_STT']]).info).toBeNull();
  });
  it('cột R1_CDD_FB thứ hai là R2_CDD_FB (như hệ cũ)', () => {
    const m = mapHeaderRow(['No.', 'R1_CDD_FB', 'R1_CDD_FB']);
    expect(m.map((c) => c.fieldKey)).toEqual(['candidate_code', 'r1_cdd_fb', 'r2_cdd_fb']);
  });
});

describe('transformMaster', () => {
  const row = (n: number, raw: Record<string, string>) => ({ sheet: 'Master', rowNumber: n, raw: { pic: 'TA1', position: 'Nhân viên Kho', ...raw } });
  const r = transformMaster([
    row(3, { candidate_code: 'TA1', full_name: 'Nguyễn A', phone: '0901234567' }),
    row(4, { candidate_code: 'TA1', full_name: 'Nguyễn A', phone: '0901234567', email: 'a@x.vn' }),  // cùng người: gộp ô trống
    row(5, { candidate_code: 'TA1', full_name: 'Trần B', phone: '0907777777' }),                     // E1
    row(6, { candidate_code: 'TA2', full_name: 'C', phone: '12' }),                                  // E5
    row(7, { candidate_code: '', full_name: 'D' }),                                                  // E9
    row(8, { candidate_code: 'TA3', full_name: 'E', phone: '0901234567', r1_status: 'Lạ' }),         // E3
    row(9, { candidate_code: 'TA4', full_name: 'F', phone: '0901234567', pic: 'KHONG' }),           // E8
    row(10, { candidate_code: 'TA5', full_name: 'G', phone: '0901234567' }),
  ], config);

  it('tổng = nạp + gộp + dòng có ngoại lệ', () => {
    const excRows = new Set(r.exceptions.map((x) => x.rowNumber)).size;
    expect(r.total).toBe(8);
    expect(r.records.length + r.merged.length + excRows).toBe(8);
    expect(r.records.map((x) => x.values.candidate_code)).toEqual(['TA1', 'TA5']);
  });
  it('gộp cùng người: bổ sung ô trống vào dòng đầu', () => {
    expect(r.merged).toEqual([{ sheet: 'Master', rowNumber: 4, candidate_code: 'TA1', into: 3 }]);
    expect(r.records[0].values.email).toBe('a@x.vn');
  });
  it('phân nhóm ngoại lệ E1, E3, E5, E8, E9', () => {
    const codes = Object.fromEntries(r.exceptions.map((x) => [x.rowNumber, x.code]));
    expect(codes).toMatchObject({ 5: 'E1', 6: 'E5', 7: 'E9', 8: 'E3', 9: 'E8' });
  });
  it('E6: cùng SĐT khác mã (chỉ trong dòng nạp được) – không phải lỗi', () => {
    expect(r.phoneGroups).toEqual([{ phone: '901234567', codes: ['TA1', 'TA5'] }]);
  });
  it('excCodeOf', () => {
    expect([excCodeOf('site'), excCodeOf('ob_date'), excCodeOf('attrition_sub_reason'), excCodeOf('position')]).toEqual(['E4', 'E7', 'E3', 'DM']);
  });
});

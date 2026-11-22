// M8-4: sổ duyệt ngoại lệ cho PO (scripts/migrate/exceptionReport.ts).
import { describe, expect, it } from 'vitest';
import { EXC_FIX, buildExceptionReport, excKey, prevKeysFromCsv } from '../../scripts/migrate/exceptionReport.ts';
import type { Exception, ParsedRow } from '../../scripts/migrate/masterEtl.ts';

const parsed: ParsedRow[] = [
  { sheet: 'Master', rowNumber: 5, raw: { candidate_code: 'TA10001', pic: 'TA1-Phat', phone: '12', r1_sub_status: 'Định hướng' } },
  { sheet: 'Master', rowNumber: 6, raw: { candidate_code: 'TA20001', pic: 'TA2-Hien', site: '=HYPERLINK("x")' } },
  { sheet: 'Master', rowNumber: 7, raw: { candidate_code: 'X1', pic: '' } },
];
const exc: Exception[] = [
  { sheet: 'Master', rowNumber: 6, candidate_code: 'TA20001', code: 'E4', field: 'site', message: 'Kho không thuộc tỉnh.' },
  { sheet: 'Master', rowNumber: 5, candidate_code: 'TA10001', code: 'E5', field: 'phone', message: 'SĐT sai.' },
  { sheet: 'Master', rowNumber: 5, candidate_code: 'TA10001', code: 'E3', field: 'r1_sub_status', message: 'Lý do không có trong rule.' },
  { sheet: 'Master', rowNumber: 7, candidate_code: 'X1', code: 'E8', field: 'pic', message: 'Thiếu PIC.' },
];
const meta = { file: 'Master.xlsx', source_sha256: 'abc', at: '2026-11-22T00:00:00Z', total: 10, loadable: 7, merged: 0 };

describe('buildExceptionReport', () => {
  const r = buildExceptionReport(exc, parsed, meta);
  const [summary, detail] = r.sheets.map((s) => s.rows);

  it('2 sheet; đếm dòng có ngoại lệ và số lỗi', () => {
    expect(r.sheets.map((s) => s.name)).toEqual(['Tổng hợp', 'Chi tiết']);
    expect(r.stats).toMatchObject({ rows: 3, issues: 4, fixed: null });
    expect(summary).toContainEqual(['Dòng có ngoại lệ (không nạp)', 3]);
  });
  it('chi tiết xếp theo PIC rồi dòng; kèm giá trị hiện tại, cột Excel, cách xử lý, cột PO trống', () => {
    expect(detail[0]).toEqual(['PIC', 'Sheet', 'Dòng', 'Mã ứng viên', 'Nhóm', 'Cột (Excel)', 'Giá trị hiện tại', 'Lỗi', 'Cách xử lý', 'PO quyết định', 'Ghi chú']);
    expect(detail.slice(1).map((d) => [d[0], d[2], d[4]])).toEqual([
      ['(chưa có PIC)', 7, 'E8'], ['TA1-Phat', 5, 'E5'], ['TA1-Phat', 5, 'E3'], ['TA2-Hien', 6, 'E4'],
    ]);
    const phone = detail.find((d) => d[4] === 'E5')!;
    expect(phone[5]).toBe('Phone');
    expect(phone[6]).toBe('12');
    expect(phone[8]).toBe(EXC_FIX.E5);
    expect(phone.slice(-2)).toEqual(['', '']);
  });
  it('chặn chèn công thức ở giá trị lấy từ file nguồn', () => {
    expect(detail.find((d) => d[4] === 'E4')![6]).toBe('\'=HYPERLINK("x")');
  });
  it('tổng hợp theo nhóm và theo PIC', () => {
    expect(summary.find((x) => x[0] === 'E3')).toEqual(['E3', expect.any(String), 1, 1, EXC_FIX.E3]);
    expect(summary.find((x) => x[0] === 'TA1-Phat')).toEqual(['TA1-Phat', 1, 2, 1, '', 1, '']);   // cột nhóm: E3, E4, E5, E8
  });
});

describe('so với lần chạy trước', () => {
  it('Mới / Còn từng lỗi, Đã sửa ở tổng hợp', () => {
    const prev = new Set([excKey(exc[0]), 'Master#99#phone#E5']);   // lỗi dòng 99 đã được sửa
    const r = buildExceptionReport(exc, parsed, meta, prev);
    expect(r.stats).toMatchObject({ isNew: 3, still: 1, fixed: 1 });
    const detail = r.sheets[1].rows;
    expect(detail[0]).toContain('So với lần trước');
    expect(detail.find((d) => d[4] === 'E4')![9]).toBe('Còn');
    expect(detail.find((d) => d[4] === 'E5')![9]).toBe('Mới');
    expect(r.sheets[0].rows).toContainEqual(['So với lần chạy trước', 'Mới 3 · Còn 1 · Đã sửa 1']);
  });
  it('đọc khóa từ master_exceptions.csv (BOM, ô có dấu phẩy/ngoặc kép)', () => {
    const csv = String.fromCharCode(0xfeff) + 'sheet,dong,ma_ung_vien,nhom,mo_ta_nhom,truong,loi\r\n'
      + 'Master,6,TA20001,E4,"Kho / tỉnh, vùng",site,"Lỗi ""x"", y"\r\n';
    expect([...prevKeysFromCsv(csv)]).toEqual(['Master#6#site#E4']);
    expect(() => prevKeysFromCsv('a,b\r\n')).toThrow();
  });
});

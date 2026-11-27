// Quy trình 1 (tạo mã ghế): kiểm rule trên dòng mẫu thật của sheet NhapLieu và các ca lỗi.
import { describe, expect, it } from 'vitest';
import {
  SEAT_EXPORT_HEADERS,
  SEAT_REGIONS,
  allocateSeatCodes,
  formatSheetDate,
  normText,
  parseSheetDate,
  toSeatExportRow,
  validateSeatRequest,
} from '../../shared/seatCodeRules.ts';

// Dòng 2 và 3 của NhapLieu (đã có mã), đúng giá trị trong sheet.
const SAMPLE_CHUOI = {
  ban: 'Chuỗi Cung Ứng',
  don_vi: 'Ambient – MCH Logistics',
  phong: 'Kho Ambient MCH',
  doi: 'Trung Tâm Phân Phối Hưng Yên',
  to_nhom: '',
  nhom_site: '',
  vung: 'Miền Bắc',
  nhom_chuc_danh: 'Rank 6',
  ranking_ap: '6A',
  ranking_offer: '6A',
  vi_tri_ap: 'Nhân viên Kiểm soát Dữ liệu Kho vận',
  vi_tri_offer_vi: 'Nhân viên Kiểm soát Dữ liệu Kho vận',
  vi_tri_offer_en: '',
  so_luong: '1',
  quan_ly_truc_tiep: 'Hoàng Tùng Lâm',
  note: '',
};

describe('validateSeatRequest – dòng mẫu thật', () => {
  it('chấp nhận dòng đầy đủ trong sheet, không lỗi, không cảnh báo', () => {
    const v = validateSeatRequest(SAMPLE_CHUOI);
    expect(v.errors).toEqual({});
    expect(v.warnings).toEqual([]);
  });

  it('cho phép để trống các trường không bắt buộc (Đơn vị, Offer, Tổ, Site)', () => {
    const v = validateSeatRequest({ ...SAMPLE_CHUOI, don_vi: '', doi: '', ranking_offer: '', vi_tri_offer_vi: '', vi_tri_offer_en: '' });
    expect(v.errors).toEqual({});
  });

  it('sheet có 1 dòng Rank 4 nhưng Ranking AP 3C: chỉ cảnh báo, không chặn', () => {
    const v = validateSeatRequest({ ...SAMPLE_CHUOI, nhom_chuc_danh: 'Rank 4', ranking_ap: '3C' });
    expect(v.errors).toEqual({});
    expect(v.warnings).toHaveLength(1);
  });

  it('Ranking Offer khác Ranking AP là hợp lệ (11 dòng mẫu)', () => {
    const v = validateSeatRequest({ ...SAMPLE_CHUOI, ranking_ap: '4B', ranking_offer: '4C', nhom_chuc_danh: 'Rank 4' });
    expect(v.errors).toEqual({});
    expect(v.warnings).toEqual([]);
  });
});

describe('validateSeatRequest – ca lỗi', () => {
  it('thiếu trường bắt buộc: Ban, Vùng, Rank, Ranking AP, Vị trí AP, Số lượng, Quản lý', () => {
    const v = validateSeatRequest({ ...SAMPLE_CHUOI, ban: ' ', vung: '', nhom_chuc_danh: '', ranking_ap: '', vi_tri_ap: '', so_luong: '', quan_ly_truc_tiep: '' });
    expect(Object.keys(v.errors).sort()).toEqual(['nhom_chuc_danh', 'quan_ly_truc_tiep', 'ranking_ap', 'so_luong', 'vi_tri_ap', 'vung', 'ban'].sort());
  });

  it('Số lượng phải là số nguyên từ 1 đến 100', () => {
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, so_luong: '0' }).errors.so_luong).toBeTruthy();
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, so_luong: '1.5' }).errors.so_luong).toBeTruthy();
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, so_luong: 'abc' }).errors.so_luong).toBeTruthy();
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, so_luong: '101' }).errors.so_luong).toBeTruthy();
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, so_luong: '41' }).errors.so_luong).toBeUndefined();
  });

  it('Rank ngoài 2–6 và Ranking sai dạng bị chặn', () => {
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, nhom_chuc_danh: 'Rank 7' }).errors.nhom_chuc_danh).toBeTruthy();
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, ranking_ap: '7A' }).errors.ranking_ap).toBeTruthy();
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, ranking_ap: '6D' }).errors.ranking_ap).toBeTruthy();
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, ranking_offer: 'X' }).errors.ranking_offer).toBeTruthy();
  });

  it('Vùng phải thuộc danh sách 3 miền', () => {
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, vung: 'Miền Tây' }).errors.vung).toBeTruthy();
  });
});

describe('chuẩn hoá Unicode', () => {
  it('"Miền Trung" ở hai dạng Unicode (NFC/NFD) đều thành một giá trị hợp lệ', () => {
    const nfd = 'Miền Trung'.normalize('NFD');
    expect(nfd).not.toBe('Miền Trung');
    expect(normText(nfd)).toBe('Miền Trung');
    expect(validateSeatRequest({ ...SAMPLE_CHUOI, vung: nfd }).errors.vung).toBeUndefined();
    expect((SEAT_REGIONS as readonly string[]).includes(normText(nfd))).toBe(true);
  });

  it('gộp khoảng trắng và viết hoa ranking', () => {
    const v = validateSeatRequest({ ...SAMPLE_CHUOI, ban: '  Chuỗi   Cung Ứng ', ranking_ap: ' 6a ' });
    expect(v.clean.ban).toBe('Chuỗi Cung Ứng');
    expect(v.clean.ranking_ap).toBe('6A');
    expect(v.errors.ranking_ap).toBeUndefined();
  });
});

describe('ngày gửi dd/mm/yyyy', () => {
  it('đổi qua lại đúng định dạng sheet', () => {
    expect(parseSheetDate('24/04/2026')).toBe('2026-04-24');
    expect(parseSheetDate('6/5/2026')).toBe('2026-05-06');
    expect(formatSheetDate('2026-04-24')).toBe('24/04/2026');
    expect(formatSheetDate(null)).toBe('');
  });

  it('từ chối ngày không tồn tại và sai dạng', () => {
    expect(parseSheetDate('31/02/2026')).toBeNull();
    expect(parseSheetDate('2026-04-24')).toBeNull();
    expect(parseSheetDate('')).toBeNull();
  });
});

describe('cấp mã ghế', () => {
  it('số liên tiếp tiếp sau mã gần nhất (mã mẫu 25597254–25597257 trong sheet)', () => {
    const r = allocateSeatCodes(25597257, 1);
    expect(r.codes).toEqual(['25597258']);
    expect(r.last).toBe(25597258);
  });

  it('một dòng nhiều ghế → nhiều mã liên tiếp, mỗi ghế một mã', () => {
    const r = allocateSeatCodes(25597257, 3);
    expect(r.codes).toEqual(['25597258', '25597259', '25597260']);
    expect(r.last).toBe(25597260);
    expect(r.codes.every((c) => /^\d{8}$/.test(c))).toBe(true);
  });

  it('không vượt dải 8 chữ số và không nhận số lượng ngoài 1–100', () => {
    expect(() => allocateSeatCodes(99_999_998, 2)).toThrow(RangeError);
    expect(() => allocateSeatCodes(25597257, 0)).toThrow(RangeError);
    expect(() => allocateSeatCodes(25597257, 101)).toThrow(RangeError);
  });
});

describe('xuất file', () => {
  it('mỗi dòng xuất có đúng số cột với tiêu đề, thứ tự cột như tab NhapLieu', () => {
    const row = toSeatExportRow({
      ...validateSeatRequest(SAMPLE_CHUOI).clean,
      ngay_gui: '2026-04-24',
      ma_ghe: ['25597256'],
      cost_center: '',
      status: 'da_cap_ma',
    });
    expect(row).toHaveLength(SEAT_EXPORT_HEADERS.length);
    expect(SEAT_EXPORT_HEADERS).toHaveLength(20);
    expect(row[0]).toBe('24/04/2026');
    expect(row[1]).toBe('25597256');
    expect(row[2]).toBe('Chuỗi Cung Ứng');
    expect(row[8]).toBe('Miền Bắc');
    expect(row[19]).toBe('Đã cấp mã');
  });

  it('dòng nhiều ghế xuất các mã cách nhau bằng dấu phẩy, dòng nháp để trống ngày và mã', () => {
    const row = toSeatExportRow({
      ...validateSeatRequest({ ...SAMPLE_CHUOI, so_luong: '2' }).clean,
      ngay_gui: null,
      ma_ghe: [],
      cost_center: '',
      status: 'nhap',
    });
    expect(row[0]).toBe('');
    expect(row[1]).toBe('');
    expect(row[15]).toBe('2');
    expect(row[19]).toBe('Nháp (TA)');
  });
});

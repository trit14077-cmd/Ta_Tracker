// M7-4: Edge records-import – phần thuần (logic.ts), hành vi như Api2.gs hImportChunk_ (kiểm lại từng dòng, không ghi đè).
import { describe, expect, it } from 'vitest';
import { MAX_CHUNK, importCreatedAt, parseImportRequest, prepareRows } from '../../supabase/functions/records-import/logic.ts';
import { seedConfig } from '../shared/seedConfig.ts';

const cfg = seedConfig({ pic: ['TA1-Phat', 'TA2-Hien'] });
const row = {
  candidate_code: 'TA10001', pic: 'TA1-Phat', full_name: 'Nguyen Moi', gender: 'Nữ', birth: '1999', phone: '0854 498 989',
  position: 'Nhân viên Kho', site: 'DC Bình Dương 1', region: 'Miền Nam', location: 'Bình Dương', unit: 'Chuỗi Cung ứng',
  dept: 'Ambient Retail', rank: '6A', sub_source: 'Zalo', created_at: '04/03/2025 08:15:00',
};

describe('parseImportRequest', () => {
  it('chunk ≤ 1.500 dòng (như hệ cũ); finish nhận số đếm', () => {
    expect(parseImportRequest({ op: 'chunk', rows: [row], meta: [{ sheet: 'T3', rowNumber: 2 }] }).ok).toBe(true);
    const big = parseImportRequest({ op: 'chunk', rows: Array.from({ length: MAX_CHUNK + 1 }, () => ({})) });
    expect(!big.ok && big.error.code).toBe('CHUNK_TOO_LARGE');
    expect(parseImportRequest({ op: 'chunk', rows: ['x'] }).ok).toBe(false);
    expect(parseImportRequest({ op: 'finish', batch_id: 7, fileName: 'a.xlsx', imported: '3', invalid: -2 })).toEqual({
      ok: true, req: { op: 'finish', batch_id: 7, file_name: 'a.xlsx', imported: 3, invalid: 0, duplicates: 0, rejected: 0 },
    });
    expect(parseImportRequest({ op: 'xoa' }).ok).toBe(false);
  });
});

describe('importCreatedAt', () => {
  it('dd/mm/yyyy [giờ] và yyyy-mm-dd -> ISO giờ VN; không đọc được -> null', () => {
    expect(importCreatedAt('04/03/2025 08:15:00')).toBe('2025-03-04T08:15:00+07:00');
    expect(importCreatedAt('4/3/2025')).toBe('2025-03-04T00:00:00+07:00');
    expect(importCreatedAt('2025-03-04 09:05')).toBe('2025-03-04T09:05:00+07:00');
    expect(importCreatedAt('31/13/2025')).toBeNull();
    expect(importCreatedAt('')).toBeNull();
    expect(importCreatedAt('hôm qua')).toBeNull();
  });
});

describe('prepareRows (= kiểm từng dòng của hImportChunk_)', () => {
  it('dòng hợp lệ -> giá trị DB (SĐT chuẩn hóa, source tính từ sub_source), giữ mã của file', () => {
    const r = prepareRows([row], [{ sheet: 'T3', rowNumber: 2 }], cfg);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    const a = r.accepted[0];
    expect(a.values.candidate_code).toBe('TA10001');
    expect(a.values.pic).toBe('TA1-Phat');
    expect(a.values.phone).toBe('854498989');
    expect(a.values.source).toBe('Social Media');
    expect(a.created_at).toBe('2025-03-04T08:15:00+07:00');
    expect([a.sheet, a.row_number]).toEqual(['T3', 2]);
  });
  it('trùng mã trong cùng lô -> dòng sau bị từ chối (không ghi đè)', () => {
    const r = prepareRows([row, { ...row, full_name: 'Khac' }], [], cfg);
    expect(r.accepted.map((x) => x.index)).toEqual([0]);
    expect(r.rejected[0]).toEqual({ index: 1, errors: { candidate_code: 'Mã ứng viên "TA10001" đã tồn tại (không ghi đè).' } });
  });
  it('thiếu mã / PIC lạ -> từ chối có lỗi theo trường', () => {
    const r = prepareRows([{ ...row, candidate_code: '' }, { ...row, candidate_code: 'X2', pic: 'KHONG-CO' }], [], cfg);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0].errors.candidate_code).toBeTruthy();
    expect(r.rejected[1].errors.pic).toBeTruthy();
  });
  it('không có PIC -> vẫn nhận (chỉ Admin thấy), pic = null', () => {
    const r = prepareRows([{ ...row, pic: '' }], [], cfg);
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0].values.pic).toBeNull();
  });
});

describe('rollback theo lô (0028) – parseImportRequest', () => {
  it('batches: limit mặc định 50, tối đa 200', () => {
    expect(parseImportRequest({ op: 'batches' })).toEqual({ ok: true, req: { op: 'batches', limit: 50 } });
    expect(parseImportRequest({ op: 'batches', limit: 9999 })).toEqual({ ok: true, req: { op: 'batches', limit: 200 } });
  });
  it('rollback mặc định CHẠY THỬ; chỉ dry_run === false mới xóa thật', () => {
    expect(parseImportRequest({ op: 'rollback', batch_id: 4 })).toEqual({ ok: true, req: { op: 'rollback', batch_id: 4, dry_run: true } });
    expect(parseImportRequest({ op: 'rollback', batch_id: 4, dry_run: 'false' })).toEqual({ ok: true, req: { op: 'rollback', batch_id: 4, dry_run: true } });
    expect(parseImportRequest({ op: 'rollback', batch_id: 4, dry_run: 0 })).toEqual({ ok: true, req: { op: 'rollback', batch_id: 4, dry_run: true } });
    expect(parseImportRequest({ op: 'rollback', batch_id: 4, dry_run: false })).toEqual({ ok: true, req: { op: 'rollback', batch_id: 4, dry_run: false } });
  });
  it('rollback thiếu / sai mã lô -> 422', () => {
    for (const b of [{}, { batch_id: 0 }, { batch_id: 'abc' }, { batch_id: null }]) {
      const r = parseImportRequest({ op: 'rollback', dry_run: false, ...b });
      expect(!r.ok && r.error.status).toBe(422);
    }
  });
});

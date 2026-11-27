// Quy trình 1 – dropdown phụ thuộc Ban → Đơn vị → Phòng → Đội → Tổ (shared/seatOrgTree.ts; bản SQL: app.seat_org_error, 0041).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SEAT_ORG_MSG_HOLE, SEAT_ORG_MSG_INVALID, parseSeatOrgDbError, seatOrgError, seatOrgOptions, seatOrgSet, type SeatOrgPath,
} from '../../shared/seatOrgTree.ts';

const P = (ban: string, don_vi = '', phong = '', doi = '', to_nhom = ''): SeatOrgPath => ({ ban, don_vi, phong, doi, to_nhom });
const paths = [
  P('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Inbound'),
  P('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Pick Pack'),
  P('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Inbound'),
  P('Chuỗi Cung Ứng', 'Cool Chain Logistics', 'Kho Cool Chain'),
  P('Phát triển Nguồn Nhân lực', 'C&B'),
  P('Phát triển Nguồn Nhân lực', 'Tuyển dụng'),
  P('Pháp chế', 'Pháp chế The Supra'),
];

describe('seatOrgOptions', () => {
  it('cấp 1 = mọi Ban, sắp xếp tiếng Việt', () => {
    expect(seatOrgOptions(paths, 'ban', {})).toEqual(['Chuỗi Cung Ứng', 'Pháp chế', 'Phát triển Nguồn Nhân lực']);
  });
  it('cấp sau lọc theo các cấp trên', () => {
    expect(seatOrgOptions(paths, 'don_vi', { ban: 'Phát triển Nguồn Nhân lực' })).toEqual(['C&B', 'Tuyển dụng']);
    expect(seatOrgOptions(paths, 'doi', { ban: 'Chuỗi Cung Ứng', don_vi: 'Ambient Logistics', phong: 'Kho Ambient' }))
      .toEqual(['Kho Bắc Ninh', 'Kho Cần Thơ']);
    expect(seatOrgOptions(paths, 'to_nhom', { ban: 'Chuỗi Cung Ứng', don_vi: 'Ambient Logistics', phong: 'Kho Ambient', doi: 'Kho Cần Thơ' }))
      .toEqual(['Inbound']);
  });
  it('cấp trên còn trống hoặc nhánh dừng -> không có lựa chọn', () => {
    expect(seatOrgOptions(paths, 'phong', { ban: 'Chuỗi Cung Ứng' })).toEqual([]);
    expect(seatOrgOptions(paths, 'doi', { ban: 'Chuỗi Cung Ứng', don_vi: 'Cool Chain Logistics', phong: 'Kho Cool Chain' })).toEqual([]);
  });
  it('chuẩn hóa khoảng trắng / NFD', () => {
    expect(seatOrgOptions(paths, 'don_vi', { ban: '  Pháp  chế '.normalize('NFD') })).toEqual(['Pháp chế The Supra']);
  });
});

describe('seatOrgError', () => {
  it('nhánh đầy đủ hoặc dừng giữa: hợp lệ', () => {
    expect(seatOrgError(paths, P('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Pick Pack'))).toBeNull();
    expect(seatOrgError(paths, P('Chuỗi Cung Ứng', 'Ambient Logistics'))).toBeNull();
    expect(seatOrgError(paths, P('Pháp chế'))).toBeNull();
  });
  it('sai nhánh: báo đúng cấp đầu tiên sai', () => {
    expect(seatOrgError(paths, P('Ban lạ'))).toEqual({ key: 'ban', msg: SEAT_ORG_MSG_INVALID });
    expect(seatOrgError(paths, P('Chuỗi Cung Ứng', 'C&B'))).toEqual({ key: 'don_vi', msg: SEAT_ORG_MSG_INVALID });
    expect(seatOrgError(paths, P('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Pick Pack')))
      .toEqual({ key: 'to_nhom', msg: SEAT_ORG_MSG_INVALID });
  });
  it('bỏ trống cấp giữa (như dòng lỗi duy nhất trong sheet)', () => {
    expect(seatOrgError(paths, P('Chuỗi Cung Ứng', '', '', 'Kho Bắc Ninh'))).toEqual({ key: 'don_vi', msg: SEAT_ORG_MSG_HOLE });
    expect(seatOrgError(paths, P('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', '', 'Inbound'))).toEqual({ key: 'doi', msg: SEAT_ORG_MSG_HOLE });
  });
  it('Ban trống: để quy tắc bắt buộc báo', () => {
    expect(seatOrgError(paths, P(''))).toBeNull();
  });
});

describe('seatOrgSet / parseSeatOrgDbError', () => {
  it('đổi cấp trên xóa các cấp dưới, giữ trường khác', () => {
    const v = { ...P('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Inbound'), vung: 'Miền Bắc' };
    expect(seatOrgSet(v, 'don_vi', 'Cool Chain Logistics')).toEqual({ ...P('Chuỗi Cung Ứng', 'Cool Chain Logistics'), vung: 'Miền Bắc' });
  });
  it('mã lỗi DB -> cấp + câu báo', () => {
    expect(parseSeatOrgDbError('SEAT_ORG_INVALID:doi')).toEqual({ key: 'doi', msg: SEAT_ORG_MSG_INVALID });
    expect(parseSeatOrgDbError('x SEAT_ORG_HOLE:phong y')).toEqual({ key: 'phong', msg: SEAT_ORG_MSG_HOLE });
    expect(parseSeatOrgDbError('SEAT_ORG_INVALID:abc')).toBeNull();
    expect(parseSeatOrgDbError('khác')).toBeNull();
  });
});

describe('khớp với migration 0041', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/0041_seat_org_tree.sql', import.meta.url)), 'utf8');
  it('mọi mã lỗi SQL đều hiểu được ở TS', () => {
    const codes = [...sql.matchAll(/'(SEAT_ORG_(?:INVALID|HOLE):[a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBe(8);
    for (const c of codes) expect(parseSeatOrgDbError(c)).not.toBeNull();
  });
  it('dữ liệu nạp sẵn: 107 nhánh, không lỗ hổng, không trùng', () => {
    const rows = [...sql.matchAll(/^ {2}\(('(?:[^']|'')*'(?:, '(?:[^']|'')*'){4})\),?$/gm)]
      .map((m) => [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")));
    expect(rows.length).toBe(107);
    const all = rows.map((r) => P(r[0], r[1], r[2], r[3], r[4]));
    expect(new Set(rows.map((r) => r.join('|'))).size).toBe(107);
    for (const p of all) expect(seatOrgError(all, p)).toBeNull();
  });
});

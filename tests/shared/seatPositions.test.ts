// Quy trình 1 – Vị trí theo AP → Ranking (shared/seatPositions.ts; bản SQL: app.seat_position_error, 0043).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SEAT_POS_MSG_RANKING, SEAT_POS_MSG_UNKNOWN, parseSeatPositionDbError, seatPositionError, seatPositionOptions,
  seatRankGroup, seatRankingOptions, type SeatPositionPair,
} from '../../shared/seatPositions.ts';

const pairs: SeatPositionPair[] = [
  { vi_tri: 'Nhân viên Lái xe nâng', ranking: '6B' },
  { vi_tri: 'Nhân viên Lái xe nâng', ranking: '6A' },
  { vi_tri: 'Trưởng kho', ranking: '4A' },
  { vi_tri: 'Chuyên viên Tuyển dụng', ranking: '5B' },
];

describe('seatPositions', () => {
  it('danh sách vị trí và ranking theo vị trí', () => {
    expect(seatPositionOptions(pairs)).toEqual(['Chuyên viên Tuyển dụng', 'Nhân viên Lái xe nâng', 'Trưởng kho']);
    expect(seatRankingOptions(pairs, ' Nhân viên  Lái xe nâng ')).toEqual(['6A', '6B']);
    expect(seatRankingOptions(pairs, 'Không có')).toEqual([]);
    expect(seatRankingOptions(pairs, '')).toEqual([]);
  });
  it('lỗi giống app.seat_position_error', () => {
    expect(seatPositionError(pairs, { vi_tri_ap: 'Trưởng kho', ranking_ap: '4a' })).toBeNull();
    expect(seatPositionError(pairs, { vi_tri_ap: 'Trưởng kho', ranking_ap: '' })).toBeNull();
    expect(seatPositionError(pairs, { vi_tri_ap: 'Trưởng kho', ranking_ap: '4C' })).toEqual({ key: 'ranking_ap', msg: SEAT_POS_MSG_RANKING });
    expect(seatPositionError(pairs, { vi_tri_ap: 'Vị trí lạ', ranking_ap: '4A' })).toEqual({ key: 'vi_tri_ap', msg: SEAT_POS_MSG_UNKNOWN });
    expect(seatPositionError(pairs, { vi_tri_ap: '' })).toBeNull();
  });
  it('mã lỗi DB và nhóm chức danh', () => {
    expect(parseSeatPositionDbError('SEAT_POS_UNKNOWN')?.key).toBe('vi_tri_ap');
    expect(parseSeatPositionDbError('x SEAT_POS_RANKING')?.key).toBe('ranking_ap');
    expect(parseSeatPositionDbError('SEAT_ORG_HOLE:doi')).toBeNull();
    expect(seatRankGroup('6b')).toBe('Rank 6');
    expect(seatRankGroup('7A')).toBe('');
  });
});

describe('khớp với migration 0043', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/0043_seat_positions.sql', import.meta.url)), 'utf8');
  it('dữ liệu nạp sẵn: 64 cặp, 56 vị trí, ranking 2A–6C, không trùng (kể cả khác hoa/thường)', () => {
    const seed = [...sql.matchAll(/^ {2}\('((?:[^']|'')+)', '([^']+)'\)[,;]?$/gm)].map((m) => ({ vi_tri: m[1].replace(/''/g, "'"), ranking: m[2] }));
    expect(seed.length).toBe(64);
    expect(seed.every((p) => /^[2-6][ABC]$/.test(p.ranking))).toBe(true);
    expect(new Set(seed.map((p) => `${p.vi_tri}|${p.ranking}`)).size).toBe(64);
    const names = seatPositionOptions(seed);
    expect(names.length).toBe(56);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(56);
  });
  it('mọi mã lỗi SQL đều hiểu được ở TS', () => {
    const codes = [...sql.matchAll(/'(SEAT_POS_[A-Z]+)'/g)].map((m) => m[1]);
    expect(new Set(codes)).toEqual(new Set(['SEAT_POS_UNKNOWN', 'SEAT_POS_RANKING']));
    for (const c of codes) expect(parseSeatPositionDbError(c)).not.toBeNull();
  });
});

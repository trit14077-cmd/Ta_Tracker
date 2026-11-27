/**
 * Quy trình 1 – mã ghế: Vị trí theo AP (JOB) → các Ranking theo AP hợp lệ (bảng seat_positions, migration 0043).
 * Mỗi dòng = 1 cặp (vị trí, ranking); 1 vị trí có thể có nhiều ranking. Nạp sẵn từ 166 dòng NhapLieu.
 * Quy tắc (bản TS của app.seat_position_error – phải giữ giống SQL):
 *  - Vị trí phải có trong danh mục đang dùng (khóa cứng; vị trí mới thì admin thêm).
 *  - Ranking AP phải là 1 trong các ranking của vị trí đó.
 */
export interface SeatPositionPair {
  vi_tri: string;
  ranking: string;
}

const norm = (v: unknown) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

export const SEAT_POS_MSG_UNKNOWN = 'Vị trí không có trong danh mục. Nhờ admin thêm vị trí mới.';
export const SEAT_POS_MSG_RANKING = 'Ranking không thuộc vị trí đã chọn.';

/** Các vị trí đang dùng (không trùng, sắp xếp tiếng Việt). */
export function seatPositionOptions(pairs: readonly SeatPositionPair[]): string[] {
  return [...new Set(pairs.map((p) => norm(p.vi_tri)))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'vi'));
}

/** Ranking hợp lệ của 1 vị trí (2A < 2B < … < 6C). Rỗng nếu vị trí không có trong danh mục. */
export function seatRankingOptions(pairs: readonly SeatPositionPair[], viTri: unknown): string[] {
  const v = norm(viTri);
  if (!v) return [];
  return [...new Set(pairs.filter((p) => norm(p.vi_tri) === v).map((p) => norm(p.ranking).toUpperCase()))].sort();
}

/** Lỗi đầu tiên (giống app.seat_position_error). Vị trí trống do quy tắc bắt buộc báo riêng. */
export function seatPositionError(
  pairs: readonly SeatPositionPair[],
  values: { vi_tri_ap?: unknown; ranking_ap?: unknown },
): { key: 'vi_tri_ap' | 'ranking_ap'; msg: string } | null {
  const v = norm(values.vi_tri_ap);
  if (!v) return null;
  const ranks = seatRankingOptions(pairs, v);
  if (!ranks.length) return { key: 'vi_tri_ap', msg: SEAT_POS_MSG_UNKNOWN };
  const r = norm(values.ranking_ap).toUpperCase();
  if (r && !ranks.includes(r)) return { key: 'ranking_ap', msg: SEAT_POS_MSG_RANKING };
  return null;
}

/** Mã lỗi DB ('SEAT_POS_UNKNOWN', 'SEAT_POS_RANKING') → ô + câu báo. */
export function parseSeatPositionDbError(message: string): { key: 'vi_tri_ap' | 'ranking_ap'; msg: string } | null {
  if (message.includes('SEAT_POS_UNKNOWN')) return { key: 'vi_tri_ap', msg: SEAT_POS_MSG_UNKNOWN };
  if (message.includes('SEAT_POS_RANKING')) return { key: 'ranking_ap', msg: SEAT_POS_MSG_RANKING };
  return null;
}

/** Nhóm chức danh suy từ chữ số của Ranking (6B → "Rank 6"), như sheet (165/166 dòng khớp). */
export function seatRankGroup(ranking: unknown): string {
  const m = /^([2-6])[ABC]$/.exec(norm(ranking).toUpperCase());
  return m ? `Rank ${m[1]}` : '';
}

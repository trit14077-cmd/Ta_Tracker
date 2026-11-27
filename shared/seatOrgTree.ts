/**
 * Quy trình 1 – mã ghế: dropdown phụ thuộc Ban → Đơn vị → Phòng → Đội → Tổ (như sheet: tab RawData + NhapLieu).
 * Danh mục nằm ở bảng seat_org_paths (migration 0041); mỗi dòng = 1 nhánh, cấp sau '' khi nhánh dừng.
 * Quy tắc (bản TS của app.seat_org_error – phải giữ giống SQL):
 *  - 5 cột phải là tiền tố của một nhánh đang dùng: được dừng ở giữa, không được bỏ trống cấp giữa rồi điền cấp sau.
 */
export const SEAT_ORG_LEVELS = ['ban', 'don_vi', 'phong', 'doi', 'to_nhom'] as const;
export type SeatOrgLevel = (typeof SEAT_ORG_LEVELS)[number];
export type SeatOrgPath = Record<SeatOrgLevel, string>;
export type SeatOrgValues = Partial<Record<SeatOrgLevel, unknown>>;

const norm = (v: unknown) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

export const SEAT_ORG_LABEL: Record<SeatOrgLevel, string> = {
  ban: 'Ban/ Chuỗi/ Khối',
  don_vi: 'Các đơn vị thành viên',
  phong: 'Phòng/ Bộ Phận/ Nhóm',
  doi: 'Đội',
  to_nhom: 'Tổ',
};

export const SEAT_ORG_MSG_INVALID = 'Không có trong danh mục của cấp trên đã chọn.';
export const SEAT_ORG_MSG_HOLE = 'Chọn cấp này trước khi chọn các cấp sau.';

const matches = (p: SeatOrgPath, v: SeatOrgPath, upto: number) => SEAT_ORG_LEVELS.slice(0, upto).every((k) => p[k] === v[k]);

function clean(values: SeatOrgValues): SeatOrgPath {
  return Object.fromEntries(SEAT_ORG_LEVELS.map((k) => [k, norm(values[k])])) as SeatOrgPath;
}

/** Giá trị chọn được ở cấp `level`, theo các cấp trên đã chọn. Rỗng nếu cấp trên còn trống hoặc nhánh dừng. */
export function seatOrgOptions(paths: readonly SeatOrgPath[], level: SeatOrgLevel, values: SeatOrgValues): string[] {
  const i = SEAT_ORG_LEVELS.indexOf(level);
  const v = clean(values);
  if (SEAT_ORG_LEVELS.slice(0, i).some((k) => !v[k])) return [];
  const out = new Set<string>();
  for (const p of paths) if (matches(p, v, i) && p[level]) out.add(p[level]);
  return [...out].sort((a, b) => a.localeCompare(b, 'vi'));
}

/** Lỗi đầu tiên (cấp + câu báo), giống app.seat_org_error. null = hợp lệ. Ban trống do quy tắc bắt buộc báo riêng. */
export function seatOrgError(paths: readonly SeatOrgPath[], values: SeatOrgValues): { key: SeatOrgLevel; msg: string } | null {
  const v = clean(values);
  for (let i = 1; i < SEAT_ORG_LEVELS.length - 1; i++) {
    const k = SEAT_ORG_LEVELS[i];
    if (!v[k] && SEAT_ORG_LEVELS.slice(i + 1).some((x) => v[x])) return { key: k, msg: SEAT_ORG_MSG_HOLE };
  }
  if (!v.ban) return null;
  for (let i = 0; i < SEAT_ORG_LEVELS.length; i++) {
    const k = SEAT_ORG_LEVELS[i];
    if (!v[k]) break;
    if (!paths.some((p) => matches(p, v, i + 1))) return { key: k, msg: SEAT_ORG_MSG_INVALID };
  }
  return null;
}

/** Mã lỗi DB ('SEAT_ORG_INVALID:doi', 'SEAT_ORG_HOLE:phong') → cấp + câu báo. */
export function parseSeatOrgDbError(message: string): { key: SeatOrgLevel; msg: string } | null {
  const m = /SEAT_ORG_(INVALID|HOLE):([a-z_]+)/.exec(message);
  if (!m || !(SEAT_ORG_LEVELS as readonly string[]).includes(m[2])) return null;
  return { key: m[2] as SeatOrgLevel, msg: m[1] === 'HOLE' ? SEAT_ORG_MSG_HOLE : SEAT_ORG_MSG_INVALID };
}

/** Đổi 1 cấp → xóa các cấp dưới (giá trị cũ không còn thuộc nhánh mới). */
export function seatOrgSet<T extends SeatOrgValues>(values: T, level: SeatOrgLevel, value: string): T {
  const i = SEAT_ORG_LEVELS.indexOf(level);
  const next = { ...values, [level]: value };
  for (const k of SEAT_ORG_LEVELS.slice(i + 1)) (next as Record<string, unknown>)[k] = '';
  return next;
}

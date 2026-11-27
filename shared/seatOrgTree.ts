/**
 * Quy trình 1 – mã ghế: dropdown phụ thuộc Ban → Đơn vị → Phòng → Đội → Tổ (như sheet: tab RawData + NhapLieu).
 * Danh mục nằm ở bảng seat_org_paths (migration 0041); mỗi dòng = 1 nhánh, cấp sau '' khi nhánh dừng.
 * Quy tắc (bản TS của app.seat_org_error – phải giữ giống SQL):
 *  - 5 cột phải là tiền tố của một nhánh đang dùng: được dừng ở giữa, không được bỏ trống cấp giữa rồi điền cấp sau.
 */
export const SEAT_ORG_LEVELS = ['ban', 'don_vi', 'phong', 'doi', 'to_nhom'] as const;
export type SeatOrgLevel = (typeof SEAT_ORG_LEVELS)[number];
/** vung (0042): Phòng/Vùng/Miền của nhánh; '' = không khóa vùng. */
export type SeatOrgPath = Record<SeatOrgLevel, string> & { vung?: string };
export type SeatOrgValues = Partial<Record<SeatOrgLevel | 'vung', unknown>>;
export const SEAT_ORG_REGIONS = ['Miền Bắc', 'Miền Nam', 'Miền Trung'] as const;

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
export const SEAT_ORG_MSG_BAN_REQUIRED = 'Bắt buộc nhập Ban.';
export const SEAT_ORG_MSG_DUP = 'Nhánh này đã có trong danh mục.';
export const SEAT_VUNG_MSG_LOCKED = 'Vùng phải đúng theo Đội đã chọn.';
export const SEAT_VUNG_MSG_INVALID = 'Vùng chỉ được là Miền Bắc, Miền Nam, Miền Trung hoặc để trống.';

const matches = (p: SeatOrgPath, v: SeatOrgPath, upto: number) => SEAT_ORG_LEVELS.slice(0, upto).every((k) => p[k] === v[k]);

/** Chuẩn hóa 5 cột (NFC, gộp khoảng trắng, bỏ đầu cuối). Admin lưu nhánh đã chuẩn hóa để khớp giá trị TA chọn. */
export function seatOrgClean(values: SeatOrgValues): SeatOrgPath {
  return Object.fromEntries(SEAT_ORG_LEVELS.map((k) => [k, norm(values[k])])) as SeatOrgPath;
}
const clean = seatOrgClean;

/** Cấp giữa bị bỏ trống trong khi cấp sau có giá trị (giống CHECK seat_org_paths_no_hole). */
function holeError(v: SeatOrgPath): { key: SeatOrgLevel; msg: string } | null {
  for (let i = 1; i < SEAT_ORG_LEVELS.length - 1; i++) {
    const k = SEAT_ORG_LEVELS[i];
    if (!v[k] && SEAT_ORG_LEVELS.slice(i + 1).some((x) => v[x])) return { key: k, msg: SEAT_ORG_MSG_HOLE };
  }
  return null;
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
  const hole = holeError(v);
  if (hole) return hole;
  if (!v.ban) return null;
  for (let i = 0; i < SEAT_ORG_LEVELS.length; i++) {
    const k = SEAT_ORG_LEVELS[i];
    if (!v[k]) break;
    if (!paths.some((p) => matches(p, v, i + 1))) return { key: k, msg: SEAT_ORG_MSG_INVALID };
  }
  return null;
}

/**
 * Vùng bắt buộc theo phần tổ chức đã chọn (bản TS của app.seat_vung_required, 0042): các nhánh đang dùng khớp tiền tố
 * mà cùng 1 vùng khác rỗng -> vùng đó. null = chọn tự do (khối văn phòng, nhánh chưa điền vùng, Đội ở nhiều vùng).
 */
export function seatVungRequired(paths: readonly SeatOrgPath[], values: SeatOrgValues): string | null {
  const v = clean(values);
  if (!v.ban) return null;
  const hit = paths.filter((p) => SEAT_ORG_LEVELS.every((k) => !v[k] || p[k] === v[k]));
  const regions = new Set(hit.map((p) => norm(p.vung)));
  return hit.length && regions.size === 1 && !regions.has('') ? [...regions][0] : null;
}

/** Vùng khác vùng bắt buộc (giống app.seat_vung_error). */
export function seatVungError(paths: readonly SeatOrgPath[], values: SeatOrgValues): { key: 'vung'; msg: string } | null {
  const r = seatVungRequired(paths, values);
  return r && norm(values.vung) !== r ? { key: 'vung', msg: SEAT_VUNG_MSG_LOCKED } : null;
}

/** Mã lỗi DB 'SEAT_VUNG_LOCKED' → câu báo ở ô Vùng. */
export function parseSeatVungDbError(message: string): { key: 'vung'; msg: string } | null {
  return message.includes('SEAT_VUNG_LOCKED') ? { key: 'vung', msg: SEAT_VUNG_MSG_LOCKED } : null;
}

/** Mã lỗi DB ('SEAT_ORG_INVALID:doi', 'SEAT_ORG_HOLE:phong') → cấp + câu báo. */
export function parseSeatOrgDbError(message: string): { key: SeatOrgLevel; msg: string } | null {
  const m = /SEAT_ORG_(INVALID|HOLE):([a-z_]+)/.exec(message);
  if (!m || !(SEAT_ORG_LEVELS as readonly string[]).includes(m[2])) return null;
  return { key: m[2] as SeatOrgLevel, msg: m[1] === 'HOLE' ? SEAT_ORG_MSG_HOLE : SEAT_ORG_MSG_INVALID };
}

/**
 * Kiểm 1 nhánh của danh mục trước khi admin thêm/sửa (DB kiểm lại: CHECK ban, seat_org_paths_no_hole, UNIQUE).
 * existing: các nhánh đang có (cả nhánh đã tắt, vì UNIQUE tính cả chúng); selfId: id của nhánh đang sửa.
 */
export function seatOrgPathError(
  values: SeatOrgValues,
  existing: readonly (SeatOrgPath & { id?: number })[] = [],
  selfId?: number | null,
): { key: SeatOrgLevel | 'vung'; msg: string } | null {
  const v = clean(values);
  if (!v.ban) return { key: 'ban', msg: SEAT_ORG_MSG_BAN_REQUIRED };
  const hole = holeError(v);
  if (hole) return hole;
  const vung = norm(values.vung);
  if (vung && !(SEAT_ORG_REGIONS as readonly string[]).includes(vung)) return { key: 'vung', msg: SEAT_VUNG_MSG_INVALID };
  const dup = existing.some((p) => p.id !== selfId && SEAT_ORG_LEVELS.every((k) => norm(p[k]) === v[k]));
  if (dup) return { key: [...SEAT_ORG_LEVELS].reverse().find((k) => v[k]) ?? 'ban', msg: SEAT_ORG_MSG_DUP };
  return null;
}

/**
 * Đổi tên giá trị ở cấp `level` của nhánh `from` thành `to`, áp cho mọi nhánh cùng tiền tố đến cấp đó.
 * Trả về số nhánh bị đổi và số nhánh sẽ trùng với nhánh có sẵn (DB chặn bằng UNIQUE, cả lệnh không chạy).
 */
export function seatOrgRenamePlan(
  paths: readonly SeatOrgPath[],
  level: SeatOrgLevel,
  from: SeatOrgValues,
  to: string,
): { changed: number; conflicts: number } {
  const i = SEAT_ORG_LEVELS.indexOf(level);
  const f = clean(from);
  const t = norm(to);
  const key = (p: SeatOrgPath) => SEAT_ORG_LEVELS.map((k) => norm(p[k])).join('\u0001');
  const hit = paths.filter((p) => matches(clean(p), f, i + 1));
  const rest = new Set(paths.filter((p) => !hit.includes(p)).map(key));
  const conflicts = hit.filter((p) => rest.has(key({ ...p, [level]: t }))).length;
  return { changed: hit.length, conflicts };
}

/** Đổi 1 cấp → xóa các cấp dưới (giá trị cũ không còn thuộc nhánh mới). */
export function seatOrgSet<T extends SeatOrgValues>(values: T, level: SeatOrgLevel, value: string): T {
  const i = SEAT_ORG_LEVELS.indexOf(level);
  const next = { ...values, [level]: value };
  for (const k of SEAT_ORG_LEVELS.slice(i + 1)) (next as Record<string, unknown>)[k] = '';
  return next;
}

// Quy trình 1 – tạo mã ghế (TA nhập → gửi HRBP → HRBP xác nhận → HRSS cấp mã).
// Quy tắc suy ra từ sheet "Copy of Request_Job Requisition": tab NhapLieu (166 dòng, 24/04/2026 → 11/2026),
// tab RawData (dòng 1 ghi bên nhập từng cột). Chi tiết và câu hỏi còn mở: docs/SEAT_CODE_RULES.md.
// File mới, không chép từ OLD. Dùng chung cho frontend và test; DB (migration 0038) kiểm lại cùng quy tắc.

export const SEAT_STATUSES = ['nhap', 'gui', 'xac_nhan', 'da_cap_ma'] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const SEAT_STATUS_LABEL: Record<SeatStatus, string> = {
  nhap: 'Nháp (TA)',
  gui: 'Đã gửi HRBP',
  xac_nhan: 'HRBP xác nhận',
  da_cap_ma: 'Đã cấp mã',
};

/** Vùng/Miền: 3 giá trị trong sheet. Chuỗi phải ở dạng NFC (sheet có "Miền Trung" tách hai dạng Unicode). */
export const SEAT_REGIONS = ['Miền Bắc', 'Miền Nam', 'Miền Trung'] as const;
/** Nhóm chức danh: "Rank 2" … "Rank 6" (sheet không có Rank 1, 7). */
export const SEAT_RANKS = ['Rank 2', 'Rank 3', 'Rank 4', 'Rank 5', 'Rank 6'] as const;
/** Ranking: một chữ số (2–6) + một chữ cái A/B/C, ví dụ 6A, 4C. */
export const SEAT_RANKING_CODES = ['2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C', '5A', '5B', '5C', '6A', '6B', '6C'] as const;

/** Số ghế tối đa một dòng. Sheet có dòng 41 ghế, nên không đặt ngưỡng thấp hơn. */
export const SEAT_MAX_QTY = 100;
/** Mã ghế: đúng 8 chữ số. */
export const SEAT_CODE_RE = /^\d{8}$/;
const RANK_RE = /^Rank [2-6]$/;
const RANKING_RE = /^[2-6][A-C]$/;

/** Các trường TA nhập. Không gồm Mã ghế (HRSS cấp), Cost center (HRBP), trạng thái. */
export interface SeatInput {
  ban: string;
  don_vi: string;
  phong: string;
  doi: string;
  to_nhom: string;
  nhom_site: string;
  vung: string;
  nhom_chuc_danh: string;
  ranking_ap: string;
  ranking_offer: string;
  vi_tri_ap: string;
  vi_tri_offer_vi: string;
  vi_tri_offer_en: string;
  so_luong: string | number;
  quan_ly_truc_tiep: string;
  note: string;
}

export type SeatInputKey = keyof SeatInput;

/** Trường bắt buộc: đủ 100% trong 166 dòng mẫu. Ngày gửi không nhập tay: hệ thống ghi khi TA gửi HRBP. */
export const SEAT_REQUIRED: readonly SeatInputKey[] = ['ban', 'vung', 'nhom_chuc_danh', 'ranking_ap', 'vi_tri_ap', 'so_luong', 'quan_ly_truc_tiep'];

/** Chuẩn hoá chuỗi: NFC, bỏ khoảng trắng thừa. */
export function normText(v: unknown): string {
  return String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Ngày sheet dd/mm/yyyy → yyyy-mm-dd. Trả null nếu sai định dạng hoặc không tồn tại (ví dụ 31/02). */
export function parseSheetDate(s: unknown): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normText(s));
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** yyyy-mm-dd → dd/mm/yyyy (định dạng sheet). Chuỗi rỗng nếu không hợp lệ. */
export function formatSheetDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export interface SeatValidation {
  /** Giá trị đã chuẩn hoá, sẵn sàng ghi DB. */
  clean: SeatInput;
  /** Lỗi chặn gửi, theo tên trường. Rỗng = hợp lệ. */
  errors: Partial<Record<SeatInputKey, string>>;
  /** Cảnh báo không chặn: người nhập xem lại. */
  warnings: string[];
}

export function validateSeatRequest(raw: Partial<Record<SeatInputKey, unknown>>): SeatValidation {
  const clean = {
    ban: normText(raw.ban),
    don_vi: normText(raw.don_vi),
    phong: normText(raw.phong),
    doi: normText(raw.doi),
    to_nhom: normText(raw.to_nhom),
    nhom_site: normText(raw.nhom_site),
    vung: normText(raw.vung),
    nhom_chuc_danh: normText(raw.nhom_chuc_danh),
    ranking_ap: normText(raw.ranking_ap).toUpperCase(),
    ranking_offer: normText(raw.ranking_offer).toUpperCase(),
    vi_tri_ap: normText(raw.vi_tri_ap),
    vi_tri_offer_vi: normText(raw.vi_tri_offer_vi),
    vi_tri_offer_en: normText(raw.vi_tri_offer_en),
    so_luong: normText(raw.so_luong),
    quan_ly_truc_tiep: normText(raw.quan_ly_truc_tiep),
    note: normText(raw.note),
  } as SeatInput;
  const errors: SeatValidation['errors'] = {};
  const warnings: string[] = [];

  for (const k of SEAT_REQUIRED) {
    if (!String(clean[k]).trim()) errors[k] = 'Bắt buộc nhập.';
  }
  if (clean.vung && !(SEAT_REGIONS as readonly string[]).includes(clean.vung)) errors.vung = 'Chọn Miền Bắc, Miền Nam hoặc Miền Trung.';
  if (clean.nhom_chuc_danh && !RANK_RE.test(clean.nhom_chuc_danh)) errors.nhom_chuc_danh = 'Dạng "Rank 2" đến "Rank 6".';
  if (clean.ranking_ap && !RANKING_RE.test(clean.ranking_ap)) errors.ranking_ap = 'Dạng 2A–6C (chữ số 2–6, chữ A/B/C).';
  if (clean.ranking_offer && !RANKING_RE.test(clean.ranking_offer)) errors.ranking_offer = 'Dạng 2A–6C, hoặc để trống.';

  const qty = normText(raw.so_luong);
  if (qty && !(/^\d+$/.test(qty) && Number(qty) >= 1 && Number(qty) <= SEAT_MAX_QTY)) {
    errors.so_luong = `Số nguyên từ 1 đến ${SEAT_MAX_QTY}.`;
  }

  // Sheet: "Rank N" luôn khớp chữ số của Ranking AP (1 dòng ngoại lệ trong 166 dòng mẫu) → cảnh báo, không chặn.
  if (!errors.nhom_chuc_danh && !errors.ranking_ap && clean.nhom_chuc_danh && clean.ranking_ap) {
    if (`Rank ${clean.ranking_ap[0]}` !== clean.nhom_chuc_danh) {
      warnings.push(`Nhóm chức danh (${clean.nhom_chuc_danh}) khác chữ số của Ranking AP (${clean.ranking_ap}). Kiểm tra lại.`);
    }
  }
  return { clean, errors, warnings };
}

/**
 * Cấp mã ghế: số liên tiếp, tiếp sau số đã cấp gần nhất, mỗi ghế một mã (Số lượng = số mã).
 * Mã 8 chữ số, không tái sử dụng. Hàm này là bản tham chiếu; DB (public.seat_issue_codes) làm cùng việc dưới khóa.
 */
export function allocateSeatCodes(lastIssued: number, count: number): { codes: string[]; last: number } {
  if (!Number.isInteger(count) || count < 1 || count > SEAT_MAX_QTY) throw new RangeError('count ngoài khoảng cho phép');
  const max = 99_999_999;
  if (lastIssued + count > max) throw new RangeError('Hết dải mã 8 chữ số');
  const codes: string[] = [];
  for (let i = 1; i <= count; i += 1) codes.push(String(lastIssued + i));
  return { codes, last: lastIssued + count };
}

/** Cột xuất file: đúng thứ tự và tên cột của tab NhapLieu (A–S), thêm cột Trạng thái để đối soát. */
export const SEAT_EXPORT_HEADERS = [
  'Ngày gửi', 'Mã ghế', 'Ban/ Chuỗi/ Khối', 'Các đơn vị thành viên', 'Phòng/ Bộ Phận/ Nhóm', 'Đội',
  'Tổ (PP/IB/OB/IN/GV)', 'Nhóm (Site)', 'Phòng/Vùng/Miền', 'Nhóm Chức Danh', 'Ranking theo AP', 'Ranking Offer',
  'VỊ TRÍ THEO AP (JOB)', 'VỊ TRÍ THEO OFFER (Tiếng Việt)', 'VỊ TRÍ THEO OFFER (Tiếng Anh)', 'Số lượng',
  'Quản lý trực tiếp', 'Cost center', 'Note', 'Trạng thái',
] as const;

export interface SeatExportSource extends SeatInput {
  ngay_gui: string | null;
  ma_ghe: string[];
  cost_center: string;
  status: SeatStatus;
}

/** Một dòng xuất file, khớp SEAT_EXPORT_HEADERS. */
export function toSeatExportRow(r: SeatExportSource): string[] {
  return [
    formatSheetDate(r.ngay_gui),
    r.ma_ghe.join(', '),
    r.ban, r.don_vi, r.phong, r.doi, r.to_nhom, r.nhom_site, r.vung, r.nhom_chuc_danh,
    r.ranking_ap, r.ranking_offer, r.vi_tri_ap, r.vi_tri_offer_vi, r.vi_tri_offer_en,
    String(r.so_luong), r.quan_ly_truc_tiep, r.cost_center, r.note,
    SEAT_STATUS_LABEL[r.status],
  ];
}

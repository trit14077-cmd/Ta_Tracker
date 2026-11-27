/**
 * Quy trình 2 – xuất danh sách chốt OB đúng template sheet "Recruitment x CnB".
 *  - Bản gọn 16 cột: như tab OBT11/26.
 *  - Bản đầy đủ 98 cột: như tab OB_T6/26 (giữ nguyên chữ của header, kể cả lỗi chính tả, để dán thẳng vào sheet).
 *  - Bảng CnB kiểm hồ sơ: như tab "C&B check HS Tháng N".
 * Nguồn: ảnh chụp lúc chốt (cnb_ob_items.src, migration 0040) = cột hồ sơ + `hr` (thông tin nhân sự).
 * Map từng cột và các cột để trống: docs/KE_HOACH_MA_GHE_VA_CNB.md mục 2.3.
 */
import { docMark, type CnbCheckKey, CNB_CHECK_KEYS } from './cnbRules.ts';

export interface CnbSource {
  record_id?: number;
  candidate_code?: string;
  pic?: string | null;
  emp_id?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  position?: string;
  rank?: string;
  region?: string;
  location?: string;
  unit?: string;
  dept?: string;
  site?: string;
  hire_type?: string;
  ob_date?: string | null;
  probation_period?: string;
  contract_sign_status?: string;
  salary_pay_status?: string;
  drive_upload?: string;
  edu_certificate?: string;
  health_check?: string;
  id_card?: string;
  resume?: string;
  doc_note?: string;
  emp_status?: string;
  attrition_date?: string | null;
  cutoff?: string;
  hr?: Record<string, unknown> | null;
  hr_status?: string | null;
}

export interface CnbConstants {
  tap_doan: string;
  pnl: string;
  cong_ty: string;
}

/** Mặc định; Admin đổi trong app_settings key 'cnb_constants'. */
export const CNB_DEFAULT_CONSTANTS: CnbConstants = {
  tap_doan: 'Masan Group',
  pnl: 'The Supra',
  cong_ty: 'Công ty Cổ phần The Supra',
};

const s = (v: unknown) => String(v ?? '').normalize('NFC').trim();
const hr = (src: CnbSource, k: string) => s(src.hr?.[k]);

/** ISO (YYYY-MM-DD) → dd/mm/yyyy; giữ nguyên nếu đã là dd/mm/yyyy. */
export function displayDate(v: unknown): string {
  const t = s(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
}

/** "5C" → "Rank 5". */
export function rankGroup(rank: unknown): string {
  const m = /^\s*([1-9])/.exec(s(rank));
  return m ? `Rank ${m[1]}` : '';
}

/** Ngày kết thúc thử việc = ngày bắt đầu + số ngày thử việc − 1 (như sheet: 22/06 + 60 ngày → 20/08). */
export function probationEnd(obIso: unknown, period: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(obIso));
  const days = Number(s(period).replace(/[^\d]/g, ''));
  if (!m || !days) return '';
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + (days - 1) * 86400000;
  return displayDate(new Date(t).toISOString());
}

const contractType = (src: CnbSource) => (s(src.probation_period) ? 'Hợp đồng thử việc' : '');

// ---------------- Bản gọn 16 cột (tab OBT11/26) ----------------
export const CNB_SHORT_HEADERS = [
  'Emp ID', 'Name', 'Position', 'Site', 'OBD', 'Emp_STT', 'Attrition_Date', 'TA', 'Tình trạng ký HĐTV',
  'Tình trạng chi lương', 'Drive upload', 'Bằng cấp', 'GKSK', 'CCCD', 'SYLL', 'Note Document',
] as const;

export function toCnbShortRow(src: CnbSource): string[] {
  return [
    s(src.emp_id), s(src.full_name), s(src.position), s(src.site), displayDate(src.ob_date), s(src.emp_status),
    displayDate(src.attrition_date), s(src.pic), s(src.contract_sign_status), s(src.salary_pay_status), s(src.drive_upload),
    docMark(src.edu_certificate), docMark(src.health_check), docMark(src.id_card), docMark(src.resume), s(src.doc_note),
  ];
}

// ---------------- Bản đầy đủ 98 cột (tab OB_T6/26) ----------------
export const CNB_FULL_HEADERS = [
  'STT', 'Tập đoàn', 'P&L', 'Ban/Chuỗi/Khối', 'Phòng/Vùng/Miền', 'Các đơn vị thành viên', 'Phòng/Bộ phận/Nhóm', 'Đội', 'Tổ',
  'Nhóm', 'Cost Ctr', 'Tài khoản AD', 'Master code', 'Mã nhân viên', 'Họ và tên', 'Nhóm chức danh', 'Cấp bậc', 'Chức danh',
  'Ngày tuyển dụng', 'Phân loại tuyển dụng', 'Lý do tuyển dụng', 'Địa chỉ thường trú', 'Địa chỉ hiện tại', 'Tỉnh/TP làm viêc',
  'Quận huyện làm việc', 'Phường/Xã', 'Địa chỉ làm việc', 'Vùng bảo hiểm', 'Chu kỳ ca làm việc', 'Đơn vị tiền tệ',
  'Thưởng Service Charge BQ', 'Thưởng tay nghề VP', 'Thưởng ngoại ngữ VP', 'Hỗ trợ sinh hoạt', 'Loại hợp đồng',
  'Ngày bắt đầu HĐ', 'Ngày kết thúc', 'Trình độ học vấn', 'Chuyên ngành', 'Trường', 'Dân tộc', 'Số CMND/Hộ chiếu', 'Ngày cấp',
  'Nơi cấp', 'Điện thoại di động', 'Email công ty', 'Email cá nhân', 'Mã số thuế', 'Người nước ngoài có cư trú',
  'Nhiều nguồn thu nhập', 'Ủy quyền quyết toán thuế', 'Cam kết thu nhập', 'Giảm trừ bản thân', 'Loại quyết định', 'Người ký',
  'Ngày ký', 'Công ty pháp lý', 'Ngân hàng', 'Chi nhánh', 'Số tài khoản NH', 'Phụ cấp Trách nhiệm', 'Thưởng Nghề',
  'Phụ cấp độc hại', 'Phụ cấp Kiêm nhiệm', 'PC chuyên môn/tay nghề', 'PC ngoại hình', 'PC Ngoại ngữ', 'Phụ cấp gửi xe',
  'Thưởng công trường', 'Thưởng điều động', 'Thưởng ngoại hình VP', 'Thưởng Ngoại ngữ', 'Thưởng ngoại hình', 'Tiền ăn giữa ca',
  'Hỗ trợ điện thoại', 'Hỗ trợ học phí con CBNVNN', 'Hỗ trợ thu hút khó tuyển dụng', 'Thưởng vượt khung',
  'Thưởng Service Charge VP', 'Hỗ trợ nhà ở', 'Hỗ trợ đi lại', 'Thưởng Vệ sinh Villa', 'Giảm Thuế theo QĐ NN',
  'Thuế TNCN Cty bù cho NV', 'Họ tên QLTT', 'Điện thoại QLTT', 'HDTV', 'Drive upload', 'Bằng cấp', 'GKSK', 'CCCD', 'SYLL',
  'Note\nDocument', 'Tình trạng làm việc', 'Ngày nghỉ việc', 'Tình trạng Cut-off', 'Loại Cut-off', 'Ngày gửi Cut-off',
] as const;

type FullCell = (src: CnbSource, c: CnbConstants) => string;

/** Cột có nguồn trong app. Cột không có ở đây xuất trống (CnB/HRSS tự điền). */
export const CNB_FULL_MAP: Partial<Record<(typeof CNB_FULL_HEADERS)[number], FullCell>> = {
  'Tập đoàn': (_x, c) => c.tap_doan,
  'P&L': (_x, c) => c.pnl,
  'Ban/Chuỗi/Khối': (x) => s(x.unit),
  'Phòng/Vùng/Miền': (x) => s(x.region),
  'Các đơn vị thành viên': (x) => s(x.dept),
  'Đội': (x) => s(x.site),
  'Mã nhân viên': (x) => s(x.emp_id),
  'Họ và tên': (x) => s(x.full_name) || hr(x, 'full_name'),
  'Nhóm chức danh': (x) => rankGroup(x.rank),
  'Cấp bậc': (x) => s(x.rank),
  'Chức danh': (x) => s(x.position),
  'Ngày tuyển dụng': (x) => displayDate(x.ob_date),
  'Phân loại tuyển dụng': (x) => s(x.hire_type),
  'Địa chỉ thường trú': (x) => hr(x, 'address_permanent'),
  'Địa chỉ hiện tại': (x) => hr(x, 'address_current'),
  'Tỉnh/TP làm viêc': (x) => s(x.location),
  'Loại hợp đồng': (x) => contractType(x),
  'Ngày bắt đầu HĐ': (x) => (contractType(x) ? displayDate(x.ob_date) : ''),
  'Ngày kết thúc': (x) => probationEnd(x.ob_date, x.probation_period),
  'Trình độ học vấn': (x) => hr(x, 'edu_level'),
  'Dân tộc': (x) => hr(x, 'ethnicity'),
  'Số CMND/Hộ chiếu': (x) => hr(x, 'id_number'),
  'Ngày cấp': (x) => hr(x, 'id_issue_date'),
  'Nơi cấp': (x) => hr(x, 'id_issue_place'),
  'Điện thoại di động': (x) => hr(x, 'phone') || s(x.phone),
  'Email cá nhân': (x) => (hr(x, 'email') || s(x.email)).toUpperCase(),
  'Mã số thuế': (x) => hr(x, 'tax_code'),
  'Loại quyết định': (x) => contractType(x),
  'Công ty pháp lý': (_x, c) => c.cong_ty,
  'Ngân hàng': (x) => hr(x, 'bank_name'),
  'Số tài khoản NH': (x) => hr(x, 'bank_account'),
  'HDTV': (x) => s(x.contract_sign_status),
  'Drive upload': (x) => s(x.drive_upload),
  'Bằng cấp': (x) => docMark(x.edu_certificate),
  'GKSK': (x) => docMark(x.health_check),
  'CCCD': (x) => docMark(x.id_card),
  'SYLL': (x) => docMark(x.resume),
  'Note\nDocument': (x) => s(x.doc_note),
  'Tình trạng làm việc': (x) => s(x.emp_status),
  'Ngày nghỉ việc': (x) => displayDate(x.attrition_date),
  'Tình trạng Cut-off': (x) => s(x.cutoff),
};

export function toCnbFullRow(src: CnbSource, stt: number, constants: CnbConstants = CNB_DEFAULT_CONSTANTS): string[] {
  return CNB_FULL_HEADERS.map((h) => (h === 'STT' ? String(stt) : CNB_FULL_MAP[h]?.(src, constants) ?? ''));
}

// ---------------- CnB kiểm hồ sơ (tab "C&B check HS Tháng N") ----------------
export const CNB_CHECK_HEADERS = ['STT', 'MNV', 'Name', 'Rank', 'Ngày tuyển dụng', 'Bằng cấp', 'CCCD', 'KSK', 'SYLL', 'HĐTV', 'HDLD', 'QĐNV', 'Ghi chú', 'TA'] as const;

export function toCnbCheckRow(src: CnbSource, check: Partial<Record<CnbCheckKey, string>>, note: string, stt: number): string[] {
  return [
    String(stt), s(src.emp_id), s(src.full_name), s(src.rank), displayDate(src.ob_date),
    ...CNB_CHECK_KEYS.map((k) => s(check?.[k])), s(note), s(src.pic),
  ];
}

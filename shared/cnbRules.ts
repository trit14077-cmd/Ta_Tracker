/**
 * Quy trình 2 – phối hợp CnB: kỳ OB, điều kiện vào danh sách chốt ngày 25, ký hiệu giấy tờ.
 * Kế hoạch và các mặc định đang dùng: docs/KE_HOACH_MA_GHE_VA_CNB.md (mục 2.1, 3).
 * DB kiểm lại cùng điều kiện khi chốt (migration 0040, hàm app.cnb_exclude_reason) – sửa ở đây thì sửa cả ở đó.
 *
 *  - Kỳ OB tháng T = 25/(T-1) → 24/T. Ngày 25 tính vào kỳ tháng sau (mặc định Q1, chờ PO xác nhận).
 *  - Vào danh sách khi: OBD trong kỳ, "Chi lương", còn làm việc tại ngày chốt, hồ sơ không lưu trữ.
 *  - Giấy tờ: có giá trị (1, x, link...) → "x", trống → "o".
 */

export const CNB_CUTOFF_DAY = 25;
export const CNB_PAID = 'Chi lương';
export const CNB_RESIGNED = 'Resigned';

export interface CnbCycle {
  /** 'YYYY-MM' của tháng T. */
  key: string;
  /** Tên tab như sheet CnB: OB_T11/26. */
  label: string;
  /** ISO, ngày đầu kỳ (25 tháng trước). */
  from: string;
  /** ISO, ngày cuối kỳ (24 tháng T). */
  to: string;
  /** ISO, ngày chốt (25 tháng T). */
  lockDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function isCycleKey(key: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(key || ''));
}

/** Kỳ theo khóa 'YYYY-MM'. */
export function cycleOf(key: string): CnbCycle {
  if (!isCycleKey(key)) throw new Error(`Kỳ OB không hợp lệ: ${key}`);
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return {
    key,
    label: `OB_T${m}/${String(y).slice(2)}`,
    from: iso(py, pm, CNB_CUTOFF_DAY),
    to: iso(y, m, CNB_CUTOFF_DAY - 1),
    lockDate: iso(y, m, CNB_CUTOFF_DAY),
  };
}

/** Khóa kỳ chứa một ngày ISO (YYYY-MM-DD). Trả '' nếu ngày không hợp lệ. */
export function cycleKeyOfDate(dateIso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateIso || ''));
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  if (d >= CNB_CUTOFF_DAY) {
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  return `${y}-${pad(mo)}`;
}

/** Ngày hôm nay theo giờ Việt Nam (UTC+7), ISO. */
export function vnTodayIso(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** Kỳ đang mở (chưa tới ngày chốt) theo ngày hôm nay. */
export function currentCycleKey(now: Date = new Date()): string {
  return cycleKeyOfDate(vnTodayIso(now));
}

/** Số ngày từ hôm nay tới ngày chốt của kỳ (âm = đã qua). */
export function daysToLock(key: string, now: Date = new Date()): number {
  const a = Date.parse(vnTodayIso(now) + 'T00:00:00Z');
  const b = Date.parse(cycleOf(key).lockDate + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** Các kỳ gần nhất, mới nhất trước (cho ô chọn kỳ). */
export function recentCycleKeys(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  let [y, m] = currentCycleKey(now).split('-').map(Number);
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${pad(m)}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

/** Phần hồ sơ cần cho việc xét điều kiện. */
export interface CnbEligibilityInput {
  ob_date?: string | null;
  salary_pay_status?: string | null;
  emp_status?: string | null;
  attrition_date?: string | null;
  is_archived?: boolean | null;
  emp_id?: string | null;
}

export type CnbReason = 'ngoai_ky' | 'chua_chi_luong' | 'da_nghi' | 'luu_tru';
export type CnbWarning = 'thieu_emp_id' | 'chua_ghi_tinh_trang_lam_viec';

export const CNB_REASON_LABELS: Record<CnbReason, string> = {
  ngoai_ky: 'OBD ngoài kỳ',
  chua_chi_luong: 'Chưa chọn "Chi lương"',
  da_nghi: 'Đã nghỉ việc',
  luu_tru: 'Hồ sơ đã lưu trữ',
};

export const CNB_WARNING_LABELS: Record<CnbWarning, string> = {
  thieu_emp_id: 'Thiếu Emp_ID',
  chua_ghi_tinh_trang_lam_viec: 'Chưa ghi Emp_STT',
};

const norm = (s: unknown) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * Xét một hồ sơ cho kỳ `key`, tính "còn làm việc" tại `asOf` (ISO; mặc định = ngày chốt của kỳ).
 * reasons rỗng = vào danh sách. warnings không loại, chỉ nhắc TA bổ sung.
 */
export function cnbEligibility(r: CnbEligibilityInput, key: string, asOf?: string): { ok: boolean; reasons: CnbReason[]; warnings: CnbWarning[] } {
  const cy = cycleOf(key);
  const at = asOf || cy.lockDate;
  const reasons: CnbReason[] = [];
  const warnings: CnbWarning[] = [];
  const ob = String(r.ob_date || '').slice(0, 10);
  if (!ob || ob < cy.from || ob > cy.to) reasons.push('ngoai_ky');
  if (norm(r.salary_pay_status) !== CNB_PAID) reasons.push('chua_chi_luong');
  const att = String(r.attrition_date || '').slice(0, 10);
  if (norm(r.emp_status) === CNB_RESIGNED || (att && att <= at)) reasons.push('da_nghi');
  if (r.is_archived) reasons.push('luu_tru');
  if (!norm(r.emp_id)) warnings.push('thieu_emp_id');
  if (!norm(r.emp_status)) warnings.push('chua_ghi_tinh_trang_lam_viec');
  return { ok: reasons.length === 0, reasons, warnings };
}

/** Ký hiệu giấy tờ cho sheet CnB. */
export function docMark(value: unknown): 'x' | 'o' {
  const v = norm(value).toLowerCase();
  return v && v !== 'o' && v !== '0' ? 'x' : 'o';
}

/** Các ô CnB kiểm hồ sơ (thay tab "C&B check HS Tháng N"). */
export const CNB_CHECK_KEYS = ['bang_cap', 'cccd', 'ksk', 'syll', 'hdtv', 'hdld', 'qdnv'] as const;
export type CnbCheckKey = (typeof CNB_CHECK_KEYS)[number];
export const CNB_CHECK_LABELS: Record<CnbCheckKey, string> = {
  bang_cap: 'Bằng cấp',
  cccd: 'CCCD',
  ksk: 'KSK',
  syll: 'SYLL',
  hdtv: 'HĐTV',
  hdld: 'HĐLĐ',
  qdnv: 'QĐNV',
};
export const CNB_CHECK_VALUES = ['', 'x', 'o'] as const;

/** Làm sạch dữ liệu kiểm hồ sơ: chỉ giữ khóa hợp lệ, giá trị '', 'x', 'o'. Ghi chú tối đa 500 ký tự. */
export function cleanCnbCheck(input: Record<string, unknown>): { check: Partial<Record<CnbCheckKey, string>>; errors: string[] } {
  const check: Partial<Record<CnbCheckKey, string>> = {};
  const errors: string[] = [];
  for (const [k, raw] of Object.entries(input || {})) {
    if (!(CNB_CHECK_KEYS as readonly string[]).includes(k)) { errors.push(`Ô không hợp lệ: ${k}`); continue; }
    const v = norm(raw).toLowerCase();
    if (!(CNB_CHECK_VALUES as readonly string[]).includes(v)) { errors.push(`${CNB_CHECK_LABELS[k as CnbCheckKey]}: chỉ nhận x hoặc o`); continue; }
    check[k as CnbCheckKey] = v;
  }
  return { check, errors };
}

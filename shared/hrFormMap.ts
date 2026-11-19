/**
 * The company Google Form "THE SUPRA - THÔNG TIN NHÂN VIÊN" and its answer sheet.
 * Columns are found by the TEXT of their header (never by position: a column added by hand can shift the others).
 * Keys are the same as the HR Information form in the app (hrInfoRules.ts), so an answer can be copied into it.
 */
import { normalizeAndValidatePhone } from './validation.ts';

export const HR_FORM_DEFAULT_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdfE73FRvyZUPY42verD5Y52JzjdcOVvjSbHT6dIXwhN3vejQ/viewform';
export const HR_SHEET_DEFAULT_ID = '1Mk37rlji67xBLRZ2TM69bEI1pJqHx8NRdTqEmJxXB4w';
export const HR_SHEET_DEFAULT_TAB = 'Câu trả lời biểu mẫu 1';

const norm = (s: string) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Checked in this order; a header is given to the first key that matches and is still free (more specific first). */
const RULES: [string, (h: string) => boolean][] = [
  ['emergency_phone', (h) => h.includes('số điện thoại') && h.includes('báo tin')],
  ['emergency_relation', (h) => h.includes('mối quan hệ')],
  ['emergency_name', (h) => h.includes('người thân') && h.includes('báo tin')],
  ['phone', (h) => h.includes('số điện thoại')],
  ['full_name', (h) => h.includes('họ tên')],
  ['birth_date', (h) => h.includes('ngày tháng năm sinh')],
  ['email', (h) => h.startsWith('email')],
  ['birth_place', (h) => h.includes('nơi sinh')],
  ['gender', (h) => h.includes('giới tính')],
  ['address_permanent', (h) => h.includes('thường trú')],
  ['address_current', (h) => h.includes('địa chỉ hiện tại')],
  ['marital_status', (h) => h.includes('hôn nhân')],
  ['ethnicity', (h) => h === 'dân tộc' || h.startsWith('dân tộc')],
  ['religion', (h) => h.includes('tôn giáo')],
  ['old_id_number', (h) => h.includes('chứng minh nhân dân')],
  ['id_issue_date', (h) => h.includes('ngày cấp')],
  ['id_expiry_date', (h) => h.includes('ngày hết hạn')],
  ['id_issue_place', (h) => h.includes('nơi cấp')],
  ['id_number', (h) => h.includes('căn cước công dân') || h.includes('cccd')],
  ['edu_level', (h) => h.includes('trình độ học vấn')],
  ['study_period', (h) => h.includes('thời gian học')],
  ['bank_name', (h) => h.includes('tên ngân hàng')],
  ['bank_account', (h) => h.includes('số tài khoản')],
  ['bank_holder', (h) => h.includes('thụ hưởng')],
  ['tax_code', (h) => h.includes('mã số thuế')],
  ['dependents', (h) => h.includes('phụ thuộc')],
  ['social_insurance_no', (h) => h.includes('bhxh')],
  ['health_facility', (h) => h.includes('khám chữa bệnh')],
  ['employee_code', (h) => h.includes('mã nhân viên')],
];

/** key -> column index (0-based). Column 0 is always the submission time (its header may have been typed over). */
export function mapHrFormHeaders(headers: unknown[]): Record<string, number> {
  const out: Record<string, number> = { submitted_at: 0 };
  headers.forEach((raw, i) => {
    if (i === 0) return;
    const h = norm(String(raw ?? ''));
    if (!h) return;
    for (const [key, test] of RULES) {
      if (out[key] === undefined && test(h)) {
        out[key] = i;
        break;
      }
    }
  });
  return out;
}

/** Phone as stored in the app (9 digits, no leading 0), from whatever the candidate typed or the sheet kept. */
export function normalizeFormPhone(v: unknown): string {
  const raw = String(v ?? '').replace(/[^\d+]/g, '');
  if (!raw) return '';
  const p = normalizeAndValidatePhone(raw);
  return p.error ? '' : p.normalized;
}

/** CCCD as 12 digits. A sheet that stored it as a number loses the leading 0, so 11 digits get it back. */
export function normalizeCccd(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11) return '0' + d;
  return d.length === 12 ? d : '';
}

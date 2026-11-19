/**
 * HR Information (Phase 4): the personal data HR needs from a candidate who passed round 2, taken from the Google Form
 * "THE SUPRA - THÔNG TIN NHÂN VIÊN" (first page). One list of fields drives the form in the browser and the checks on the
 * Apps Script server, so both agree. To add or change a field edit HR_FIELDS only.
 */
import { currentStage } from './stage.ts';
import { normalizeAndValidatePhone, parseDisplayDateToIso } from './validation.ts';

export type HrFieldType = 'text' | 'textarea' | 'date' | 'select' | 'phone' | 'email' | 'cccd' | 'cmnd' | 'taxcode' | 'bhxh' | 'account' | 'period';

export interface HrField {
  key: string;
  label: string;
  group: string;
  type: HrFieldType;
  required: boolean;
  options?: string[];
  hint?: string;
  /** Candidate field used to pre-fill this one the first time the form is opened. */
  prefill?: string;
}

export const HR_GROUPS = [
  { id: 'personal', title: 'Thông tin cá nhân' },
  { id: 'id', title: 'Giấy tờ tùy thân' },
  { id: 'education', title: 'Học vấn' },
  { id: 'bank', title: 'Ngân hàng' },
  { id: 'emergency', title: 'Người liên hệ khẩn cấp' },
  { id: 'tax', title: 'Thuế' },
  { id: 'insurance', title: 'Bảo hiểm' },
];

export const HR_FIELDS: HrField[] = [
  { key: 'full_name', label: 'Họ tên đầy đủ', group: 'personal', type: 'text', required: true, prefill: 'full_name' },
  { key: 'birth_date', label: 'Ngày tháng năm sinh', group: 'personal', type: 'date', required: true, hint: 'DD/MM/YYYY' },
  { key: 'phone', label: 'Số điện thoại', group: 'personal', type: 'phone', required: true, prefill: 'phone' },
  { key: 'email', label: 'Email (Gmail)', group: 'personal', type: 'email', required: true, hint: 'Bắt buộc dùng Gmail, không dùng iCloud hoặc Yahoo.', prefill: 'email' },
  { key: 'birth_place', label: 'Nơi sinh', group: 'personal', type: 'text', required: true, hint: 'Chỉ ghi tên tỉnh/thành.' },
  { key: 'gender', label: 'Giới tính', group: 'personal', type: 'select', required: true, options: ['Nam', 'Nữ'], prefill: 'gender' },
  { key: 'address_permanent', label: 'Địa chỉ thường trú (theo hộ khẩu/CCCD)', group: 'personal', type: 'textarea', required: true, hint: 'Ghi theo địa chỉ mới sau sáp nhập.' },
  { key: 'address_current', label: 'Địa chỉ hiện tại', group: 'personal', type: 'textarea', required: true, hint: 'Ghi theo địa chỉ mới sau sáp nhập.' },
  { key: 'marital_status', label: 'Tình trạng hôn nhân', group: 'personal', type: 'select', required: true, options: ['Độc thân', 'Kết hôn', 'Ly hôn'] },
  { key: 'ethnicity', label: 'Dân tộc', group: 'personal', type: 'text', required: true },
  { key: 'religion', label: 'Tôn giáo', group: 'personal', type: 'text', required: true, hint: 'Không có thì ghi "Không".' },

  { key: 'id_number', label: 'Số Căn cước công dân (CCCD)', group: 'id', type: 'cccd', required: true, hint: '12 chữ số.' },
  { key: 'old_id_number', label: 'Số CMND 9 số (nếu có)', group: 'id', type: 'cmnd', required: false, hint: 'Không bắt buộc, dùng để tra cứu mã số thuế.' },
  { key: 'id_issue_date', label: 'Ngày cấp CCCD', group: 'id', type: 'date', required: true, hint: 'DD/MM/YYYY (có thể gõ 20.10.2021).' },
  { key: 'id_expiry_date', label: 'Ngày hết hạn CCCD', group: 'id', type: 'date', required: true, hint: 'DD/MM/YYYY' },
  {
    key: 'id_issue_place', label: 'Nơi cấp CCCD', group: 'id', type: 'select', required: true,
    options: ['Cục CSĐK QLCT & DLQG về dân cư', 'Cục CS QLHC về TTXH', 'Bộ Công An'],
  },

  { key: 'edu_level', label: 'Trình độ học vấn', group: 'education', type: 'select', required: true, options: ['Đại học', 'Cao đẳng', 'Trung cấp', 'Trung học phổ thông', 'Trung học cơ sở', 'Tiểu học'] },
  { key: 'study_period', label: 'Thời gian học tập', group: 'education', type: 'period', required: true, hint: 'Năm bắt đầu - năm kết thúc, ví dụ 2015 - 2019.' },

  { key: 'bank_name', label: 'Tên ngân hàng - chi nhánh', group: 'bank', type: 'text', required: true },
  { key: 'bank_account', label: 'Số tài khoản (chính chủ)', group: 'bank', type: 'account', required: true },
  { key: 'bank_holder', label: 'Tên người thụ hưởng', group: 'bank', type: 'text', required: true, hint: 'Viết hoa, không dấu giống tên trên thẻ.' },

  { key: 'emergency_name', label: 'Người thân khi cần báo tin', group: 'emergency', type: 'text', required: true },
  { key: 'emergency_relation', label: 'Mối quan hệ', group: 'emergency', type: 'text', required: true },
  { key: 'emergency_phone', label: 'Số điện thoại liên hệ', group: 'emergency', type: 'phone', required: true },

  { key: 'tax_code', label: 'Mã số thuế', group: 'tax', type: 'taxcode', required: true, hint: 'Chưa có thì ghi KHÔNG.' },
  { key: 'dependents', label: 'Có người phụ thuộc giảm trừ gia cảnh không', group: 'tax', type: 'select', required: true, options: ['Có', 'Không'] },

  { key: 'social_insurance_no', label: 'Mã số sổ BHXH', group: 'insurance', type: 'bhxh', required: true, hint: 'Chưa có thì ghi KHÔNG.' },
  { key: 'health_facility', label: 'Nơi đăng ký khám chữa bệnh mong muốn', group: 'insurance', type: 'text', required: true },
];

export const HR_FIELD_BY_KEY: Record<string, HrField> = Object.fromEntries(HR_FIELDS.map((f) => [f.key, f]));

/** draft = still being filled; submitted = complete, waiting for the TA to check; verified = checked by the TA / Admin, locked. */
export type HrStatus = 'draft' | 'submitted' | 'verified';

export const HR_STATUS_LABELS: Record<HrStatus | 'none', string> = {
  none: 'Chưa nhập',
  draft: 'Đang nhập (nháp)',
  submitted: 'Đã nhập đủ, chờ xác nhận',
  verified: 'Đã xác nhận',
};

/** Stages that count as "passed round 2": Passed, and the ones after it (offer, hired). Default rule, to be confirmed by the business. */
export const HR_ELIGIBLE_STAGES = ['Passed', 'Offer', 'Hired'];

export function hrEligible(candidate: Record<string, unknown>): boolean {
  return HR_ELIGIBLE_STAGES.includes(currentStage(candidate));
}

const MAX_LEN = 300;
const MAX_LEN_LONG = 500;

function normDate(v: string): string {
  return v.replace(/[.\-]/g, '/').replace(/\s+/g, '');
}

/** "20.10.2021" -> "20/10/2021"; invalid input is left as typed so the error message can show it. */
function cleanValue(f: HrField, raw: unknown): string {
  let v = String(raw ?? '').replace(/\s+/g, ' ').trim().normalize('NFC');
  if (f.type === 'date') v = normDate(v);
  if (f.type === 'email') v = v.toLowerCase();
  if (f.type === 'cccd' || f.type === 'cmnd') v = v.replace(/\s/g, '');
  if (f.type === 'account') v = v.replace(/[\s.\-]/g, '');
  if (f.type === 'taxcode' || f.type === 'bhxh') {
    v = v.replace(/\s/g, '');
    if (/^(khong|không)$/i.test(v)) v = 'KHÔNG';
  }
  if (f.type === 'phone') {
    const p = normalizeAndValidatePhone(v);
    if (!p.error) v = p.normalized;
  }
  const max = f.type === 'textarea' ? MAX_LEN_LONG : MAX_LEN;
  return v.slice(0, max);
}

function isoOf(v: string): string {
  const r = parseDisplayDateToIso(v);
  return r.error ? '' : r.iso;
}

export interface HrValidation {
  clean: Record<string, string>;
  errors: Record<string, string>;
  /** Field keys still empty among the required ones. */
  missing: string[];
}

/**
 * Cleans the input and checks every filled field. Drafts may be incomplete; a submission needs every required field.
 * Unknown keys are dropped.
 */
export function validateHrInfo(input: Record<string, unknown>, mode: 'draft' | 'submit'): HrValidation {
  const clean: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const missing: string[] = [];
  for (const f of HR_FIELDS) {
    const v = cleanValue(f, input ? input[f.key] : '');
    clean[f.key] = v;
    if (!v) {
      if (f.required) missing.push(f.key);
      continue;
    }
    let err = '';
    switch (f.type) {
      case 'select':
        if (!f.options?.includes(v)) err = 'Hãy chọn một giá trị trong danh sách.';
        break;
      case 'email':
        if (!/^[^\s@]+@gmail\.com$/.test(v)) err = 'Email phải là địa chỉ Gmail (đuôi @gmail.com).';
        break;
      case 'phone': {
        const p = normalizeAndValidatePhone(v);
        if (p.error) err = p.error;
        break;
      }
      case 'date': {
        const d = parseDisplayDateToIso(v);
        if (d.error) err = d.error;
        break;
      }
      case 'cccd':
        if (!/^\d{12}$/.test(v)) err = 'Số CCCD gồm đúng 12 chữ số.';
        break;
      case 'cmnd':
        if (!/^\d{9}$/.test(v)) err = 'Số CMND gồm đúng 9 chữ số.';
        break;
      case 'account':
        if (!/^\d{6,20}$/.test(v)) err = 'Số tài khoản chỉ gồm chữ số (6 đến 20 số).';
        break;
      case 'taxcode':
        if (v !== 'KHÔNG' && !/^\d{10}(\d{3})?$/.test(v.replace(/-/g, ''))) err = 'Mã số thuế gồm 10 hoặc 13 chữ số, hoặc ghi KHÔNG nếu chưa có.';
        break;
      case 'bhxh':
        if (v !== 'KHÔNG' && !/^\d{10}$/.test(v)) err = 'Mã số BHXH gồm 10 chữ số, hoặc ghi KHÔNG nếu chưa có.';
        break;
      case 'period': {
        const m = /^(\d{4})\s*[-–]\s*(\d{4})$/.exec(v);
        if (!m) err = 'Ghi dạng năm bắt đầu - năm kết thúc, ví dụ 2015 - 2019.';
        else if (Number(m[2]) < Number(m[1])) err = 'Năm kết thúc không được nhỏ hơn năm bắt đầu.';
        break;
      }
      default:
        break;
    }
    if (err) errors[f.key] = err;
  }
  const a = isoOf(clean.id_issue_date);
  const b = isoOf(clean.id_expiry_date);
  if (a && b && b <= a && !errors.id_expiry_date) errors.id_expiry_date = 'Ngày hết hạn phải sau ngày cấp CCCD.';
  if (mode === 'submit') {
    for (const k of missing) errors[k] = 'Bắt buộc phải nhập.';
  }
  return { clean, errors, missing };
}

/** Number of required fields still empty (for the progress text). */
export function hrMissingCount(data: Record<string, string>): number {
  return HR_FIELDS.filter((f) => f.required && !String(data[f.key] ?? '').trim()).length;
}

/** Fields shown in the audit log and the TA never sees other people's values of: only these keys identify a person. */
export const HR_ID_KEY = 'id_number';

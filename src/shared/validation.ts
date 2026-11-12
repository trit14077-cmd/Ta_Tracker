import { FIELD_CATALOG, FieldDefinition } from './fieldCatalog.ts';
import { INTERVIEW_TIME_SLOTS, LEGACY_HIRE_TYPE_VALUES } from './seedData.ts';

export interface DropdownConfigBundle {
  lists: Record<string, { value: string; active: boolean }[]>;
  subSourceMapping: Record<string, string>;
  regionToLocations: Record<string, string[]>;
  locationToSites: Record<string, string[]>;
}

export interface PhoneNormalizationResult {
  normalized: string;
  wasNormalized: boolean;
  notice?: string;
  error?: string;
}

/**
 * VALIDATION RULE — Phone Normalization & Validation
 * - Phone must be stored as TEXT of exactly 9 digits with no leading 0.
 * - If user types "0854498989", "0854 498 989", or "+84854498989",
 *   we strip whitespace/punctuation, remove leading "+84", "84", or "0",
 *   normalize to "854498989", and inform the user in Vietnamese.
 */
export function normalizeAndValidatePhone(rawInput: string | null | undefined): PhoneNormalizationResult {
  const raw = String(rawInput ?? '').trim();
  if (!raw) {
    return {
      normalized: '',
      wasNormalized: false,
      error: 'Vui lòng nhập số điện thoại (9 chữ số, không có số 0 ở đầu, ví dụ: 854498989).',
    };
  }

  // Remove spaces, dots, dashes, parentheses
  let cleaned = raw.replace(/[\s.\-()]/g, '');

  if (cleaned.startsWith('+84')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('84') && cleaned.length === 11) {
    cleaned = cleaned.slice(2);
  }

  // Strip a single leading zero if 10 digits starting with 0
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('0')) {
    cleaned = cleaned.replace(/^0+/, '');
  }

  if (!/^[1-9]\d{8}$/.test(cleaned)) {
    return {
      normalized: cleaned,
      wasNormalized: cleaned !== raw,
      error:
        'Số điện thoại phải gồm đúng 9 chữ số từ 0-9 và không bắt đầu bằng số 0. Cách sửa: Nhập dạng 854498989 (hoặc 0854498989 để hệ thống tự chuẩn hóa).',
    };
  }

  const wasNormalized = cleaned !== raw;
  return {
    normalized: cleaned,
    wasNormalized,
    notice: wasNormalized
      ? `Đã tự động chuẩn hóa số điện thoại từ "${raw}" thành "${cleaned}" (9 chữ số, bỏ số 0/+84 ở đầu).`
      : undefined,
  };
}

/**
 * VALIDATION RULE — Date Format (DD/MM/YYYY <-> YYYY-MM-DD)
 * - User input & display must be DD/MM/YYYY.
 * - Database storage must be YYYY-MM-DD.
 */
export function parseDisplayDateToIso(input: string | null | undefined): {
  iso: string;
  error?: string;
} {
  const val = String(input ?? '').trim();
  if (!val) return { iso: '' };

  // Also accept already-ISO YYYY-MM-DD when coming from internal state, but validate strictly
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    if (isValidCalendarDate(y, m, d)) {
      return { iso: val };
    }
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(val);
  if (!match) {
    return {
      iso: '',
      error: 'Ngày không đúng định dạng DD/MM/YYYY. Cách sửa: Nhập ngày/tháng/năm dạng 15/11/2026.',
    };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (!isValidCalendarDate(year, month, day)) {
    return {
      iso: '',
      error: `Ngày "${val}" không tồn tại trên lịch. Cách sửa: Kiểm tra lại ngày và tháng (DD/MM/YYYY).`,
    };
  }

  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso };
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1940 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function formatIsoDateToDisplay(iso: string | null | undefined): string {
  const val = String(iso ?? '').trim();
  if (!val) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(val);
  if (!match) return val;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Legacy Excel Time Fraction Converter:
 * Converts decimal day fractions (e.g., 0.375 -> 09:00, 0.3958333 -> 09:30)
 * into HH:mm string format.
 */
export function normalizeExcelTimeValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number' && raw >= 0 && raw < 1) {
    const totalMinutes = Math.round(raw * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const str = String(raw).trim();
  if (/^0\.\d+$/.test(str)) {
    const num = parseFloat(str);
    if (!isNaN(num) && num >= 0 && num < 1) {
      const totalMinutes = Math.round(num * 24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  // Normalize 9:00 -> 09:00
  const hmMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(str);
  if (hmMatch) {
    return `${ hmMatch[1].padStart(2, '0') }:${ hmMatch[2] }`;
  }
  return str;
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * COMPUTED FIELD — ob_month
 * Derived strictly from `ob_date` (ISO YYYY-MM-DD).
 * Format: "Jan'26" / "Nov'26" with English month abbreviations.
 * Empty if `ob_date` is empty.
 */
export function computeObMonth(obDateIso: string | null | undefined): string {
  const val = String(obDateIso ?? '').trim();
  if (!val) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
  if (!match) return '';
  const year = Number(match[1]);
  const monthIdx = Number(match[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return '';
  const shortYear = String(year).slice(-2);
  return `${MONTH_ABBR[monthIdx]}'${shortYear}`;
}

/**
 * Returns today's date in Asia/Ho_Chi_Minh timezone as YYYY-MM-DD.
 */
export function getTodayIsoInHoChiMinh(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // en-CA yields YYYY-MM-DD
}

/**
 * COMPUTED FIELD — tenor
 * Rules:
 * - Empty if `ob_date` is empty.
 * - End date = `attrition_date` if `emp_status === 'Resigned'` and `attrition_date` exists,
 *   otherwise today's date in `Asia/Ho_Chi_Minh`.
 * - days = (end_date - ob_date) in calendar days.
 * - Buckets:
 *   < 1  -> "<1D"
 *   < 3  -> "<3D"
 *   < 7  -> "<7D"
 *   < 15 -> "<15D"
 *   < 30 -> "<30D"
 *   >=30 -> ">30D"
 */
export function computeTenor(
  obDateIso: string | null | undefined,
  empStatus: string | null | undefined,
  attritionDateIso: string | null | undefined,
  todayHoChiMinhIso?: string
): string {
  const ob = String(obDateIso ?? '').trim();
  if (!ob || !/^\d{4}-\d{2}-\d{2}$/.test(ob)) return '';

  const endIso =
    empStatus === 'Resigned' && attritionDateIso && /^\d{4}-\d{2}-\d{2}$/.test(attritionDateIso)
      ? attritionDateIso
      : todayHoChiMinhIso || getTodayIsoInHoChiMinh();

  const [obY, obM, obD] = ob.split('-').map(Number);
  const [endY, endM, endD] = endIso.split('-').map(Number);

  const obUtc = Date.UTC(obY, obM - 1, obD);
  const endUtc = Date.UTC(endY, endM - 1, endD);
  const diffDays = Math.floor((endUtc - obUtc) / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return '<1D';
  if (diffDays < 3) return '<3D';
  if (diffDays < 7) return '<7D';
  if (diffDays < 15) return '<15D';
  if (diffDays < 30) return '<30D';
  return '>30D';
}

/**
 * COMPUTED FIELD — source (from sub_source mapping)
 * Resolves `source` from `sub_source` using the Sub_Source -> Source mapping table.
 */
export function computeSourceFromSubSource(
  subSource: string | null | undefined,
  mapping: Record<string, string>
): string {
  const sub = String(subSource ?? '').trim();
  if (!sub) return '';
  return mapping[sub] ?? '';
}

/**
 * Validates and prepares a candidate payload (client or server).
 * Returns field errors in Vietnamese with instructions on how to fix them,
 * plus normalized values and computed fields.
 */
export function validateAndComputeCandidate(
  input: Record<string, unknown>,
  config: DropdownConfigBundle,
  options?: {
    existingValues?: Record<string, unknown>; // Allow keeping an existing inactive dropdown value if unchanged
    isPartialPatch?: boolean;
  }
): {
  valid: boolean;
  errors: Record<string, string>;
  notices: Record<string, string>;
  sanitized: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const notices: Record<string, string> = {};
  const merged: Record<string, unknown> = {
    ...(options?.existingValues || {}),
    ...input,
  };

  const sanitized: Record<string, string> = {};

  // Helper to check if a value is allowed in a dropdown list
  const isDropdownAllowed = (listKey: string, val: string, fieldKey: string): boolean => {
    const items = config.lists[listKey] || [];
    const activeSet = new Set(items.filter((i) => i.active).map((i) => i.value));
    if (activeSet.has(val)) return true;
    // Allow unchanged legacy/deactivated value if editing an existing row without changing that field
    const prevVal = String(options?.existingValues?.[fieldKey] ?? '');
    const allSet = new Set(items.map((i) => i.value));
    if (prevVal === val && allSet.has(val)) return true;
    return false;
  };

  for (const field of FIELD_CATALOG) {
    if (field.type === 'readonly_timestamp' || field.type === 'readonly_computed') {
      continue; // Never accept computed fields from client
    }

    const rawVal = merged[field.key];
    const strVal = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim();

    if (field.key === 'candidate_code') {
      // TODO: exact candidate_code pattern not confirmed, so only check non-empty/no-spaces/unique.
      if (!strVal) {
        errors.candidate_code =
          'Mã ứng viên là bắt buộc. Cách sửa: Nhập mã ứng viên viết liền không khoảng trắng (ví dụ: UV2026001).';
      } else if (/\s/.test(strVal)) {
        errors.candidate_code =
          'Mã ứng viên không được chứa khoảng trắng. Cách sửa: Xóa dấu cách trong mã ứng viên.';
      }
      sanitized.candidate_code = strVal;
      continue;
    }

    if (field.required && !strVal) {
      errors[field.key] = `Trường "${field.label}" là bắt buộc. Cách sửa: Vui lòng nhập hoặc chọn giá trị hợp lệ.`;
      sanitized[field.key] = '';
      continue;
    }

    if (!strVal) {
      sanitized[field.key] = '';
      continue;
    }

    switch (field.type) {
      case 'phone': {
        const res = normalizeAndValidatePhone(strVal);
        sanitized[field.key] = res.normalized;
        if (res.error) {
          errors[field.key] = res.error;
        } else if (res.notice) {
          notices[field.key] = res.notice;
        }
        break;
      }

      case 'email': {
        // email is optional, validate format when present
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(strVal)) {
          errors[field.key] =
            'Địa chỉ Email không hợp lệ. Cách sửa: Nhập đúng định dạng ten@mien.com hoặc để trống nếu không có.';
        }
        sanitized[field.key] = strVal;
        break;
      }

      case 'date': {
        const parsed = parseDisplayDateToIso(strVal);
        if (parsed.error) {
          errors[field.key] = parsed.error;
          sanitized[field.key] = strVal;
        } else {
          sanitized[field.key] = parsed.iso;
        }
        break;
      }

      case 'time': {
        const normTime = normalizeExcelTimeValue(strVal);
        if (!INTERVIEW_TIME_SLOTS.includes(normTime)) {
          errors[field.key] =
            'Giờ phỏng vấn phải nằm trong khung 09:00 đến 16:30 (mỗi nấc 30 phút). Cách sửa: Chọn giờ từ danh sách như 09:00, 09:30, ..., 16:30.';
        }
        sanitized[field.key] = normTime;
        break;
      }

      case 'money': {
        const cleanedMoney = strVal.replace(/[,.\s]/g, '');
        if (!/^\d+$/.test(cleanedMoney)) {
          errors[field.key] =
            `"${field.label}" phải là số nguyên VND không âm. Cách sửa: Chỉ nhập chữ số nguyên (ví dụ: 9500000).`;
          sanitized[field.key] = strVal;
        } else {
          sanitized[field.key] = String(Number(cleanedMoney));
        }
        break;
      }

      case 'percentage': {
        const cleanedPct = strVal.replace(/%/g, '').trim();
        const num = Number(cleanedPct);
        if (isNaN(num) || num < 0 || num > 100) {
          errors[field.key] =
            'Phần trăm lương thử việc (% Probation) phải từ 0 đến 100. Cách sửa: Nhập số phần trăm hợp lệ (ví dụ: 85 hoặc 100).';
          sanitized[field.key] = strVal;
        } else {
          sanitized[field.key] = String(num);
        }
        break;
      }

      case 'dropdown': {
        if (field.dropdownListKey && !isDropdownAllowed(field.dropdownListKey, strVal, field.key)) {
          errors[field.key] =
            `Giá trị "${strVal}" không có trong danh mục "${field.label}". Cách sửa: Chọn một giá trị có sẵn từ danh sách thả xuống.`;
        }
        sanitized[field.key] = strVal;
        break;
      }

      case 'dependent_dropdown': {
        if (field.dropdownListKey && !isDropdownAllowed(field.dropdownListKey, strVal, field.key)) {
          errors[field.key] =
            `Giá trị "${strVal}" không nằm trong danh sách "${field.label}". Cách sửa: Chọn giá trị hợp lệ từ danh sách.`;
        }
        sanitized[field.key] = strVal;
        break;
      }

      default: {
        sanitized[field.key] = strVal;
        break;
      }
    }
  }

  // Validate dependent dropdown hierarchy: Region -> Location -> Site
  const regionVal = sanitized.region || '';
  const locationVal = sanitized.location || '';
  const siteVal = sanitized.site || '';

  if (locationVal) {
    if (!regionVal) {
      errors.location =
        'Chưa chọn Vùng/Miền (Region). Cách sửa: Chọn Vùng/Miền trước khi chọn Tỉnh/Thành (Location).';
    } else {
      const allowedLocations = config.regionToLocations[regionVal] || [];
      if (!allowedLocations.includes(locationVal)) {
        errors.location = `Tỉnh/Thành "${locationVal}" không thuộc "${regionVal}". Cách sửa: Chọn lại Tỉnh/Thành thuộc ${regionVal}.`;
      }
    }
  }

  if (siteVal) {
    if (!locationVal) {
      errors.site =
        'Chưa chọn Tỉnh/Thành (Location). Cách sửa: Chọn Tỉnh/Thành trước khi chọn Điểm làm việc (Site).';
    } else {
      const allowedSites = config.locationToSites[locationVal] || [];
      if (!allowedSites.includes(siteVal)) {
        errors.site = `Điểm làm việc "${siteVal}" không thuộc "${locationVal}". Cách sửa: Chọn lại Điểm làm việc thuộc ${locationVal}.`;
      }
    }
  }

  // Validate attrition_date vs ob_date: Reject attrition_date earlier than ob_date
  const obDateIso = sanitized.ob_date || '';
  const attritionDateIso = sanitized.attrition_date || '';
  if (
    obDateIso &&
    attritionDateIso &&
    /^\d{4}-\d{2}-\d{2}$/.test(obDateIso) &&
    /^\d{4}-\d{2}-\d{2}$/.test(attritionDateIso)
  ) {
    if (attritionDateIso < obDateIso) {
      errors.attrition_date =
        'Ngày nghỉ việc (Attrition_Date) không được nhỏ hơn Ngày Onboard (OB_Date). Cách sửa: Nhập ngày nghỉ việc sau hoặc trùng ngày Onboard.';
    }
  }

  // Compute server-authoritative fields
  sanitized.source = computeSourceFromSubSource(sanitized.sub_source, config.subSourceMapping);
  sanitized.ob_month = computeObMonth(sanitized.ob_date);
  sanitized.tenor = computeTenor(
    sanitized.ob_date,
    sanitized.emp_status,
    sanitized.attrition_date
  );

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    notices,
    sanitized,
  };
}

/**
 * Legacy Excel OB_Sub_STT splitter:
 * "Legacy files have a single OB_Sub_STT column: if its value is one of
 * Tuyển mới / Tuyển thay thế / Tái tuyển dụng, put it in hire_type instead of ob_sub_status."
 */
export function applyLegacyImportTransformations(row: Record<string, string>): Record<string, string> {
  const transformed = { ...row };
  const obSubVal = (transformed.ob_sub_status || '').trim();
  if (obSubVal && LEGACY_HIRE_TYPE_VALUES.has(obSubVal)) {
    if (!transformed.hire_type) {
      transformed.hire_type = obSubVal;
    }
    transformed.ob_sub_status = '';
  }

  if (transformed.r1_time) {
    transformed.r1_time = normalizeExcelTimeValue(transformed.r1_time);
  }
  if (transformed.r2_time) {
    transformed.r2_time = normalizeExcelTimeValue(transformed.r2_time);
  }
  return transformed;
}

/**
 * Neutralize spreadsheet formula injection on export:
 * Prefix cells starting with =, +, -, @ (or leading tab/CR) with a single quote (').
 */
export function sanitizeCellForSpreadsheet(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (!str) return '';
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export function formatVndDisplay(val: string | number | null | undefined): string {
  const str = String(val ?? '').trim();
  if (!str) return '';
  const num = Number(str);
  if (isNaN(num)) return str;
  return num.toLocaleString('vi-VN');
}

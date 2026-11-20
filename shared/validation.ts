import { FIELD_CATALOG, FieldDefinition } from './fieldCatalog.ts';
import { lookupPositionInfo } from './positionMap.ts';
import { normalizePosition } from './positionCatalog.ts';
import { requiredDocuments } from './documentRules.ts';
import {
  REASON_EXPECTED,
  REASON_FIELD,
  REASON_RENAMES,
  ReasonRound,
  allowedReasons,
  reasonUniverse,
} from './reasonRules.ts';
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
    // The phone number is optional (real lead data often has none); format is only checked when present.
    return { normalized: '', wasNormalized: false };
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
  // Vietnam has no daylight saving time (fixed UTC+7). Plain arithmetic avoids relying on
  // Intl time-zone support, which is not guaranteed in every runtime (e.g. Google Apps Script).
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
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
 * Birth: either a full date DD/MM/YYYY or just a year YYYY. Candidates must be 14 to 80 years old.
 */
export function normalizeBirth(raw: string, today: Date = new Date()): { value: string; error?: string } {
  const v = raw.trim();
  if (!v) return { value: '' };
  const thisYear = today.getFullYear();
  const bad = 'Ngày/Năm sinh không hợp lệ. Cách sửa: Nhập ngày sinh dạng DD/MM/YYYY (ví dụ 15/08/1999) hoặc chỉ năm sinh (ví dụ 1999).';
  const range = `Năm sinh phải từ ${thisYear - 80} đến ${thisYear - 14} (ứng viên từ 14 đến 80 tuổi).`;
  if (/^\d{4}$/.test(v)) {
    const y = Number(v);
    return y >= thisYear - 80 && y <= thisYear - 14 ? { value: v } : { value: v, error: range };
  }
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(v);
  if (!m) return { value: v, error: bad };
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return { value: v, error: bad };
  const value = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
  return y >= thisYear - 80 && y <= thisYear - 14 ? { value } : { value, error: range };
}

/** CV link: must be a web address; "linkedin.com/in/abc" gets https:// added. */
export function normalizeCvLink(raw: string): { value: string; error?: string } {
  let v = raw.trim();
  if (!v) return { value: '' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) v = 'https://' + v;
  if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v)) {
    return { value: v, error: 'Link CV không hợp lệ. Cách sửa: Dán đường dẫn đầy đủ, ví dụ https://www.linkedin.com/in/ten-ban hoặc link Google Drive.' };
  }
  return { value: v };
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
    isCreate?: boolean; // a NEW candidate typed by hand: fields marked requiredOnCreate must be filled
    lenient?: boolean; // legacy import: status/reason mismatches become notices instead of errors
  }
): {
  valid: boolean;
  errors: Record<string, string>;
  notices: Record<string, string>;
  sanitized: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const notices: Record<string, string> = {};
  // Vietnamese text can arrive as precomposed (NFC) or decomposed (NFD) characters depending on the
  // source (Excel, keyboard, paste). Compare everything in NFC so "Hà Nam" always matches the Drop-list.
  const toNfc = (src: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) out[k] = typeof v === 'string' ? v.normalize('NFC') : v;
    return out;
  };
  const merged: Record<string, unknown> = {
    ...toNfc(options?.existingValues || {}),
    ...toNfc(input),
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
    if (field.key === 'cv_file') {
      // Written only by the upload endpoint, never by the client.
      sanitized.cv_file = String(options?.existingValues?.cv_file ?? '');
      continue;
    }

    if (field.type === 'document') {
      // An uploaded file is written only by the upload endpoints. A row keeps its stored value; new / imported rows
      // may carry an old-style flag such as "1" or "Done" (never a file reference, which contains "|").
      const stored = options?.existingValues?.[field.key];
      const legacy = String(input[field.key] ?? '').trim();
      sanitized[field.key] = stored !== undefined && stored !== null ? String(stored) : legacy.includes('|') ? '' : legacy;
      continue;
    }

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

    if (field.requiredOnCreate && options?.isCreate && !strVal) {
      errors[field.key] = `Trường "${field.label}" là bắt buộc. Cách sửa: Vui lòng nhập hoặc chọn giá trị hợp lệ.`;
      sanitized[field.key] = '';
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
        if (field.key === 'birth') {
          const b = normalizeBirth(strVal);
          if (b.error) errors.birth = b.error;
          sanitized.birth = b.value;
          break;
        }
        if (field.key === 'cv_link') {
          const u = normalizeCvLink(strVal);
          if (u.error) errors.cv_link = u.error;
          sanitized.cv_link = u.value;
          break;
        }
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

  // Hiring Operation: this Site + Position pair is not listed (the form then fills by principle). Warning only.
  if (!options?.lenient && sanitized.site && sanitized.position) {
    const info = lookupPositionInfo(sanitized.site, sanitized.position);
    if (!info || !info.exact) {
      notices.position = `Kho "${sanitized.site}" chưa có vị trí "${sanitized.position}" trong Hiring Operation. Rank, Phòng/Ban, Khối được điền theo quy tắc chung. Hãy kiểm tra lại.`;
    }
  }

  // Status -> reason rule per round (R1, R2, Onboard)
  for (const round of Object.keys(REASON_FIELD) as ReasonRound[]) {
    const { status: stKey, sub: subKey, label } = REASON_FIELD[round];
    const st = sanitized[stKey] || '';
    const sub = sanitized[subKey] || '';
    if (!st) {
      if (sub) {
        const msg = `Đã có lý do (${label}) nhưng chưa chọn trạng thái. Cách sửa: Chọn trạng thái ${label} trước.`;
        if (options?.lenient) notices[subKey] = msg;
        else errors[subKey] = msg;
      }
      continue;
    }
    const allowed = allowedReasons(round, st);
    if (allowed === null) continue; // status without a rule: leave to the dropdown check
    const unchanged =
      String(options?.existingValues?.[stKey] ?? '') === st && String(options?.existingValues?.[subKey] ?? '') === sub;
    if (sub && !errors[subKey] && reasonUniverse(round).includes(sub) && !allowed.includes(sub)) {
      const msg = allowed.length
        ? `Lý do "${sub}" không dùng cho trạng thái "${st}" (${label}). Cách sửa: Chọn một trong: ${allowed.join(', ')}.`
        : `Trạng thái "${st}" (${label}) không có lý do. Cách sửa: Để trống lý do hoặc đổi trạng thái.`;
      if (options?.lenient || unchanged) notices[subKey] = msg;
      else errors[subKey] = msg;
    } else if (!sub && REASON_EXPECTED[round].includes(st)) {
      notices[subKey] = `Trạng thái "${st}" (${label}) nên có lý do. Bạn có thể bổ sung sau.`;
    }
  }

  // Missing required documents (a warning only: the file may arrive after the record is created).
  if (!options?.lenient && /^(Accepted|Joined)$/.test(sanitized.ob_status || '')) {
    for (const k of requiredDocuments(sanitized.position, sanitized.rank)) {
      if (!sanitized[k]) notices[k] = 'Thiếu giấy tờ bắt buộc cho vị trí này. Cách sửa: Tải file lên.';
    }
  }

  // A round that has data must also have its status (required for a new candidate, a warning otherwise).
  const roundHasData: [string, string[], string][] = [
    ['r1_status', ['r1_date', 'r1_time', 'r1_sub_status'], 'R1'],
    ['r2_status', ['r2_date', 'r2_time', 'r2_sub_status'], 'R2'],
    ['ob_status', ['ob_date', 'ob_sub_status'], 'Onboard'],
  ];
  for (const [stKey, dataKeys, label] of roundHasData) {
    if (!sanitized[stKey] && dataKeys.some((k) => sanitized[k])) {
      const msg = `Đã có thông tin ${label} nhưng chưa chọn trạng thái. Cách sửa: Chọn trạng thái ${label}.`;
      if (options?.isCreate) errors[stKey] = msg;
      else if (!options?.lenient) notices[stKey] = msg;
    }
  }

  // Round order: R2 after R1 Passed, Onboard after R2 Passed (warning only)
  if (sanitized.r2_status && sanitized.r1_status && sanitized.r1_status !== 'Passed') {
    notices.r2_status = 'Có kết quả R2 nhưng R1 chưa Passed. Hãy kiểm tra lại.';
  }
  if (sanitized.ob_status && sanitized.r2_status && sanitized.r2_status !== 'Passed') {
    notices.ob_status = 'Có trạng thái Onboard nhưng R2 chưa Passed. Hãy kiểm tra lại.';
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

  for (const k of ['r1_sub_status', 'r2_sub_status', 'ob_sub_status']) {
    const v = (transformed[k] || '').trim().normalize('NFC');
    if (v && REASON_RENAMES[v]) transformed[k] = REASON_RENAMES[v];
  }

  // Vị trí: tên cũ (tên tiếng Anh / khác hoa-thường) -> tên chuẩn theo danh mục 18.11 (positionCatalog.ts, 0027)
  if (transformed.position) transformed.position = normalizePosition(transformed.position);

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

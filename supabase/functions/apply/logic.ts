// Kiểm form ứng tuyển công khai (Edge `apply`, M7-3) – như hApplySubmit_ của Apply.gs. Không gọi mạng, test được bằng vitest.
import { normalizeAndValidatePhone, sanitizeCellForSpreadsheet } from '../../../shared/validation.ts';
import { magicMatches } from '../files/logic.ts';

export const APPLY_CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_MIME: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

export interface ApplyInput {
  full_name: string; phone: string; email: string; area: string; position: string; note: string; consent: boolean; website: string;
}
export interface ApplyClean {
  full_name: string; phone: string; email: string; area: string; position: string; note: string;
}
export interface CvInfo { name: string; ext: string; mime: string }

/** `positions`: danh sách vị trí đang mở (dropdown 'position'); vị trí phải nằm trong danh sách này. */
export function validateApply(b: ApplyInput, cv: { name: string; size: number; head: Uint8Array } | null, positions: string[]):
  { ok: true; clean: ApplyClean; cv: CvInfo | null } | { ok: false; fields: Record<string, string> } {
  const errors: Record<string, string> = {};
  const position = String(b.position || '').trim();
  if (!position || !positions.includes(position)) errors.position = 'Vui lòng chọn vị trí ứng tuyển.';
  const name = String(b.full_name || '').replace(/\s+/g, ' ').trim();
  if (!name) errors.full_name = 'Vui lòng nhập họ và tên.';
  else if (name.length > 100) errors.full_name = 'Họ và tên tối đa 100 ký tự.';
  const ph = normalizeAndValidatePhone(String(b.phone || ''));
  if (!String(b.phone || '').trim()) errors.phone = 'Vui lòng nhập số điện thoại.';
  else if (ph.error || !ph.normalized) errors.phone = 'Số điện thoại chưa đúng (VD: 0912345678).';
  const email = String(b.email || '').trim();
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = 'Email chưa đúng định dạng.';
  const area = String(b.area || '').trim();
  if (area.length > 100) errors.area = 'Tối đa 100 ký tự.';
  const note = String(b.note || '').trim();
  if (note.length > 1000) errors.note = 'Tối đa 1.000 ký tự.';
  if (b.consent !== true) errors.consent = 'Vui lòng đồng ý để chúng tôi lưu và sử dụng thông tin.';

  let info: CvInfo | null = null;
  if (cv && cv.size > 0) {
    const cvName = String(cv.name || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const ext = (cvName.lastIndexOf('.') >= 0 ? cvName.slice(cvName.lastIndexOf('.') + 1) : '').toLowerCase();
    if (!CV_MIME[ext]) errors.cv = 'Chỉ nhận file PDF, DOC, DOCX, JPG, PNG.';
    else if (cv.size > APPLY_CV_MAX_BYTES) errors.cv = 'File CV tối đa 5 MB.';
    else if (!magicMatches('.' + ext, cv.head)) errors.cv = 'Nội dung file không đúng với đuôi file.';
    else info = { name: cvName, ext, mime: CV_MIME[ext] };
  }
  if (Object.keys(errors).length) return { ok: false, fields: errors };
  const clean = (v: string) => String(sanitizeCellForSpreadsheet(v));
  return {
    ok: true,
    clean: { full_name: clean(name), phone: ph.normalized, email: clean(email), area: clean(area), position: clean(position), note: clean(note) },
    cv: info,
  };
}

/**
 * Tên file CV trên Drive: <TA>_<Vị trí>_<Họ tên>.<đuôi>
 * <TA> là mã PIC của link (VD TA3-Thang), link chung là Admin. Ví dụ: TA3-Thang_Kế toán_Nguyễn Văn A.pdf
 */
export function applyCvFileName(taLabel: string, position: string, name: string, ext: string): string {
  const body = [taLabel, position, name].join('_').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
  return body + '.' + ext;
}

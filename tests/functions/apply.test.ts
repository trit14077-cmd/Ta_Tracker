// M7-3: Edge `apply` – kiểm form ứng tuyển như hApplySubmit_ (Apply.gs).
import { describe, expect, it } from 'vitest';
import { applyCvFileName, validateApply } from '../../supabase/functions/apply/logic.ts';

const OK = { full_name: '  Nguyễn   Văn A ', phone: '0912 345 678', email: '', area: 'Bình Dương', note: '', consent: true, website: '' };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]);

describe('validateApply', () => {
  it('hợp lệ: chuẩn hóa tên, SĐT 9 số', () => {
    const r = validateApply(OK, null);
    expect(r).toEqual({ ok: true, cv: null, clean: { full_name: 'Nguyễn Văn A', phone: '912345678', email: '', area: 'Bình Dương', note: '' } });
  });
  it('báo lỗi từng ô như hệ cũ', () => {
    const r = validateApply({ ...OK, full_name: '', phone: '123', email: 'x@', note: 'a'.repeat(1001), consent: false }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fields).toEqual({
        full_name: 'Vui lòng nhập họ và tên.', phone: 'Số điện thoại chưa đúng (VD: 0912345678).', email: 'Email chưa đúng định dạng.',
        note: 'Tối đa 1.000 ký tự.', consent: 'Vui lòng đồng ý để chúng tôi lưu và sử dụng thông tin.',
      });
    }
  });
  it('thiếu SĐT', () => {
    const r = validateApply({ ...OK, phone: '  ' }, null);
    expect(!r.ok && r.fields.phone).toBe('Vui lòng nhập số điện thoại.');
  });
  it('CV: đuôi, ≤5 MB, nội dung đúng đuôi', () => {
    expect(validateApply(OK, { name: 'cv.pdf', size: 1000, head: PDF })).toMatchObject({ ok: true, cv: { name: 'cv.pdf', ext: 'pdf', mime: 'application/pdf' } });
    expect(validateApply(OK, { name: 'cv.exe', size: 10, head: PDF })).toMatchObject({ ok: false, fields: { cv: 'Chỉ nhận file PDF, DOC, DOCX, JPG, PNG.' } });
    expect(validateApply(OK, { name: 'cv.pdf', size: 5 * 1024 * 1024 + 1, head: PDF })).toMatchObject({ ok: false, fields: { cv: 'File CV tối đa 5 MB.' } });
    expect(validateApply(OK, { name: 'cv.pdf', size: 10, head: new Uint8Array([0x4d, 0x5a]) })).toMatchObject({ ok: false, fields: { cv: 'Nội dung file không đúng với đuôi file.' } });
  });
  it('chặn công thức bảng tính trong ô chữ', () => {
    const r = validateApply({ ...OK, note: '=HYPERLINK("x")' }, null);
    expect(r.ok && r.clean.note.startsWith('=')).toBe(false);
  });
});

it('tên file CV trên Drive như hệ cũ', () => {
  expect(applyCvFileName('912345678', 'Nguyễn/Văn A', 'pdf')).toBe('UngTuyen_912345678_Nguyễn_Văn A.pdf');
});

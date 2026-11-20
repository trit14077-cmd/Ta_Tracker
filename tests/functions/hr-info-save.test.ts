// M6-4: Edge hr-info-save – phần thuần (logic.ts), hành vi như HrInfo.gs hHrPut_ / hHrVerify_.
import { describe, expect, it } from 'vitest';
import { mapHrRpcError, parseHrRequest, planHrSave, planHrVerify } from '../../supabase/functions/hr-info-save/logic.ts';

const passed = { r1_status: 'Passed', r2_status: 'Passed' };
const full: Record<string, string> = {
  full_name: 'Nguyễn Văn A', birth_date: '01/01/1995', phone: '0901234567', email: 'a.nguyen@gmail.com', birth_place: 'Bình Dương',
  gender: 'Nam', address_permanent: 'Thuận An, Bình Dương', address_current: 'Thuận An, Bình Dương', marital_status: 'Độc thân',
  ethnicity: 'Kinh', religion: 'Không', id_number: '079200001234', id_issue_date: '20.10.2021', id_expiry_date: '01/01/2035',
  id_issue_place: 'Bộ Công An', edu_level: 'Đại học', study_period: '2013 - 2017', bank_name: 'VCB - Bình Dương', bank_account: '0123456789',
  bank_holder: 'NGUYEN VAN A', emergency_name: 'Nguyễn Thị B', emergency_relation: 'Mẹ', emergency_phone: '0912345678',
  tax_code: 'không', dependents: 'Không', social_insurance_no: 'KHONG', health_facility: 'BV Bình Dương',
};

describe('parseHrRequest', () => {
  it('save: mode khác submit là nháp (như hệ cũ); verify mặc định true', () => {
    expect(parseHrRequest({ op: 'save', record_id: 3, mode: 'x', data: {} })).toEqual({ ok: true, req: { op: 'save', record_id: 3, mode: 'draft', data: {} } });
    expect(parseHrRequest({ op: 'verify', record_id: 3 })).toEqual({ ok: true, req: { op: 'verify', record_id: 3, verified: true } });
    expect(parseHrRequest({ op: 'verify', record_id: 3, verified: false })).toEqual({ ok: true, req: { op: 'verify', record_id: 3, verified: false } });
    expect(parseHrRequest({ op: 'save', record_id: 0, data: {} }).ok).toBe(false);
    expect(parseHrRequest({ op: 'xoa', record_id: 1 }).ok).toBe(false);
  });
});

describe('planHrSave (= hHrPut_)', () => {
  it('nháp được phép thiếu; dòng nhật ký chỉ có tên trường đổi', () => {
    const r = planHrSave(passed, null, 'draft', { full_name: 'Nguyễn Văn A', id_number: '079 2000 01234' });
    expect(r.ok && r.status).toBe('draft');
    expect(r.ok && r.idNumber).toBe('079200001234');
    expect(r.ok && r.audit).toBe('Lưu nháp: Họ tên đầy đủ, Số Căn cước công dân (CCCD)');
  });
  it('gửi đủ: chuẩn hóa ngày / mã số thuế / BHXH như shared', () => {
    const r = planHrSave(passed, null, 'submit', full);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe('submitted');
      expect(r.clean.id_issue_date).toBe('20/10/2021');
      expect(r.clean.tax_code).toBe('KHÔNG');
      expect(r.audit.startsWith('Nhập đủ: ')).toBe(true);
    }
  });
  it('gửi thiếu => 400 VALIDATION_FAILED có lỗi theo trường', () => {
    const r = planHrSave(passed, null, 'submit', { full_name: 'A' });
    expect(!r.ok && r.error.code).toBe('VALIDATION_FAILED');
    expect(!r.ok && r.error.fields?.id_number).toBe('Bắt buộc phải nhập.');
  });
  it('không đổi gì => "(không đổi)"', () => {
    const first = planHrSave(passed, null, 'submit', full);
    const r = planHrSave(passed, { status: 'submitted', data: first.ok ? first.clean : {} }, 'submit', full);
    expect(r.ok && r.audit).toBe('Nhập đủ (không đổi)');
  });
  it('đã xác nhận => 409 LOCKED; chưa đạt R2 => 400 NOT_ELIGIBLE', () => {
    expect(planHrSave(passed, { status: 'verified', data: {} }, 'draft', {})).toMatchObject({ ok: false, error: { status: 409, code: 'LOCKED' } });
    expect(planHrSave({ r2_status: 'Pending' }, null, 'draft', {})).toMatchObject({ ok: false, error: { status: 400, code: 'NOT_ELIGIBLE' } });
  });
});

describe('planHrVerify (= hHrVerify_)', () => {
  it('xác nhận cần đủ + hợp lệ', () => {
    expect(planHrVerify({ status: 'submitted', data: full }, true)).toEqual({ ok: true, status: 'verified', audit: 'Xác nhận thông tin nhân sự' });
    expect(planHrVerify({ status: 'draft', data: { full_name: 'A' } }, true)).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Thông tin chưa đủ hoặc chưa hợp lệ nên chưa xác nhận được.' } });
    expect(planHrVerify({ status: 'verified', data: full }, true)).toMatchObject({ ok: false, error: { status: 409, code: 'LOCKED' } });
    expect(planHrVerify(null, true)).toMatchObject({ ok: false, error: { status: 404, code: 'NO_HR_INFO' } });
  });
  it('mở lại chỉ khi đang xác nhận', () => {
    expect(planHrVerify({ status: 'verified', data: full }, false)).toEqual({ ok: true, status: 'submitted', audit: 'Mở lại thông tin nhân sự để sửa' });
    expect(planHrVerify({ status: 'submitted', data: full }, false)).toMatchObject({ ok: false, error: { status: 409, code: 'NOT_VERIFIED' } });
  });
});

describe('mapHrRpcError', () => {
  it('PTxxx -> HTTP, message theo mã; lỗi khác -> 500 chung', () => {
    expect(mapHrRpcError({ code: 'PT409', message: 'CHANGED' })).toEqual({ status: 409, code: 'CHANGED', message: 'Thông tin nhân sự vừa được người khác sửa. Hãy tải lại rồi thử lại.' });
    expect(mapHrRpcError({ code: 'PT404', message: 'NOT_FOUND' }).status).toBe(404);
    expect(mapHrRpcError({ code: '42P01', message: 'x' }).code).toBe('SERVER_ERROR');
  });
});

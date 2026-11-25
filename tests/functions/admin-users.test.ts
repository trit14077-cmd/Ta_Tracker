// M3-2: kiểm tra yêu cầu của Edge admin-users (phần thuần, không cần Deno/DB).
import { describe, expect, it } from 'vitest';
import {
  auditChanges, corsHeaders, finalRoleCheck, internManagerCheck, parseRequest, selfLockout, usernameToEmail,
} from '../../supabase/functions/admin-users/logic.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const ok = (body: unknown) => {
  const p = parseRequest(body);
  if (!p.ok) throw new Error('mong đợi hợp lệ: ' + JSON.stringify(p.error));
  return p.req;
};
const err = (body: unknown) => {
  const p = parseRequest(body);
  if (p.ok) throw new Error('mong đợi lỗi');
  return p.error;
};

describe('create', () => {
  const base = { op: 'create', username: 'ta.phat', full_name: ' Phát ', role: 'pic', pic_code: 'TA1-Phat', temp_password: 'TamThoi-123' };
  it('hợp lệ; tên được cắt khoảng trắng', () => {
    expect(ok(base)).toMatchObject({ op: 'create', username: 'ta.phat', full_name: 'Phát', role: 'pic', pic_code: 'TA1-Phat' });
  });
  it('TA thiếu PIC => MISSING_PIC (như hệ cũ: "pic user without a PIC code rejected")', () => {
    expect(err({ ...base, pic_code: '' }).code).toBe('MISSING_PIC');
  });
  it('Admin không cần PIC', () => {
    expect(ok({ ...base, role: 'admin', pic_code: '' })).toMatchObject({ role: 'admin', pic_code: null });
  });
  it.each([
    ['username quá ngắn', { username: 'ab' }, 'username'],
    ['username có dấu/khoảng trắng', { username: 'phát nguyễn' }, 'username'],
    ['vai trò lạ', { role: 'root' }, 'role'],
    ['mật khẩu < 8 ký tự (như hệ cũ)', { temp_password: 'short' }, 'temp_password'],
  ])('từ chối: %s', (_n, extra, field) => {
    const e = err({ ...base, ...extra });
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.fields).toHaveProperty(field as string);
  });
});

describe('update / reset_password', () => {
  it('chỉ giữ các trường được gửi', () => {
    expect(ok({ op: 'update', id: ID, active: false, can_view_all_targets: true })).toEqual({ op: 'update', id: ID, active: false, can_view_all_targets: true });
  });
  it('không có thay đổi nào => lỗi', () => {
    expect(err({ op: 'update', id: ID }).code).toBe('VALIDATION_FAILED');
  });
  it('id sai định dạng => lỗi', () => {
    expect(err({ op: 'update', id: '123', active: true }).fields).toHaveProperty('id');
  });
  it('active / can_view_all_targets phải là boolean', () => {
    expect(err({ op: 'update', id: ID, active: 'false' }).fields).toHaveProperty('active');
    expect(err({ op: 'update', id: ID, can_view_all_targets: 1 }).fields).toHaveProperty('can_view_all_targets');
  });
  it('đặt lại mật khẩu kiểm độ dài', () => {
    expect(ok({ op: 'reset_password', id: ID, temp_password: 'MatKhau-Moi1' })).toMatchObject({ op: 'reset_password', id: ID });
    expect(err({ op: 'reset_password', id: ID, temp_password: '1234567' }).fields).toHaveProperty('temp_password');
  });
  it('op lạ => INVALID_OP', () => {
    expect(err({ op: 'delete', id: ID }).code).toBe('INVALID_OP');
    expect(err(null).code).toBe('VALIDATION_FAILED');
  });
});

describe('quy tắc nghiệp vụ', () => {
  it('đổi sang TA mà không có PIC => MISSING_PIC', () => {
    expect(finalRoleCheck('pic', null)?.code).toBe('MISSING_PIC');
    expect(finalRoleCheck('admin', null)).toBeNull();
  });
  it('Admin không tự khóa / tự hạ quyền mình', () => {
    expect(selfLockout(ID, { op: 'update', id: ID, active: false })?.code).toBe('SELF_LOCKOUT');
    expect(selfLockout(ID, { op: 'update', id: ID, role: 'pic', pic_code: 'TA1-Phat' })?.code).toBe('SELF_LOCKOUT');
    expect(selfLockout(ID, { op: 'update', id: ID, full_name: 'Tên mới' })).toBeNull();
    expect(selfLockout('khac', { op: 'update', id: ID, active: false })).toBeNull();
  });
  it('audit không bao giờ chứa mật khẩu', () => {
    const r = ok({ op: 'reset_password', id: ID, temp_password: 'BiMat-12345' });
    expect(JSON.stringify(auditChanges(r))).not.toContain('BiMat');
  });
  it('username -> email giả chữ thường (D-05b)', () => {
    expect(usernameToEmail(' TA.Phat ')).toBe('ta.phat@ta.supra.internal');
  });
  it('CORS chỉ mở cho origin trong danh sách', () => {
    expect(corsHeaders('https://app.example', ['https://app.example'])['Access-Control-Allow-Origin']).toBe('https://app.example');
    expect(corsHeaders('https://evil.example', ['https://app.example'])['Access-Control-Allow-Origin']).toBe('');
  });

  describe('TA quản lý nhóm tạo Intern', () => {
    const me = ID;
    const other = '00000000-0000-4000-8000-000000000002';
    const create = (o: Record<string, unknown>) =>
      ok({ op: 'create', username: 'Intern23-NM.Linh', full_name: 'x', role: 'pic', pic_code: 'Intern23-NM.Linh', temp_password: 'Linh@123', ...o });
    it('chỉ tạo role pic với PIC Intern', () => {
      expect(internManagerCheck(me, create({}))).toBeNull();
      expect(internManagerCheck(me, create({ role: 'admin', pic_code: null }))?.status).toBe(403);
      expect(internManagerCheck(me, create({ pic_code: 'TA6-T.Thuong' }))?.status).toBe(403);
    });
    it('chỉ khóa/đổi tên/đặt lại MK Intern do mình tạo', () => {
      expect(internManagerCheck(me, ok({ op: 'update', id: other, active: false }), me)).toBeNull();
      expect(internManagerCheck(me, ok({ op: 'update', id: other, active: false }), null)?.status).toBe(403);
      expect(internManagerCheck(me, ok({ op: 'reset_password', id: other, temp_password: 'Abcd1234' }), other)?.status).toBe(403);
      expect(internManagerCheck(me, ok({ op: 'reset_password', id: other, temp_password: 'Abcd1234' }), me)).toBeNull();
    });
    it('không đổi role, PIC, target', () => {
      expect(internManagerCheck(me, ok({ op: 'update', id: other, pic_code: 'TA1-Phat' }), me)?.status).toBe(403);
      expect(internManagerCheck(me, ok({ op: 'update', id: other, role: 'admin' }), me)?.status).toBe(403);
      expect(internManagerCheck(me, ok({ op: 'update', id: other, can_view_all_targets: true }), me)?.status).toBe(403);
    });
  });
});

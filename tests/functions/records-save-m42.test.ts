// M4-2: các tiêu chí ghi hồ sơ ở tầng Edge records-save.
// (1) 409 khi lệch version; (2) khóa trường theo vòng rớt (FIELD_LOCKED, triển khai là STEP_LOCKED – API_SPEC 1.2);
// (3) TA không sửa hồ sơ PIC khác; (4) `pic` chỉ Admin đổi.
// Tầng DB của cùng các ý đã có ở supabase/tests/rpc_test.sql (PT409/PT404/PT403) và rls_test.sql.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  checkAccess, checkVersion, mapRpcError, rowToStrings, validatePatch, type Actor,
} from '../../supabase/functions/records-save/logic.ts';
import { seedConfig } from '../shared/seedConfig.ts';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T03:00:00Z'));
});
afterAll(() => vi.useRealTimers());

const cfg = seedConfig({ pic: ['TA1-Phat', 'TA2-Hien'] });
const ta1: Actor = { id: 'u-ta1', role: 'pic', pic_code: 'TA1-Phat' };
const ta2: Actor = { id: 'u-ta2', role: 'pic', pic_code: 'TA2-Hien' };
const taNoPic: Actor = { id: 'u-ta0', role: 'pic', pic_code: null };
const admin: Actor = { id: 'u-ad', role: 'admin', pic_code: null };

const base = {
  full_name: 'Nguyen Moi', gender: 'Nữ', birth: '1999', phone: '854498989', position: 'Nhân viên Kho', site: 'DC Bình Dương 1',
  region: 'Miền Nam', location: 'Bình Dương', unit: 'Chuỗi Cung ứng', dept: 'Ambient Retail', rank: '6A', sub_source: 'Zalo',
};
const dbRow = { id: 7, row_version: 3, candidate_code: 'TA10007', pic: 'TA1-Phat', ...base, r1_status: '', r2_status: '', ob_status: '' };
const failedR1 = rowToStrings({ ...dbRow, r1_status: 'Failed', r1_sub_status: 'Độ tuổi', r1_date: '2026-11-03' });
const fresh = rowToStrings(dbRow);

describe('M4-2 (1) – 409 khi lệch version', () => {
  it('đúng version: cho qua', () => {
    expect(checkVersion(dbRow, 3)).toBeNull();
  });
  it('version cũ hơn hoặc mới hơn: 409 VERSION_CONFLICT kèm bản hiện tại', () => {
    for (const v of [2, 4]) {
      const e = checkVersion(dbRow, v);
      expect(e?.status).toBe(409);
      expect(e?.code).toBe('VERSION_CONFLICT');
      expect((e?.details as { current: unknown }).current).toBe(dbRow);
    }
  });
  it('row_version trả về dạng chuỗi vẫn so đúng', () => {
    expect(checkVersion({ ...dbRow, row_version: '3' }, 3)).toBeNull();
  });
  it('RPC save_record báo PT409 (đua ghi giữa lúc đọc và lúc ghi) cũng thành 409 kèm current', () => {
    const e = mapRpcError({ code: 'PT409', message: 'VERSION_CONFLICT', details: JSON.stringify(dbRow) });
    expect(e.status).toBe(409);
    expect(e.code).toBe('VERSION_CONFLICT');
  });
});

describe('M4-2 (2) – khóa trường theo vòng rớt', () => {
  it('rớt R1: TA và Admin đều không sửa được bước R2/OB', () => {
    for (const who of [ta1, admin]) {
      const v = validatePatch(who, failedR1, { r2_status: 'Pending', r2_date: '20/11/2026' }, cfg);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.error.status).toBe(422);
        expect(v.error.code).toBe('STEP_LOCKED');
        expect(v.error.fields).toHaveProperty('r2_status');
      }
    }
  });
  it('trường không bị khóa (thông tin ứng viên, ghi chú R1) vẫn sửa được', () => {
    expect(validatePatch(ta1, failedR1, { r1_note: 'Gọi lại sau' }, cfg).ok).toBe(true);
    expect(validatePatch(ta1, failedR1, { full_name: 'Nguyen Moi B' }, cfg).ok).toBe(true);
  });
  it('chưa rớt vòng nào: không khóa', () => {
    expect(validatePatch(ta1, fresh, { r1_status: 'Pending', r1_date: '20/11/2026' }, cfg).ok).toBe(true);
  });
});

describe('M4-2 (3) – TA không sửa hồ sơ PIC khác', () => {
  it('TA thấy hồ sơ PIC mình', () => {
    expect(checkAccess(ta1, dbRow)).toBeNull();
  });
  it('TA PIC khác: 404 NOT_FOUND (không lộ hồ sơ có tồn tại)', () => {
    const e = checkAccess(ta2, dbRow);
    expect(e?.status).toBe(404);
    expect(e?.code).toBe('NOT_FOUND');
  });
  it('hồ sơ chưa gán PIC: chỉ Admin thấy; TA chưa có mã PIC cũng không thấy', () => {
    const noPic = { ...dbRow, pic: null };
    expect(checkAccess(admin, noPic)).toBeNull();
    expect(checkAccess(ta1, noPic)?.code).toBe('NOT_FOUND');
    expect(checkAccess(taNoPic, noPic)?.code).toBe('NOT_FOUND');
  });
  it('hồ sơ không tồn tại: 404', () => {
    expect(checkAccess(admin, null)?.code).toBe('NOT_FOUND');
  });
  it('Admin thấy hồ sơ mọi PIC', () => {
    expect(checkAccess(admin, dbRow)).toBeNull();
    expect(checkAccess(admin, { ...dbRow, pic: 'TA2-Hien' })).toBeNull();
  });
  it('thứ tự kiểm: hồ sơ PIC khác + version cũ vẫn trả 404, không trả 409 kèm dữ liệu', () => {
    const first = checkAccess(ta2, dbRow) ?? checkVersion(dbRow, 1);
    expect(first?.status).toBe(404);
    expect(first?.details).toBeUndefined();
  });
  it('RPC save_record báo PT404 (PIC bị đổi giữa chừng) thành 404', () => {
    expect(mapRpcError({ code: 'PT404', message: 'NOT_FOUND' }).status).toBe(404);
  });
});

describe('M4-2 (4) – `pic` chỉ Admin đổi', () => {
  it('TA đổi pic: 403 FORBIDDEN_PIC_CHANGE', () => {
    const v = validatePatch(ta1, fresh, { pic: 'TA2-Hien' }, cfg);
    expect(!v.ok && v.error.status).toBe(403);
    expect(!v.ok && v.error.code).toBe('FORBIDDEN_PIC_CHANGE');
  });
  it('TA gửi lại đúng pic của mình (form gửi cả bản ghi) thì không bị chặn', () => {
    expect(validatePatch(ta1, fresh, { pic: 'TA1-Phat', r1_note: 'x' }, cfg).ok).toBe(true);
  });
  it('Admin đổi pic được', () => {
    const v = validatePatch(admin, fresh, { pic: 'TA2-Hien' }, cfg);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.values.pic).toBe('TA2-Hien');
  });
  it('RPC báo PT403 FORBIDDEN thành 403', () => {
    const e = mapRpcError({ code: 'PT403', message: 'FORBIDDEN' });
    expect(e.status).toBe(403);
    expect(e.code).toBe('FORBIDDEN');
  });
});

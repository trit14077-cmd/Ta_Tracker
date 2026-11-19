// M4-1: phần thuần của Edge records-save. Ca lấy từ hành vi Api.gs (hCreateCandidate_, hPatchCandidate_, hMoveCandidate_).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildConfig, mapRpcError, maskDuplicates, parseRequest, planMove, rowToStrings, toDbValues, validateCreate, validatePatch,
  type Actor,
} from '../../supabase/functions/records-save/logic.ts';
import { seedConfig } from '../shared/seedConfig.ts';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T03:00:00Z'));
});
afterAll(() => vi.useRealTimers());

const cfg = seedConfig({ pic: ['TA1-Phat', 'TA2-Hien'] });
const ta: Actor = { id: 'u-ta', role: 'pic', pic_code: 'TA1-Phat' };
const admin: Actor = { id: 'u-ad', role: 'admin', pic_code: null };
const values = {
  full_name: 'Nguyen Moi', gender: 'Nữ', birth: '1999', phone: '0854 498 989', position: 'Nhân viên Kho', site: 'DC Bình Dương 1',
  region: 'Miền Nam', location: 'Bình Dương', unit: 'Chuỗi Cung ứng', dept: 'Ambient Retail', rank: '6A', sub_source: 'Zalo',
};
// Hồ sơ đã lưu, dạng chuỗi như rowToStrings trả về
const existing = rowToStrings({
  id: 7, row_version: 3, candidate_code: 'TA10007', pic: 'TA1-Phat', ...values, phone: '854498989',
  r1_status: 'Failed', r1_sub_status: 'Độ tuổi', r1_date: '2026-11-03', r2_status: '', ob_status: '', basic_salary: null, ob_date: null,
});

describe('parseRequest', () => {
  it('nhận đủ 5 thao tác', () => {
    expect(parseRequest({ op: 'create', values: {} }).ok).toBe(true);
    expect(parseRequest({ op: 'patch', id: 1, expected_version: 1, changes: {} }).ok).toBe(true);
    expect(parseRequest({ op: 'move', id: 1, expected_version: 1, target_box: 'r2' }).ok).toBe(true);
    expect(parseRequest({ op: 'archive', id: 1, expected_version: 1 }).ok).toBe(true);
    expect(parseRequest({ op: 'restore', id: 1, expected_version: 1 }).ok).toBe(true);
  });
  it('thiếu phiên bản / id / op lạ bị từ chối', () => {
    expect(parseRequest({ op: 'patch', id: 1, changes: {} }).ok).toBe(false);
    expect(parseRequest({ op: 'archive', id: '1', expected_version: 1 }).ok).toBe(false);
    const r = parseRequest({ op: 'delete', id: 1, expected_version: 1 });
    expect(!r.ok && r.error.code).toBe('INVALID_OP');
  });
});

describe('buildConfig', () => {
  it('dựng Drop-list, PIC từ bảng pics, sub_source, phân cấp', () => {
    const c = buildConfig(
      [{ list_key: 'gender', value: 'Nam', active: true }, { list_key: 'gender', value: 'Cũ', active: false }],
      [{ code: 'TA1-Phat', active: true }],
      [{ sub_source: 'Zalo', source: 'Social Media' }],
      [{ parent_type: 'region', parent_value: 'Miền Nam', child_value: 'Bình Dương' }, { parent_type: 'location', parent_value: 'Bình Dương', child_value: 'DC Bình Dương 1' }],
    );
    expect(c.lists.gender).toHaveLength(2);
    expect(c.lists.pic).toEqual([{ value: 'TA1-Phat', active: true }]);
    expect(c.subSourceMapping.Zalo).toBe('Social Media');
    expect(c.regionToLocations['Miền Nam']).toEqual(['Bình Dương']);
    expect(c.locationToSites['Bình Dương']).toEqual(['DC Bình Dương 1']);
  });
});

describe('tạo mới', () => {
  it('TA: PIC bị ép theo tài khoản, mã gõ tay bị bỏ, dùng mã gợi ý', () => {
    const v = validateCreate(ta, { ...values, candidate_code: 'HACK9' }, cfg, 'TA10001');
    expect(v.ok && v.values.pic).toBe('TA1-Phat');
    expect(v.ok && v.values.candidate_code).toBe('TA10001');
    expect(v.ok && v.values.source).toBe('Social Media');
    expect(v.ok && v.values.phone).toBe('854498989');
  });
  it('TA chọn PIC khác => FORBIDDEN_PIC (403)', () => {
    const v = validateCreate(ta, { ...values, pic: 'TA2-Hien' }, cfg, 'TA10001');
    expect(!v.ok && v.error.code).toBe('FORBIDDEN_PIC');
  });
  it('Admin có PIC: dùng mã gợi ý theo PIC đó', () => {
    const v = validateCreate(admin, { ...values, pic: 'TA2-Hien' }, cfg, 'TA20001');
    expect(v.ok && v.values.candidate_code).toBe('TA20001');
  });
  it('thiếu trường bắt buộc => VALIDATION_FAILED kèm lỗi theo field', () => {
    const v = validateCreate(ta, { ...values, gender: '' }, cfg, 'TA10001');
    expect(!v.ok && v.error.code).toBe('VALIDATION_FAILED');
    expect(!v.ok && v.error.fields).toHaveProperty('gender');
  });
});

describe('sửa hồ sơ', () => {
  it('TA đổi PIC => FORBIDDEN_PIC_CHANGE; TA đổi mã => FORBIDDEN', () => {
    const a = validatePatch(ta, existing, { pic: 'TA2-Hien' }, cfg);
    expect(!a.ok && a.error.code).toBe('FORBIDDEN_PIC_CHANGE');
    const b = validatePatch(ta, existing, { candidate_code: 'KHAC' }, cfg);
    expect(!b.ok && b.error.code).toBe('FORBIDDEN');
  });
  it('rớt R1: sửa bước sau => STEP_LOCKED; sửa ghi chú R1 vẫn được', () => {
    const locked = validatePatch(ta, existing, { r2_status: 'Pending', r2_date: '20/11/2026' }, cfg);
    expect(!locked.ok && locked.error.code).toBe('STEP_LOCKED');
    expect(!locked.ok && locked.error.fields).toHaveProperty('r2_status');
    const ok = validatePatch(ta, existing, { r1_note: 'Gọi lại sau' }, cfg);
    expect(ok.ok).toBe(true);
  });
  it('mở lại vòng rớt (đổi R1 Failed -> Passed) rồi mới sửa bước sau', () => {
    const v = validatePatch(ta, existing, { r1_status: 'Passed', r1_sub_status: '', r2_status: 'Pending', r2_date: '20/11/2026' }, cfg);
    expect(v.ok).toBe(true);
  });
});

describe('kéo thả Kanban', () => {
  it('hợp lệ: changes + ô cũ/ô mới', () => {
    const e = rowToStrings({ r1_status: 'Passed' });
    const m = planMove(e, 'r2');
    expect(m.ok && m).toMatchObject({ changes: { r2_status: 'Pending' }, from: 'lusu', to: 'r2' });
  });
  it('hồ sơ đã rớt / kéo lùi => 409 MOVE_*', () => {
    const a = planMove(existing, 'lusu');
    expect(!a.ok && a.error).toMatchObject({ status: 409, code: 'MOVE_FAILED' });
    const b = planMove(rowToStrings({ r1_status: 'Passed', r2_status: 'Pending' }), 'r1');
    expect(!b.ok && b.error.code).toBe('MOVE_BACKWARD');
  });
});

describe('chuyển sang DB và lỗi RPC', () => {
  it("'' -> null cho ngày/số, bỏ field tính khi đọc", () => {
    const d = toDbValues({ full_name: 'A', r1_date: '', basic_salary: '', probation_pct: '85', tenor: '<1D', cv_file: 'x', created_at: 'x' });
    expect(d).toMatchObject({ full_name: 'A', r1_date: null, basic_salary: null, probation_pct: '85' });
    expect(d).not.toHaveProperty('tenor');
    expect(d).not.toHaveProperty('cv_file');
    expect(d).not.toHaveProperty('created_at');
  });
  it('PTxxx -> HTTP; VERSION_CONFLICT kèm bản hiện tại', () => {
    expect(mapRpcError({ code: 'PT404', message: 'NOT_FOUND' })).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    const c = mapRpcError({ code: 'PT409', message: 'VERSION_CONFLICT', details: '{"id":7,"row_version":4}' });
    expect(c).toMatchObject({ status: 409, code: 'VERSION_CONFLICT', details: { current: { id: 7, row_version: 4 } } });
    expect(mapRpcError({ code: 'PT409', message: 'DUPLICATE_CODE', details: 'X1' }).message).toContain('X1');
    expect(mapRpcError({ code: '42883', message: 'function x does not exist' })).toMatchObject({ status: 500, code: 'SERVER_ERROR' });
  });
  it('trùng SĐT: TA không thấy hồ sơ của PIC khác (maskForeign_)', () => {
    const rows = [{ id: 1, candidate_code: 'TA10001', full_name: 'A', pic: 'TA1-Phat' }, { id: 2, candidate_code: 'TA20001', full_name: 'B', pic: 'TA2-Hien' }];
    expect(maskDuplicates(rows, admin)).toEqual(rows);
    const m = maskDuplicates(rows, ta);
    expect(m[0]).toEqual(rows[0]);
    expect(m[1]).toEqual({ id: 0, candidate_code: '(ẩn)', full_name: 'Ứng viên của PIC khác', pic: '' });
  });
});

// M1-2: quy tắc nhập hồ sơ. Mỗi ca lấy từ test tích hợp cũ OLD/apps-script/test/run.mjs (ghi số dòng),
// nhưng gọi thẳng hàm dùng chung thay vì đi qua API Apps Script.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  computeObMonth,
  computeSourceFromSubSource,
  computeTenor,
  normalizeAndValidatePhone,
  normalizeBirth,
  normalizeCvLink,
  parseDisplayDateToIso,
  sanitizeCellForSpreadsheet,
  validateAndComputeCandidate,
} from '../../shared/validation.ts';
import { seedConfig } from './seedConfig.ts';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T03:00:00Z'));
});
afterAll(() => vi.useRealTimers());

const cfg = seedConfig({ pic: ['TA1-Phat', 'TA2-Hien', 'TA3-Thang'] });

// run.mjs:87 – hồ sơ mẫu của test cũ
const base: Record<string, string> = {
  candidate_code: 'TA10000', pic: 'TA1-Phat', full_name: 'Nguyen Van Test', gender: 'Nam', birth: '15/08/1999', phone: '0854 498 989', email: '',
  position: 'Nhân viên Kho', rank: '6A', region: 'Miền Bắc', location: 'Bắc Ninh', unit: 'Chuỗi Cung ứng', dept: 'Ambient Retail', site: 'DC Bắc Ninh',
  sub_source: 'Facebook Ads', r1_date: '03/11/2026', r1_time: '09:00', r1_status: 'Passed', ob_date: '05/11/2026', ob_status: 'Joined', emp_status: 'Active',
  source: 'FORGED', ob_month: 'FORGED', tenor: 'FORGED',
};
const v = (extra: Record<string, string> = {}, opts: Parameters<typeof validateAndComputeCandidate>[2] = {}) =>
  validateAndComputeCandidate({ ...base, ...extra }, cfg, opts);

describe('hàm chuẩn hóa đơn lẻ', () => {
  it('SĐT: bỏ khoảng trắng, 0 đầu, +84 → 9 số (run.mjs:96,117)', () => {
    expect(normalizeAndValidatePhone('0854 498 989').normalized).toBe('854498989');
    expect(normalizeAndValidatePhone('+84854498989').normalized).toBe('854498989');
    expect(normalizeAndValidatePhone('12345678').error).toBeTruthy();
    expect(normalizeAndValidatePhone('')).toMatchObject({ normalized: '' });
    expect(normalizeAndValidatePhone('').error).toBeUndefined();
  });
  it('ngày DD/MM/YYYY → ISO; sai định dạng và 31/02 bị từ chối (run.mjs:100,118,119)', () => {
    expect(parseDisplayDateToIso('05/11/2026')).toEqual({ iso: '2026-11-05' });
    expect(parseDisplayDateToIso('5-11-26').error).toBeTruthy();
    expect(parseDisplayDateToIso('31/02/2026').error).toBeTruthy();
  });
  it("ob_month dạng Mon'YY (run.mjs:98)", () => {
    expect(computeObMonth('2026-11-05')).toBe("Nov'26");
  });
  it('tenor theo khoảng ngày (run.mjs:105-111)', () => {
    expect(computeTenor('2026-11-05', 'Resigned', '2026-11-05')).toBe('<1D');
    expect(computeTenor('2026-11-05', 'Resigned', '2026-11-12')).toBe('<15D');
    expect(computeTenor('2026-11-05', 'Resigned', '2026-12-05')).toBe('>30D');
    expect(computeTenor('2026-11-05', 'Active', '', '2026-11-08')).toBe('<7D');
    expect(computeTenor('', 'Active', '')).toBe('');
  });
  it('source suy ra từ sub_source (run.mjs:97)', () => {
    expect(computeSourceFromSubSource('Facebook Ads', cfg.subSourceMapping)).toBe('Social Media');
    expect(computeSourceFromSubSource('', cfg.subSourceMapping)).toBe('');
  });
  it('ngày/năm sinh: 14–80 tuổi (run.mjs:332-334)', () => {
    expect(normalizeBirth('15/08/1999')).toEqual({ value: '15/08/1999' });
    expect(normalizeBirth('1999')).toEqual({ value: '1999' });
    expect(normalizeBirth('31/02/1999').error).toBeTruthy();
    expect(normalizeBirth('2020').error).toBeTruthy();
    // task #7: TA nhập năm hiện tại / tương lai -> báo lỗi (chặn lưu)
    const nov2026 = new Date(2026, 10, 27);
    expect(normalizeBirth('2026', nov2026).error).toMatch(/1946 đến 2012/);
    expect(normalizeBirth('15/08/2026', nov2026).error).toBeTruthy();
    expect(normalizeBirth('2030', nov2026).error).toBeTruthy();
    expect(normalizeBirth('2012', nov2026)).toEqual({ value: '2012' });
  });
  it('link CV: tự thêm https://, chuỗi không phải link bị từ chối (run.mjs:337,338)', () => {
    expect(normalizeCvLink('linkedin.com/in/abc')).toEqual({ value: 'https://linkedin.com/in/abc' });
    expect(normalizeCvLink('abc').error).toBeTruthy();
  });
  it('chống formula injection khi xuất bảng tính', () => {
    expect(sanitizeCellForSpreadsheet('=HYPERLINK("x")').startsWith("'")).toBe(true);
    expect(sanitizeCellForSpreadsheet('Nguyen Van A')).toBe('Nguyen Van A');
  });
});

describe('validateAndComputeCandidate – hồ sơ mẫu', () => {
  it('hợp lệ; field tự tính bỏ qua giá trị giả mạo (run.mjs:94-100)', () => {
    const r = v();
    expect(r.errors).toEqual({});
    expect(r.valid).toBe(true);
    expect(r.sanitized.phone).toBe('854498989');
    expect(r.sanitized.source).toBe('Social Media');
    expect(r.sanitized.ob_month).toBe("Nov'26");
    expect(['<1D', '<3D', '<7D', '<15D', '<30D', '>30D']).toContain(r.sanitized.tenor);
  });
  it('nghỉ việc trước ngày OB bị từ chối (run.mjs:112)', () => {
    expect(v({ emp_status: 'Resigned', attrition_date: '01/11/2026' }).valid).toBe(false);
  });
  it.each([
    ['SĐT 8 số', { phone: '12345678' }, 'run.mjs:115'],
    ['ngày sai định dạng', { r1_date: '5-11-26' }, 'run.mjs:118'],
    ['31/02', { r1_date: '31/02/2026' }, 'run.mjs:119'],
    ['vị trí ngoài Drop-list', { position: 'Không có trong danh sách' }, 'run.mjs:120'],
    ['tỉnh không thuộc vùng', { region: 'Miền Nam', location: 'Bắc Ninh' }, 'run.mjs:121'],
    ['kho không thuộc tỉnh', { location: 'Bắc Ninh', site: 'DC Hưng Yên' }, 'run.mjs:122'],
    ['email sai', { email: 'not-an-email' }, 'run.mjs:123'],
    ['mã có khoảng trắng', { candidate_code: 'TA 10019' }, 'run.mjs:126'],
    ['giờ ngoài 09:00–16:30', { r1_time: '08:30' }, 'run.mjs:127'],
  ])('từ chối: %s (%s)', (_name, extra, _src) => {
    expect(v(extra as Record<string, string>).valid).toBe(false);
  });
  it.each([
    ['email trống', { email: '' }, 'run.mjs:124'],
    ['SĐT trống', { phone: '' }, 'run.mjs:125'],
    ['thử việc ghi chữ + tiền + %', { probation_period: '2 tháng', basic_salary: '8500000', probation_pct: '85' }, 'run.mjs:128'],
  ])('chấp nhận: %s (%s)', (_name, extra, _src) => {
    expect(v(extra as Record<string, string>).errors).toEqual({});
  });
  it('ob_sub_status và hire_type tách riêng (run.mjs:130,131)', () => {
    const r = v({ ob_status: 'Canceled', ob_sub_status: 'Lương', hire_type: 'Tuyển mới' });
    expect(r.valid).toBe(true);
    expect(r.sanitized.hire_type).toBe('Tuyển mới');
    expect(r.sanitized.ob_sub_status).toBe('Lương');
  });
});

describe('trạng thái → lý do (run.mjs:289-296)', () => {
  it.each([
    ['R1 không có Canceled', { r1_status: 'Canceled' }, false],
    ['R1 Failed + lý do hợp lệ', { r1_status: 'Failed', r1_sub_status: 'Độ tuổi' }, true],
    ['R1 Passed kèm lý do', { r1_status: 'Passed', r1_sub_status: 'Lương' }, false],
    ['R1 Failed + lý do chỉ của R2', { r1_status: 'Failed', r1_sub_status: 'Thái độ' }, false],
    ['R2 Failed + Thái độ', { r2_status: 'Failed', r2_sub_status: 'Thái độ' }, true],
    ['R2 Failed + lý do phía ứng viên', { r2_status: 'Failed', r2_sub_status: 'Lương' }, false],
    ['OB Joined kèm lý do', { ob_status: 'Joined', ob_sub_status: 'Lương' }, false],
  ])('%s', (_name, extra, ok) => {
    expect(v(extra as Record<string, string>).valid).toBe(ok);
  });
  it('Failed thiếu lý do chỉ là cảnh báo', () => {
    const r = v({ r1_status: 'Failed' });
    expect(r.valid).toBe(true);
    expect(Object.keys(r.notices).length).toBeGreaterThan(0);
  });
});

describe('tạo mới bằng tay (isCreate) – run.mjs:331-341', () => {
  // Server cũ gán candidate_code (nextCandidateCode) và pic (PIC của TA) trước khi validate.
  const create: Record<string, string> = {
    candidate_code: 'TA10050', pic: 'TA1-Phat',
    full_name: 'Nguyen Moi', gender: 'Nữ', birth: '1999', ethnicity: 'Kinh', position: 'Nhân viên Kho', site: 'DC Bình Dương 1',
    region: 'Miền Nam', location: 'Bình Dương', unit: 'Chuỗi Cung ứng', dept: 'Ambient Retail', rank: '6A', sub_source: 'Zalo',
  };
  const c = (extra: Record<string, string> = {}) => validateAndComputeCandidate({ ...create, ...extra }, cfg, { isCreate: true });
  it('hồ sơ đủ trường bắt buộc hợp lệ', () => {
    expect(c().errors).toEqual({});
  });
  it.each(['gender', 'birth', 'position', 'site', 'sub_source'])('thiếu %s bị từ chối', (k) => {
    expect(c({ [k]: '' }).valid).toBe(false);
  });
  it('có ngày R1 mà không có trạng thái bị từ chối', () => {
    expect(c({ r1_date: '03/11/2026' }).valid).toBe(false);
  });
  it('giấy tờ: lái xe nâng đã Joined được cảnh báo thiếu sức khỏe, CCCD, bằng xe nâng (run.mjs:363)', () => {
    const r = c({ position: 'Nhân viên Lái xe nâng', ob_status: 'Joined' });
    expect(r.notices.health_check).toBeTruthy();
    expect(r.notices.id_card).toBeTruthy();
    expect(r.notices.forklift_cert).toBeTruthy();
  });
  it('giấy tờ: vị trí rank 4C không bắt buộc giấy tờ (run.mjs:365)', () => {
    const r = c({ position: 'Giám sát kho', rank: '4C', ob_status: 'Joined' });
    expect(r.notices.health_check).toBeFalsy();
    expect(r.notices.id_card).toBeFalsy();
  });
});

// M1-2: Kanban, giai đoạn, mã ứng viên, vị trí, lịch. Ca lấy từ OLD/apps-script/test/run_kanban.mjs, run.mjs, run_ops.mjs.
import { describe, expect, it } from 'vitest';
import { boardPosition, boardSub, lockedFieldKeys, moveChanges } from '../../shared/pipelineRules.ts';
import { currentStage } from '../../shared/stage.ts';
import { nextCandidateCode, picCodePrefix } from '../../shared/candidateCode.ts';
import { lookupPositionInfo } from '../../shared/positionMap.ts';
import { allowedReasons } from '../../shared/reasonRules.ts';
import { addDays, isoWeekKey, periodKeyOf, periodRange } from '../../shared/opsRules.ts';

describe('Kanban – vị trí ô (run_kanban.mjs:55)', () => {
  it.each([
    [{}, 'lead', null],
    [{ r1_status: 'Pending' }, 'r1', null],
    [{ r1_status: 'Passed' }, 'lusu', null],
    [{ r1_status: 'Passed', r2_status: 'Pending' }, 'r2', null],
    [{ r1_status: 'Passed', r2_status: 'Passed', ob_status: 'Pending' }, 'ob', null],
    [{ r1_status: 'Failed' }, 'r1', 'r1'],
    [{ r1_status: 'Passed', r2_status: 'Canceled' }, 'r2', 'r2'],
    [{ r1_status: 'Passed', r2_status: 'Passed', ob_status: 'Noshow' }, 'ob', 'ob'],
  ])('%j → %s (rớt ở %s)', (c, col, failedAt) => {
    expect(boardPosition(c)).toEqual({ col, failedAt });
  });
});

describe('Kanban – chỉ số phụ không trùng nhau (run_kanban.mjs:125-128)', () => {
  it.each([
    [{}, 'lead_new'],
    [{ r1_status: 'KIV' }, 'r1_wait'],
    [{ r1_status: 'Failed' }, null],
    [{ r1_status: 'Passed' }, 'su'],
    [{ r1_status: 'Passed', r2_date: '2026-11-20' }, 'lu'],
    [{ r1_status: 'Passed', r2_status: 'Pending' }, 'lu'],
    [{ r1_status: 'Passed', r2_status: 'Passed' }, 'r2_passed'],
    [{ r1_status: 'Passed', r2_status: 'Failed' }, 'r2_failed'],
    [{ r1_status: 'Passed', r2_status: 'Canceled' }, 'r2_canceled'],
    [{ ob_status: 'Không liên lạc được' }, 'ob_wait'],
    [{ ob_status: 'Joined' }, null],
  ])('%j → %s', (c, sub) => {
    expect(boardSub(c)).toBe(sub);
  });
});

describe('Kanban – kéo thả (run_kanban.mjs:66-91)', () => {
  it('Lead → R2: R1 Passed, R2 Pending', () => {
    expect(moveChanges({}, 'r2')).toEqual({ changes: { r1_status: 'Passed', r2_status: 'Pending' } });
  });
  it('R2 → OB: điền R2 Passed và OB Pending', () => {
    expect(moveChanges({ r1_status: 'Passed', r2_status: 'Pending' }, 'ob').changes).toEqual({ r2_status: 'Passed', ob_status: 'Pending' });
  });
  it('lý do không hợp với trạng thái mới bị xóa', () => {
    const r = moveChanges({ r1_status: 'Pending', r1_sub_status: 'Gia đình' }, 'lusu');
    expect(r.changes.r1_status).toBe('Passed');
    expect(r.changes.r1_sub_status).toBe('');
  });
  it.each([
    [{ r1_status: 'Passed', r2_status: 'Pending' }, 'r1', 'BACKWARD'],
    [{ r1_status: 'Failed' }, 'lusu', 'FAILED'],
    [{ r1_status: 'Pending' }, 'r1', 'SAME'],
    [{}, 'nowhere', 'INVALID'],
  ])('từ chối %j → %s (%s)', (c, target, code) => {
    const r = moveChanges(c, target as never);
    expect(r.error?.code).toBe(code);
    expect(r.changes).toEqual({});
  });
});

describe('khóa field sau vòng rớt', () => {
  it('chưa rớt: không khóa gì', () => {
    expect(lockedFieldKeys({ r1_status: 'Passed' })).toEqual([]);
  });
  it('rớt R1: khóa các section sau (R2, OB…), không khóa R1', () => {
    const k = lockedFieldKeys({ r1_status: 'Failed' });
    expect(k).toContain('r2_status');
    expect(k).toContain('ob_status');
    expect(k).not.toContain('r1_status');
    expect(k).not.toContain('ob_month'); // field tự tính không bị khóa
  });
});

describe('giai đoạn hiện tại (stage.ts)', () => {
  it.each([
    [{}, 'New'],
    [{ r1_date: '2026-11-01' }, 'Screening'],
    [{ r1_status: 'Passed' }, 'Interview'],
    [{ r1_status: 'KIV' }, 'On Hold'],
    [{ r1_status: 'Failed' }, 'Rejected'],
    [{ r1_status: 'Passed', r2_status: 'Pending' }, 'Evaluation'],
    [{ r1_status: 'Passed', r2_status: 'Passed' }, 'Passed'],
    [{ ob_status: 'Accepted' }, 'Offer'],
    [{ ob_status: 'Joined' }, 'Hired'],
    [{ ob_status: 'Noshow' }, 'Rejected'],
  ])('%j → %s', (c, stage) => {
    expect(currentStage(c)).toBe(stage);
  });
});

describe('mã ứng viên (run.mjs:323-328)', () => {
  it('tiền tố PIC + 00 + số', () => {
    expect(picCodePrefix('TA3-Thang')).toBe('TA3');
    expect(nextCandidateCode('TA1-Phat', [])).toBe('TA10001');
  });
  it('lấy số lớn nhất + 1, bỏ qua mã đã dùng ở PIC khác', () => {
    expect(nextCandidateCode('TA1-Phat', ['TA10001', 'TA10007'])).toBe('TA10008');
    expect(nextCandidateCode('TA1-Phat', ['TA10001'], (c) => c === 'TA10002')).toBe('TA10003');
  });
  it('PIC rỗng không sinh mã', () => {
    expect(nextCandidateCode('', [])).toBe('');
  });
});

describe('tra vị trí theo kho (run.mjs:298-310)', () => {
  it('kho + vị trí có trong bảng → phòng ban, khối, rank', () => {
    const a = lookupPositionInfo('DC Hưng Yên', 'Trưởng phòng');
    expect(a).toMatchObject({ dept: 'Ambient Retail', unit: 'Chuỗi Cung ứng' });
    expect(a?.ranks[0]).toBe('3B');
  });
  it('hai rank giữ cả hai, rank đầu là mặc định', () => {
    expect(lookupPositionInfo('TTPP Hải Dương', 'Phó Trưởng Bộ Phận Kho Vận')?.ranks.join()).toBe('4C,4B');
  });
  it('cặp không có trong bảng: kho cho phòng ban, vị trí cho rank', () => {
    const d = lookupPositionInfo('DC Hưng Yên', 'Nhân viên Kho');
    expect(d).toMatchObject({ exact: false, dept: 'Ambient Retail', unit: 'Chuỗi Cung ứng' });
    expect(d?.ranks[0]).toBe('6A');
  });
  it('vị trí lạ: chỉ có thông tin kho, không rank', () => {
    const d = lookupPositionInfo('DC Hưng Yên', 'Không có vị trí này');
    expect(d?.dept).toBe('Ambient Retail');
    expect(d?.ranks).toEqual([]);
  });
  it('Head Office: phòng ban theo vị trí', () => {
    expect(lookupPositionInfo('Head Office', 'Legal Manager')).toMatchObject({ dept: 'Legal', unit: 'Khối Văn phòng' });
  });
  it('kho và vị trí đều lạ → null', () => {
    expect(lookupPositionInfo('Kho lạ', 'Vị trí lạ')).toBeNull();
  });
});

describe('lý do hợp lệ theo trạng thái', () => {
  it('Passed không có lý do; trạng thái lạ trả null', () => {
    expect(allowedReasons('r1', 'Passed')).toEqual([]);
    expect(allowedReasons('r2', 'Failed')).toContain('Thái độ');
    expect(allowedReasons('r1', 'Không có')).toBeNull();
  });
});

describe('lịch và kỳ target (run_ops.mjs)', () => {
  it('cộng ngày qua tháng/năm', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('tuần ISO', () => {
    expect(isoWeekKey('2026-11-19')).toBe('2026-W47');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
  });
  it('khóa kỳ và khoảng ngày của kỳ', () => {
    expect(periodKeyOf('month', '2026-11-19')).toBe('2026-11');
    expect(periodRange('month', '2026-02')).toEqual(['2026-02-01', '2026-02-28']);
    expect(periodRange('year', '2026')).toEqual(['2026-01-01', '2026-12-31']);
  });
});

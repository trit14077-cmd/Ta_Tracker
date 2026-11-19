// M6-2: checklist tuyển + xác nhận tuyển (records-save/hiring.ts) – hành vi như Ops.gs hireView_ / hHireConfirm_.
import { describe, expect, it } from 'vitest';
import { hiringView, planHire, type HiringRow } from '../../supabase/functions/records-save/hiring.ts';
import { parseRequest, type Actor } from '../../supabase/functions/records-save/logic.ts';

const ta: Actor = { id: 'u1', role: 'pic', pic_code: 'TA1' };
const admin: Actor = { id: 'a1', role: 'admin', pic_code: null };
const done = { done: true, by: 'ta1', at: '2026-11-20T01:00:00Z' };
const allManual: HiringRow['items'] = { offer_sent: done, salary_agreed: done, offer_accepted: done };
const row = (over: Partial<HiringRow> = {}): HiringRow => ({ items: {}, confirmed: false, confirmed_by: '', confirmed_at: '', hr_status: '', ...over });
// Đạt vòng 2, rank 6 (cần giấy khám sức khỏe + CCCD), đủ giấy tờ, có ngày OB
const ready = { r1_status: 'Passed', r2_status: 'Passed', position: 'Nhân viên Kho', rank: '6A', health_check: 'kham.pdf', id_card: 'cccd.pdf', ob_date: '2026-12-01' };

describe('hiringView (= hireView_)', () => {
  it('3 mục tự tính + 3 mục tick tay, theo thứ tự HIRING_ITEMS', () => {
    const v = hiringView(ready, row({ items: { offer_sent: done }, hr_status: 'verified' }));
    expect(v.eligible).toBe(true);
    expect(v.items.map((i) => [i.key, i.done])).toEqual([
      ['offer_sent', true], ['salary_agreed', false], ['offer_accepted', false],
      ['docs_complete', true], ['hr_verified', true], ['ob_date_set', true],
    ]);
    expect(v.items[0].by).toBe('ta1');
  });
  it('thiếu giấy tờ bắt buộc theo rank 6 / lái xe nâng', () => {
    expect(hiringView({ ...ready, id_card: '' }, row()).items.find((i) => i.key === 'docs_complete')!.done).toBe(false);
    expect(hiringView({ ...ready, rank: '5', position: 'Nhân viên Lái xe nâng' }, row()).items.find((i) => i.key === 'docs_complete')!.done).toBe(false);
    expect(hiringView({ ...ready, rank: '5', id_card: '', health_check: '' }, row()).items.find((i) => i.key === 'docs_complete')!.done).toBe(true);
  });
  it('chưa có dòng checklist: mọi mục tay chưa xong, chưa xác nhận', () => {
    const v = hiringView(ready, null);
    expect(v.confirmed).toBe(false);
    expect(v.items.filter((i) => !i.auto).every((i) => !i.done)).toBe(true);
  });
  it('chưa đạt vòng 2 => không đủ điều kiện', () => {
    expect(hiringView({ r1_status: 'Passed', r2_status: 'Pending' }, null).eligible).toBe(false);
  });
});

describe('planHire (= các bước kiểm của hHireConfirm_)', () => {
  const full = (over: Partial<HiringRow> = {}) => hiringView(ready, row({ items: allManual, hr_status: 'verified', ...over }));
  it('đủ 6 mục => được xác nhận, trả 3 mục tay để RPC kiểm lại', () => {
    expect(planHire(ta, ready, full(), true)).toEqual({ ok: true, manualKeys: ['offer_sent', 'salary_agreed', 'offer_accepted'] });
  });
  it('còn thiếu => 400 HIRING_INCOMPLETE, liệt kê tên mục như hệ cũ', () => {
    const r = planHire(ta, ready, hiringView(ready, row({ items: { offer_sent: done } })), true);
    expect(r).toEqual({ ok: false, error: { status: 400, code: 'HIRING_INCOMPLETE',
      message: 'Chưa xác nhận tuyển được, còn thiếu: Đã chốt lương đề xuất, Ứng viên đã nhận offer, Thông tin nhân sự đã xác nhận.' } });
  });
  it('đã xác nhận => 409 LOCKED', () => {
    const r = planHire(ta, ready, full({ confirmed: true }), true);
    expect(!r.ok && r.error.code).toBe('LOCKED');
  });
  it('chưa đạt vòng 2 => 400 NOT_ELIGIBLE', () => {
    const r = planHire(admin, { r2_status: 'Pending' }, full(), true);
    expect(!r.ok && r.error.code).toBe('NOT_ELIGIBLE');
  });
  it('mở lại: chỉ Admin (TA => 403)', () => {
    const r = planHire(ta, ready, full({ confirmed: true }), false);
    expect(!r.ok && r.error.status).toBe(403);
    expect(planHire(admin, ready, full({ confirmed: true }), false).ok).toBe(true);
  });
});

describe('parseRequest confirm_hire / reopen_hire', () => {
  it('chỉ cần id (không cần expected_version, như hệ cũ)', () => {
    expect(parseRequest({ op: 'confirm_hire', id: 5 })).toEqual({ ok: true, req: { op: 'confirm_hire', id: 5 } });
    expect(parseRequest({ op: 'reopen_hire', id: 5 })).toEqual({ ok: true, req: { op: 'reopen_hire', id: 5 } });
    expect(parseRequest({ op: 'confirm_hire' }).ok).toBe(false);
  });
});

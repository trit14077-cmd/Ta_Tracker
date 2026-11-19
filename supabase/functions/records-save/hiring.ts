// M6-2: checklist tuyển + "Xác nhận tuyển" (Ops.gs: hireView_, hHireConfirm_) – phần thuần, dùng chung cho Edge
// records-save (kiểm trước khi ghi) và giao diện (opsService.getHiring hiển thị). Quy tắc lấy từ shared/ (nguyên văn hệ cũ).
import { HIRING_ITEMS } from '../../../shared/opsRules.ts';
import { requiredDocuments } from '../../../shared/documentRules.ts';
import { hrEligible } from '../../../shared/hrInfoRules.ts';
import type { ApiError, Actor } from './logic.ts';

/** Kết quả RPC hiring_state (0016). */
export interface HiringRow {
  items: Record<string, { done?: boolean; by?: string; at?: string }>;
  confirmed: boolean;
  confirmed_by: string;
  confirmed_at: string;
  hr_status: string;
}
export interface HiringState {
  eligible: boolean;
  items: { key: string; label: string; auto: boolean; done: boolean; by: string; at: string }[];
  confirmed: boolean;
  confirmed_by: string;
  confirmed_at: string;
}

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** = hireView_: 3 mục tự tính (đủ giấy tờ bắt buộc, HR Info đã xác nhận, có ngày OB) + 3 mục tick tay. */
export function hiringView(record: Record<string, unknown>, row: HiringRow | null): HiringState {
  const need = requiredDocuments(s(record.position), s(record.rank));
  const auto: Record<string, boolean> = {
    docs_complete: need.every((k) => !!s(record[k])),
    hr_verified: row?.hr_status === 'verified',
    ob_date_set: !!s(record.ob_date),
  };
  const manual = row?.items || {};
  return {
    eligible: hrEligible(record),
    items: HIRING_ITEMS.map((it) => (it.auto
      ? { key: it.key, label: it.label, auto: true, done: !!auto[it.key], by: '', at: '' }
      : { key: it.key, label: it.label, auto: false, done: !!manual[it.key]?.done, by: s(manual[it.key]?.by), at: s(manual[it.key]?.at) })),
    confirmed: !!row?.confirmed,
    confirmed_by: s(row?.confirmed_by),
    confirmed_at: s(row?.confirmed_at),
  };
}

/**
 * = các bước kiểm của hHireConfirm_ trước khi ghi. confirm=true: phải đủ điều kiện (đã đạt vòng 2), chưa xác nhận,
 * mọi mục xong. confirm=false (mở lại): chỉ Admin. Trả các mục tick tay để RPC kiểm lại trong giao dịch.
 */
export function planHire(actor: Actor, record: Record<string, unknown>, view: HiringState, confirm: boolean):
  { ok: true; manualKeys: string[] } | { ok: false; error: ApiError } {
  const fail = (status: number, code: string, message: string) => ({ ok: false as const, error: { status, code, message } });
  if (!confirm && actor.role !== 'admin') return fail(403, 'FORBIDDEN', 'Chỉ Admin mới mở lại được xác nhận tuyển.');
  if (!hrEligible(record)) return fail(400, 'NOT_ELIGIBLE', 'Chỉ dùng cho ứng viên đã đạt vòng 2.');
  if (confirm) {
    if (view.confirmed) return fail(409, 'LOCKED', 'Đã xác nhận tuyển rồi.');
    const missing = view.items.filter((it) => !it.done).map((it) => it.label);
    if (missing.length) return fail(400, 'HIRING_INCOMPLETE', 'Chưa xác nhận tuyển được, còn thiếu: ' + missing.join(', ') + '.');
  }
  return { ok: true, manualKeys: HIRING_ITEMS.filter((it) => !it.auto).map((it) => it.key) };
}

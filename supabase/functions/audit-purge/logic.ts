// CSV nhật ký để lưu trên Drive trước khi xóa (Edge audit-purge). Không gọi mạng – test được bằng vitest.
import { sanitizeCellForSpreadsheet } from '../../../shared/validation.ts';

export interface AuditRow {
  id: number; at: string; actor_username: string; actor_role: string; action: string;
  record_id: number | null; candidate_code: string; changes: unknown;
}

const HEAD = ['id', 'at', 'actor_username', 'actor_role', 'action', 'record_id', 'candidate_code', 'changes'];
const cell = (v: unknown) => {
  const s = sanitizeCellForSpreadsheet(typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV UTF-8 có BOM (Excel mở đúng tiếng Việt), chặn công thức như các file xuất khác. */
export function auditCsv(rows: AuditRow[]): string {
  const lines = [HEAD.join(','), ...rows.map((r) => HEAD.map((k) => cell((r as unknown as Record<string, unknown>)[k])).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** "NhatKy_<id đầu>-<id cuối>_<ngày dòng đầu>_<ngày dòng cuối>.csv" */
export function auditFileName(rows: AuditRow[]): string {
  const d = (s: string) => String(s).slice(0, 10);
  return `NhatKy_${rows[0].id}-${rows[rows.length - 1].id}_${d(rows[0].at)}_${d(rows[rows.length - 1].at)}.csv`;
}

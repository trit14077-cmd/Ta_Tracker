// Tìm câu trả lời Google Form "THÔNG TIN NHÂN VIÊN" của 1 ứng viên trong sheet trả lời (Edge hr-form op:"response").
// Theo SĐT trước, không thấy thì theo CCCD (đã lưu ở HR Info). Nhiều lần gửi => lấy lần MỚI NHẤT (dòng dưới cùng).
// Cột tìm theo chữ ở tiêu đề (mapHrFormHeaders), không theo vị trí. Không gọi mạng – test được bằng vitest.
import { mapHrFormHeaders, normalizeCccd, normalizeFormPhone } from '../../../shared/hrFormMap.ts';

export interface HrAnswer {
  found: boolean;
  reason?: 'empty' | 'no_match';
  searched?: { phone: string; cccd: boolean };
  match_by?: 'phone' | 'cccd';
  count?: number;
  row?: number;
  submitted_at?: string;
  answers?: { header: string; value: string; key: string }[];
  mapped?: Record<string, string>;
}

export function findHrAnswer(values: unknown[][], phone: string, cccd: string): HrAnswer {
  const headers = (values[0] ?? []).map((h) => String(h ?? ''));
  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  const searched = { phone, cccd: Boolean(cccd) };
  if (!rows.length) return { found: false, reason: 'empty', searched };

  const map = mapHrFormHeaders(headers);
  const cell = (r: unknown[], key: string) => (map[key] === undefined ? '' : String(r[map[key]] ?? '').trim());

  let match_by: 'phone' | 'cccd' = 'phone';
  let hits = phone && map.phone !== undefined ? rows.filter((r) => normalizeFormPhone(cell(r, 'phone')) === phone) : [];
  if (!hits.length && cccd && map.id_number !== undefined) {
    match_by = 'cccd';
    hits = rows.filter((r) => normalizeCccd(cell(r, 'id_number')) === cccd);
  }
  if (!hits.length) return { found: false, reason: 'no_match', searched };

  const last = hits[hits.length - 1];
  const keyOf: Record<number, string> = {};
  for (const [k, i] of Object.entries(map)) keyOf[i] = k;
  const mapped: Record<string, string> = {};
  for (const k of Object.keys(map)) if (k !== 'submitted_at' && cell(last, k)) mapped[k] = cell(last, k);
  return {
    found: true, match_by, count: hits.length, row: values.indexOf(last) + 1, submitted_at: cell(last, 'submitted_at'), searched,
    answers: headers.map((h, i) => ({ header: h, value: String(last[i] ?? '').trim(), key: keyOf[i] ?? '' })).filter((a) => a.header.trim()),
    mapped,
  };
}

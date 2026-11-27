/**
 * Task #10 – Tổng hợp chi trả theo người nhận (sheet "Summary <Mon>'<YY>" của TA_Credit_Bonus_<Mon><YY>.xlsx):
 *   (1) Total = (2) TA Credit + (3) Onsite + (4) Recruitment Bonus Freelancer (số gross, trước PIT).
 *  - Chỉ lấy khoản ĐÃ CHỐT của từng loại trong kỳ (bảng trình duyệt khớp số đã chốt); loại chưa chốt báo riêng.
 *  - TA: gom theo mã PIC (payee_key), thứ tự theo dòng TA Credit rồi Onsite. CTV: gom theo 'FL-<id>', đứng sau TA.
 *  - MoM: tổng từng loại theo các kỳ đã có khoản chốt.
 */
import type { BonusLineInput } from './period.ts';

export const SUMMARY_KINDS = ['ta_credit', 'onsite', 'freelancer'] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];

type Line = Pick<BonusLineInput, 'payee_type' | 'payee_key' | 'payee_name' | 'emp_id' | 'amount' | 'pit' | 'net' | 'detail'>;

export interface SummaryRow {
  key: string;
  type: 'ta' | 'freelancer';
  name: string;
  region: string;
  title: string;
  emp_id: string;
  credit: number;
  onsite: number;
  freelancer: number;
  /** PIT của phần Freelancer (TA Credit / Onsite không khấu trừ). */
  pit: number;
  total: number;
}

export const FREELANCER_TITLE = 'Recruitment Freelance';

export function buildPayoutSummary(byKind: Partial<Record<SummaryKind, Line[]>>): { rows: SummaryRow[]; totals: Omit<SummaryRow, 'key' | 'type' | 'name' | 'region' | 'title' | 'emp_id'> } {
  const m = new Map<string, SummaryRow>();
  const add = (kind: SummaryKind, l: Line) => {
    const d = (l.detail ?? {}) as Record<string, unknown>;
    const fl = l.payee_type === 'freelancer';
    const key = `${fl ? 'fl' : 'ta'}:${l.payee_key}`;
    const r = m.get(key) ?? {
      key, type: fl ? 'freelancer' : 'ta', name: l.payee_name, region: '', title: fl ? FREELANCER_TITLE : '', emp_id: l.emp_id,
      credit: 0, onsite: 0, freelancer: 0, pit: 0, total: 0,
    } as SummaryRow;
    r.name ||= l.payee_name;
    r.emp_id ||= l.emp_id;
    r.region ||= String(d.region ?? '');
    if (!fl) r.title ||= String(d.title ?? '');
    if (kind === 'ta_credit') r.credit += l.amount;
    else if (kind === 'onsite') r.onsite += l.amount;
    else { r.freelancer += l.amount; r.pit += l.pit; }
    r.total = r.credit + r.onsite + r.freelancer;
    m.set(key, r);
  };
  for (const k of SUMMARY_KINDS) for (const l of byKind[k] ?? []) add(k, l);
  const rows = [...m.values()].sort((a, b) => (a.type === b.type ? 0 : a.type === 'ta' ? -1 : 1));
  const sum = (f: (r: SummaryRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    rows,
    totals: { credit: sum((r) => r.credit), onsite: sum((r) => r.onsite), freelancer: sum((r) => r.freelancer), pit: sum((r) => r.pit), total: sum((r) => r.total) },
  };
}

export interface SummaryMomRow { period: string; credit: number; onsite: number; freelancer: number; total: number }

/** `periods`: mỗi phần tử = một kỳ của một loại đã chốt. Kết quả tăng dần theo kỳ. */
export function payoutMom(periods: { kind: SummaryKind; period: string; lines: Pick<BonusLineInput, 'amount'>[] }[]): SummaryMomRow[] {
  const m = new Map<string, SummaryMomRow>();
  for (const p of periods) {
    const r = m.get(p.period) ?? { period: p.period, credit: 0, onsite: 0, freelancer: 0, total: 0 };
    const a = p.lines.reduce((s, l) => s + l.amount, 0);
    if (p.kind === 'ta_credit') r.credit += a;
    else if (p.kind === 'onsite') r.onsite += a;
    else r.freelancer += a;
    r.total = r.credit + r.onsite + r.freelancer;
    m.set(p.period, r);
  }
  return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
}

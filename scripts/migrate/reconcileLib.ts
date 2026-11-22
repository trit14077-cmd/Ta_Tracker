// M8-3 – phần thuần của bộ đối chiếu ETL ↔ DB (test: tests/migrate/reconcile.test.ts).
// Nguyên tắc: KPI và Kanban tính bằng CHÍNH hàm dùng chung (dashboardCalc.totals, pipelineRules.boardPosition/boardSub)
// – không tự viết lại công thức – để phép so không thể "cùng sai".
// DEV chứa bản ẨN DANH (M8-0): chỉ so từng ô ở các cột không bị ẩn danh (SAFE_COLUMNS); cột ẩn danh chỉ so số lượng.
import { createHash } from 'node:crypto';
import { groupTotals, totals, type ReportRow, type Totals } from '../../shared/dashboardCalc.ts';
import { boardPosition, boardSub } from '../../shared/pipelineRules.ts';
import { normalizePosition } from '../../shared/positionCatalog.ts';

/** Cột không bị anonymize.ts thay/xóa ⇒ phải giống hệt giữa ETL (bản thật) và DEV (bản ẩn danh). */
export const SAFE_COLUMNS = [
  'pic', 'site', 'region', 'location', 'unit', 'dept', 'position', 'rank', 'source', 'sub_source', 'gender', 'hire_type',
  'r1_date', 'r1_status', 'r1_sub_status', 'r2_date', 'r2_status', 'r2_sub_status',
  'ob_date', 'ob_status', 'ob_sub_status', 'emp_status', 'attrition_date',
] as const;

/** Cột phân bổ (đếm theo giá trị) – báo cáo cho PO và so giữa hai bên. */
export const DIST_COLUMNS = ['pic', 'position', 'source', 'r1_status', 'r2_status', 'ob_status', 'emp_status'] as const;

export type Row = Record<string, unknown>;

/** Chuẩn hóa ô để so: null/undefined ⇒ '', cắt khoảng trắng; ngày ISO có giờ ⇒ chỉ ngày; vị trí theo danh mục 18.11. */
export function norm(col: string, v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && col.endsWith('_date')) s = s.slice(0, 10);
  if (col === 'position') s = normalizePosition(s);
  return s;
}

export interface ColumnDiff { mismatches: number; samples: { candidate_code: string; source: string; target: string }[] }
export interface RowCompare {
  source: number;
  target: number;
  missing: string[];   // có ở ETL, không có ở đích
  extra: string[];     // có ở đích (lô ETL), không có ở ETL
  duplicateCodes: string[];
  columns: Record<string, ColumnDiff>;
  ok: boolean;
}

/** So từng hồ sơ theo candidate_code trên các cột cho trước. */
export function compareRows(source: Row[], target: Row[], cols: readonly string[] = SAFE_COLUMNS, sampleLimit = 20): RowCompare {
  const key = (r: Row) => norm('candidate_code', r.candidate_code);
  const dup = new Set<string>();
  const index = (rows: Row[]) => {
    const m = new Map<string, Row>();
    for (const r of rows) {
      const k = key(r);
      if (m.has(k)) dup.add(k);
      m.set(k, r);
    }
    return m;
  };
  const s = index(source);
  const t = index(target);
  const missing = [...s.keys()].filter((k) => !t.has(k)).sort();
  const extra = [...t.keys()].filter((k) => !s.has(k)).sort();
  const columns: Record<string, ColumnDiff> = {};
  for (const c of cols) columns[c] = { mismatches: 0, samples: [] };
  for (const [k, sr] of s) {
    const tr = t.get(k);
    if (!tr) continue;
    for (const c of cols) {
      const a = norm(c, sr[c]);
      const b = norm(c, tr[c]);
      if (a !== b) {
        columns[c].mismatches++;
        if (columns[c].samples.length < sampleLimit) columns[c].samples.push({ candidate_code: k, source: a, target: b });
      }
    }
  }
  const ok = source.length === target.length && !missing.length && !extra.length && !dup.size
    && Object.values(columns).every((d) => d.mismatches === 0);
  return { source: source.length, target: target.length, missing, extra, duplicateCodes: [...dup].sort(), columns, ok };
}

/** Hash 1 cột trên toàn bộ hồ sơ (xếp theo candidate_code) – dấu vân tay để lưu biên bản. */
export function columnHash(rows: Row[], col: string): string {
  const h = createHash('sha256');
  const sorted = [...rows].sort((a, b) => norm('candidate_code', a.candidate_code).localeCompare(norm('candidate_code', b.candidate_code)));
  for (const r of sorted) h.update(`${norm('candidate_code', r.candidate_code)}\u0001${norm(col, r[col])}\u0000`);
  return h.digest('hex');
}

export function distribution(rows: Row[], col: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = norm(col, r[col]) || '(trống)';
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}

/** So 2 bảng đếm; diffs[giá trị] = đích − nguồn (chỉ giá trị lệch). */
export function compareCounts(source: Record<string, number>, target: Record<string, number>): { ok: boolean; diffs: Record<string, number> } {
  const diffs: Record<string, number> = {};
  for (const k of new Set([...Object.keys(source), ...Object.keys(target)])) {
    const d = (target[k] ?? 0) - (source[k] ?? 0);
    if (d !== 0) diffs[k] = d;
  }
  return { ok: Object.keys(diffs).length === 0, diffs };
}

/** Ngày VN (yyyy-mm-dd) của timestamptz/ISO; rỗng nếu không đọc được. */
export function vnDate(ts: unknown): string {
  if (ts === null || ts === undefined || ts === '') return '';
  const d = new Date(String(ts));
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Dòng báo cáo như v_report_rows (0011): lead = r1_date, không có thì ngày tạo (giờ VN). Bỏ hồ sơ lưu trữ. */
export function toReportRows(rows: Row[]): ReportRow[] {
  const s = (v: unknown) => norm('', v);
  return rows.filter((r) => !r.is_archived).map((r) => ({
    pic: s(r.pic), site: s(r.site), region: s(r.region), dept: s(r.dept), position: s(r.position), source: s(r.source),
    subSource: s(r.sub_source),
    lead: s(r.r1_date) || vnDate(r.created_at),
    r1d: s(r.r1_date), r1s: s(r.r1_status), r1r: s(r.r1_sub_status),
    r2d: s(r.r2_date), r2s: s(r.r2_status), r2r: s(r.r2_sub_status),
    obd: s(r.ob_date), obs: s(r.ob_status), obr: s(r.ob_sub_status), emp: s(r.emp_status), attd: s(r.attrition_date),
  }));
}

export const ALL_FROM = '2000-01-01';
export function kpiTotals(rows: Row[], today: string): Totals {
  return totals(toReportRows(rows), ALL_FROM, today, today);
}

/** groupTotals (dashboardCalc) làm phẳng thành "<nhóm>.<chỉ số>" – so với report_totals(p_group_by) không phụ thuộc thứ tự. */
export type GroupKey = 'pic' | 'source';
export function kpiGroups(rows: Row[], key: GroupKey, from: string, to: string, today: string): Record<string, number> {
  const pick = key === 'pic' ? (r: ReportRow) => r.pic : (r: ReportRow) => r.source;
  return flattenGroups(groupTotals(toReportRows(rows), pick, from, to, today));
}
export function flattenGroups(pairs: [string, Partial<Totals>][]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [g, t] of pairs) for (const [k, v] of Object.entries(t)) o[`${g}.${k}`] = Number(v ?? 0);
  return o;
}

export interface BoardCounts { counts: Record<string, { total: number; failed: number }>; subs: Record<string, number> }
const COLS = ['lead', 'r1', 'lusu', 'r2', 'ob'];
const SUBS = ['lead_new', 'r1_wait', 'su', 'lu', 'r2_passed', 'r2_failed', 'r2_canceled', 'ob_wait'];

/** = board_counts('') (0010/0014) nhưng tính bằng pipelineRules dùng chung; bỏ hồ sơ lưu trữ. */
export function boardCounts(rows: Row[]): BoardCounts {
  const counts: BoardCounts['counts'] = Object.fromEntries(COLS.map((c) => [c, { total: 0, failed: 0 }]));
  const subs: BoardCounts['subs'] = Object.fromEntries(SUBS.map((s) => [s, 0]));
  for (const r of rows) {
    if (r.is_archived) continue;
    const c: Row = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]));
    const p = boardPosition(c);
    counts[p.col].total++;
    if (p.failedAt) counts[p.col].failed++;
    const sub = boardSub(c);
    if (sub) subs[sub] = (subs[sub] ?? 0) + 1;
  }
  return { counts, subs };
}

/** Làm phẳng để so: counts.<cột>.total|failed, subs.<chỉ số>. */
export function flattenBoard(b: BoardCounts): Record<string, number> {
  const o: Record<string, number> = {};
  for (const c of COLS) {
    o[`counts.${c}.total`] = Number(b.counts?.[c]?.total ?? 0);
    o[`counts.${c}.failed`] = Number(b.counts?.[c]?.failed ?? 0);
  }
  for (const s of SUBS) o[`subs.${s}`] = Number(b.subs?.[s] ?? 0);
  return o;
}

export function flattenTotals(t: Partial<Totals>): Record<string, number> {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Number(v ?? 0)]));
}

export interface VisibilityCheck { ok: boolean; unknownPics: Record<string, number>; picsWithoutUser: Record<string, number>; noPic: number }
/** "RLS" ở góc dữ liệu: TA thấy hồ sơ qua pic = pic_code của mình (rr_read). Hồ sơ có pic lạ = không ai ngoài Admin thấy (lỗi);
 *  pic chưa có tài khoản TA đang hoạt động = tạm chỉ Admin thấy (cảnh báo); pic rỗng = chỉ Admin thấy (thông tin). */
export function visibility(rows: Row[], pics: string[], activeTaPics: string[]): VisibilityCheck {
  const known = new Set(pics);
  const users = new Set(activeTaPics);
  const unknownPics: Record<string, number> = {};
  const picsWithoutUser: Record<string, number> = {};
  let noPic = 0;
  for (const r of rows) {
    const p = norm('pic', r.pic);
    if (!p) noPic++;
    else if (!known.has(p)) unknownPics[p] = (unknownPics[p] ?? 0) + 1;
    else if (!users.has(p)) picsWithoutUser[p] = (picsWithoutUser[p] ?? 0) + 1;
  }
  return { ok: Object.keys(unknownPics).length === 0, unknownPics, picsWithoutUser, noPic };
}

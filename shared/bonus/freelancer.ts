/**
 * Task #10 (4) – Recruitment Bonus cho Freelancer / CTV (External Recruiters). Quy tắc chốt ngày 27/11/2026
 * (docs/bonus/PHAN_TICH_BONUS.md, không vào Git) + sheet "Freelancer Bonus" của file TA_Credit_Bonus_<Mon><YY>.xlsx:
 *  - CTV không phải PIC, không có Emp ID: admin quản lý danh sách CTV (bonus_freelancers) và gán CTV cho hồ sơ ở màn Bonus
 *    (bonus_freelancer_records). Danh sách hồ sơ gợi ý = sub_source 'Freelancer', OB Joined.
 *  - Ứng viên eligible khi làm đủ minDays (30) NGÀY LỊCH: ngày đủ điều kiện = OBD + 30. Nghỉ trước ngày đó → gợi ý Failed.
 *    Admin sửa tay được: Passed / Failed / Hold (Hold = chưa xét, để kỳ sau).
 *  - Kỳ lương theo ngày chốt: ngày đủ điều kiện ≤ ngày chốt và chưa trả ở kỳ đã chốt khác → vào kỳ này.
 *  - Mức / ứng viên theo SỐ ỨNG VIÊN của CTV trong kỳ, áp cho cả lô (1 → 700k; 2–3 → 800k; 4–6 → 900k; > 6 → 1tr).
 *  - PIT 10% (pitRate), net = amount − PIT. Mỗi hồ sơ một khoản (part 'freelancer', payee_type 'freelancer', payee_key 'FL-<id>').
 * DB: migration 0049.
 */
import { addDays, toIsoDate, type BonusLineInput } from './period.ts';

export interface FreelancerTier {
  /** Số ứng viên tối đa của khung (null = không giới hạn, chỉ ở khung cuối). */
  max: number | null;
  amount: number;
}

export interface FreelancerConfig {
  minDays: number;
  tiers: FreelancerTier[];
  pitRate: number;
}

export const FREELANCER_DEFAULT_CONFIG: FreelancerConfig = {
  minDays: 30,
  tiers: [{ max: 1, amount: 700_000 }, { max: 3, amount: 800_000 }, { max: 6, amount: 900_000 }, { max: null, amount: 1_000_000 }],
  pitRate: 0.1,
};

/** Gộp cấu hình đọc từ DB với mặc định; bảng khung sai (không tăng dần, khung cuối không mở) → mặc định. */
export function cleanFreelancerConfig(raw: unknown): FreelancerConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const D = FREELANCER_DEFAULT_CONFIG;
  const t = Array.isArray(r.tiers) ? (r.tiers as Record<string, unknown>[]) : [];
  const okTiers = t.length > 0 && t.every((x, i) => {
    if (!x || typeof x !== 'object' || !Number.isInteger(x.amount) || (x.amount as number) < 0) return false;
    if (i === t.length - 1) return x.max === null;
    const prev = i ? (t[i - 1].max as number) : 0;
    return Number.isInteger(x.max) && (x.max as number) > prev;
  });
  const pit = r.pitRate;
  return {
    minDays: Number.isInteger(r.minDays) && (r.minDays as number) >= 0 ? (r.minDays as number) : D.minDays,
    tiers: okTiers ? t.map((x) => ({ max: x.max as number | null, amount: x.amount as number })) : D.tiers.map((x) => ({ ...x })),
    pitRate: typeof pit === 'number' && pit >= 0 && pit < 1 ? pit : D.pitRate,
  };
}

/** Mức / ứng viên khi CTV có `count` ứng viên trong kỳ (0 → 0). */
export function freelancerRate(count: number, cfg: FreelancerConfig): number {
  if (count <= 0) return 0;
  return (cfg.tiers.find((t) => t.max == null || count <= t.max) ?? cfg.tiers[cfg.tiers.length - 1]).amount;
}

export const FREELANCER_REGIONS = ['North', 'South'] as const;

export interface Freelancer {
  id: number;
  name: string;
  phone: string;
  region: '' | 'North' | 'South';
  note: string;
  active: boolean;
}

export const FREELANCER_FLAGS = ['', 'Passed', 'Failed', 'Hold'] as const;
export type FreelancerFlag = (typeof FREELANCER_FLAGS)[number];

export function cleanFreelancerFlag(v: unknown): FreelancerFlag {
  return (FREELANCER_FLAGS as readonly string[]).includes(String(v ?? '')) ? (String(v ?? '') as FreelancerFlag) : '';
}

/** Một hồ sơ (nguồn Freelancer hoặc đã gán CTV) kèm phần admin nhập. */
export interface FreelancerSource {
  record_id: number;
  candidate_code: string;
  full_name: string;
  emp_id: string;
  position: string;
  site: string;
  sub_source: string;
  pic: string | null;
  ob_date: string | null;
  ob_status: string;
  emp_status: string;
  attrition_date: string | null;
  freelancer_id: number | null;
  flag: FreelancerFlag;
  note: string;
}

/** no_freelancer = chưa gán CTV; future = chưa tới ngày đủ điều kiện; due = vào kỳ đang xem; paid_before = đã chốt ở kỳ khác. */
export type FreelancerState = 'no_freelancer' | 'not_joined' | 'hold' | 'failed' | 'future' | 'due' | 'paid_before';

export const FREELANCER_STATE_LABELS: Record<FreelancerState, string> = {
  no_freelancer: 'Chưa gán CTV',
  not_joined: 'Chưa Joined',
  hold: 'Hold – để kỳ sau',
  failed: 'Không đạt',
  future: 'Chưa đủ ngày',
  due: 'Trả kỳ này',
  paid_before: 'Đã trả',
};

export type FreelancerWarning = 'resigned_no_date' | 'not_freelancer_source' | 'flag_manual';

export const FREELANCER_WARNING_LABELS: Record<FreelancerWarning, string> = {
  resigned_no_date: 'Đã nghỉ nhưng thiếu ngày nghỉ',
  not_freelancer_source: 'Nguồn hồ sơ không phải Freelancer',
  flag_manual: 'Cờ sửa tay khác gợi ý',
};

export type FreelancerPaidMap = Map<number, { period: string; amount: number }>;

export interface FreelancerRow extends FreelancerSource {
  eligible_date: string;
  suggested: 'Passed' | 'Failed' | '';
  state: FreelancerState;
  warnings: FreelancerWarning[];
  /** Kỳ đã trả (paid_before) hoặc kỳ đang xem (due). */
  period: string;
  amount: number;
  pit: number;
  net: number;
}

export interface FreelancerGroup {
  freelancer: Freelancer | null;
  freelancer_id: number;
  count: number;
  rate: number;
  amount: number;
  pit: number;
  net: number;
  rows: FreelancerRow[];
}

export interface FreelancerResult {
  rows: FreelancerRow[];
  groups: FreelancerGroup[];
  lines: BonusLineInput[];
  totals: { amount: number; pit: number; net: number; people: number; freelancers: number };
}

const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim();

/** Ngày đủ điều kiện = OBD + minDays ('' nếu thiếu OBD). */
export function eligibleDate(obDate: string | null, cfg: FreelancerConfig): string {
  const ob = toIsoDate(obDate);
  return ob ? addDays(ob, cfg.minDays) : '';
}

/** Gợi ý: nghỉ trước ngày đủ điều kiện (hoặc đã nghỉ mà thiếu ngày nghỉ) → Failed, còn lại Passed. */
export function suggestFreelancerFlag(src: Pick<FreelancerSource, 'emp_status' | 'attrition_date'>, eligible: string): 'Passed' | 'Failed' {
  const att = toIsoDate(src.attrition_date);
  if (att) return att < eligible ? 'Failed' : 'Passed';
  return norm(src.emp_status) === 'Resigned' ? 'Failed' : 'Passed';
}

export function evaluateFreelancerRecord(src: FreelancerSource, paid: FreelancerPaidMap, periodKey: string, asof: string, cfg: FreelancerConfig): FreelancerRow {
  const el = eligibleDate(src.ob_date, cfg);
  const suggested = el ? suggestFreelancerFlag(src, el) : '';
  const warnings: FreelancerWarning[] = [];
  if (norm(src.emp_status) === 'Resigned' && !toIsoDate(src.attrition_date)) warnings.push('resigned_no_date');
  if (src.freelancer_id != null && norm(src.sub_source) !== 'Freelancer') warnings.push('not_freelancer_source');
  if ((src.flag === 'Passed' || src.flag === 'Failed') && suggested && src.flag !== suggested) warnings.push('flag_manual');
  const decision = src.flag || suggested;
  const p = paid.get(src.record_id);
  let state: FreelancerState;
  if (p && p.period !== periodKey) state = 'paid_before';
  else if (src.freelancer_id == null) state = 'no_freelancer';
  else if (norm(src.ob_status) !== 'Joined' || !el) state = 'not_joined';
  else if (src.flag === 'Hold') state = 'hold';
  else if (decision === 'Failed') state = 'failed';
  else if (el > asof) state = 'future';
  else state = 'due';
  return {
    ...src, eligible_date: el, suggested, state, warnings,
    period: state === 'paid_before' ? p!.period : state === 'due' ? periodKey : '',
    amount: state === 'paid_before' ? p!.amount : 0, pit: 0, net: 0,
  };
}

/**
 * Tính kỳ `periodKey` với ngày chốt `asof`. `paid` = hồ sơ đã chốt ở các kỳ Freelancer.
 * Mức của mỗi CTV = freelancerRate(số hồ sơ due của CTV đó trong kỳ), áp cho mọi hồ sơ của CTV.
 */
export function buildFreelancerPeriod(
  sources: FreelancerSource[], freelancers: Freelancer[], paid: FreelancerPaidMap, periodKey: string, asof: string, cfg: FreelancerConfig,
): FreelancerResult {
  const cut = toIsoDate(asof);
  if (!cut) throw new Error(`Ngày chốt không hợp lệ: ${asof}`);
  const rows = sources.map((s) => evaluateFreelancerRecord(s, paid, periodKey, cut, cfg));
  const fl = new Map(freelancers.map((f) => [f.id, f]));
  const byFl = new Map<number, FreelancerRow[]>();
  for (const r of rows) if (r.state === 'due') byFl.set(r.freelancer_id!, [...(byFl.get(r.freelancer_id!) ?? []), r]);
  const groups: FreelancerGroup[] = [];
  const lines: BonusLineInput[] = [];
  for (const [id, rs] of byFl) {
    const f = fl.get(id) ?? null;
    const rate = freelancerRate(rs.length, cfg);
    const pit = Math.round(rate * cfg.pitRate);
    rs.sort((a, b) => String(a.ob_date).localeCompare(String(b.ob_date)) || a.record_id - b.record_id);
    for (const r of rs) {
      r.amount = rate;
      r.pit = pit;
      r.net = rate - pit;
      lines.push({
        record_id: r.record_id, part: 'freelancer', payee_type: 'freelancer', payee_key: `FL-${id}`, payee_name: f?.name ?? '', emp_id: '', ta_pic: null,
        amount: rate, pit, net: rate - pit,
        detail: {
          freelancer_id: id, region: f?.region ?? '', count: rs.length, rate, candidate_code: r.candidate_code, full_name: r.full_name,
          cand_emp_id: r.emp_id, emp_status: r.emp_status || 'Active', site: r.site, position: r.position, ob_date: r.ob_date,
          eligible_date: r.eligible_date, flag: r.flag,
        },
      });
    }
    groups.push({ freelancer: f, freelancer_id: id, count: rs.length, rate, amount: rate * rs.length, pit: pit * rs.length, net: (rate - pit) * rs.length, rows: rs });
  }
  groups.sort((a, b) => b.count - a.count || norm(a.freelancer?.name).localeCompare(norm(b.freelancer?.name)));
  return {
    rows, groups, lines,
    totals: {
      amount: lines.reduce((s, l) => s + l.amount, 0), pit: lines.reduce((s, l) => s + l.pit, 0), net: lines.reduce((s, l) => s + l.net, 0),
      people: lines.length, freelancers: groups.length,
    },
  };
}

/** Một dòng của sheet "Freelancer Bonus" – dựng từ khoản (kỳ đang mở hoặc đã chốt). */
export interface FreelancerLineView {
  record_id: number | null;
  freelancer_id: number;
  freelancer_name: string;
  region: string;
  count: number;
  candidate_code: string;
  full_name: string;
  cand_emp_id: string;
  emp_status: string;
  site: string;
  position: string;
  ob_date: string | null;
  amount: number;
  pit: number;
  net: number;
}

export function freelancerLineViews(lines: Pick<BonusLineInput, 'record_id' | 'payee_name' | 'amount' | 'pit' | 'net' | 'detail'>[]): FreelancerLineView[] {
  return lines.map((l) => {
    const d = (l.detail ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (v == null ? '' : String(v));
    return {
      record_id: l.record_id, freelancer_id: Number(d.freelancer_id ?? 0), freelancer_name: l.payee_name, region: s(d.region), count: Number(d.count ?? 0),
      candidate_code: s(d.candidate_code), full_name: s(d.full_name), cand_emp_id: s(d.cand_emp_id), emp_status: s(d.emp_status), site: s(d.site),
      position: s(d.position), ob_date: (d.ob_date as string) ?? null, amount: l.amount, pit: l.pit, net: l.net,
    };
  });
}

/** Gom các dòng theo CTV (giữ thứ tự xuất hiện). */
export function groupLineViews(views: FreelancerLineView[]): { freelancer_id: number; name: string; region: string; count: number; rate: number; amount: number; pit: number; net: number }[] {
  const m = new Map<number, { freelancer_id: number; name: string; region: string; count: number; rate: number; amount: number; pit: number; net: number }>();
  for (const v of views) {
    const g = m.get(v.freelancer_id) ?? { freelancer_id: v.freelancer_id, name: v.freelancer_name, region: v.region, count: 0, rate: v.amount, amount: 0, pit: 0, net: 0 };
    g.count += 1;
    g.amount += v.amount;
    g.pit += v.pit;
    g.net += v.net;
    m.set(v.freelancer_id, g);
  }
  return [...m.values()];
}

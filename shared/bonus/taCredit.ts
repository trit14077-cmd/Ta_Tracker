/**
 * Task #10 (2) – TA Credit Bonus. Quy tắc chốt ngày 27/11/2026 (docs/bonus/PHAN_TICH_BONUS.md, không vào Git):
 *  - Kết quả tháng N (OB có OBD từ ngày 1 đến cuối tháng N) trả ở kỳ lương N+1.
 *  - OB đủ điều kiện: OB Status = Joined, số ngày làm = (ngày nghỉ, hoặc ngày chốt nếu còn làm) − OBD ≥ minDays (7, ngày lịch,
 *    giống cột Working_Days của Excel).
 *  - Credit / OB: site trong creditSites → mức của site (DC/TTPP Hưng Yên, Hải Phòng = 3). Còn lại theo chữ số đầu của Rank
 *    và vùng của OB (Region = "Miền Bắc" → North, còn lại South/Central). Rank 3 Back Office (unit = 'Khối Văn phòng')
 *    tách riêng 9 / 7 (Excel cũ không tách – đã chốt tách).
 *  - Bonus lũy tiến theo Level + Region của TA (ta_bonus_profiles): credit trong Base × 0, tới cận trên Target × 70k,
 *    tới cận trên Outperformance × 120k, phần vượt × 200k. Intern: phần Base trả internBaseRate (70k) như Excel (đã chốt).
 *  - Mỗi TA một khoản / kỳ (part 'credit', payee_type 'ta', ta_pic = PIC → TA tự xem được).
 * DB: migration 0047 (ta_bonus_profiles + cấu hình bonus_settings 'ta_credit').
 */
import { daysBetween, periodMonthRange, shiftPeriod, toIsoDate, type BonusLineInput } from './period.ts';

export const TA_REGIONS = ['North', 'South'] as const;
export type TaRegion = (typeof TA_REGIONS)[number];
export const TA_LEVELS = ['Senior', 'Middle', 'Junior', 'Intern'] as const;
export type TaLevel = (typeof TA_LEVELS)[number];
export const TIER_NAMES = ['Base', 'Target', 'Outperformance', 'Outstanding'] as const;
export type TierName = (typeof TIER_NAMES)[number];

/** Cận trên Base / Target / Outperformance (Outstanding không giới hạn). */
export type TierBounds = [number, number, number];

export interface TaCreditConfig {
  minDays: number;
  northRegion: string;
  backOfficeUnit: string;
  /** Credit cố định theo site của OB. */
  creditSites: Record<string, number>;
  /** Credit theo rank: khóa '6','5','4','3','3BO','2'. */
  rankCredits: Record<TaRegion, Record<string, number>>;
  tiers: Record<TaRegion, Record<TaLevel, TierBounds>>;
  /** Đơn giá / credit của 4 khung. */
  rates: [number, number, number, number];
  /** Đơn giá phần Base của Intern (Excel trả 70k). 0 = như các level khác. */
  internBaseRate: number;
}

export const TA_CREDIT_DEFAULT_CONFIG: TaCreditConfig = {
  minDays: 7,
  northRegion: 'Miền Bắc',
  backOfficeUnit: 'Khối Văn phòng',
  creditSites: { 'DC Hưng Yên': 3, 'DC Hải Phòng': 3, 'TTPP Hưng Yên': 3, 'TTPP Hải Phòng': 3 },
  rankCredits: {
    North: { 6: 1.5, 5: 2, 4: 4, 3: 8, '3BO': 9, 2: 20 },
    South: { 6: 1, 5: 1.5, 4: 3, 3: 6, '3BO': 7, 2: 20 },
  },
  tiers: {
    North: { Senior: [15, 30, 40], Middle: [12, 25, 40], Junior: [10, 25, 40], Intern: [5, 25, 40] },
    South: { Senior: [22, 30, 40], Middle: [18, 25, 40], Junior: [15, 25, 40], Intern: [5, 25, 40] },
  },
  rates: [0, 70_000, 120_000, 200_000],
  internBaseRate: 70_000,
};

const norm = (v: unknown) => String(v ?? '').normalize('NFC').trim();
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Gộp cấu hình đọc từ DB với mặc định; giá trị sai bỏ qua. */
export function cleanTaCreditConfig(raw: unknown): TaCreditConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const D = TA_CREDIT_DEFAULT_CONFIG;
  const map = (v: unknown, d: Record<string, number>) => {
    if (!v || typeof v !== 'object') return { ...d };
    const out: Record<string, number> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (norm(k) && typeof x === 'number' && x >= 0) out[norm(k)] = x;
    return out;
  };
  const rc = (r.rankCredits ?? {}) as Record<string, unknown>;
  const ti = (r.tiers ?? {}) as Record<string, Record<string, unknown>>;
  const tiers = {} as TaCreditConfig['tiers'];
  for (const reg of TA_REGIONS) {
    tiers[reg] = {} as Record<TaLevel, TierBounds>;
    for (const lv of TA_LEVELS) {
      const t = ti?.[reg]?.[lv];
      const ok = Array.isArray(t) && t.length === 3 && t.every((x) => typeof x === 'number' && x >= 0) && t[0] <= t[1] && t[1] <= t[2];
      tiers[reg][lv] = ok ? [t[0], t[1], t[2]] as TierBounds : [...D.tiers[reg][lv]] as TierBounds;
    }
  }
  const rates = Array.isArray(r.rates) && r.rates.length === 4 && r.rates.every((x) => Number.isInteger(x) && (x as number) >= 0)
    ? (r.rates as TaCreditConfig['rates']) : [...D.rates] as TaCreditConfig['rates'];
  return {
    minDays: Number.isInteger(r.minDays) && (r.minDays as number) >= 0 ? (r.minDays as number) : D.minDays,
    northRegion: norm(r.northRegion) || D.northRegion,
    backOfficeUnit: norm(r.backOfficeUnit) || D.backOfficeUnit,
    creditSites: map(r.creditSites, D.creditSites),
    rankCredits: { North: map(rc.North, D.rankCredits.North), South: map(rc.South, D.rankCredits.South) },
    tiers,
    rates,
    internBaseRate: Number.isInteger(r.internBaseRate) && (r.internBaseRate as number) >= 0 ? (r.internBaseRate as number) : D.internBaseRate,
  };
}

/** Hồ sơ bonus của một TA (bảng ta_bonus_profiles, khóa = mã PIC). */
export interface TaProfile {
  pic: string;
  name: string;
  emp_id: string;
  region: TaRegion | '';
  level: TaLevel | '';
  title: string;
  is_freelancer: boolean;
  onsite: boolean;
  active: boolean;
}

/** Một OB (hồ sơ tuyển dụng) đưa vào tính credit. */
export interface TaCreditSource {
  record_id: number;
  candidate_code: string;
  full_name: string;
  emp_id: string;
  pic: string | null;
  rank: string;
  region: string;
  unit: string;
  site: string;
  ob_date: string | null;
  ob_status: string;
  emp_status: string;
  attrition_date: string | null;
}

export type ObSkip = 'not_joined' | 'short' | 'no_pic' | 'no_rank' | 'outside_month';

export const OB_SKIP_LABELS: Record<ObSkip, string> = {
  not_joined: 'Chưa Joined',
  short: 'Chưa đủ số ngày làm',
  no_pic: 'Không có PIC',
  no_rank: 'Rank không có trong bảng credit',
  outside_month: 'Ngoài tháng tính',
};

export interface TaCreditOb extends TaCreditSource {
  days: number;
  credits: number;
  /** '' = được tính. */
  skip: ObSkip | '';
}

/** Khóa rank trong bảng credit: chữ số đầu ('6A' → '6'); Rank 3 Back Office → '3BO'. '' = không đọc được. */
export function rankKey(rank: string, unit: string, cfg: TaCreditConfig): string {
  const d = /\d/.exec(norm(rank))?.[0] ?? '';
  if (!d) return '';
  return d === '3' && norm(unit) === cfg.backOfficeUnit ? '3BO' : d;
}

export function obCredits(src: Pick<TaCreditSource, 'site' | 'rank' | 'region' | 'unit'>, cfg: TaCreditConfig): number | null {
  const site = norm(src.site);
  if (has(cfg.creditSites, site)) return cfg.creditSites[site];
  const key = rankKey(src.rank, src.unit, cfg);
  const table = cfg.rankCredits[norm(src.region) === cfg.northRegion ? 'North' : 'South'];
  return key && has(table, key) ? table[key] : null;
}

/** Số ngày làm như cột Working_Days: (ngày nghỉ hoặc ngày chốt) − OBD. */
export function workingDays(src: Pick<TaCreditSource, 'ob_date' | 'attrition_date'>, asof: string): number {
  const ob = toIsoDate(src.ob_date);
  if (!ob) return 0;
  const end = toIsoDate(src.attrition_date) || asof;
  return Math.max(0, daysBetween(ob, end));
}

/** Tháng OB được trả ở kỳ `periodKey` (kỳ N+1 → tháng N). */
export function performanceMonth(periodKey: string): string {
  return shiftPeriod(periodKey, -1);
}

export function evaluateOb(src: TaCreditSource, perfMonth: string, asof: string, cfg: TaCreditConfig): TaCreditOb {
  const { from, to } = periodMonthRange(perfMonth);
  const ob = toIsoDate(src.ob_date);
  const days = workingDays(src, asof);
  const c = obCredits(src, cfg);
  let skip: ObSkip | '' = '';
  if (!ob || ob < from || ob > to) skip = 'outside_month';
  else if (norm(src.ob_status) !== 'Joined') skip = 'not_joined';
  else if (!norm(src.pic)) skip = 'no_pic';
  else if (days < cfg.minDays) skip = 'short';
  else if (c == null) skip = 'no_rank';
  return { ...src, days, credits: skip ? 0 : (c ?? 0), skip };
}

export interface TierSplit { credits: number; rate: number; amount: number }

/** Chia credit lũy tiến vào 4 khung; trả từng khung + tổng tiền (làm tròn đồng). */
export function tierBonus(credits: number, region: TaRegion, level: TaLevel, cfg: TaCreditConfig): { tiers: TierSplit[]; amount: number; tier: TierName } {
  const [b, t, o] = cfg.tiers[region][level];
  const c = Math.max(0, credits);
  const parts = [Math.min(c, b), Math.max(0, Math.min(c, t) - b), Math.max(0, Math.min(c, o) - t), Math.max(0, c - o)];
  const rates = [...cfg.rates];
  if (level === 'Intern' && cfg.internBaseRate > 0) rates[0] = cfg.internBaseRate;
  const tiers = parts.map((p, i) => ({ credits: p, rate: rates[i], amount: Math.round(p * rates[i]) }));
  const tier: TierName = c <= b ? 'Base' : c <= t ? 'Target' : c <= o ? 'Outperformance' : 'Outstanding';
  return { tiers, amount: tiers.reduce((s, x) => s + x.amount, 0), tier };
}

export interface TaCreditRow {
  pic: string;
  profile: TaProfile | null;
  obs: TaCreditOb[];
  onboarded: number;
  eligible: number;
  credits: number;
  tier: TierName | '';
  tiers: TierSplit[];
  amount: number;
  /** '' = được trả; khác = lý do không tạo khoản. */
  problem: '' | 'no_profile' | 'inactive' | 'no_level';
}

export const TA_ROW_PROBLEM_LABELS: Record<Exclude<TaCreditRow['problem'], ''>, string> = {
  no_profile: 'PIC chưa có hồ sơ bonus',
  inactive: 'Hồ sơ bonus đang tắt',
  no_level: 'Thiếu Region / Level',
};

export interface TaCreditResult {
  perfMonth: string;
  rows: TaCreditRow[];
  /** OB trong tháng không được tính (để admin xem lý do). */
  skipped: TaCreditOb[];
  lines: BonusLineInput[];
  totals: { amount: number; credits: number; eligible: number; onboarded: number; tas: number };
}

/**
 * Tính kỳ `periodKey` (trả kết quả tháng N = kỳ − 1) với ngày chốt `asof`.
 * Mọi TA có hồ sơ bonus đang bật (không phải freelancer) đều có dòng (kể cả 0 OB) để TA xem được credit của mình.
 */
export function buildTaCreditPeriod(sources: TaCreditSource[], profiles: TaProfile[], periodKey: string, asof: string, cfg: TaCreditConfig): TaCreditResult {
  const cut = toIsoDate(asof);
  if (!cut) throw new Error(`Ngày chốt không hợp lệ: ${asof}`);
  const perfMonth = performanceMonth(periodKey);
  const byPic = new Map<string, TaCreditOb[]>();
  const skipped: TaCreditOb[] = [];
  for (const s of sources) {
    const ob = evaluateOb(s, perfMonth, cut, cfg);
    if (ob.skip === 'outside_month') continue;
    if (ob.skip === 'no_pic') { skipped.push(ob); continue; }
    const k = norm(ob.pic);
    byPic.set(k, [...(byPic.get(k) ?? []), ob]);
    if (ob.skip) skipped.push(ob);
  }
  const prof = new Map(profiles.map((p) => [norm(p.pic), p]));
  const pics = new Set<string>([...byPic.keys(), ...profiles.filter((p) => p.active && !p.is_freelancer).map((p) => norm(p.pic))]);
  const rows: TaCreditRow[] = [];
  const lines: BonusLineInput[] = [];
  for (const pic of [...pics].sort()) {
    const obs = byPic.get(pic) ?? [];
    const ok = obs.filter((o) => !o.skip);
    const credits = Math.round(ok.reduce((s, o) => s + o.credits, 0) * 100) / 100;
    const p = prof.get(pic) ?? null;
    const problem: TaCreditRow['problem'] = !p ? 'no_profile' : !p.active || p.is_freelancer ? 'inactive' : !p.region || !p.level ? 'no_level' : '';
    const tb = problem ? null : tierBonus(credits, p!.region as TaRegion, p!.level as TaLevel, cfg);
    const row: TaCreditRow = {
      pic, profile: p, obs, onboarded: obs.length, eligible: ok.length, credits,
      tier: tb?.tier ?? '', tiers: tb?.tiers ?? [], amount: tb?.amount ?? 0, problem,
    };
    rows.push(row);
    if (problem) continue;
    lines.push({
      record_id: null, part: 'credit', payee_type: 'ta', payee_key: pic, payee_name: p!.name, emp_id: p!.emp_id, ta_pic: pic,
      amount: row.amount, pit: 0, net: row.amount,
      detail: {
        perfMonth, region: p!.region, level: p!.level, title: p!.title, onboarded: row.onboarded, eligible: row.eligible,
        credits, tier: row.tier, tiers: row.tiers,
        obs: ok.map((o) => ({ record_id: o.record_id, candidate_code: o.candidate_code, site: o.site, rank: o.rank, ob_date: o.ob_date, credits: o.credits })),
      },
    });
  }
  const paid = rows.filter((r) => !r.problem);
  return {
    perfMonth, rows, skipped, lines,
    totals: {
      amount: lines.reduce((s, l) => s + l.amount, 0),
      credits: Math.round(paid.reduce((s, r) => s + r.credits, 0) * 100) / 100,
      eligible: paid.reduce((s, r) => s + r.eligible, 0),
      onboarded: rows.reduce((s, r) => s + r.onboarded, 0),
      tas: paid.length,
    },
  };
}

/** Dựng lại các dòng của một kỳ đã chốt từ bonus_lines.detail. */
export function taCreditRowsFromLines(lines: Pick<BonusLineInput, 'payee_key' | 'payee_name' | 'emp_id' | 'amount' | 'detail'>[]): TaCreditRow[] {
  return lines.map((l) => {
    const d = (l.detail ?? {}) as Record<string, unknown>;
    return {
      pic: l.payee_key,
      profile: {
        pic: l.payee_key, name: l.payee_name, emp_id: l.emp_id, region: (d.region as TaRegion) ?? '', level: (d.level as TaLevel) ?? '',
        title: String(d.title ?? ''), is_freelancer: false, onsite: false, active: true,
      },
      obs: [], onboarded: Number(d.onboarded ?? 0), eligible: Number(d.eligible ?? 0), credits: Number(d.credits ?? 0),
      tier: (d.tier as TierName) ?? '', tiers: (d.tiers as TierSplit[]) ?? [], amount: l.amount, problem: '',
    };
  });
}

/**
 * TA dưới Base `n` kỳ liên tiếp tính tới kỳ hiện tại (cảnh báo review performance, không ảnh hưởng tiền).
 * `history` = các kỳ đã chốt trước đó (mới nhất trước), mỗi kỳ là map PIC → tier.
 */
export function belowBaseStreak(pic: string, currentTier: TierName | '', history: Map<string, TierName | ''>[]): number {
  if (currentTier !== 'Base') return 0;
  let n = 1;
  for (const h of history) {
    if (h.get(pic) !== 'Base') break;
    n += 1;
  }
  return n;
}

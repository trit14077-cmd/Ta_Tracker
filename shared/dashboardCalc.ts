/**
 * Recruitment dashboard numbers (the "Báo cáo" page, per TA). Pure functions shared by the app and the demo.
 *
 * Every stage is counted by ITS OWN date inside the chosen period (the same way the Recruitment Dashboard does it):
 *   Leads  = candidates whose lead date (R1 date, else the creation date) is in the period
 *   R1     = R1 date in the period, R1_STT = Passed
 *   LU     = R2 date in the period (the candidate has been lined up for the interview)
 *   SU     = R2 date in the period and R2_STT is Passed or Failed (the candidate showed up)
 *   R2     = R2 date in the period and R2_STT = Passed
 *   OB     = OB date in the period and OB Status = Joined (Noshow / Canceled are counted apart)
 *   ER     = Joined people (OB in the period) who are still Active;  ATT = those who resigned
 * Because stages use independent dates, a rate can pass 100% on a short period; rates with fewer than 10 people
 * underneath are not shown (MIN_SAMPLE).
 */

export interface ReportRow {
  pic: string;
  site: string;
  region: string;
  dept: string;
  position: string;
  source: string;
  subSource: string;
  lead: string; // ISO date
  r1d: string;
  r1s: string;
  r1r: string; // reason
  r2d: string;
  r2s: string;
  r2r: string;
  obd: string;
  obs: string;
  obr: string;
  emp: string;
  attd: string;
}

/** Column order of /api/reports/rows */
export const REPORT_KEYS = [
  'pic', 'site', 'region', 'dept', 'position', 'source', 'sub_source',
  'lead_date', 'r1_date', 'r1_status', 'r1_sub_status',
  'r2_date', 'r2_status', 'r2_sub_status',
  'ob_date', 'ob_status', 'ob_sub_status', 'emp_status', 'attrition_date',
] as const;

export function rowsFromArrays(arr: string[][]): ReportRow[] {
  return arr.map((a) => ({
    pic: a[0], site: a[1], region: a[2], dept: a[3], position: a[4], source: a[5], subSource: a[6],
    lead: a[7], r1d: a[8], r1s: a[9], r1r: a[10],
    r2d: a[11], r2s: a[12], r2r: a[13],
    obd: a[14], obs: a[15], obr: a[16], emp: a[17], attd: a[18],
  }));
}

export const THRESH = { r1p: 0.68, lup: 0.68, sup: 0.59, r2p: 0.68, obp: 0.79, erp: 0.5, cr: 0.1, er30: 0.5 };
export const MIN_SAMPLE = 10;

// ---------------------------------------------------------------- dates (ISO yyyy-mm-dd strings)
const MS = 86400000;
export const isoToDay = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS : NaN;
};
export const dayToIso = (d: number): string => new Date(d * MS).toISOString().slice(0, 10);
export const inR = (iso: string, from: string, to: string): boolean => Boolean(iso) && iso >= from && iso <= to;
export const daysBetween = (a: string, b: string): number => isoToDay(b) - isoToDay(a);

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}
export function monthBounds(ym: string): [string, string] {
  const [y, m] = ym.split('-').map(Number);
  return [`${ym}-01`, dayToIso(Date.UTC(y, m, 0) / MS)];
}
export function monthKeys(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').slice(0, 2).map(Number);
  const [ty, tm] = to.split('-').slice(0, 2).map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `T${Number(m)}/${y}`;
}

export type Preset = 'week' | 'month' | 'lmonth' | 'quarter' | 'ytd' | 'all' | 'custom';
export const PRESET_LABELS: [Preset, string][] = [
  ['week', 'Tuần này'], ['month', 'Tháng này'], ['lmonth', 'Tháng trước'], ['quarter', 'Quý này'],
  ['ytd', 'YTD'], ['all', 'Toàn thời gian'], ['custom', 'Tuỳ chọn'],
];

export function presetRange(p: Preset, today: string, minDate: string): [string, string] {
  const t = isoToDay(today);
  const d = new Date(t * MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (p) {
    case 'week': {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      return [dayToIso(t - dow), dayToIso(t - dow + 6)];
    }
    case 'month': return [dayToIso(Date.UTC(y, m, 1) / MS), dayToIso(Date.UTC(y, m + 1, 0) / MS)];
    case 'lmonth': return [dayToIso(Date.UTC(y, m - 1, 1) / MS), dayToIso(Date.UTC(y, m, 0) / MS)];
    case 'quarter': {
      const q = Math.floor(m / 3) * 3;
      return [dayToIso(Date.UTC(y, q, 1) / MS), dayToIso(Date.UTC(y, q + 3, 0) / MS)];
    }
    case 'ytd': return [`${y}-01-01`, today];
    default: return [minDate || `${y}-01-01`, today];
  }
}

/** The period right before [from, to] with the same number of days. */
export function prevRange(from: string, to: string): [string, string] {
  // A whole calendar month (or quarter) is compared with the one before it, not with "30 days earlier".
  const fm = monthBounds(monthOf(from));
  if (from === fm[0] && to === monthBounds(monthOf(to))[1]) {
    const months = monthKeys(from, to).length;
    const [y, m] = from.split('-').map(Number);
    const startPrev = dayToIso(Date.UTC(y, m - 1 - months, 1) / MS);
    return [startPrev, dayToIso(Date.UTC(y, m - 1, 0) / MS)];
  }
  const n = daysBetween(from, to) + 1;
  const f = isoToDay(from);
  return [dayToIso(f - n), dayToIso(f - 1)];
}

// ---------------------------------------------------------------- totals
export interface Totals {
  leads: number; r1Total: number; r1: number; lu: number; su: number; r2: number;
  ob: number; ns: number; cc: number; er: number; att: number; att30: number;
  er30n: number; er30d: number; er60n: number; er60d: number;
}
export const blank = (): Totals => ({
  leads: 0, r1Total: 0, r1: 0, lu: 0, su: 0, r2: 0, ob: 0, ns: 0, cc: 0, er: 0, att: 0, att30: 0,
  er30n: 0, er30d: 0, er60n: 0, er60d: 0,
});

export function totals(rows: ReportRow[], from: string, to: string, today: string): Totals {
  const t = blank();
  const td = isoToDay(today);
  for (const r of rows) {
    if (inR(r.lead, from, to)) t.leads += 1;
    if (inR(r.r1d, from, to)) {
      t.r1Total += 1;
      if (r.r1s === 'Passed') t.r1 += 1;
    }
    if (inR(r.r2d, from, to)) {
      t.lu += 1;
      if (r.r2s === 'Passed' || r.r2s === 'Failed') t.su += 1;
      if (r.r2s === 'Passed') t.r2 += 1;
    }
    if (inR(r.obd, from, to)) {
      if (r.obs === 'Joined') {
        t.ob += 1;
        const active = r.emp !== 'Resigned';
        if (r.emp === 'Active') t.er += 1;
        if (r.emp === 'Resigned') {
          t.att += 1;
          if (r.attd && daysBetween(r.obd, r.attd) <= 30) t.att30 += 1;
        }
        const od = isoToDay(r.obd);
        const stay = r.attd ? daysBetween(r.obd, r.attd) : Infinity;
        if (td - od >= 30) {
          t.er30d += 1;
          if (active || stay > 30) t.er30n += 1;
        }
        if (td - od >= 60) {
          t.er60d += 1;
          if (active || stay > 60) t.er60n += 1;
        }
      } else if (r.obs === 'Noshow') t.ns += 1;
      else if (r.obs === 'Canceled') t.cc += 1;
    }
  }
  return t;
}

export interface Rates { r1p: number | null; lup: number | null; sup: number | null; r2p: number | null; obp: number | null; cr: number | null; erp: number | null; er30: number | null; er60: number | null }
const ratio = (a: number, b: number): number | null => (b ? a / b : null);
export function rates(t: Totals): Rates {
  return {
    r1p: ratio(t.r1, t.leads), lup: ratio(t.lu, t.r1), sup: ratio(t.su, t.lu), r2p: ratio(t.r2, t.su),
    obp: ratio(t.ob, t.r2), cr: ratio(t.ob, t.leads), erp: ratio(t.er, t.ob),
    er30: ratio(t.er30n, t.er30d), er60: ratio(t.er60n, t.er60d),
  };
}

/** A rate is hidden when the number underneath is too small to mean anything. */
export const DEN_OF: Record<string, keyof Totals> = { r1p: 'leads', lup: 'r1', sup: 'lu', r2p: 'su', obp: 'r2', cr: 'leads', erp: 'ob' };

export function groupTotals(rows: ReportRow[], keyOf: (r: ReportRow) => string, from: string, to: string, today: string): [string, Totals][] {
  const by = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = keyOf(r) || '(Trống)';
    (by.get(k) || by.set(k, []).get(k)!).push(r);
  }
  return [...by.entries()]
    .map(([k, rs]) => [k, totals(rs, from, to, today)] as [string, Totals])
    .filter(([, t]) => t.leads || t.ob || t.r1 || t.lu)
    .sort((a, b) => b[1].ob - a[1].ob || b[1].leads - a[1].leads);
}

// ---------------------------------------------------------------- donuts
export interface DonutData {
  key: 'r1' | 'lu' | 'su' | 'r2' | 'ob';
  title: string;
  sub: string;
  pass: number;
  total: number;
  nonLabel: string;
  reasonsTitle: string;
  note: string;
  reasons: [string, number][];
}

function countBy(list: ReportRow[], f: (r: ReportRow) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of list) {
    const k = f(r) || '(Chưa ghi lý do)';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function donuts(rows: ReportRow[], from: string, to: string, t: Totals): DonutData[] {
  const r1rows = rows.filter((r) => inR(r.r1d, from, to));
  const r1fail = r1rows.filter((r) => r.r1s === 'Failed');
  const luNo = r1rows.filter((r) => r.r1s === 'Passed' && !r.r2d);
  const r2rows = rows.filter((r) => inR(r.r2d, from, to));
  const noShow = r2rows.filter((r) => r.r2s !== 'Passed' && r.r2s !== 'Failed');
  const r2fail = r2rows.filter((r) => r.r2s === 'Failed');
  const obNo = rows.filter((r) => inR(r.obd, from, to) && (r.obs === 'Noshow' || r.obs === 'Canceled'));
  return [
    { key: 'r1', title: 'R1 Passed', sub: 'Screening Passed', pass: t.r1, total: t.r1Total, nonLabel: 'Screening Failed',
      reasonsTitle: 'Lý do rớt sàng lọc', note: 'R1 không đạt', reasons: countBy(r1fail, (r) => r.r1r) },
    { key: 'lu', title: 'LU', sub: 'Line Up', pass: t.lu, total: Math.max(t.r1, t.lu), nonLabel: 'Not Scheduled',
      reasonsTitle: 'Chưa có lịch phỏng vấn R2', note: 'Đậu R1 nhưng chưa có lịch R2',
      reasons: [...(luNo.length ? [['Đậu R1, chưa có lịch R2', luNo.length] as [string, number]] : []), ...countBy(r1fail, (r) => r.r1r)] },
    { key: 'su', title: 'SU', sub: 'Show Up', pass: t.su, total: Math.max(t.lu, t.su), nonLabel: 'No-show',
      reasonsTitle: 'Có lịch R2 nhưng không đến', note: 'Có lịch R2, chưa đến hoặc hủy', reasons: countBy(noShow, (r) => r.r2r) },
    { key: 'r2', title: 'R2 Passed', sub: 'Pass Interview', pass: t.r2, total: Math.max(t.su, t.r2), nonLabel: 'Interview Failed',
      reasonsTitle: 'Lý do rớt phỏng vấn', note: 'Đã đến phỏng vấn nhưng không đạt', reasons: countBy(r2fail, (r) => r.r2r) },
    { key: 'ob', title: 'OB', sub: 'Joined', pass: t.ob, total: Math.max(t.r2, t.ob), nonLabel: 'Offer Declined',
      reasonsTitle: 'Noshow / Canceled', note: 'Đã đạt R2 nhưng không nhận việc',
      reasons: countBy(obNo, (r) => `${r.obs}${r.obr ? ' · ' + r.obr : ''}`) },
  ];
}

// ---------------------------------------------------------------- monthly trend
export interface TrendPoint { month: string; ob: number; att: number; start: number; churn: number | null }
/** % churn of a month = resigned in the month / (people working at the start of the month + OB of the month). */
export function trend(rows: ReportRow[], from: string, to: string): TrendPoint[] {
  return monthKeys(from, to).map((m) => {
    const [f, l] = monthBounds(m);
    let ob = 0, att = 0, start = 0;
    for (const r of rows) {
      if (r.obs !== 'Joined' || !r.obd) continue;
      if (inR(r.obd, f, l)) ob += 1;
      if (r.obd < f && (!r.attd || r.attd >= f)) start += 1;
      if (r.attd && inR(r.attd, f, l)) att += 1;
    }
    const den = start + ob;
    return { month: m, ob, att, start, churn: den ? att / den : null };
  });
}

export const MIN_DATE = (rows: ReportRow[]): string => {
  let min = '';
  for (const r of rows) for (const d of [r.lead, r.r1d, r.r2d, r.obd]) if (d && (!min || d < min)) min = d;
  return min;
};

// ---------------------------------------------------------------- periods (month / week) for the TA charts
export type Gran = 'month' | 'week';
export interface Period { key: string; label: string; from: string; to: string }

/** Calendar months (Mon-Sun weeks) that touch [from, to], newest `max` kept. */
export function periodsOf(from: string, to: string, gran: Gran, max = 12): Period[] {
  const out: Period[] = [];
  if (gran === 'month') {
    for (const m of monthKeys(from, to)) {
      const [f, l] = monthBounds(m);
      out.push({ key: m, label: monthLabel(m), from: f, to: l });
    }
  } else {
    const f0 = isoToDay(from);
    let s = f0 - ((new Date(f0 * MS).getUTCDay() + 6) % 7);
    const end = isoToDay(to);
    while (s <= end) {
      const a = dayToIso(s);
      out.push({ key: a, label: `${a.slice(8, 10)}/${a.slice(5, 7)}`, from: a, to: dayToIso(s + 6) });
      s += 7;
    }
  }
  return out.slice(-max);
}

export interface PeriodTotals { p: Period; t: Totals }
export function periodSeries(rows: ReportRow[], ps: Period[], today: string): PeriodTotals[] {
  return ps.map((p) => ({ p, t: totals(rows, p.from, p.to, today) }));
}

/** Retention / churn after 30 and 60 days: of the joiners old enough, the share still working / already gone. */
export function retention(t: Totals): { r30: number | null; r60: number | null; c30: number | null; c60: number | null } {
  const r30 = t.er30d ? t.er30n / t.er30d : null;
  const r60 = t.er60d ? t.er60n / t.er60d : null;
  return { r30, r60, c30: r30 === null ? null : 1 - r30, c60: r60 === null ? null : 1 - r60 };
}

export const RET_THRESH = 0.5;
/** Colour class of a value against its threshold: below = red, within 10% above = amber, otherwise green. */
export function band(v: number | null, thr: number): 'none' | 'red' | 'amber' | 'green' {
  if (v === null || Number.isNaN(v)) return 'none';
  return v < thr ? 'red' : v < thr * 1.1 ? 'amber' : 'green';
}

export const sliceRows = (rows: ReportRow[], dim: 'all' | 'site' | 'source', value: string): ReportRow[] =>
  dim === 'all' || !value ? rows : rows.filter((r) => (dim === 'site' ? r.site : r.source) === value);

// ---------------------------------------------------------------- Performance × Source (OB, Churn, %ER, %ER30, %ER60 per period)
export interface SourcePeriod {
  p: Period; ob: number; churn: number;
  er: number | null; er30: number | null; er60: number | null;
  n: { er: number; ob: number; s30: number; e30: number; s60: number; e60: number };
  bySource: { name: string; ob: number; churn: number }[];
}
/** OB = Joined in the period; Churn = people who resigned in the period (whenever they joined); %ER* = share of the period's joiners still working. */
export function sourceSeries(rows: ReportRow[], ps: Period[], today: string): SourcePeriod[] {
  return ps.map((p) => {
    const t = totals(rows, p.from, p.to, today);
    const by = new Map<string, { ob: number; churn: number }>();
    const slot = (k: string) => by.get(k) || by.set(k, { ob: 0, churn: 0 }).get(k)!;
    let churn = 0;
    for (const r of rows) {
      if (r.obs !== 'Joined') continue;
      const k = r.source || '(Trống)';
      if (inR(r.obd, p.from, p.to)) slot(k).ob += 1;
      if (r.attd && inR(r.attd, p.from, p.to)) { churn += 1; slot(k).churn += 1; }
    }
    return {
      p, ob: t.ob, churn,
      er: t.ob ? t.er / t.ob : null,
      er30: t.er30d ? t.er30n / t.er30d : null,
      er60: t.er60d ? t.er60n / t.er60d : null,
      n: { er: t.er, ob: t.ob, s30: t.er30n, e30: t.er30d, s60: t.er60n, e60: t.er60d },
      bySource: [...by.entries()].map(([name, v]) => ({ name, ...v })).filter((x) => x.ob || x.churn).sort((a, b) => b.ob - a.ob),
    };
  });
}

// Chuyển từ OLD/src/components/TaCharts.tsx (M5-3). Giữ nguyên giao diện; số theo kỳ lấy từ RPC report_series /
// report_sources (cùng quy tắc periodSeries/sourceSeries) thay cho tính trên mảng dòng. Kỳ vẫn do usePeriods tạo.
import React, { useEffect, useMemo, useState } from 'react';
import { reportService, type OptionKey, type ReportFilters } from '../services/reportService.ts';
import {
  Gran,
  MIN_SAMPLE,
  Period,
  PeriodTotals,
  RET_THRESH,
  SourcePeriod,
  THRESH,
  Totals,
  band,
  blank,
  dayToIso,
  isoToDay,
  periodsOf,
  retention,
} from '../../../shared/dashboardCalc.ts';

/**
 * The three TA charts of the Recruitment Dashboard's overview: Performance Achievement, Performance theo TA and the
 * Conversion table. Each has its own MoM / WoW switch and always shows the 12 most recent periods up to the end of
 * the chosen range (so a "this week" filter still gives a trend).
 */

const nf = new Intl.NumberFormat('vi-VN');
const fmtN = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '–' : nf.format(Math.round(v)));
const fmtP0 = (v: number | null) => (v === null || Number.isNaN(v) ? '–' : `${Math.round(v * 100)}%`);
const card = 'bg-white border border-[#ECEEF2] rounded-2xl shadow-[0_1px_2px_rgba(17,24,39,0.04),0_6px_20px_rgba(17,24,39,0.05)]';

const LINES: { key: 'leads' | 'r1' | 'lu' | 'su' | 'r2'; label: string; color: string }[] = [
  { key: 'leads', label: 'Lead', color: '#6366F1' },
  { key: 'r1', label: 'R1', color: '#10B981' },
  { key: 'lu', label: 'LU', color: '#F59E0B' },
  { key: 'su', label: 'SU', color: '#EC4899' },
  { key: 'r2', label: 'R2', color: '#8B5CF6' },
];

function GranToggle({ gran, set }: { gran: Gran; set: (g: Gran) => void }) {
  return (
    <div className="inline-flex rounded-full border border-[#ECEEF2] bg-slate-50 p-0.5">
      {(['month', 'week'] as Gran[]).map((g) => (
        <button key={g} type="button" onClick={() => set(g)} className={`px-3 h-7 rounded-full text-[12px] font-bold ${gran === g ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>
          {g === 'month' ? 'MoM' : 'WoW'}
        </button>
      ))}
    </div>
  );
}

/** The 12 latest periods that end at `to` (clipped to today) and do not start before the first data. */
function usePeriods(to: string, today: string, minDate: string, gran: Gran): Period[] {
  return useMemo(() => {
    if (!to) return [];
    const end = to < today ? to : today;
    const ed = isoToDay(end);
    const start = gran === 'month'
      ? dayToIso(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 12, 1) / 86400000)
      : dayToIso(ed - 7 * 11);
    const ps = periodsOf(start, end, gran, 12);
    let i = 0;
    while (i < ps.length - 1 && minDate && ps[i].to < minDate) i += 1;
    return ps.slice(i);
  }, [to, today, minDate, gran]);
}

interface ChartSeries { name: string; color: string; vals: (number | null)[]; fmt?: (v: number) => string; tip?: string[] }
interface ComboProps { labels: string[]; bars: { name: string; color: string; vals: number[]; tip?: string[] }[]; lines: ChartSeries[]; rightPct?: boolean; fixedMax?: number }

/** Bars on the left axis, lines on the right axis. */
function Combo({ labels, bars, lines, rightPct, fixedMax }: ComboProps) {
  const W = 1160, H = 300, L = 46, R = 50, T = 24, B = 34;
  const n = labels.length;
  if (!n) return <div className="text-sm text-slate-400 py-10 text-center">Chưa có dữ liệu.</div>;
  const maxL = Math.max(1, ...bars.flatMap((b) => b.vals));
  const rv = lines.flatMap((l) => l.vals.filter((v): v is number => v !== null));
  const maxR = fixedMax ?? Math.max(1, ...rv);
  const gw = (W - L - R) / n;
  const ph = H - T - B;
  const yl = (v: number) => T + ph * (1 - v / maxL);
  const yr = (v: number) => T + ph * (1 - v / maxR);
  const bw = Math.min(34, (gw * 0.7) / Math.max(1, bars.length));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[300px]">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - R} y1={T + ph * f} y2={T + ph * f} stroke="#ECEEF2" />
          <text x={L - 6} y={T + ph * f + 3} textAnchor="end" fontSize="10" fill="#9CA3AF">{Math.round(maxL * (1 - f))}</text>
          <text x={W - R + 6} y={T + ph * f + 3} fontSize="10" fill="#9CA3AF">{rightPct ? `${Math.round(maxR * (1 - f) * 100)}%` : Math.round(maxR * (1 - f))}</text>
        </g>
      ))}
      {labels.map((lb, i) => {
        const cx = L + gw * i + gw / 2;
        const x0 = cx - (bw * bars.length) / 2;
        return (
          <g key={lb + i}>
            {bars.map((b, k) => (
              <g key={b.name}>
                <rect x={x0 + k * bw} y={yl(b.vals[i])} width={bw - 3} height={Math.max(0, T + ph - yl(b.vals[i]))} rx="3" fill={b.color}>{b.tip && <title>{b.tip[i]}</title>}</rect>
                {b.vals[i] > 0 && <text x={x0 + k * bw + (bw - 3) / 2} y={yl(b.vals[i]) - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0B5CA8">{fmtN(b.vals[i])}</text>}
              </g>
            ))}
            <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fill="#6B7280">{lb}</text>
          </g>
        );
      })}
      {lines.map((ln) => {
        const pts = ln.vals.map((v, i) => (v === null ? null : [L + gw * i + gw / 2, yr(v), v] as [number, number, number]));
        const poly = pts.filter(Boolean).map((p) => `${p![0]},${p![1]}`).join(' ');
        return (
          <g key={ln.name}>
            {poly && <polyline points={poly} fill="none" stroke={ln.color} strokeWidth="2.2" />}
            {pts.map((p, i) => p && (
              <g key={i}>
                <circle cx={p[0]} cy={p[1]} r="3.5" fill="#fff" stroke={ln.color} strokeWidth="2">{ln.tip && <title>{ln.tip[i]}</title>}</circle>
                {lines.length === 1 && <text x={p[0]} y={p[1] - 9} textAnchor="middle" fontSize="10" fontWeight="700" fill={ln.color}>{ln.fmt ? ln.fmt(p[2]) : fmtN(p[2])}</text>}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

interface Props {
  filters: ReportFilters; options: Record<OptionKey, string[]>; reloadKey: number;
  to: string; today: string; minDate: string; isAdmin: boolean; trend?: React.ReactNode;
}

/** periodSeries qua server; giữ kết quả cũ tới khi có kết quả mới (như hệ cũ không nhấp nháy). */
function usePeriodSeries(ps: Period[], filters: ReportFilters | null, today: string, reloadKey: number): PeriodTotals[] {
  const [v, setV] = useState<PeriodTotals[]>([]);
  useEffect(() => {
    if (!today) return;
    let alive = true;
    // filters = null: bộ lọc mâu thuẫn (vd. đã lọc Site A ở trên, chọn Site B ở biểu đồ) -> hệ cũ ra toàn 0
    const load = filters ? reportService.getPeriodSeries(ps, filters, today) : Promise.resolve(ps.map((p) => ({ p, t: blank() })));
    load.then((x) => { if (alive) setV(x); }).catch(() => { /* giữ số cũ */ });
    return () => { alive = false; };
  }, [ps, filters, today, reloadKey]);
  return v;
}

const RET_MIN = 5; // retention needs fewer people than the funnel rates: only joiners old enough count

export const TaCharts: React.FC<Props> = ({ filters, options, reloadKey, to, today, minDate, isAdmin, trend }) => {
  // ---- Performance × Source
  const [gS, setGS] = useState<Gran>('month');
  const psS = usePeriods(to, today, minDate, gS);
  const [serS, setSerS] = useState<SourcePeriod[]>([]);
  useEffect(() => {
    if (!today) return;
    let alive = true;
    reportService.getSourceSeries(psS, filters, today).then((x) => { if (alive) setSerS(x); }).catch(() => { /* giữ số cũ */ });
    return () => { alive = false; };
  }, [psS, filters, today, reloadKey]);

  // ---- Performance Achievement
  const [gA, setGA] = useState<Gran>('month');
  const [target, setTarget] = useState<number>(0);
  const [draft, setDraft] = useState('');
  const [tgtMsg, setTgtMsg] = useState('');
  useEffect(() => {
    let alive = true;
    reportService.getObTarget().then((v) => { if (alive) { setTarget(v); setDraft(v ? String(v) : ''); } }).catch(() => { /* target stays 0 */ });
    return () => { alive = false; };
  }, []);
  const psA = usePeriods(to, today, minDate, gA);
  const serA = usePeriodSeries(psA, filters, today, reloadKey);
  const tgtOf = () => (gA === 'month' ? target : Math.round(((target * 12) / 52) * 10) / 10);
  const saveTarget = async () => {
    const v = Math.max(0, Math.round(Number(draft) || 0));
    if (v === target) return;
    try {
      setTarget(await reportService.setObTarget(v));
      setTgtMsg('Đã lưu');
    } catch (e) {
      setTgtMsg(e instanceof Error ? e.message : 'Không lưu được');
    }
    setTimeout(() => setTgtMsg(''), 2500);
  };

  // ---- Performance theo TA
  const [gB, setGB] = useState<Gran>('month');
  const [dim, setDim] = useState<'site' | 'source'>('site');
  const [pick, setPick] = useState('');
  const [on, setOn] = useState<Record<string, boolean>>({ leads: true, r1: true, lu: true, su: true, r2: true });
  const psB = usePeriods(to, today, minDate, gB);
  // Hệ cũ lấy lựa chọn từ các dòng đang lọc; ở đây từ toàn bộ hồ sơ được xem (report_meta).
  const choices = options[dim];
  const filtersB = useMemo<ReportFilters | null>(() => {
    if (!pick) return filters;
    if (filters[dim] && filters[dim] !== pick) return null; // = sliceRows trên dòng đã lọc ra rỗng
    return { ...filters, [dim]: pick };
  }, [filters, dim, pick]);
  const serB = usePeriodSeries(psB, filtersB, today, reloadKey);

  // ---- Conversion
  const [gC, setGC] = useState<Gran>('month');
  const psC = usePeriods(to, today, minDate, gC);
  const serC = usePeriodSeries(psC, filters, today, reloadKey);

  const tg = tgtOf();
  return (
    <>
      {trend}
      {/* Performance × Source */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h3 className="font-bold text-[15px]">Performance × Source</h3>
          <span className="text-[12px] text-slate-500">OB, nghỉ việc và %ER của nhóm OB trong kỳ</span>
          <div className="ml-auto"><GranToggle gran={gS} set={setGS} /></div>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-slate-500 mb-1">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#0A3D75' }} />OB</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#F59E0B' }} />Churn</span>
          <span><i className="inline-block w-2.5 h-0.5 mr-1 align-middle" style={{ background: '#16A34A' }} />%ER</span>
          <span><i className="inline-block w-2.5 h-0.5 mr-1 align-middle" style={{ background: '#DB2777' }} />%ER30</span>
          <span><i className="inline-block w-2.5 h-0.5 mr-1 align-middle" style={{ background: '#8B5CF6' }} />%ER60</span>
        </div>
        <Combo
          labels={serS.map((s) => s.p.label)}
          bars={[
            { name: 'OB', color: '#0A3D75', vals: serS.map((s) => s.ob), tip: serS.map((s) => tipOf(s.p.label, 'OB', s.ob, s.bySource.map((x) => [x.name, x.ob]))) },
            { name: 'Churn', color: '#F59E0B', vals: serS.map((s) => s.churn), tip: serS.map((s) => tipOf(s.p.label, 'Churn', s.churn, s.bySource.map((x) => [x.name, x.churn]))) },
          ]}
          lines={[
            { name: '%ER', color: '#16A34A', vals: serS.map((s) => s.er), fmt: fmtP0, tip: serS.map((s) => `%ER: ${s.n.er}/${s.n.ob} OB`) },
            { name: '%ER30', color: '#DB2777', vals: serS.map((s) => s.er30), fmt: fmtP0, tip: serS.map((s) => `%ER30: ${s.n.s30}/${s.n.e30} OB đủ 30 ngày`) },
            { name: '%ER60', color: '#8B5CF6', vals: serS.map((s) => s.er60), fmt: fmtP0, tip: serS.map((s) => `%ER60: ${s.n.s60}/${s.n.e60} OB đủ 60 ngày`) },
          ]}
          rightPct fixedMax={1}
        />
        <p className="text-[11.5px] text-slate-500 -mt-1">Churn = toàn bộ người nghỉ việc trong kỳ. Rê chuột vào cột để xem nguồn đóng góp. %ER = số còn làm / số OB của kỳ.</p>
      </div>

      {/* Performance Achievement */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h3 className="font-bold text-[15px]">Performance Achievement</h3>
          <span className="text-[12px] text-slate-500">OB so với Target · % Achievement</span>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
              Target OB / tháng
              {isAdmin ? (
                <input
                  type="number" min={0} value={draft} placeholder="0"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={saveTarget}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  className="w-20 h-8 px-2 border border-[#ECEEF2] rounded-lg text-[13px] text-right"
                />
              ) : <b className="text-[13px] text-slate-900">{target || '–'}</b>}
              {tgtMsg && <span className="text-[11px] text-emerald-600">{tgtMsg}</span>}
            </label>
            <GranToggle gran={gA} set={setGA} />
          </div>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-slate-500 mb-1">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#0B7BD1' }} />OB</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#C6EBFF' }} />Target</span>
          <span><i className="inline-block w-2.5 h-0.5 mr-1 align-middle" style={{ background: '#F59E0B' }} />% Achievement</span>
          <span className="ml-auto text-[11px] text-slate-400">
            {isAdmin ? 'Target do Admin nhập, dùng chung cả team' : 'Target do Admin đặt'} · 12 kỳ gần nhất
          </span>
        </div>
        <Combo
          labels={serA.map((s) => s.p.label)}
          bars={[
            { name: 'OB', color: '#0B7BD1', vals: serA.map((s) => s.t.ob) },
            ...(tg > 0 ? [{ name: 'Target', color: '#C6EBFF', vals: serA.map(() => tg) }] : []),
          ]}
          lines={tg > 0 ? [{ name: '% Achievement', color: '#F59E0B', vals: serA.map((s) => s.t.ob / tg), fmt: (v) => fmtP0(v) }] : []}
          rightPct
        />
        {tg === 0 && <p className="text-[12px] text-slate-400 -mt-2">{isAdmin ? 'Nhập Target OB / tháng ở góc phải' : 'Admin chưa đặt Target OB'} để hiện cột Target và đường % Achievement.</p>}
      </div>

      {/* Performance theo TA */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h3 className="font-bold text-[15px]">Performance theo TA</h3>
          <span className="text-[12px] text-slate-500">OB và các bước funnel theo kỳ</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="inline-flex rounded-full border border-[#ECEEF2] bg-slate-50 p-0.5">
              {([['site', '× DC'], ['source', '× Source']] as ['site' | 'source', string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setDim(k); setPick(''); }} className={`px-3 h-7 rounded-full text-[12px] font-bold ${dim === k ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>{l}</button>
              ))}
            </div>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 px-2 border border-[#ECEEF2] rounded-lg text-[12.5px] bg-white max-w-[190px]">
              <option value="">Tất cả</option>
              {choices.map((c) => <option key={c}>{c}</option>)}
            </select>
            <GranToggle gran={gB} set={setGB} />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-1 text-[12px]">
          <span className="text-slate-500"><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#0B7BD1' }} />OB (cột)</span>
          {LINES.map((l) => (
            <button
              key={l.key} type="button" onClick={() => setOn((o) => ({ ...o, [l.key]: !o[l.key] }))}
              className={`px-2.5 h-6 rounded-full border font-semibold ${on[l.key] ? 'text-white border-transparent' : 'text-slate-400 bg-white border-[#ECEEF2]'}`}
              style={on[l.key] ? { background: l.color } : undefined}
            >{l.label}</button>
          ))}
        </div>
        <Combo
          labels={serB.map((s) => s.p.label)}
          bars={[{ name: 'OB', color: '#0B7BD1', vals: serB.map((s) => s.t.ob) }]}
          lines={LINES.filter((l) => on[l.key]).map((l) => ({ name: l.label, color: l.color, vals: serB.map((s) => s.t[l.key]) }))}
        />
      </div>

      {/* Conversion */}
      <div className={`${card} p-5`}>
        <div className="flex items-center gap-3 mb-2">
          <h3 className="font-bold text-[15px]">Conversion</h3>
          <span className="text-[12px] text-slate-500">Số người, tỷ lệ chuyển đổi và thay đổi so với kỳ liền trước</span>
          <div className="ml-auto"><GranToggle gran={gC} set={setGC} /></div>
        </div>
        <ConversionTable ser={serC} />
        <p className="text-[11.5px] text-slate-500 mt-2">
          Đỏ = dưới ngưỡng · cam = sát ngưỡng · xanh = đạt (R1 {fmtP0(THRESH.r1p)} · LU {fmtP0(THRESH.lup)} · SU {fmtP0(THRESH.sup)} · R2 {fmtP0(THRESH.r2p)} · OB {fmtP0(THRESH.obp)} · Retention {fmtP0(RET_THRESH)}). ▲▼ so với kỳ liền trước.
          Tỷ lệ chuyển đổi chỉ hiện khi có từ {MIN_SAMPLE} người ở mẫu số; Retention/Churn khi có từ {RET_MIN} người OB đã đủ 30 / 60 ngày.
        </p>
      </div>
    </>
  );
};

/** Hover text of a bar: the period, its total and the sources that make it up. */
function tipOf(label: string, name: string, total: number, parts: [string, number][]): string {
  return [`${label} · ${name} ${total}`, ...parts.filter((x) => x[1]).map((x) => `${x[0]}: ${x[1]}`)].join(String.fromCharCode(10));
}

const BAND_CLS: Record<string, string> = { none: 'text-slate-300', red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600' };

function Dlt({ cur, prev, unit = '' }: { cur: number | null; prev: number | null; unit?: string }) {
  if (cur === null || prev === null) return null;
  const d = (cur - prev) * 100;
  if (Math.abs(d) < 0.05) return <span className="text-[10px] text-slate-400"> ▬</span>;
  return <span className={`text-[10px] font-bold ${d > 0 ? 'text-emerald-600' : 'text-red-500'}`}> {d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(1).replace('.', ',')}{unit}</span>;
}

function ConversionTable({ ser }: { ser: PeriodTotals[] }) {
  if (!ser.length) return <div className="text-sm text-slate-400 py-8 text-center">Chưa có dữ liệu.</div>;
  const rows = [...ser].reverse(); // newest first
  type Stage = { head: string; cnt: (t: Totals) => number; den: (t: Totals) => number; thr: number };
  const stages: Stage[] = [
    { head: 'R1', cnt: (t) => t.r1, den: (t) => t.leads, thr: THRESH.r1p },
    { head: 'LU', cnt: (t) => t.lu, den: (t) => t.r1, thr: THRESH.lup },
    { head: 'SU', cnt: (t) => t.su, den: (t) => t.lu, thr: THRESH.sup },
    { head: 'R2', cnt: (t) => t.r2, den: (t) => t.su, thr: THRESH.r2p },
    { head: 'OB', cnt: (t) => t.ob, den: (t) => t.r2, thr: THRESH.obp },
  ];
  const rate = (s: Stage, t: Totals) => (s.den(t) >= MIN_SAMPLE ? s.cnt(t) / s.den(t) : null);
  return (
    <div className="overflow-auto max-h-[520px] rounded-xl border border-[#ECEEF2]">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 z-[1]">
          <tr className="text-[11px] bg-slate-50 text-slate-500">
            <th className="px-3 py-2" />
            <th className="px-2 py-2 text-center font-bold bg-sky-50 text-sky-700" colSpan={1 + stages.length}>Funnel · số người (tỷ lệ chuyển đổi)</th>
            <th className="px-2 py-2 text-center font-bold bg-emerald-50 text-emerald-700 border-l border-slate-200" colSpan={2}>Retention</th>
            <th className="px-2 py-2 text-center font-bold bg-rose-50 text-rose-700 border-l border-slate-200" colSpan={2}>Churn</th>
          </tr>
          <tr className="text-[11.5px] text-slate-600 bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-2 text-left font-bold">Kỳ</th>
            <th className="px-2 py-2 text-center font-bold">Leads</th>
            {stages.map((s) => <th key={s.head} className="px-2 py-2 text-center font-bold">{s.head}</th>)}
            <th className="px-2 py-2 text-center font-bold border-l border-slate-200">30 ngày</th>
            <th className="px-2 py-2 text-center font-bold">60 ngày</th>
            <th className="px-2 py-2 text-center font-bold border-l border-slate-200">30 ngày</th>
            <th className="px-2 py-2 text-center font-bold">60 ngày</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cur, idx) => {
            const prev = rows[idx + 1];
            const rc = retention(cur.t);
            const rp = prev ? retention(prev.t) : null;
            const ret = (v: number | null, pv: number | null | undefined, den: number, churn: boolean) => {
              if (v === null || den < RET_MIN) return <td className="px-2 py-2 text-center text-slate-300">–</td>;
              const b = band(churn ? 1 - v : v, RET_THRESH);
              return <td className={`px-2 py-2 text-center font-semibold ${BAND_CLS[b]}`}>{fmtP0(v)}<Dlt cur={churn ? -v : v} prev={pv === null || pv === undefined ? null : churn ? -pv : pv} /></td>;
            };
            return (
              <tr key={cur.p.key} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold whitespace-nowrap">{cur.p.label}</td>
                <td className="px-2 py-2 text-center">
                  {fmtN(cur.t.leads)}
                  {prev && prev.t.leads > 0 && <Dlt cur={cur.t.leads / prev.t.leads - 1} prev={0} unit="%" />}
                </td>
                {stages.map((s) => {
                  const r = rate(s, cur.t);
                  const pr = prev ? rate(s, prev.t) : null;
                  return (
                    <td key={s.head} className="px-2 py-2 text-center whitespace-nowrap">
                      <b>{fmtN(s.cnt(cur.t))}</b>{' '}
                      <span className={`font-semibold ${BAND_CLS[band(r, s.thr)]}`}>{r === null ? '' : `(${fmtP0(r)})`}</span>
                      <Dlt cur={r} prev={pr} />
                    </td>
                  );
                })}
                {ret(rc.r30, rp?.r30, cur.t.er30d, false)}
                {ret(rc.r60, rp?.r60, cur.t.er60d, false)}
                {ret(rc.c30, rp?.c30, cur.t.er30d, true)}
                {ret(rc.c60, rp?.c60, cur.t.er60d, true)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

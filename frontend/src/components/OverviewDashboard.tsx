// Chuyển từ OLD/src/components/OverviewDashboard.tsx (M5-3). Giữ nguyên giao diện; chỉ đổi nguồn số liệu:
// thay vì tải mọi dòng (getReportRows) rồi tính bằng dashboardCalc, gọi RPC tổng hợp ở server (reportService,
// cùng quy tắc – supabase/tests/report_parity_test.sql). Bộ lọc gửi lên server; thứ tự khi bằng nhau theo tên.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { TaCharts } from './TaCharts.tsx';
import type { UserProfile } from '../services/authService.ts';
import { reportService, type OptionKey, type ReportFilters, type ReportMeta, type ReportReasons } from '../services/reportService.ts';
import { donutsFromReasons } from '../services/reportAdapters.ts';
import {
  DonutData,
  MIN_SAMPLE,
  Preset,
  PRESET_LABELS,
  THRESH,
  Totals,
  TrendPoint,
  DEN_OF,
  monthBounds,
  monthKeys,
  monthLabel,
  presetRange,
  prevRange,
  rates,
  daysBetween,
} from '../../../shared/dashboardCalc.ts';

/**
 * "Báo cáo": the first page of the Recruitment Dashboard, per TA only.
 * Filter bar -> 8 flip cards (Leads ... ATT) -> 5 donuts with reasons -> monthly performance by TA -> monthly trend.
 * A TA only receives their own people from the server; Admin receives everyone and can filter by TA.
 */

const CARD_COLORS: [string, string][] = [
  ['#0A3D75', '#fff'], ['#0B5CA8', '#fff'], ['#0B7BD1', '#fff'], ['#2E94E0', '#fff'],
  ['#30AFFF', '#06304F'], ['#6CC6FF', '#06304F'], ['#9ADBFF', '#06304F'], ['#C6EBFF', '#06304F'],
];
const PASS_COLOR = '#30AFFF';
const NON_COLOR = '#C7CCD6';

const nf = new Intl.NumberFormat('vi-VN');
const fmtN = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '–' : nf.format(Math.round(v)));
const fmtP = (v: number | null) => (v === null || Number.isNaN(v) ? '–' : `${(v * 100).toFixed(1).replace('.', ',')}%`);
const fmtP0 = (v: number | null) => (v === null || Number.isNaN(v) ? '–' : `${Math.round(v * 100)}%`);

/** Change against the previous period: counts as a percentage, rates in points. */
function Delta({ cur, prev, kind }: { cur: number | null; prev: number | null; kind: 'n' | 'p' }) {
  if (cur === null || prev === null || prev === 0 || Number.isNaN(cur) || Number.isNaN(prev)) {
    return <span className="text-[11px] text-slate-400">–</span>;
  }
  const d = kind === 'p' ? (cur - prev) * 100 : ((cur - prev) / prev) * 100;
  const up = d >= 0;
  return (
    <span className={`text-[11px] font-bold ${up ? 'text-emerald-600' : 'text-red-500'}`} title="So với kỳ trước">
      {up ? '▲' : '▼'} {Math.abs(d).toFixed(kind === 'p' ? 1 : 0).replace('.', ',')}
      {kind === 'p' ? ' đ' : '%'}
    </span>
  );
}

const Donut: React.FC<{ pass: number; total: number }> = ({ pass, total }) => {
  const r = 42;
  const sw = 17;
  const C = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, pass / total) : 0;
  const gap = frac > 0 && frac < 1 ? 10 : 0; // pixels of the ring left empty between the two arcs
  const passLen = Math.max(0, frac * C - gap);
  const nonLen = Math.max(0, (1 - frac) * C - gap);
  return (
    <svg viewBox="0 0 120 120" className="w-[108px] h-[108px] mx-auto">
      {nonLen > 0 && (
        <circle cx="60" cy="60" r={r} fill="none" stroke={NON_COLOR} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${nonLen} ${C}`} transform={`rotate(${-90 + ((passLen + gap) / C) * 360 + (gap / 2 / C) * 360} 60 60)`} />
      )}
      {passLen > 0 && (
        <circle cx="60" cy="60" r={r} fill="none" stroke={PASS_COLOR} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${passLen} ${C}`} transform={`rotate(${-90 + (gap / 2 / C) * 360} 60 60)`} />
      )}
      {total > 0 && frac === 0 && <circle cx="60" cy="60" r={r} fill="none" stroke={NON_COLOR} strokeWidth={sw} />}
      <text x="60" y="66" textAnchor="middle" fontSize="20" fontWeight="700" fill="#111827">{fmtP0(total ? pass / total : null)}</text>
    </svg>
  );
};

interface Props {
  user: UserProfile;
}

const PERF_DIM: Record<'pic' | 'source' | 'subSource' | 'site' | 'position', OptionKey> = {
  pic: 'pic', source: 'source', subSource: 'sub_source', site: 'site', position: 'position',
};
const NO_OPTIONS: Record<OptionKey, string[]> = { pic: [], site: [], source: [], sub_source: [], region: [], dept: [], position: [] };

interface MainData { T: Totals; P: Totals; trendAll: TrendPoint[]; reasons: ReportReasons; counts: { all: number; filtered: number } }

export const OverviewDashboard: React.FC<Props> = ({ user }) => {
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const today = meta?.today || '';
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  const [preset, setPreset] = useState<Preset>('ytd');
  const [cFrom, setCFrom] = useState('');
  const [cTo, setCTo] = useState('');
  const [fPic, setFPic] = useState('');
  const [fSite, setFSite] = useState('');
  const [fSource, setFSource] = useState('');
  const [fRegion, setFRegion] = useState('');
  const [fDept, setFDept] = useState('');
  const [fPos, setFPos] = useState('');
  const [fSub, setFSub] = useState('');
  const [more, setMore] = useState(false);
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const [perfMonth, setPerfMonth] = useState<string>('all');
  const [perfDim, setPerfDim] = useState<'pic' | 'source' | 'subSource' | 'site' | 'position'>('pic');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMeta(await reportService.getMeta());
      setReloadKey((k) => k + 1);
      const d = new Date();
      setUpdatedAt(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu báo cáo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const minDate = meta?.minDate || '';
  const [from, to] = useMemo<[string, string]>(() => {
    if (!today) return ['', ''];
    if (preset === 'custom') return [cFrom || minDate || today, cTo || today];
    return presetRange(preset, today, minDate);
  }, [preset, cFrom, cTo, today, minDate]);

  // Bộ lọc gửi lên server (tên cột DB). Hệ cũ lọc mảng dòng ở trình duyệt.
  const filters = useMemo<ReportFilters>(
    () => ({ pic: fPic, site: fSite, source: fSource, region: fRegion, dept: fDept, position: fPos, sub_source: fSub }),
    [fPic, fSite, fSource, fRegion, fDept, fPos, fSub]
  );

  const distinct = (k: OptionKey) => (meta ? meta.options[k] : []);

  const ready = Boolean(from && to);
  const [pf, pt] = useMemo(() => (ready ? prevRange(from, to) : ['', '']), [from, to, ready]);

  // Kỳ đang xem + kỳ trước + xu hướng + lý do + số hồ sơ: 5 RPC song song; bỏ kết quả cũ nếu bộ lọc đã đổi.
  const [data, setData] = useState<MainData | null>(null);
  useEffect(() => {
    if (!ready || !today) return;
    let alive = true;
    Promise.all([
      reportService.getTotals(from, to, filters, today),
      reportService.getTotals(pf, pt, filters, today),
      reportService.getTrend(from, to, filters),
      reportService.getReasons(from, to, filters),
      reportService.getCounts(filters),
    ])
      .then(([T, P, trendAll, reasons, counts]) => { if (alive) { setData({ T, P, trendAll, reasons, counts }); setError(''); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Không tải được dữ liệu báo cáo.'); });
    return () => { alive = false; };
  }, [ready, from, to, pf, pt, filters, today, reloadKey]);
  const T: Totals | null = data?.T ?? null;
  const P: Totals | null = data?.P ?? null;
  const R = T ? rates(T) : null;
  const RP = P ? rates(P) : null;
  const nDays = ready ? Math.max(1, daysBetween(from, to < today ? to : today) + 1) : 1;

  const trendPts = useMemo(() => (data ? data.trendAll.slice(-12) : []), [data]);
  const lastChurn = useMemo(() => {
    for (let i = trendPts.length - 1; i >= 0; i--) {
      const [, last] = monthBounds(trendPts[i].month);
      if (trendPts[i].churn !== null && last <= today) return { cur: trendPts[i], prev: trendPts[i - 1] };
    }
    const i = trendPts.length - 1;
    return i >= 0 && trendPts[i].churn !== null ? { cur: trendPts[i], prev: trendPts[i - 1] } : null;
  }, [trendPts, today]);

  const months = useMemo(() => (ready ? monthKeys(from, to) : []), [from, to, ready]);
  useEffect(() => {
    if (perfMonth !== 'all' && !months.includes(perfMonth)) setPerfMonth(months.length ? months[months.length - 1] : 'all');
  }, [months, perfMonth]);

  // ---------- 8 flip cards
  const gap = (rk: keyof typeof THRESH, den: keyof Totals, num: keyof Totals) =>
    T ? Math.max(0, Math.round(THRESH[rk] * (T[den] as number) - (T[num] as number))) : 0;
  const thr = (rk: keyof typeof THRESH, den: keyof Totals, num: keyof Totals): [string, string] => {
    const miss = gap(rk, den, num);
    return ['Ngưỡng', `${fmtP0(THRESH[rk])} · ${miss > 0 ? 'thiếu ' + fmtN(miss) : 'đạt'}`];
  };
  const prevLine = (v: number | null): [string, string] => ['Kỳ trước', fmtN(v)];

  interface FlipCard { id: string; name: string; abbr: string; big: string; sub: React.ReactNode; back: [string, string][] }
  const cards: FlipCard[] = T && P && R && RP ? [
    {
      id: 'leads', name: 'Leads', abbr: 'Ứng viên', big: fmtN(T.leads),
      sub: <Delta cur={T.leads} prev={P.leads} kind="n" />,
      back: [['Trung bình', `${(T.leads / nDays).toFixed(1).replace('.', ',')} / ngày`], prevLine(P.leads)],
    },
    {
      id: 'r1', name: 'Screening Passed', abbr: 'R1', big: fmtN(T.r1),
      sub: <><b>{fmtP(R.r1p)}</b> <Delta cur={R.r1p} prev={RP.r1p} kind="p" /></>,
      back: [['R1 / Leads', fmtP(R.r1p)], thr('r1p', 'leads', 'r1'), prevLine(P.r1)],
    },
    {
      id: 'lu', name: 'Line Up', abbr: 'LU', big: fmtN(T.lu),
      sub: <><b>{fmtP(R.lup)}</b> <Delta cur={R.lup} prev={RP.lup} kind="p" /></>,
      back: [['LU / R1', fmtP(R.lup)], thr('lup', 'r1', 'lu'), prevLine(P.lu)],
    },
    {
      id: 'su', name: 'Show Up', abbr: 'SU', big: fmtN(T.su),
      sub: <><b>{fmtP(R.sup)}</b> <Delta cur={R.sup} prev={RP.sup} kind="p" /></>,
      back: [['SU / LU', fmtP(R.sup)], thr('sup', 'lu', 'su'), prevLine(P.su)],
    },
    {
      id: 'r2', name: 'Pass Interview', abbr: 'R2', big: fmtN(T.r2),
      sub: <><b>{fmtP(R.r2p)}</b> <Delta cur={R.r2p} prev={RP.r2p} kind="p" /></>,
      back: [['R2 / SU', fmtP(R.r2p)], thr('r2p', 'su', 'r2'), prevLine(P.r2)],
    },
    {
      id: 'ob', name: 'Onboard', abbr: 'OB', big: fmtN(T.ob),
      sub: <>OB/R2 <b>{fmtP(R.obp)}</b> <Delta cur={R.obp} prev={RP.obp} kind="p" /></>,
      back: [
        ['Joined · Noshow · Canceled', (() => { const d = T.ob + T.ns + T.cc; return d ? `${fmtP0(T.ob / d)} · ${fmtP0(T.ns / d)} · ${fmtP0(T.cc / d)}` : '–'; })()],
        ['CR (OB / Leads)', fmtP(R.cr)], prevLine(P.ob),
      ],
    },
    {
      id: 'er', name: 'Joined & Active', abbr: 'ER', big: fmtN(T.er),
      sub: <>ER <b>{fmtP(R.erp)}</b> <Delta cur={R.erp} prev={RP.erp} kind="p" /></>,
      back: [
        ['ER > 30 ngày', fmtP(R.er30)], ['ER > 60 ngày', fmtP(R.er60)],
        ['Đủ 30 / 60 ngày', `${fmtN(T.er30n)}/${fmtN(T.er30d)} · ${fmtN(T.er60n)}/${fmtN(T.er60d)}`],
      ],
    },
    {
      id: 'att', name: 'Tỷ lệ nghỉ việc', abbr: 'ATT', big: lastChurn?.cur.churn != null ? fmtP(lastChurn.cur.churn) : '–',
      sub: lastChurn ? <>% Churn · {monthLabel(lastChurn.cur.month)}{lastChurn.prev?.churn != null && <> <Delta cur={lastChurn.cur.churn} prev={lastChurn.prev.churn} kind="p" /></>}</> : '% Churn',
      back: [
        ['Nghỉ trong tháng', lastChurn ? fmtN(lastChurn.cur.att) : '–'],
        ['Đang làm đầu tháng', lastChurn ? fmtN(lastChurn.cur.start) : '–'],
        ['Nghỉ < 30 ngày', `${fmtN(T.att30)} · ${fmtP(T.att ? T.att30 / T.att : null)}`],
        ['OB − ER', fmtN(T.ob - T.er)],
      ],
    },
  ] : [];

  // ---------- donuts
  const donutData: DonutData[] = useMemo(() => (data ? donutsFromReasons(data.T, data.reasons) : []), [data]);

  // ---------- monthly performance by TA
  const perfFrom = perfMonth === 'all' ? from : monthBounds(perfMonth)[0] > from ? monthBounds(perfMonth)[0] : from;
  const perfTo = perfMonth === 'all' ? to : monthBounds(perfMonth)[1] < to ? monthBounds(perfMonth)[1] : to;
  const [perfList, setPerfList] = useState<[string, Totals][]>([]);
  const [perfTotal, setPerfTotal] = useState<Totals | null>(null);
  useEffect(() => {
    if (!ready || !today) return;
    let alive = true;
    Promise.all([
      reportService.getGroupTotals(perfFrom, perfTo, filters, PERF_DIM[perfDim], today),
      reportService.getTotals(perfFrom, perfTo, filters, today),
    ])
      .then(([list, tot]) => { if (alive) { setPerfList(list); setPerfTotal(tot); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Không tải được hiệu suất theo tháng.'); });
    return () => { alive = false; };
  }, [ready, perfDim, perfFrom, perfTo, filters, today, reloadKey]);

  const rateCell = (t: Totals, key: keyof typeof THRESH, isTot: boolean) => {
    const r = rates(t) as unknown as Record<string, number | null>;
    const den = DEN_OF[key];
    const v = r[key];
    if (v === null || v === undefined || (!isTot && den && (t[den] as number) < MIN_SAMPLE)) return <td className="px-2 py-2 text-center text-slate-300">–</td>;
    const low = v < THRESH[key];
    return (
      <td className={`px-2 py-2 text-center font-semibold ${low ? 'text-red-600' : 'text-sky-600'}`}>
        {Math.round(v * 100)}% <span className="text-[9px]">{low ? '▼' : '▲'}</span>
      </td>
    );
  };

  const perfRow = (name: string, t: Totals, isTot: boolean) => {
    const rr = rates(t);
    const er30Low = rr.er30 !== null && rr.er30 < THRESH.er30;
    return (
      <tr key={name} className={isTot ? 'bg-slate-50 font-extrabold' : 'border-t border-slate-100'}>
        <td className="px-3 py-2 text-left whitespace-nowrap font-semibold">{name}</td>
        {[t.leads, t.r1, t.lu, t.su, t.r2, t.ob].map((v, i) => <td key={i} className="px-2 py-2 text-center">{fmtN(v)}</td>)}
        <td className="px-2 py-2 text-center border-l border-slate-200">{fmtN(t.er)}</td>
        {rateCell(t, 'erp', isTot)}
        <td className={`px-2 py-2 text-center ${rr.er30 === null ? 'text-slate-300' : er30Low ? 'text-red-600 font-semibold' : 'text-sky-600 font-semibold'}`}>
          {rr.er30 === null ? '–' : `${Math.round(rr.er30 * 100)}% (${t.er30n}/${t.er30d})`}
        </td>
        <td className="px-2 py-2 text-center">{fmtN(t.att)}</td>
        <td className="px-2 py-2 text-center border-l border-slate-200">
          {rr.cr === null ? '–' : (
            <span className={rr.cr < THRESH.cr ? 'text-red-600 font-semibold' : 'text-sky-600 font-semibold'}>
              {Math.round(rr.cr * 100)}% <span className="text-[9px]">{rr.cr < THRESH.cr ? '▼' : '▲'}</span>
            </span>
          )}
        </td>
        {rateCell(t, 'r1p', isTot)}
        {rateCell(t, 'lup', isTot)}
        {rateCell(t, 'sup', isTot)}
        {rateCell(t, 'r2p', isTot)}
        {rateCell(t, 'obp', isTot)}
      </tr>
    );
  };

  // ---------- trend chart (SVG)
  const TrendChart = () => {
    const W = 1100, H = 280, L = 44, Rr = 44, Tt = 20, B = 36;
    const n = trendPts.length;
    if (!n) return <div className="text-sm text-slate-400 py-10 text-center">Chưa có dữ liệu trong khoảng này.</div>;
    const maxC = Math.max(1, ...trendPts.flatMap((p) => [p.ob, p.att]));
    const maxP = Math.max(0.05, ...trendPts.map((p) => p.churn || 0));
    const gw = (W - L - Rr) / n;
    const y = (v: number) => Tt + (H - Tt - B) * (1 - v / maxC);
    const yp = (v: number) => Tt + (H - Tt - B) * (1 - v / maxP);
    const line = trendPts.map((p, i) => (p.churn === null ? null : `${L + gw * i + gw / 2},${yp(p.churn)}`)).filter(Boolean).join(' ');
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[290px]">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - Rr} y1={Tt + (H - Tt - B) * f} y2={Tt + (H - Tt - B) * f} stroke="#ECEEF2" />
            <text x={L - 6} y={Tt + (H - Tt - B) * f + 3} textAnchor="end" fontSize="10" fill="#9CA3AF">{Math.round(maxC * (1 - f))}</text>
            <text x={W - Rr + 6} y={Tt + (H - Tt - B) * f + 3} fontSize="10" fill="#9CA3AF">{Math.round(maxP * (1 - f) * 100)}%</text>
          </g>
        ))}
        {trendPts.map((p, i) => {
          const x0 = L + gw * i + gw * 0.16;
          const bw = gw * 0.3;
          return (
            <g key={p.month}>
              <rect x={x0} y={y(p.ob)} width={bw} height={Tt + (H - Tt - B) - y(p.ob)} rx="3" fill="#0B7BD1" />
              <rect x={x0 + bw + 3} y={y(p.att)} width={bw} height={Tt + (H - Tt - B) - y(p.att)} rx="3" fill="#F59E0B" />
              <text x={x0 + bw / 2} y={y(p.ob) - 4} textAnchor="middle" fontSize="10" fill="#0B5CA8" fontWeight="700">{p.ob || ''}</text>
              <text x={x0 + bw * 1.5 + 3} y={y(p.att) - 4} textAnchor="middle" fontSize="10" fill="#B45309" fontWeight="700">{p.att || ''}</text>
              <text x={L + gw * i + gw / 2} y={H - 14} textAnchor="middle" fontSize="11" fill="#6B7280">{monthLabel(p.month)}</text>
            </g>
          );
        })}
        {line && <polyline points={line} fill="none" stroke="#EF4444" strokeWidth="2" />}
        {trendPts.map((p, i) => p.churn === null ? null : (
          <g key={p.month + 'c'}>
            <circle cx={L + gw * i + gw / 2} cy={yp(p.churn)} r="3.5" fill="#EF4444" />
            <text x={L + gw * i + gw / 2} y={yp(p.churn) - 8} textAnchor="middle" fontSize="10" fill="#B91C1C" fontWeight="700">{(p.churn * 100).toFixed(1).replace('.', ',')}%</text>
          </g>
        ))}
      </svg>
    );
  };

  const box = 'bg-white border border-[#ECEEF2] rounded-xl px-3 h-10 flex items-center gap-1.5 min-w-0';
  const sel = 'bg-transparent outline-none text-[13px] text-slate-900 min-w-0 flex-1';
  const card = 'bg-white border border-[#ECEEF2] rounded-2xl shadow-[0_1px_2px_rgba(17,24,39,0.04),0_6px_20px_rgba(17,24,39,0.05)]';
  const clearAll = () => {
    setPreset('ytd'); setCFrom(''); setCTo(''); setFPic(''); setFSite(''); setFSource('');
    setFRegion(''); setFDept(''); setFPos(''); setFSub('');
  };
  const activeFilters = [fPic, fSite, fSource, fRegion, fDept, fPos, fSub].filter(Boolean).length;

  return (
    <div className="overflow-x-auto">
      <style>{`
        .flip3d{perspective:900px;height:150px;cursor:pointer;min-width:0}
        .flip3d .fin{position:relative;width:100%;height:100%;transition:transform .5s cubic-bezier(.4,.2,.2,1);transform-style:preserve-3d}
        .flip3d.pin .fin{transform:rotateY(180deg)}
        .flip3d .face{position:absolute;inset:0;border-radius:14px;padding:10px 12px;backface-visibility:hidden;-webkit-backface-visibility:hidden;display:flex;flex-direction:column;overflow:hidden;min-width:0}
        .flip3d .back{transform:rotateY(180deg);background:#fff;border:1px solid #ECEEF2}
        .dflip3d{perspective:900px;height:218px;min-width:0}
        .dflip3d .fin{position:relative;width:100%;height:100%;transition:transform .5s cubic-bezier(.4,.2,.2,1);transform-style:preserve-3d}
        .dflip3d.pin .fin{transform:rotateY(180deg)}
        .dflip3d .face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;display:flex;flex-direction:column}
        .dflip3d .back{transform:rotateY(180deg)}
      `}</style>
      <div className="min-w-[1240px] space-y-4">
        {/* Filter bar */}
        <div className="pb-3 border-b border-[#ECEEF2] space-y-3">
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'minmax(0,1.5fr) repeat(3,minmax(0,1fr)) auto' }}>
            <div className={box}>
              <b className="text-slate-500 font-medium whitespace-nowrap text-[13px]">Thời gian:</b>
              <select className="bg-transparent outline-none text-[13px] text-slate-900 w-[112px] flex-none" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
                {PRESET_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <input type="date" className="bg-transparent outline-none text-[12px] w-[118px]" value={from} disabled={preset !== 'custom'} onChange={(e) => { setPreset('custom'); setCFrom(e.target.value); }} />
              <span className="text-slate-400">→</span>
              <input type="date" className="bg-transparent outline-none text-[12px] w-[118px]" value={to} disabled={preset !== 'custom'} onChange={(e) => { setPreset('custom'); setCTo(e.target.value); }} />
            </div>
            {user.role === 'admin' ? (
              <div className={box}><b className="text-slate-500 font-medium text-[13px]">TA:</b>
                <select className={sel} value={fPic} onChange={(e) => setFPic(e.target.value)}>
                  <option value="">Tất cả TA</option>
                  {distinct('pic').map((v) => <option key={v}>{v}</option>)}
                </select></div>
            ) : (
              <div className={box}><b className="text-slate-500 font-medium text-[13px]">TA:</b><span className="text-[13px] font-semibold">{user.pic_code || user.username}</span></div>
            )}
            <div className={box}><b className="text-slate-500 font-medium text-[13px]">Site:</b>
              <select className={sel} value={fSite} onChange={(e) => setFSite(e.target.value)}>
                <option value="">Tất cả Site</option>
                {distinct('site').map((v) => <option key={v}>{v}</option>)}
              </select></div>
            <div className={box}><b className="text-slate-500 font-medium text-[13px]">Source:</b>
              <select className={sel} value={fSource} onChange={(e) => setFSource(e.target.value)}>
                <option value="">Tất cả Source</option>
                {distinct('source').map((v) => <option key={v}>{v}</option>)}
              </select></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setMore((m) => !m)} className="h-10 px-3 inline-flex items-center gap-1.5 text-[13px] font-semibold border border-[#ECEEF2] rounded-xl bg-white hover:bg-slate-50">
                <SlidersHorizontal className="w-4 h-4" /> Lọc thêm {activeFilters > 0 && <span className="bg-blue-600 text-white rounded-full text-[10px] px-1.5">{activeFilters}</span>}
              </button>
              <button type="button" onClick={clearAll} className="h-10 px-3 text-[13px] border border-[#ECEEF2] rounded-xl bg-white hover:bg-slate-50">Xóa bộ lọc</button>
              <button type="button" onClick={load} disabled={loading} className="h-10 px-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-700 border border-blue-200 rounded-xl hover:bg-blue-50 disabled:opacity-50">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Làm mới
              </button>
            </div>
          </div>
          {more && (
            <div className="grid grid-cols-4 gap-2.5">
              <div className={box}><b className="text-slate-500 font-medium text-[13px]">Vùng:</b>
                <select className={sel} value={fRegion} onChange={(e) => setFRegion(e.target.value)}><option value="">Tất cả</option>{distinct('region').map((v) => <option key={v}>{v}</option>)}</select></div>
              <div className={box}><b className="text-slate-500 font-medium text-[13px]">Phòng/Ban:</b>
                <select className={sel} value={fDept} onChange={(e) => setFDept(e.target.value)}><option value="">Tất cả</option>{distinct('dept').map((v) => <option key={v}>{v}</option>)}</select></div>
              <div className={box}><b className="text-slate-500 font-medium text-[13px]">Sub_Source:</b>
                <select className={sel} value={fSub} onChange={(e) => setFSub(e.target.value)}><option value="">Tất cả</option>{distinct('sub_source').map((v) => <option key={v}>{v}</option>)}</select></div>
              <div className={box}><b className="text-slate-500 font-medium text-[13px]">Vị trí:</b>
                <select className={sel} value={fPos} onChange={(e) => setFPos(e.target.value)}><option value="">Tất cả</option>{distinct('position').map((v) => <option key={v}>{v}</option>)}</select></div>
            </div>
          )}
          <div className="text-[12px] text-slate-500 flex items-center gap-3">
            <span>Kỳ đang xem: <b>{from.split('-').reverse().join('/')}</b> → <b>{to.split('-').reverse().join('/')}</b> · so với kỳ trước {pf.split('-').reverse().join('/')} → {pt.split('-').reverse().join('/')}</span>
            <span className="ml-auto">{updatedAt && `Cập nhật ${updatedAt} · `}{data?.counts.filtered ?? 0} / {data?.counts.all ?? 0} ứng viên</span>
          </div>
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-800">{error}</div>}
        {loading && !data && <div className="py-12 text-center text-sm text-slate-500">Đang tải dữ liệu báo cáo...</div>}

        {T && (
          <>
            {/* 8 flip cards */}
            <div className="grid grid-cols-8 gap-3">
              {cards.map((c, i) => {
                const [bg, fg] = CARD_COLORS[i];
                return (
                  <div key={c.id} className={`flip3d ${pinned[c.id] ? 'pin' : ''}`} onClick={() => setPinned((p) => ({ ...p, [c.id]: !p[c.id] }))} title="Bấm để xem chi tiết">
                    <div className="fin">
                      <div className="face" style={{ background: bg, color: fg }}>
                        <div className="text-[11.5px] font-bold leading-tight">{c.name}<small className="block text-[9.5px] font-medium opacity-75">{c.abbr}</small></div>
                        <div className="text-[28px] font-extrabold tracking-tight leading-none mt-auto">{c.big}</div>
                        <div className="mt-1 text-[11px] bg-white/95 text-slate-500 rounded-md px-1.5 py-0.5 self-start max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{c.sub}</div>
                      </div>
                      <div className="face back" style={{ borderTop: `3px solid ${bg}` }}>
                        <div className="text-[11.5px] font-bold text-slate-600 pb-1 mb-1 border-b border-dashed border-slate-200">{c.name} <small className="font-medium text-slate-400">{c.abbr}</small></div>
                        {c.back.map(([l, v]) => (
                          <div key={l} className="flex justify-between gap-2 text-[11px] py-[2px]"><span className="text-slate-500">{l}</span><b className="text-slate-900 text-right">{v}</b></div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 5 donuts */}
            <div className="grid grid-cols-5 gap-3">
              {donutData.map((d) => {
                const non = Math.max(0, d.total - d.pass);
                const tot = Math.max(d.total, d.pass);
                const canFlip = d.key !== 'r1';
                return (
                  <div key={d.key} className={`dflip3d ${pinned['d_' + d.key] ? 'pin' : ''}`} style={{ cursor: canFlip ? 'pointer' : 'default' }} onClick={() => canFlip && setPinned((p) => ({ ...p, ['d_' + d.key]: !p['d_' + d.key] }))}>
                    <div className="fin">
                      <div className={`face ${card} px-4 pt-3.5 pb-3`}>
                        {canFlip && <span className="absolute top-2.5 right-3 z-[2] text-[10.5px] font-semibold text-[#0B5CA8] bg-[#EAF4FF] border border-[#CFE6FF] rounded-full px-2.5 py-[3px] whitespace-nowrap">Lý do ↻</span>}
                        <div className={`font-semibold text-[12.5px] text-[#111827] whitespace-nowrap ${canFlip ? 'pr-16' : ''}`}>{d.title}<small className="ml-2 font-medium text-[#9CA3AF] text-[10.5px]">{d.sub}</small></div>
                        <div className="my-2"><Donut pass={d.pass} total={tot} /></div>
                        <div className="text-[11px] text-slate-600 flex items-center justify-center gap-3 mt-auto whitespace-nowrap">
                          <div className="flex items-center gap-1 whitespace-nowrap"><i className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: PASS_COLOR }} />Passed <b>{fmtN(d.pass)}</b> <span className="text-slate-400">{fmtP0(tot ? d.pass / tot : null)}</span></div>
                          <div className="flex items-center gap-1 whitespace-nowrap"><i className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: NON_COLOR }} />{d.nonLabel} <b>{fmtN(non)}</b> <span className="text-slate-400">{fmtP0(tot ? non / tot : null)}</span></div>
                        </div>
                      </div>
                      <div className={`face back ${card} p-4`}>
                        <div className="font-extrabold text-[14px]">{d.title}<small className="ml-1.5 font-medium text-slate-400 text-[11px]">{d.sub}</small></div>
                        <div className="text-[12px] font-bold text-slate-600 mt-2">{d.reasonsTitle}</div>
                        <div className="text-[11px] text-slate-400 mb-2">{d.note}</div>
                        <div className="flex-1 overflow-auto space-y-1.5">
                          {d.reasons.length === 0 && <div className="text-[12px] text-slate-400">Chưa có lý do nào được ghi.</div>}
                          {d.reasons.slice(0, 8).map(([name, n]) => {
                            const max = d.reasons[0][1] || 1;
                            return (
                              <div key={name} className="text-[12px]">
                                <div className="flex justify-between gap-2"><span className="truncate" title={name}>{name}</span><b>{n}</b></div>
                                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.round((n / max) * 100)}%` }} /></div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-auto pt-1 text-[10.5px] text-slate-400 text-center">↻ Quay lại</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <TaCharts filters={filters} options={meta?.options || NO_OPTIONS} reloadKey={reloadKey} to={to} today={today} minDate={minDate} isAdmin={user.role === 'admin'}
              trend={(
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-bold text-[15px]">Onboard, nghỉ việc &amp; % churn theo tháng</h3>
                <span className="flex items-center gap-3 text-[12px] text-slate-500 ml-auto">
                  <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#0B7BD1' }} />Onboard</span>
                  <span><i className="inline-block w-2.5 h-2.5 rounded-sm mr-1" style={{ background: '#F59E0B' }} />Nghỉ việc</span>
                  <span><i className="inline-block w-2.5 h-0.5 mr-1 align-middle" style={{ background: '#EF4444' }} />% churn</span>
                </span>
              </div>
              <p className="text-[12px] text-slate-500 mb-1">% churn của tháng = số nghỉ trong tháng / (số đang làm đầu tháng + OB trong tháng).</p>
              <TrendChart />
            </div>
              )} />

            {/* Monthly performance by TA */}
            <div className={`${card} p-5`}>
              <div className="flex items-center gap-3 flex-wrap mb-3">
                <h3 className="font-bold text-[15px]">Hiệu suất tuyển dụng theo tháng</h3>
                <div className="inline-flex rounded-full border border-[#ECEEF2] bg-slate-50 p-0.5">
                  {([['pic', 'TA'], ['source', 'Source'], ['subSource', 'Sub_Source'], ['site', 'Site'], ['position', 'Position']] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setPerfDim(k)} className={`px-3 h-7 rounded-full text-[12px] font-bold ${perfDim === k ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>{l}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 ml-auto">
                  {['all', ...months].map((m) => (
                    <button key={m} type="button" onClick={() => setPerfMonth(m)} className={`px-3 h-8 rounded-full text-[12px] font-bold border ${perfMonth === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-[#ECEEF2] hover:bg-slate-50'}`}>
                      {m === 'all' ? 'Tất cả' : monthLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
              {perfList.length === 0 ? (
                <div className="text-sm text-slate-400 py-8 text-center">Không có dữ liệu cho kỳ này.</div>
              ) : (
                <div className="overflow-auto max-h-[560px] rounded-xl border border-[#ECEEF2]">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 z-[1]">
                      <tr className="text-[11px] text-slate-500 bg-slate-50">
                        <th className="px-3 py-2" />
                        <th colSpan={6} className="px-2 py-2 text-center font-bold bg-sky-50 text-sky-700">Funnel</th>
                        <th colSpan={4} className="px-2 py-2 text-center font-bold bg-emerald-50 text-emerald-700 border-l border-slate-200">Retention</th>
                        <th colSpan={6} className="px-2 py-2 text-center font-bold bg-violet-50 text-violet-700 border-l border-slate-200">Conversion</th>
                      </tr>
                      <tr className="text-[11.5px] text-slate-600 bg-slate-50 border-b border-slate-200">
                        {[({ pic: 'TA', source: 'Source', subSource: 'Sub_Source', site: 'Site', position: 'Position' } as const)[perfDim], 'Leads', 'R1', 'LU', 'SU', 'R2', 'OB', 'ER', '%ER', 'ER30', 'ATT', 'CR', 'R1', 'LU', 'SU', 'R2', 'OB'].map((h, i) => (
                          <th key={i} className={`px-2 py-2 font-bold ${i === 0 ? 'text-left px-3' : 'text-center'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {perfList.map(([name, t]) => perfRow(name, t, false))}
                      {perfTotal && perfRow(`Tổng (${perfList.length})`, perfTotal, true)}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11.5px] text-slate-500 mt-2">
                ▼ Đỏ = dưới ngưỡng · ▲ Xanh = đạt ngưỡng: CR &lt;{fmtP0(THRESH.cr)} · R1 &lt;{fmtP0(THRESH.r1p)} · LU &lt;{fmtP0(THRESH.lup)} · SU &lt;{fmtP0(THRESH.sup)} · R2 &lt;{fmtP0(THRESH.r2p)} · OB &lt;{fmtP0(THRESH.obp)} · %ER &lt;{fmtP0(THRESH.erp)} · ER30 &lt;{fmtP0(THRESH.er30)}.
                Tỷ lệ chỉ hiện khi có từ {MIN_SAMPLE} người trở lên ở mẫu số.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

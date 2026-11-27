// Task #10 (2) – TA Credit bonus theo kỳ lương (kết quả tháng N trả ở kỳ N+1). Thay file "TA_Credit_Bonus_<Mon><YY>.xlsx".
// Kỳ đang mở: tính từ OB + hồ sơ bonus TA + cấu hình (shared/bonus/taCredit.ts). Kỳ đã chốt: ảnh chụp đã lưu.
import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Lock, LockOpen, RefreshCw, Save } from 'lucide-react';
import { bonusService, type BonusLine, type BonusPeriod, type TaProfileRow } from '../services/bonusService.ts';
import { vnTodayIso } from '../../../shared/cnbRules.ts';
import { displayDateVn, fmtVnd, isIsoDate, periodLabel, periodMonthRange, periodOfDate, periodShort, recentPeriodKeys, shiftPeriod } from '../../../shared/bonus/period.ts';
import {
  OB_SKIP_LABELS,
  TA_CREDIT_DEFAULT_CONFIG,
  TA_LEVELS,
  TA_REGIONS,
  TA_ROW_PROBLEM_LABELS,
  belowBaseStreak,
  buildTaCreditPeriod,
  cleanTaCreditConfig,
  performanceMonth,
  taCreditRowsFromLines,
  type TaCreditConfig,
  type TaCreditResult,
  type TaCreditRow,
  type TaCreditSource,
  type TierName,
} from '../../../shared/bonus/taCredit.ts';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const input = 'border border-slate-300 rounded px-2 py-1 text-xs';

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div>
);

const TIER_STYLE: Record<TierName, string> = {
  Base: 'bg-slate-100 text-slate-600', Target: 'bg-sky-50 text-sky-700', Outperformance: 'bg-emerald-50 text-emerald-700', Outstanding: 'bg-violet-50 text-violet-700',
};

const ObDetail: React.FC<{ row: TaCreditRow; colSpan: number }> = ({ row, colSpan }) => (
  <tr className="bg-slate-50">
    <td colSpan={colSpan} className="px-6 py-2">
      {!row.obs.length ? <span className="text-slate-500">Không có OB trong tháng.</span> : (
        <table className="text-[11px]">
          <tbody>
            {row.obs.map((o) => (
              <tr key={o.record_id}>
                <td className="pr-3">{o.candidate_code}</td>
                <td className="pr-3">{o.full_name}</td>
                <td className="pr-3">{o.rank}</td>
                <td className="pr-3">{o.site}</td>
                <td className="pr-3 tabular-nums">{displayDateVn(o.ob_date)}</td>
                <td className="pr-3 tabular-nums">{`${o.days} ngày`}</td>
                <td className="pr-3 tabular-nums font-medium">{o.skip ? '' : `${o.credits} credit`}</td>
                <td className="text-amber-700">{o.skip ? OB_SKIP_LABELS[o.skip] : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </td>
  </tr>
);

function defaultCutoff(period: string, today: string): string {
  return periodOfDate(today) === period ? today : periodMonthRange(period).to;
}

export const BonusTaCreditPanel: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const today = vnTodayIso();
  const thisPeriod = periodOfDate(today);
  const periodOptions = useMemo(() => [shiftPeriod(thisPeriod, 1), ...recentPeriodKeys(12, thisPeriod)], [thisPeriod]);
  const [period, setPeriod] = useState(thisPeriod);
  const [asof, setAsof] = useState(today);
  const [periods, setPeriods] = useState<BonusPeriod[]>([]);
  const [lines, setLines] = useState<BonusLine[]>([]);
  const [sources, setSources] = useState<TaCreditSource[]>([]);
  const [profiles, setProfiles] = useState<TaProfileRow[]>([]);
  const [cfg, setCfg] = useState<TaCreditConfig>(TA_CREDIT_DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [show, setShow] = useState<'tas' | 'skipped'>('tas');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const perfMonth = performanceMonth(period);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, c, pr, src] = await Promise.all([
        bonusService.periods('ta_credit'), bonusService.taCreditConfig(), bonusService.taProfiles(), bonusService.taCreditSources(perfMonth),
      ]);
      setPeriods(ps);
      setCfg(c);
      setProfiles(pr);
      setSources(src);
      setLines(await bonusService.lines(ps.filter((p) => p.status === 'da_chot').map((p) => p.id)));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [perfMonth]);

  useEffect(() => { void reload(); }, [reload]);

  const cur = periods.find((p) => p.period_key === period) ?? null;
  const locked = cur?.status === 'da_chot';

  const result = useMemo((): TaCreditResult | null => {
    if (locked && cur) {
      const ls = lines.filter((l) => l.period_id === cur.id);
      const rows = taCreditRowsFromLines(ls);
      return {
        perfMonth, rows, skipped: [], lines: ls,
        totals: {
          amount: ls.reduce((s, l) => s + l.amount, 0), credits: rows.reduce((s, r) => s + r.credits, 0),
          eligible: rows.reduce((s, r) => s + r.eligible, 0), onboarded: rows.reduce((s, r) => s + r.onboarded, 0), tas: rows.length,
        },
      };
    }
    if (!isIsoDate(asof)) return null;
    return buildTaCreditPeriod(sources, profiles.filter((p) => p.has_profile), period, asof, cfg);
  }, [locked, cur, lines, perfMonth, sources, profiles, period, asof, cfg]);

  // Tier của các kỳ đã chốt trước kỳ đang xem (mới nhất trước) → cảnh báo dưới Base nhiều kỳ liền.
  const history = useMemo(() => periods
    .filter((p) => p.status === 'da_chot' && p.period_key < period)
    .sort((a, b) => b.period_key.localeCompare(a.period_key))
    .map((p) => new Map(lines.filter((l) => l.period_id === p.id).map((l) => [l.payee_key, String(l.detail?.tier ?? '') as TierName | '']))), [periods, lines, period]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await fn() });
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const lock = () => {
    if (!result || !isIsoDate(asof)) { setNotice({ ok: false, text: 'Ngày chốt không hợp lệ.' }); return; }
    const missing = result.rows.filter((r) => r.problem && r.eligible > 0).length;
    if (missing && !window.confirm(`Có ${missing} PIC có OB nhưng chưa có hồ sơ bonus hợp lệ (không được trả). Vẫn chốt?`)) return;
    if (!window.confirm(`Chốt ${periodLabel(period)}: ${result.totals.tas} TA, tổng ${fmtVnd(result.totals.amount)} đ?`)) return;
    void run(async () => {
      const r = await bonusService.lock('ta_credit', period, asof, result.lines);
      return `Đã chốt kỳ: ${r.count} khoản, tổng ${fmtVnd(r.total)} đ.`;
    });
  };
  const reopen = () => {
    const reason = window.prompt('Lý do mở lại kỳ (bắt buộc):', '');
    if (reason == null) return;
    void run(async () => { await bonusService.reopen('ta_credit', period, reason); return 'Đã mở lại kỳ.'; });
  };
  const exportXlsx = () => void run(async () => {
    if (result) await bonusService.exportTaCredit(period, perfMonth, result.rows, result.rows.flatMap((r) => r.obs).concat(result.skipped.filter((o) => o.skip === 'no_pic')));
    return 'Đã tải file Excel.';
  });
  const toggle = (pic: string) => setOpen((o) => { const n = new Set(o); if (n.has(pic)) n.delete(pic); else n.add(pic); return n; });

  const COLS = 13;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1 block">
          <span className="text-slate-500 block">Kỳ lương</span>
          <select className={input} value={period} onChange={(e) => { setPeriod(e.target.value); setAsof(defaultCutoff(e.target.value, today)); }}>
            {periodOptions.map((k) => <option key={k} value={k}>{periodLabel(k)}</option>)}
          </select>
        </label>
        {!locked && (
          <label className="text-xs space-y-1 block">
            <span className="text-slate-500 block">Ngày chốt</span>
            <input type="date" className={input} value={asof} onChange={(e) => setAsof(e.target.value)} />
          </label>
        )}
        <span className="text-xs text-slate-600 pb-1">{`Kết quả tháng ${periodShort(perfMonth)}`}</span>
        <span className={`text-xs px-2 py-1 rounded ${locked ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {locked ? `Đã chốt ngày ${displayDateVn(cur?.asof_date)}` : 'Đang mở'}
        </span>
        <div className="flex-1" />
        <button className={`${btn} border-slate-300`} disabled={loading || busy} onClick={() => void reload()}><RefreshCw className="w-3.5 h-3.5" /> Tải lại</button>
        <button className={`${btn} border-slate-300`} disabled={loading || busy || !result?.rows.length} onClick={exportXlsx}><Download className="w-3.5 h-3.5" /> Xuất Excel</button>
        {isAdmin && !locked && (
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={loading || busy || !result?.lines.length} onClick={lock}><Lock className="w-3.5 h-3.5" /> Chốt kỳ</button>
        )}
        {isAdmin && locked && <button className={`${btn} border-slate-300`} disabled={busy} onClick={reopen}><LockOpen className="w-3.5 h-3.5" /> Mở lại</button>}
      </div>

      {notice && <div className={`text-xs px-3 py-2 rounded ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>}
      {!result && <div className="text-xs px-3 py-2 rounded bg-red-50 text-red-700">Ngày chốt không hợp lệ.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="TA được tính" value={String(result?.totals.tas ?? 0)} />
        <Stat label="OB eligible" value={`${result?.totals.eligible ?? 0} / ${result?.totals.onboarded ?? 0}`} />
        <Stat label="Tổng credit" value={String(result?.totals.credits ?? 0)} />
        <Stat label="Tổng TA Credit" value={fmtVnd(result?.totals.amount ?? 0)} />
      </div>

      {!locked && (
        <div className="flex items-center gap-2">
          <button className={`${btn} ${show === 'tas' ? 'border-[#0B5FFF] text-[#0B5FFF]' : 'border-slate-300'}`} onClick={() => setShow('tas')}>{`Theo TA (${result?.rows.length ?? 0})`}</button>
          <button className={`${btn} ${show === 'skipped' ? 'border-[#0B5FFF] text-[#0B5FFF]' : 'border-slate-300'}`} onClick={() => setShow('skipped')}>{`OB không được tính (${result?.skipped.length ?? 0})`}</button>
        </div>
      )}

      {(locked || show === 'tas') && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {['', 'PIC', 'TA', 'Region', 'Level', 'Onboarding', 'Eligible', 'Credit', 'Khung', 'Target', 'Outperf.', 'Bonus', 'Lưu ý']
                  .map((h, i) => <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={COLS} className="px-3 py-6 text-center text-slate-500">Đang tải…</td></tr>}
              {!loading && !result?.rows.length && <tr><td colSpan={COLS} className="px-3 py-6 text-center text-slate-500">Không có dữ liệu.</td></tr>}
              {!loading && result?.rows.map((r) => {
                const streak = belowBaseStreak(r.pic, r.tier, history);
                const notes = [r.problem ? TA_ROW_PROBLEM_LABELS[r.problem] : '', streak >= 3 ? `Dưới Base ${streak} kỳ liền – review performance` : ''].filter(Boolean);
                return (
                  <Fragment key={r.pic}>
                    <tr className={`border-t border-slate-100 ${r.problem ? 'text-slate-400' : ''}`}>
                      <td className="px-2 py-1.5">
                        {!locked && <button className="p-0.5 text-slate-500" onClick={() => toggle(r.pic)} aria-label="OB">{open.has(r.pic) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</button>}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap font-mono">{r.pic}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.profile?.name ?? ''}</td>
                      <td className="px-3 py-1.5">{r.profile?.region ?? ''}</td>
                      <td className="px-3 py-1.5">{r.profile?.level ?? ''}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.onboarded}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.eligible}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.credits}</td>
                      <td className="px-3 py-1.5">{r.tier && <span className={`px-1.5 rounded ${TIER_STYLE[r.tier]}`}>{r.tier}</span>}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.tiers[1] ? fmtVnd(r.tiers[1].amount) : ''}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.tiers[2] ? fmtVnd(r.tiers[2].amount + (r.tiers[3]?.amount ?? 0)) : ''}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtVnd(r.amount)}</td>
                      <td className="px-3 py-1.5 text-amber-700">{notes.join('; ')}</td>
                    </tr>
                    {open.has(r.pic) && <ObDetail row={r} colSpan={COLS} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!locked && show === 'skipped' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>{['Mã UV', 'Họ tên', 'PIC', 'Rank', 'Site', 'OBD', 'Ngày nghỉ', 'Số ngày', 'Lý do'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {!result?.skipped.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Không có OB bị loại.</td></tr>}
              {result?.skipped.map((o) => (
                <tr key={o.record_id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{o.candidate_code}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{o.full_name}</td>
                  <td className="px-3 py-1.5 font-mono">{o.pic || '—'}</td>
                  <td className="px-3 py-1.5">{o.rank}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{o.site}</td>
                  <td className="px-3 py-1.5 tabular-nums">{displayDateVn(o.ob_date)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{displayDateVn(o.attrition_date)}</td>
                  <td className="px-3 py-1.5 tabular-nums">{o.days}</td>
                  <td className="px-3 py-1.5 text-amber-700">{o.skip ? OB_SKIP_LABELS[o.skip] : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        OB Joined trong tháng tính, làm đủ số ngày tối thiểu (ngày lịch, tính tới ngày nghỉ hoặc ngày chốt). Credit theo site / rank / vùng của OB; bonus lũy tiến theo Level + Region của TA. Hồ sơ bonus TA và mức tiền đổi ở tab Cấu hình.
      </p>
    </div>
  );
};

// ---------------- Cấu hình: hồ sơ bonus TA ----------------
const ProfileRow: React.FC<{ p: TaProfileRow; onSaved: () => void }> = ({ p, onSaved }) => {
  const [f, setF] = useState(p);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dirty = JSON.stringify(f) !== JSON.stringify(p);
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await bonusService.saveTaProfile({
        pic: f.pic, emp_id: f.emp_id, region: f.region, level: f.level, title: f.title, is_freelancer: f.is_freelancer, onsite: f.onsite, active: f.active, note: f.note,
      });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr className={`border-t border-slate-100 ${p.pic_active ? '' : 'text-slate-400'}`}>
      <td className="px-2 py-1 font-mono whitespace-nowrap">{p.pic}</td>
      <td className="px-2 py-1 whitespace-nowrap">{p.name}</td>
      <td className="px-2 py-1"><input className={`${input} w-24`} value={f.emp_id} onChange={(e) => setF({ ...f, emp_id: e.target.value })} /></td>
      <td className="px-2 py-1">
        <select className={input} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value as TaProfileRow['region'] })}>
          <option value="">—</option>{TA_REGIONS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <select className={input} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as TaProfileRow['level'] })}>
          <option value="">—</option>{TA_LEVELS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </td>
      <td className="px-2 py-1"><input className={`${input} w-56`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></td>
      <td className="px-2 py-1 text-center"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /></td>
      <td className="px-2 py-1 text-center"><input type="checkbox" checked={f.onsite} onChange={(e) => setF({ ...f, onsite: e.target.checked })} /></td>
      <td className="px-2 py-1 text-center"><input type="checkbox" checked={f.is_freelancer} onChange={(e) => setF({ ...f, is_freelancer: e.target.checked })} /></td>
      <td className="px-2 py-1 whitespace-nowrap">
        <button className={`${btn} border-slate-300`} disabled={busy || (!dirty && p.has_profile)} onClick={save}><Save className="w-3.5 h-3.5" /> Lưu</button>
        {err && <span className="ml-2 text-red-600">{err}</span>}
      </td>
    </tr>
  );
};

export const TaProfileSettings: React.FC = () => {
  const [rows, setRows] = useState<TaProfileRow[]>([]);
  const [err, setErr] = useState('');
  const [all, setAll] = useState(false);
  const load = useCallback(() => {
    bonusService.taProfiles().then(setRows).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(load, [load]);
  const list = rows.filter((r) => all || r.pic_active || r.has_profile);
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Hồ sơ bonus TA (TA Credit)</div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Hiện cả PIC ngừng dùng</span></label>
      </div>
      <div className="text-[11px] text-slate-500">Chỉ TA có hồ sơ đang bật, có Region + Level mới được tính TA Credit. Onsite = có phụ cấp onsite (tab Onsite).</div>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="text-slate-500">
            <tr>{['PIC', 'Tên', 'Emp ID', 'Region', 'Level', 'Title/Scope', 'Bật', 'Onsite', 'Freelancer', ''].map((h, i) => <th key={i} className="px-2 py-1 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {list.map((p) => <ProfileRow key={`${p.pic}:${p.has_profile}:${p.level}:${p.region}:${p.active}`} p={p} onSaved={load} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------- Cấu hình: mức TA Credit ----------------
export const TaCreditSettings: React.FC = () => {
  const [cfg, setCfg] = useState<TaCreditConfig>(TA_CREDIT_DEFAULT_CONFIG);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fill = (c: TaCreditConfig) => { setCfg(c); setText(JSON.stringify(c, null, 2)); };
  useEffect(() => { bonusService.taCreditConfig().then(fill).catch((e: Error) => setNotice({ ok: false, text: e.message })); }, []);

  const save = async () => {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { setNotice({ ok: false, text: 'Cấu hình không phải JSON hợp lệ.' }); return; }
    const next = cleanTaCreditConfig(raw);
    if (JSON.stringify(next) !== JSON.stringify(raw)) {
      fill(next);
      setNotice({ ok: false, text: 'Có giá trị không hợp lệ, đã thay bằng mặc định. Kiểm tra lại rồi bấm Lưu.' });
      return;
    }
    setBusy(true);
    try {
      await bonusService.saveSettings('ta_credit', { ...next });
      fill(next);
      setNotice({ ok: true, text: 'Đã lưu mức tiền. Kỳ đã chốt giữ mức cũ.' });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2 max-w-3xl">
      <div className="text-sm font-semibold">Mức TA Credit</div>
      <div className="text-[11px] text-slate-600">
        {`Hiện tại: tối thiểu ${cfg.minDays} ngày · đơn giá ${cfg.rates.map((r) => fmtVnd(r)).join(' / ')} đ · Intern Base ${fmtVnd(cfg.internBaseRate)} đ`}
      </div>
      <div className="text-[11px] text-slate-500">
        minDays: số ngày làm tối thiểu; creditSites: credit theo site; rankCredits: credit theo rank (3BO = Rank 3 Back Office); tiers: cận trên Base / Target / Outperformance theo Region + Level; rates: đơn giá 4 khung; internBaseRate: đơn giá phần Base của Intern (0 = không trả).
      </div>
      <textarea className="w-full h-72 font-mono text-[11px] border border-slate-300 rounded p-2" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {notice && <div className={`text-xs ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</div>}
      <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy} onClick={save}><Save className="w-3.5 h-3.5" /> Lưu</button>
    </div>
  );
};

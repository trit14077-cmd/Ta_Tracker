// Task #10 (3) – TA Onsite Allowance theo kỳ lương (ngày onsite của chính tháng N trả ở kỳ N). Thay sheet "Onsite Allowance"
// của file TA_Credit_Bonus_<Mon><YY>.xlsx. Kỳ đang mở: bảng ngày × TA admin tick rồi Lưu; kỳ đã chốt: ảnh chụp đã lưu.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Lock, LockOpen, RefreshCw, Save } from 'lucide-react';
import { bonusService, type BonusLine, type BonusPeriod, type TaProfileRow } from '../services/bonusService.ts';
import { vnTodayIso } from '../../../shared/cnbRules.ts';
import { cleanAmount, displayDateVn, fmtVnd, isIsoDate, periodLabel, periodMonthRange, periodOfDate, recentPeriodKeys, shiftPeriod } from '../../../shared/bonus/period.ts';
import {
  ONSITE_DEFAULT_CONFIG,
  ONSITE_PROBLEM_LABELS,
  buildOnsitePeriod,
  cleanOnsiteConfig,
  isWeekend,
  monthDays,
  onsiteRowsFromLines,
  weekdayShort,
  type OnsiteConfig,
  type OnsiteDay,
  type OnsiteResult,
} from '../../../shared/bonus/onsite.ts';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const input = 'border border-slate-300 rounded px-2 py-1 text-xs';

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div>
);

function defaultCutoff(period: string, today: string): string {
  return periodOfDate(today) === period ? today : periodMonthRange(period).to;
}

export const BonusOnsitePanel: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const today = vnTodayIso();
  const thisPeriod = periodOfDate(today);
  const periodOptions = useMemo(() => [shiftPeriod(thisPeriod, 1), ...recentPeriodKeys(12, thisPeriod)], [thisPeriod]);
  const [period, setPeriod] = useState(thisPeriod);
  const [asof, setAsof] = useState(today);
  const [periods, setPeriods] = useState<BonusPeriod[]>([]);
  const [lines, setLines] = useState<BonusLine[]>([]);
  const [profiles, setProfiles] = useState<TaProfileRow[]>([]);
  const [cfg, setCfg] = useState<OnsiteConfig>(ONSITE_DEFAULT_CONFIG);
  const [saved, setSaved] = useState<OnsiteDay[]>([]);
  /** Ngày đã sửa nhưng chưa lưu, theo PIC (thay toàn bộ ngày của PIC trong tháng). */
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = Object.keys(draft).length;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, c, pr, ds] = await Promise.all([
        bonusService.periods('onsite'), bonusService.onsiteConfig(), bonusService.taProfiles(), bonusService.onsiteDays(period),
      ]);
      setPeriods(ps);
      setCfg(c);
      setProfiles(pr);
      setSaved(ds);
      setDraft({});
      setLines(await bonusService.lines(ps.filter((p) => p.status === 'da_chot' && p.period_key === period).map((p) => p.id)));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void reload(); }, [reload]);

  const cur = periods.find((p) => p.period_key === period) ?? null;
  const locked = cur?.status === 'da_chot';
  const days = useMemo(() => monthDays(period), [period]);

  const effective = useMemo((): OnsiteDay[] => [
    ...saved.filter((d) => !(d.pic in draft)),
    ...Object.entries(draft).flatMap(([pic, ds]) => ds.map((day) => ({ pic, day }))),
  ], [saved, draft]);

  const result = useMemo((): OnsiteResult => {
    if (locked && cur) {
      const ls = lines.filter((l) => l.period_id === cur.id);
      const rows = onsiteRowsFromLines(ls);
      return { rows, lines: ls, totals: { amount: ls.reduce((s, l) => s + l.amount, 0), days: rows.reduce((s, r) => s + r.count, 0), tas: rows.length } };
    }
    return buildOnsitePeriod(effective, profiles.filter((p) => p.has_profile), period, cfg);
  }, [locked, cur, lines, effective, profiles, period, cfg]);

  const rate = locked ? Number((cur?.config as Record<string, unknown> | null)?.ratePerDay ?? cfg.ratePerDay) : cfg.ratePerDay;
  const sets = useMemo(() => result.rows.map((r) => new Set(r.days)), [result]);
  const editable = isAdmin && !locked && !busy && !loading;

  const toggle = (pic: string, day: string) => {
    const row = result.rows.find((r) => r.pic === pic);
    const curDays = row?.days ?? [];
    const next = curDays.includes(day) ? curDays.filter((d) => d !== day) : [...curDays, day].sort();
    const orig = saved.filter((d) => d.pic === pic).map((d) => d.day).sort();
    setDraft((o) => {
      const n = { ...o };
      if (next.join() === orig.join()) delete n[pic];
      else n[pic] = next;
      return n;
    });
  };

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
  const save = () => void run(async () => {
    for (const [pic, ds] of Object.entries(draft)) await bonusService.saveOnsiteDays(pic, period, ds);
    return `Đã lưu ngày onsite của ${dirty} TA.`;
  });
  const lock = () => {
    if (dirty) { setNotice({ ok: false, text: 'Còn thay đổi chưa lưu. Bấm Lưu trước khi chốt.' }); return; }
    if (!isIsoDate(asof)) { setNotice({ ok: false, text: 'Ngày chốt không hợp lệ.' }); return; }
    const missing = result.rows.filter((r) => r.problem).length;
    if (missing && !window.confirm(`Có ${missing} PIC có ngày onsite nhưng chưa có hồ sơ bonus hợp lệ (không được trả). Vẫn chốt?`)) return;
    if (!window.confirm(`Chốt ${periodLabel(period)}: ${result.totals.tas} TA, ${result.totals.days} ngày, tổng ${fmtVnd(result.totals.amount)} đ?`)) return;
    void run(async () => {
      const r = await bonusService.lock('onsite', period, asof, result.lines);
      return `Đã chốt kỳ: ${r.count} khoản, tổng ${fmtVnd(r.total)} đ.`;
    });
  };
  const reopen = () => {
    const reason = window.prompt('Lý do mở lại kỳ (bắt buộc):', '');
    if (reason == null) return;
    void run(async () => { await bonusService.reopen('onsite', period, reason); return 'Đã mở lại kỳ.'; });
  };
  const exportXlsx = () => void run(async () => {
    await bonusService.exportOnsite(period, result.rows, rate);
    return 'Đã tải file Excel.';
  });
  const changePeriod = (p: string) => {
    if (dirty && !window.confirm('Còn thay đổi chưa lưu. Bỏ các thay đổi này?')) return;
    setPeriod(p);
    setAsof(defaultCutoff(p, today));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1 block">
          <span className="text-slate-500 block">Kỳ lương</span>
          <select className={input} value={period} onChange={(e) => changePeriod(e.target.value)}>
            {periodOptions.map((k) => <option key={k} value={k}>{periodLabel(k)}</option>)}
          </select>
        </label>
        {!locked && (
          <label className="text-xs space-y-1 block">
            <span className="text-slate-500 block">Ngày chốt</span>
            <input type="date" className={input} value={asof} onChange={(e) => setAsof(e.target.value)} />
          </label>
        )}
        <span className={`text-xs px-2 py-1 rounded ${locked ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {locked ? `Đã chốt ngày ${displayDateVn(cur?.asof_date)}` : 'Đang mở'}
        </span>
        <div className="flex-1" />
        <button className={`${btn} border-slate-300`} disabled={loading || busy} onClick={() => { if (!dirty || window.confirm('Còn thay đổi chưa lưu. Bỏ các thay đổi này?')) void reload(); }}>
          <RefreshCw className="w-3.5 h-3.5" /> Tải lại
        </button>
        <button className={`${btn} border-slate-300`} disabled={loading || busy || !result.lines.length} onClick={exportXlsx}><Download className="w-3.5 h-3.5" /> Xuất Excel</button>
        {isAdmin && !locked && (
          <button className={`${btn} border-slate-300`} disabled={!dirty || busy} onClick={save}><Save className="w-3.5 h-3.5" /> {dirty ? `Lưu (${dirty} TA)` : 'Lưu'}</button>
        )}
        {isAdmin && !locked && (
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={loading || busy || !!dirty || !result.lines.length} onClick={lock}><Lock className="w-3.5 h-3.5" /> Chốt kỳ</button>
        )}
        {isAdmin && locked && <button className={`${btn} border-slate-300`} disabled={busy} onClick={reopen}><LockOpen className="w-3.5 h-3.5" /> Mở lại</button>}
      </div>

      {notice && <div className={`text-xs px-3 py-2 rounded ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="TA được trả" value={String(result.totals.tas)} />
        <Stat label="Tổng ngày onsite" value={String(result.totals.days)} />
        <Stat label="Đơn giá / ngày" value={fmtVnd(rate)} />
        <Stat label="Tổng Onsite" value={fmtVnd(result.totals.amount)} />
      </div>

      <div className="text-[11px] text-slate-500">
        Tick ngày TA đi onsite trong tháng của kỳ lương rồi bấm Lưu. Cột = TA có hồ sơ bonus bật cờ Onsite (tab Cấu hình). Kỳ đã chốt thì không sửa được ngày.
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-auto max-h-[70vh]">
        {loading && <div className="px-3 py-6 text-center text-xs text-slate-500">Đang tải…</div>}
        {!loading && !result.rows.length && (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            {locked ? 'Kỳ đã chốt không có khoản Onsite.' : 'Chưa có TA nào bật Onsite. Bật cờ Onsite trong hồ sơ bonus TA ở tab Cấu hình.'}
          </div>
        )}
        {!loading && result.rows.length > 0 && (
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Ngày</th>
                <th className="px-2 py-2 text-left font-medium">Thứ</th>
                {result.rows.map((r) => (
                  <th key={r.pic} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                    <div>{r.profile?.name || r.pic}</div>
                    <div className="text-[10px] text-slate-400 font-normal">{r.pic}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d} className={`border-t border-slate-100 ${isWeekend(d) ? 'bg-slate-50 text-slate-400' : ''}`}>
                  <td className="px-3 py-1 tabular-nums">{displayDateVn(d)}</td>
                  <td className="px-2 py-1">{weekdayShort(d)}</td>
                  {result.rows.map((r, i) => (
                    <td key={r.pic} className={`px-2 py-1 text-center ${r.pic in draft ? 'bg-amber-50' : ''}`}>
                      <input type="checkbox" aria-label={`${r.pic} ${d}`} checked={sets[i].has(d)} disabled={!editable} onChange={() => toggle(r.pic, d)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-medium sticky bottom-0">
              <tr className="border-t border-slate-200">
                <td className="px-3 py-1.5" colSpan={2}>Số ngày</td>
                {result.rows.map((r) => <td key={r.pic} className="px-2 py-1.5 text-center tabular-nums">{r.count}</td>)}
              </tr>
              <tr>
                <td className="px-3 py-1.5" colSpan={2}>Tiền</td>
                {result.rows.map((r) => (
                  <td key={r.pic} className="px-2 py-1.5 text-center tabular-nums">
                    {r.problem ? <span className="text-amber-700 font-normal">{ONSITE_PROBLEM_LABELS[r.problem]}</span> : fmtVnd(r.amount)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
};

export const OnsiteSettings: React.FC = () => {
  const [cfg, setCfg] = useState<OnsiteConfig>(ONSITE_DEFAULT_CONFIG);
  const [rate, setRate] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fill = (c: OnsiteConfig) => { setCfg(c); setRate(String(c.ratePerDay)); };
  useEffect(() => { bonusService.onsiteConfig().then(fill).catch((e: Error) => setNotice({ ok: false, text: e.message })); }, []);

  const save = async () => {
    const r = cleanAmount(rate);
    if (r == null) { setNotice({ ok: false, text: 'Mức tiền phải là số nguyên không âm.' }); return; }
    const next = cleanOnsiteConfig({ ratePerDay: r });
    setBusy(true);
    try {
      await bonusService.saveSettings('onsite', { ...next });
      fill(next);
      setNotice({ ok: true, text: 'Đã lưu mức tiền. Kỳ đã chốt giữ mức cũ.' });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 max-w-xl">
      <div className="text-sm font-semibold">Phụ cấp Onsite</div>
      <label className="flex items-center gap-2 text-xs"><span className="w-56">Đơn giá một ngày onsite (đ)</span>
        <input className={input} value={rate} onChange={(e) => setRate(e.target.value)} /></label>
      {notice && <div className={`text-xs ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</div>}
      <div className="flex items-center gap-2">
        <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy} onClick={save}><Save className="w-3.5 h-3.5" /> Lưu</button>
        <span className="text-[11px] text-slate-500">{`Hiện tại: ${fmtVnd(cfg.ratePerDay)} đ / ngày`}</span>
      </div>
    </div>
  );
};

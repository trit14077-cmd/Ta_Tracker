// Task #10 – Tổng hợp chi trả theo người nhận: (2) TA Credit + (3) Onsite + (4) Freelancer = (1) Total.
// Thay sheet "Summary <Mon>'<YY>" của TA_Credit_Bonus_<Mon><YY>.xlsx. Chỉ lấy khoản đã chốt. Quy tắc: shared/bonus/summary.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { bonusService, type BonusLine, type BonusPeriod } from '../services/bonusService.ts';
import { vnTodayIso } from '../../../shared/cnbRules.ts';
import { displayDateVn, fmtVnd, periodLabel, periodOfDate, periodShort, recentPeriodKeys, shiftPeriod } from '../../../shared/bonus/period.ts';
import { SUMMARY_KINDS, buildPayoutSummary, payoutMom, type SummaryKind } from '../../../shared/bonus/summary.ts';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const input = 'border border-slate-300 rounded px-2 py-1 text-xs';

const KIND_LABEL: Record<SummaryKind, string> = { ta_credit: '(2) TA Credit', onsite: '(3) Onsite', freelancer: '(4) Freelancer' };

const Stat: React.FC<{ label: string; value: string; sub?: string; warn?: boolean }> = ({ label, value, sub, warn }) => (
  <div className={`bg-white border rounded-lg px-3 py-2 ${warn ? 'border-amber-300' : 'border-slate-200'}`}>
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="text-sm font-semibold tabular-nums">{value}</div>
    {sub && <div className={`text-[11px] ${warn ? 'text-amber-700' : 'text-slate-500'}`}>{sub}</div>}
  </div>
);

export const BonusSummaryPanel: React.FC = () => {
  const today = vnTodayIso();
  const thisPeriod = periodOfDate(today);
  const periodOptions = useMemo(() => [shiftPeriod(thisPeriod, 1), ...recentPeriodKeys(12, thisPeriod)], [thisPeriod]);
  const [period, setPeriod] = useState(thisPeriod);
  const [periods, setPeriods] = useState<BonusPeriod[]>([]);
  const [lines, setLines] = useState<BonusLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await bonusService.payoutData();
      setPeriods(d.periods);
      setLines(d.lines);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const locked = useMemo(() => periods.filter((p) => p.status === 'da_chot'), [periods]);
  const status = useMemo(() => Object.fromEntries(SUMMARY_KINDS.map((k) => [k, locked.find((p) => p.kind === k && p.period_key === period) ?? null])) as Record<SummaryKind, BonusPeriod | null>, [locked, period]);
  const summary = useMemo(() => buildPayoutSummary(Object.fromEntries(SUMMARY_KINDS.map((k) => {
    const p = status[k];
    return [k, p ? lines.filter((l) => l.period_id === p.id) : []];
  }))), [status, lines]);
  const mom = useMemo(() => payoutMom(locked.filter((p) => (SUMMARY_KINDS as readonly string[]).includes(p.kind) && p.period_key <= period)
    .map((p) => ({ kind: p.kind as SummaryKind, period: p.period_key, lines: lines.filter((l) => l.period_id === p.id) }))), [locked, lines, period]);
  const missing = SUMMARY_KINDS.filter((k) => !status[k]);

  const exportXlsx = async () => {
    if (missing.length && !window.confirm(`Chưa chốt: ${missing.map((k) => KIND_LABEL[k]).join(', ')}. Các phần này sẽ là 0 trong file. Vẫn xuất?`)) return;
    try {
      await bonusService.exportPayoutSummary(period, summary.rows, summary.totals, mom);
      setNotice({ ok: true, text: 'Đã tải file Excel.' });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  };

  const z = (n: number) => (n ? fmtVnd(n) : '');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1 block">
          <span className="text-slate-500 block">Kỳ lương</span>
          <select className={input} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periodOptions.map((k) => <option key={k} value={k}>{periodLabel(k)}</option>)}
          </select>
        </label>
        <div className="flex-1" />
        <button className={`${btn} border-slate-300`} disabled={loading} onClick={() => void reload()}><RefreshCw className="w-3.5 h-3.5" /> Tải lại</button>
        <button className={`${btn} border-slate-300`} disabled={loading || !summary.rows.length} onClick={() => void exportXlsx()}><Download className="w-3.5 h-3.5" /> Xuất Excel</button>
      </div>

      {notice && <div className={`text-xs px-3 py-2 rounded ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>}
      {!loading && missing.length > 0 && (
        <div className="text-xs px-3 py-2 rounded bg-amber-50 text-amber-800">
          {`Chưa chốt: ${missing.map((k) => KIND_LABEL[k]).join(', ')}. Bảng chỉ cộng các phần đã chốt – chốt kỳ ở từng tab trước khi gửi duyệt.`}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {SUMMARY_KINDS.map((k) => (
          <Stat key={k} label={KIND_LABEL[k]} warn={!status[k]}
            value={fmtVnd(k === 'ta_credit' ? summary.totals.credit : k === 'onsite' ? summary.totals.onsite : summary.totals.freelancer)}
            sub={status[k] ? `Đã chốt ngày ${displayDateVn(status[k]!.asof_date)}` : 'Chưa chốt'} />
        ))}
        <Stat label={`(1) Total Payout - ${periodShort(period)}`} value={fmtVnd(summary.totals.total)}
          sub={summary.totals.pit ? `Freelancer PIT ${fmtVnd(summary.totals.pit)} · net ${fmtVnd(summary.totals.total - summary.totals.pit)}` : undefined} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>{['No', 'Người nhận', 'Region', 'Title/Scope', 'Employee ID', '(2) TA Credit', '(3) Onsite', '(4) Freelancer', '(1) Total'].map((h, i) => (
              <th key={i} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 5 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Đang tải…</td></tr>}
            {!loading && !summary.rows.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">Chưa có khoản nào được chốt trong kỳ này.</td></tr>}
            {!loading && summary.rows.map((r, i) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="px-3 py-1.5 tabular-nums">{i + 1}</td>
                <td className="px-3 py-1.5">{r.name}<span className="text-[10px] text-slate-400 ml-1">{r.type === 'ta' ? r.key.slice(3) : 'CTV'}</span></td>
                <td className="px-3 py-1.5">{r.region}</td>
                <td className="px-3 py-1.5">{r.title}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.emp_id}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.type === 'ta' ? fmtVnd(r.credit) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{z(r.onsite)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{z(r.freelancer)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtVnd(r.total)}</td>
              </tr>
            ))}
          </tbody>
          {!loading && summary.rows.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold">
              <tr className="border-t border-slate-200">
                <td className="px-3 py-1.5" colSpan={5}>Total</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(summary.totals.credit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(summary.totals.onsite)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(summary.totals.freelancer)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(summary.totals.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {mom.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-auto max-w-3xl">
          <div className="px-3 py-2 text-xs font-semibold bg-slate-50">MoM – các kỳ đã chốt</div>
          <table className="min-w-full text-xs">
            <thead className="text-slate-600">
              <tr>{['Kỳ lương', 'TA Credit', 'Onsite', 'Freelancer', 'Total'].map((h, i) => <th key={i} className={`px-3 py-1.5 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {mom.map((m) => (
                <tr key={m.period} className={`border-t border-slate-100 ${m.period === period ? 'font-medium' : ''}`}>
                  <td className="px-3 py-1.5">{periodLabel(m.period)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(m.credit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(m.onsite)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(m.freelancer)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

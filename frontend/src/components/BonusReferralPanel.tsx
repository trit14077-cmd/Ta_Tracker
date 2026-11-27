// Task #8 – Referral bonus theo kỳ lương. Thay file "Referral Payment_<Mon>'<YYYY>.xlsx".
// Kỳ đang mở: tính từ hồ sơ + thông tin người giới thiệu (shared/bonus/referral.ts). Kỳ đã chốt: hiện ảnh chụp đã lưu.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Lock, LockOpen, Pencil, RefreshCw, X } from 'lucide-react';
import { bonusService, type BonusLine, type BonusPeriod } from '../services/bonusService.ts';
import { vnTodayIso } from '../../../shared/cnbRules.ts';
import { displayDateVn, fmtVnd, isIsoDate, periodLabel, periodMonthRange, periodOfDate, recentPeriodKeys, shiftPeriod, sumLines } from '../../../shared/bonus/period.ts';
import {
  REFERRAL_DEFAULT_RATES,
  REFERRAL_WARNING_LABELS,
  buildReferralPeriod,
  referralRowsFromLines,
  suggestEligible,
  type ReferralRates,
  type ReferralRow,
  type ReferralSource,
  type YesNo,
} from '../../../shared/bonus/referral.ts';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const input = 'w-full border border-slate-300 rounded px-2 py-1 text-xs';

const EligibleChip: React.FC<{ v: YesNo }> = ({ v }) => (
  <span className={`px-1.5 rounded text-[11px] ${v === 'Yes' ? 'bg-emerald-50 text-emerald-700' : v === 'No' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
    {v || 'Chưa chọn'}
  </span>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1"><span className="text-[11px] text-slate-500">{label}</span>{children}</label>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div>
);

type EditState = Pick<ReferralSource, 'referrer_name' | 'referrer_emp_id' | 'referrer_rank' | 'referrer_dc' | 'referrer_status' | 'referrer_last_day'
  | 'disciplinary' | 'candidate_eligible' | 'referrer_eligible' | 'note'>;

const EditModal: React.FC<{ row: ReferralRow; onClose: () => void; onSaved: () => void }> = ({ row, onClose, onSaved }) => {
  const [f, setF] = useState<EditState>({
    referrer_name: row.referrer_name, referrer_emp_id: row.referrer_emp_id, referrer_rank: row.referrer_rank, referrer_dc: row.referrer_dc,
    referrer_status: row.referrer_status, referrer_last_day: row.referrer_last_day, disciplinary: row.disciplinary,
    candidate_eligible: row.candidate_eligible, referrer_eligible: row.referrer_eligible, note: row.note,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const candLocked = row.candidate_state === 'paid_before';
  const refLocked = row.referrer_state === 'paid_before';
  const set = <K extends keyof EditState>(k: K, v: EditState[K]) => setF((o) => ({ ...o, [k]: v }));
  const hint = suggestEligible({ ...row, ...f });

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await bonusService.saveReferral(row.record_id, { ...f, referrer_last_day: f.referrer_last_day || null });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold">Thông tin Referral</div>
            <div className="text-xs text-slate-500">{row.candidate_code} · {row.full_name} · {row.dc}</div>
          </div>
          <button className="p-1 text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Đóng"><X className="w-4 h-4" /></button>
        </div>
        <fieldset disabled={refLocked} className="grid grid-cols-2 gap-2">
          <Field label="Người giới thiệu"><input className={input} value={f.referrer_name} onChange={(e) => set('referrer_name', e.target.value)} /></Field>
          <Field label="Mã nhân viên người giới thiệu"><input className={input} value={f.referrer_emp_id} onChange={(e) => set('referrer_emp_id', e.target.value)} /></Field>
          <Field label="Rank người giới thiệu"><input className={input} value={f.referrer_rank} onChange={(e) => set('referrer_rank', e.target.value)} /></Field>
          <Field label="DC người giới thiệu"><input className={input} value={f.referrer_dc} onChange={(e) => set('referrer_dc', e.target.value)} /></Field>
          <Field label="Tình trạng người giới thiệu">
            <select className={input} value={f.referrer_status} onChange={(e) => set('referrer_status', e.target.value)}>
              <option value="">—</option><option value="Active">Active</option><option value="Resigned">Resigned</option>
            </select>
          </Field>
          <Field label="Ngày làm việc cuối (người giới thiệu)">
            <input type="date" className={input} value={f.referrer_last_day ?? ''} onChange={(e) => set('referrer_last_day', e.target.value || null)} />
          </Field>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Eligible – ứng viên">
            <select className={input} disabled={candLocked} value={f.candidate_eligible} onChange={(e) => set('candidate_eligible', e.target.value as YesNo)}>
              <option value="">Chưa chọn</option><option value="Yes">Yes</option><option value="No">No</option>
            </select>
          </Field>
          <Field label="Eligible – người giới thiệu">
            <select className={input} disabled={refLocked} value={f.referrer_eligible} onChange={(e) => set('referrer_eligible', e.target.value as YesNo)}>
              <option value="">Chưa chọn</option><option value="Yes">Yes</option><option value="No">No</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={f.disciplinary} onChange={(e) => set('disciplinary', e.target.checked)} />
          <span>Có vi phạm kỷ luật</span>
        </label>
        <Field label="Ghi chú (Remark)"><input className={input} maxLength={500} value={f.note} onChange={(e) => set('note', e.target.value)} /></Field>
        {(hint.candidate === 'No' || hint.referrer === 'No') && (
          <div className="text-xs text-amber-700 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{hint.candidate === 'No' ? 'Gợi ý: chọn No cho ứng viên.' : 'Gợi ý: chọn No cho người giới thiệu.'}</span>
            <button className="underline" onClick={() => setF((o) => ({
              ...o,
              candidate_eligible: !candLocked && hint.candidate === 'No' ? 'No' : o.candidate_eligible,
              referrer_eligible: !refLocked && hint.referrer === 'No' ? 'No' : o.referrer_eligible,
            }))}>Áp dụng gợi ý</button>
          </div>
        )}
        {(candLocked || refLocked) && <div className="text-xs text-slate-500">Phần đã chốt ở kỳ trước không sửa được.</div>}
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className={`${btn} border-slate-300`} onClick={onClose}>Hủy</button>
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  );
};

export const BonusReferralPanel: React.FC<{ isAdmin: boolean; onOpenCandidate?: (id: number) => void }> = ({ isAdmin, onOpenCandidate }) => {
  const today = vnTodayIso();
  const thisPeriod = periodOfDate(today);
  const periodOptions = useMemo(() => [shiftPeriod(thisPeriod, 1), ...recentPeriodKeys(12, thisPeriod)], [thisPeriod]);
  const [period, setPeriod] = useState(thisPeriod);
  const [asof, setAsof] = useState(today);
  const [periods, setPeriods] = useState<BonusPeriod[]>([]);
  const [lines, setLines] = useState<BonusLine[]>([]);
  const [sources, setSources] = useState<ReferralSource[]>([]);
  const [rates, setRates] = useState<ReferralRates>(REFERRAL_DEFAULT_RATES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [show, setShow] = useState<'period' | 'pending'>('period');
  const [editing, setEditing] = useState<ReferralRow | null>(null);
  const [q, setQ] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, rt, src] = await Promise.all([
        bonusService.periods('referral'),
        bonusService.referralRates(),
        bonusService.referralSources(periodMonthRange(shiftPeriod(period, -12)).from),
      ]);
      const locked = ps.filter((p) => p.status === 'da_chot');
      setPeriods(ps);
      setRates(rt);
      setSources(src);
      setLines(await bonusService.lines(locked.map((p) => p.id)));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void reload(); }, [reload]);

  const cur = periods.find((p) => p.period_key === period) ?? null;
  const locked = cur?.status === 'da_chot';
  const curLines = useMemo(() => (cur && locked ? lines.filter((l) => l.period_id === cur.id) : []), [cur, locked, lines]);

  const result = useMemo(() => {
    if (locked) {
      const rows = referralRowsFromLines(curLines, period);
      const s = sumLines(curLines);
      const cand = curLines.filter((l) => l.part === 'candidate');
      return {
        rows, pending: [] as ReferralRow[], lines: curLines,
        totals: {
          candidate: sumLines(cand).amount, referrer: s.amount - sumLines(cand).amount, total: s.amount,
          hired: cand.length, eligible: cand.filter((l) => l.amount > 0).length,
        },
      };
    }
    return buildReferralPeriod(sources, bonusService.referralPaid(periods, lines), period, rates);
  }, [locked, curLines, sources, periods, lines, period, rates]);

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
    if (!isIsoDate(asof)) { setNotice({ ok: false, text: 'Ngày chốt không hợp lệ.' }); return; }
    if (!window.confirm(`Chốt ${periodLabel(period)}: ${result.rows.length} hồ sơ, tổng ${fmtVnd(result.totals.total)} đ?`)) return;
    void run(async () => {
      const r = await bonusService.lock('referral', period, asof, result.lines);
      return `Đã chốt kỳ: ${r.count} khoản, tổng ${fmtVnd(r.total)} đ.`;
    });
  };
  const reopen = () => {
    const reason = window.prompt('Lý do mở lại kỳ (bắt buộc):', '');
    if (reason == null) return;
    void run(async () => { await bonusService.reopen('referral', period, reason); return 'Đã mở lại kỳ.'; });
  };
  const exportXlsx = () => void run(async () => {
    await bonusService.exportReferral(period, result.rows, result.lines, periods, lines);
    return 'Đã tải file Excel.';
  });

  const needle = q.trim().toLowerCase();
  const list = (show === 'period' ? result.rows : result.pending).filter((r) => !needle
    || [r.candidate_code, r.full_name, r.emp_id, r.dc, r.referrer_name, r.referrer_emp_id].some((t) => String(t ?? '').toLowerCase().includes(needle)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1 block">
          <span className="text-slate-500 block">Kỳ lương</span>
          <select className="border border-slate-300 rounded px-2 py-1 text-xs" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periodOptions.map((k) => <option key={k} value={k}>{periodLabel(k)}</option>)}
          </select>
        </label>
        {!locked && (
          <label className="text-xs space-y-1 block">
            <span className="text-slate-500 block">Ngày chốt</span>
            <input type="date" className="border border-slate-300 rounded px-2 py-1 text-xs" value={asof} onChange={(e) => setAsof(e.target.value)} />
          </label>
        )}
        <span className={`text-xs px-2 py-1 rounded ${locked ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {locked ? `Đã chốt ngày ${displayDateVn(cur?.asof_date)}` : 'Đang mở'}
        </span>
        <div className="flex-1" />
        <button className={`${btn} border-slate-300`} disabled={loading || busy} onClick={() => void reload()}><RefreshCw className="w-3.5 h-3.5" /> Tải lại</button>
        <button className={`${btn} border-slate-300`} disabled={loading || busy || !result.rows.length} onClick={exportXlsx}><Download className="w-3.5 h-3.5" /> Xuất Excel</button>
        {isAdmin && !locked && (
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={loading || busy || !result.lines.length} onClick={lock}><Lock className="w-3.5 h-3.5" /> Chốt kỳ</button>
        )}
        {isAdmin && locked && (
          <button className={`${btn} border-slate-300`} disabled={busy} onClick={reopen}><LockOpen className="w-3.5 h-3.5" /> Mở lại</button>
        )}
      </div>

      {notice && <div className={`text-xs px-3 py-2 rounded ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="Hồ sơ vào kỳ" value={String(result.totals.hired)} />
        <Stat label="Eligible" value={String(result.totals.eligible)} />
        <Stat label="Tiền ứng viên" value={fmtVnd(result.totals.candidate)} />
        <Stat label="Tiền người giới thiệu" value={fmtVnd(result.totals.referrer)} />
        <Stat label="Tổng Referral" value={fmtVnd(result.totals.total)} />
      </div>

      <div className="flex items-center gap-2">
        <button className={`${btn} ${show === 'period' ? 'border-[#0B5FFF] text-[#0B5FFF]' : 'border-slate-300'}`} onClick={() => setShow('period')}>
          {`Vào kỳ (${result.rows.length})`}
        </button>
        {!locked && (
          <button className={`${btn} ${show === 'pending' ? 'border-[#0B5FFF] text-[#0B5FFF]' : 'border-slate-300'}`} onClick={() => setShow('pending')}>
            {`Chờ xác nhận Eligible (${result.pending.length})`}
          </button>
        )}
        <input className="ml-auto border border-slate-300 rounded px-2 py-1 text-xs w-56" placeholder="Tìm mã, tên, Emp ID, DC…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {['Mã UV', 'Họ tên', 'Emp ID', 'DC', 'OBD', 'Tình trạng', 'Người giới thiệu', 'Eligible UV', 'Eligible NGT', 'Tiền UV', 'Tiền NGT', 'Lưu ý', '']
                .map((h, i) => <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-500">Đang tải…</td></tr>}
            {!loading && !list.length && <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-500">Không có hồ sơ.</td></tr>}
            {!loading && list.map((r) => (
              <tr key={r.record_id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {onOpenCandidate ? <button className="text-[#0B5FFF] hover:underline" onClick={() => onOpenCandidate(r.record_id)}>{r.candidate_code}</button> : r.candidate_code}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.full_name}</td>
                <td className="px-3 py-1.5 font-mono">{r.emp_id || '—'}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.dc}</td>
                <td className="px-3 py-1.5 tabular-nums">{displayDateVn(r.ob_date)}</td>
                <td className="px-3 py-1.5">{r.emp_status || 'Active'}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.referrer_name || <span className="text-red-600">Chưa nhập</span>}{r.referrer_emp_id ? ` · ${r.referrer_emp_id}` : ''}</td>
                <td className="px-3 py-1.5"><EligibleChip v={r.candidate_eligible} /></td>
                <td className="px-3 py-1.5"><EligibleChip v={r.referrer_eligible} /></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.candidate_state === 'paid_before' ? <span className="text-slate-400" title={periodLabel(r.candidate_period)}>đã trả</span> : fmtVnd(r.candidate_amount)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.referrer_state === 'paid_before' ? <span className="text-slate-400" title={periodLabel(r.referrer_period)}>đã trả</span> : r.referrer_state === 'pending' ? <span className="text-amber-700">chờ</span> : fmtVnd(r.referrer_amount)}</td>
                <td className="px-3 py-1.5 text-amber-700">{r.warnings.map((w) => REFERRAL_WARNING_LABELS[w]).join('; ')}</td>
                <td className="px-3 py-1.5">
                  {isAdmin && !locked && <button className="p-1 text-slate-500 hover:text-[#0B5FFF]" title="Sửa" onClick={() => setEditing(r)}><Pencil className="w-3.5 h-3.5" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Danh sách: hồ sơ nguồn Referrals đã Joined trong 12 tháng gần đây. Ứng viên Eligible = Yes được thưởng; người giới thiệu chỉ được khi cả hai Eligible = Yes. Mức tiền đổi ở tab Cấu hình.
      </p>
      {editing && <EditModal row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
};

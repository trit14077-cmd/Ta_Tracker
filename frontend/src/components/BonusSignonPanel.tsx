// Task #9 – Sign-on bonus theo kỳ lương. Thay file "Sign-on Bonus Payment _ <Mon>'<YY> Pay Period.xlsx".
// Kỳ đang mở: tính từ hồ sơ + scheme + cờ sửa tay (shared/bonus/signon.ts) theo NGÀY CHỐT. Kỳ đã chốt: ảnh chụp đã lưu.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Lock, LockOpen, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { bonusService, type BonusLine, type BonusPeriod } from '../services/bonusService.ts';
import { vnTodayIso } from '../../../shared/cnbRules.ts';
import {
  addDays, displayDateVn, fmtVnd, isIsoDate, periodLabel, periodMonthRange, periodOfDate, periodShort, recentPeriodKeys, shiftPeriod, sumLines,
} from '../../../shared/bonus/period.ts';
import {
  SIGNON_WARNING_LABELS,
  buildSignonPeriod,
  cleanSignonScheme,
  signonRowsFromLines,
  type SignonFlag,
  type SignonMilestoneRow,
  type SignonPeriodResult,
  type SignonRow,
  type SignonScheme,
  type SignonSource,
} from '../../../shared/bonus/signon.ts';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const input = 'w-full border border-slate-300 rounded px-2 py-1 text-xs';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1"><span className="text-[11px] text-slate-500">{label}</span>{children}</label>
);

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div>
);

const MilestoneCell: React.FC<{ m: SignonMilestoneRow | undefined }> = ({ m }) => {
  if (!m) return <span className="text-slate-300">—</span>;
  const date = <div className="tabular-nums text-slate-500">{displayDateVn(m.date)}</div>;
  if (m.state === 'na') return <span className="text-slate-400">N/A</span>;
  if (m.state === 'future') return <div>{date}<span className="text-slate-400">chưa đến</span></div>;
  if (m.state === 'hold') return <div>{date}<span className="px-1.5 rounded bg-amber-50 text-amber-700">Hold</span></div>;
  if (m.state === 'paid_before') {
    return <div title={periodLabel(m.period)}>{date}<span className="text-slate-400">{`đã trả ${periodShort(m.period)}`}</span></div>;
  }
  const ok = m.flag === 'Passed';
  return (
    <div>
      {date}
      <span className={`px-1.5 rounded ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{`${m.flag}${m.overridden ? '*' : ''}`}</span>
      {ok && <span className="ml-1 tabular-nums">{fmtVnd(m.bonus)}</span>}
    </div>
  );
};

const FLAG_OPTIONS: SignonFlag[] = ['Passed', 'Failed', 'Hold'];

const EditModal: React.FC<{ row: SignonRow; schemes: SignonScheme[]; onClose: () => void; onSaved: () => void }> = ({ row, schemes, onClose, onSaved }) => {
  const [scheme, setScheme] = useState(row.scheme_code);
  const [flags, setFlags] = useState<Record<string, SignonFlag>>({ ...row.flags });
  const [note, setNote] = useState(row.note);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const anyPaid = row.milestones.some((m) => m.state === 'paid_before');

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const all: Record<string, SignonFlag> = {};
      for (const m of row.milestones) if (m.state !== 'paid_before') all[m.part] = flags[m.part] ?? '';
      await bonusService.saveSignon(row.record_id, { ...(anyPaid ? {} : { scheme_code: scheme }), flags: all, note });
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
            <div className="text-sm font-semibold">Thông tin Sign-on</div>
            <div className="text-xs text-slate-500">{`${row.candidate_code} · ${row.full_name} · ${row.dc} · ${displayDateVn(row.ob_date)}`}</div>
          </div>
          <button className="p-1 text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Đóng"><X className="w-4 h-4" /></button>
        </div>
        <Field label="Scheme">
          <select className={input} disabled={anyPaid} value={scheme} onChange={(e) => setScheme(e.target.value)}>
            <option value="">{`Tự gán: ${row.scheme_auto || '—'}`}</option>
            {schemes.map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {row.milestones.map((m, i) => (
            <Field key={m.part} label={`Mốc ${i + 1} (+${m.days} ngày) · ${displayDateVn(m.date)}`}>
              <select className={input} disabled={m.state === 'paid_before' || m.state === 'na'} value={flags[m.part] ?? ''}
                onChange={(e) => setFlags((o) => ({ ...o, [m.part]: e.target.value as SignonFlag }))}>
                <option value="">{`Theo gợi ý: ${m.suggested}`}</option>
                {FLAG_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>
          ))}
        </div>
        <Field label="Ghi chú (Remark)"><input className={input} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="text-[11px] text-slate-500">Gợi ý: nghỉ việc trước ngày mốc → Failed. Hold = chưa xét, để kỳ sau.</div>
        {anyPaid && <div className="text-xs text-slate-500">Mốc đã chốt ở kỳ trước không sửa được; scheme chỉ đổi được khi chưa có mốc nào chốt.</div>}
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className={`${btn} border-slate-300`} onClick={onClose}>Hủy</button>
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </div>
    </div>
  );
};

/** Ngày chốt mặc định: kỳ hiện tại → hôm nay; kỳ khác → ngày cuối tháng của kỳ. */
function defaultCutoff(period: string, today: string): string {
  return periodOfDate(today) === period ? today : periodMonthRange(period).to;
}

type Show = 'period' | 'all' | 'unassigned';

export const BonusSignonPanel: React.FC<{ isAdmin: boolean; onOpenCandidate?: (id: number) => void }> = ({ isAdmin, onOpenCandidate }) => {
  const today = vnTodayIso();
  const thisPeriod = periodOfDate(today);
  const periodOptions = useMemo(() => [shiftPeriod(thisPeriod, 1), ...recentPeriodKeys(12, thisPeriod)], [thisPeriod]);
  const [period, setPeriod] = useState(thisPeriod);
  const [asof, setAsof] = useState(today);
  const [periods, setPeriods] = useState<BonusPeriod[]>([]);
  const [lines, setLines] = useState<BonusLine[]>([]);
  const [sources, setSources] = useState<SignonSource[]>([]);
  const [schemes, setSchemes] = useState<SignonScheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [show, setShow] = useState<Show>('period');
  const [editing, setEditing] = useState<SignonRow | null>(null);
  const [q, setQ] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, sc] = await Promise.all([bonusService.periods('signon'), bonusService.signonSchemes()]);
      const active = sc.filter((s) => s.active);
      const from = active.length ? addDays(active.map((s) => s.effective_from).sort()[0], -31) : today;
      const sites = [...new Set(active.flatMap((s) => s.sites))];
      const locked = ps.filter((p) => p.status === 'da_chot');
      const [src, ls] = await Promise.all([bonusService.signonSources(from, sites), bonusService.lines(locked.map((p) => p.id))]);
      setPeriods(ps);
      setSchemes(sc);
      setSources(src);
      setLines(ls);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { void reload(); }, [reload]);

  const cur = periods.find((p) => p.period_key === period) ?? null;
  const locked = cur?.status === 'da_chot';
  const curLines = useMemo(() => (cur && locked ? lines.filter((l) => l.period_id === cur.id) : []), [cur, locked, lines]);

  const result = useMemo((): SignonPeriodResult | null => {
    if (locked) {
      const rows = signonRowsFromLines(curLines, period);
      const byPart: Record<string, number> = {};
      for (const l of curLines) byPart[l.part] = (byPart[l.part] ?? 0) + l.amount;
      return {
        rows, all: rows, unassigned: [], lines: curLines,
        totals: { total: sumLines(curLines).amount, people: rows.filter((r) => r.period_amount > 0).length, lines: curLines.length, byPart },
      };
    }
    if (!isIsoDate(asof)) return null;
    return buildSignonPeriod(sources, bonusService.signonPaid(periods, lines), period, asof, schemes);
  }, [locked, curLines, sources, periods, lines, period, asof, schemes]);

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
    if (!window.confirm(`Chốt ${periodLabel(period)} (ngày chốt ${displayDateVn(asof)}): ${result.totals.people} người, tổng ${fmtVnd(result.totals.total)} đ?`)) return;
    void run(async () => {
      const r = await bonusService.lock('signon', period, asof, result.lines);
      return `Đã chốt kỳ: ${r.count} khoản, tổng ${fmtVnd(r.total)} đ.`;
    });
  };
  const reopen = () => {
    const reason = window.prompt('Lý do mở lại kỳ (bắt buộc):', '');
    if (reason == null) return;
    void run(async () => { await bonusService.reopen('signon', period, reason); return 'Đã mở lại kỳ.'; });
  };
  const exportXlsx = () => void run(async () => {
    if (result) await bonusService.exportSignon(period, result.rows, result.all, periods, lines);
    return 'Đã tải file Excel.';
  });

  const n = Math.max(4, ...(result?.all ?? []).map((r) => r.milestones.length));
  const needle = q.trim().toLowerCase();
  const base = !result ? [] : show === 'period' ? result.rows : show === 'all' ? result.all : result.unassigned;
  const list = base.filter((r) => !needle
    || [r.candidate_code, r.full_name, r.emp_id, r.dc, r.scheme].some((t) => String(t ?? '').toLowerCase().includes(needle)));
  const tab = (id: Show, label: string) => (
    <button className={`${btn} ${show === id ? 'border-[#0B5FFF] text-[#0B5FFF]' : 'border-slate-300'}`} onClick={() => setShow(id)}>{label}</button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1 block">
          <span className="text-slate-500 block">Kỳ lương</span>
          <select className="border border-slate-300 rounded px-2 py-1 text-xs" value={period}
            onChange={(e) => { setPeriod(e.target.value); setAsof(defaultCutoff(e.target.value, today)); }}>
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
        <button className={`${btn} border-slate-300`} disabled={loading || busy || !result?.rows.length} onClick={exportXlsx}><Download className="w-3.5 h-3.5" /> Xuất Excel</button>
        {isAdmin && !locked && (
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={loading || busy || !result?.lines.length} onClick={lock}><Lock className="w-3.5 h-3.5" /> Chốt kỳ</button>
        )}
        {isAdmin && locked && (
          <button className={`${btn} border-slate-300`} disabled={busy} onClick={reopen}><LockOpen className="w-3.5 h-3.5" /> Mở lại</button>
        )}
      </div>

      {notice && <div className={`text-xs px-3 py-2 rounded ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>}
      {!result && <div className="text-xs px-3 py-2 rounded bg-red-50 text-red-700">Ngày chốt không hợp lệ.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="Người được trả" value={String(result?.totals.people ?? 0)} />
        <Stat label="Mốc vào kỳ" value={String(result?.totals.lines ?? 0)} />
        <Stat label="Theo mốc" value={Object.entries(result?.totals.byPart ?? {}).sort().map(([k, v]) => `${k.toUpperCase()} ${fmtVnd(v)}`).join(' · ') || '—'} />
        <Stat label="Tổng Sign-on" value={fmtVnd(result?.totals.total ?? 0)} />
      </div>

      <div className="flex items-center gap-2">
        {tab('period', `Vào kỳ (${result?.rows.length ?? 0})`)}
        {!locked && tab('all', `Tất cả trong phạm vi (${result?.all.length ?? 0})`)}
        {!locked && tab('unassigned', `Chưa có scheme (${result?.unassigned.length ?? 0})`)}
        <input className="ml-auto border border-slate-300 rounded px-2 py-1 text-xs w-56" placeholder="Tìm mã, tên, Emp ID, DC, scheme…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {['Mã UV', 'Họ tên', 'Emp ID', 'DC', 'Ngày vào', 'Ngày nghỉ', 'Scheme'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}
              {Array.from({ length: n }, (_, i) => <th key={`m${i}`} className="px-3 py-2 text-left font-medium whitespace-nowrap">{`Mốc ${i + 1}`}</th>)}
              {['Tiền kỳ', 'Lưu ý', ''].map((h, i) => <th key={`t${i}`} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={n + 10} className="px-3 py-6 text-center text-slate-500">Đang tải…</td></tr>}
            {!loading && !list.length && <tr><td colSpan={n + 10} className="px-3 py-6 text-center text-slate-500">Không có hồ sơ.</td></tr>}
            {!loading && list.map((r) => (
              <tr key={r.record_id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {onOpenCandidate ? <button className="text-[#0B5FFF] hover:underline" onClick={() => onOpenCandidate(r.record_id)}>{r.candidate_code}</button> : r.candidate_code}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.full_name}</td>
                <td className="px-3 py-1.5 font-mono">{r.emp_id || '—'}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.dc}</td>
                <td className="px-3 py-1.5 tabular-nums">{displayDateVn(r.ob_date)}</td>
                <td className="px-3 py-1.5 tabular-nums">{displayDateVn(r.attrition_date)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{r.scheme || <span className="text-red-600">—</span>}</td>
                {Array.from({ length: n }, (_, i) => <td key={i} className="px-3 py-1.5 whitespace-nowrap"><MilestoneCell m={r.milestones[i]} /></td>)}
                <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtVnd(r.period_amount)}</td>
                <td className="px-3 py-1.5 text-amber-700">{r.warnings.map((w) => SIGNON_WARNING_LABELS[w]).join('; ')}</td>
                <td className="px-3 py-1.5">
                  {isAdmin && !locked && <button className="p-1 text-slate-500 hover:text-[#0B5FFF]" title="Sửa" onClick={() => setEditing(r)}><Pencil className="w-3.5 h-3.5" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Phạm vi: Rank 6 đã Joined tại site có scheme. Mốc = ngày vào + số ngày lịch của scheme; mốc đạt trước hoặc đúng ngày chốt và chưa trả ở kỳ trước thì vào kỳ này. * = cờ admin sửa tay. Scheme đổi ở tab Cấu hình.
      </p>
      {editing && <EditModal row={editing} schemes={schemes} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
};

// ---------------- Cấu hình scheme (tab Cấu hình) ----------------
interface SchemeForm {
  isNew: boolean;
  code: string;
  sites: string;
  effective_from: string;
  effective_to: string;
  milestones: { days: string; amount: string }[];
  active: boolean;
  note: string;
}

const toForm = (s: SignonScheme | null): SchemeForm => (s
  ? {
    isNew: false, code: s.code, sites: s.sites.join(', '), effective_from: s.effective_from, effective_to: s.effective_to ?? '',
    milestones: s.milestones.map((m) => ({ days: String(m.days), amount: m.amount == null ? '' : String(m.amount) })), active: s.active, note: s.note,
  }
  : {
    isNew: true, code: '', sites: '', effective_from: '', effective_to: '',
    milestones: [{ days: '6', amount: '500000' }, { days: '14', amount: '500000' }, { days: '29', amount: '1000000' }, { days: '59', amount: '1000000' }],
    active: true, note: '',
  });

const SchemeEditor: React.FC<{ form: SchemeForm; onCancel: () => void; onSaved: () => void }> = ({ form, onCancel, onSaved }) => {
  const [f, setF] = useState<SchemeForm>(form);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const setM = (i: number, k: 'days' | 'amount', v: string) => setF((o) => ({ ...o, milestones: o.milestones.map((m, j) => (j === i ? { ...m, [k]: v } : m)) }));

  const save = async () => {
    const { scheme, error } = cleanSignonScheme({
      code: f.code, sites: f.sites.split(','), effective_from: f.effective_from, effective_to: f.effective_to || null,
      milestones: f.milestones.map((m) => ({ days: m.days.trim() === '' ? NaN : Number(m.days), amount: m.amount.trim() === '' ? null : Number(m.amount.replace(/[.,\s]/g, '')) })),
      active: f.active, note: f.note,
    });
    if (!scheme) { setErr(error); return; }
    setBusy(true);
    setErr('');
    try {
      await bonusService.saveSignonScheme(scheme);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Mã scheme"><input className={input} disabled={!f.isNew} value={f.code} onChange={(e) => setF((o) => ({ ...o, code: e.target.value }))} /></Field>
        <Field label="Site (cách nhau bằng dấu phẩy)"><input className={input} value={f.sites} onChange={(e) => setF((o) => ({ ...o, sites: e.target.value }))} /></Field>
        <Field label="Hiệu lực từ ngày vào"><input type="date" className={input} value={f.effective_from} onChange={(e) => setF((o) => ({ ...o, effective_from: e.target.value }))} /></Field>
        <Field label="Hết hiệu lực (không bắt buộc)"><input type="date" className={input} value={f.effective_to} onChange={(e) => setF((o) => ({ ...o, effective_to: e.target.value }))} /></Field>
      </div>
      <div className="text-[11px] text-slate-500">Các mốc: số ngày lịch tính từ ngày vào, mức tiền (để trống = Not Applicable).</div>
      {f.milestones.map((m, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-14">{`Mốc ${i + 1}`}</span>
          <input className={`${input} w-20`} value={m.days} onChange={(e) => setM(i, 'days', e.target.value)} />
          <span>ngày</span>
          <input className={`${input} w-32`} value={m.amount} placeholder="N/A" onChange={(e) => setM(i, 'amount', e.target.value)} />
          <span>đ</span>
          <button className="p-1 text-slate-400 hover:text-red-600" title="Xóa" onClick={() => setF((o) => ({ ...o, milestones: o.milestones.filter((_, j) => j !== i) }))}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <button className={`${btn} border-slate-300`} disabled={f.milestones.length >= 6} onClick={() => setF((o) => ({ ...o, milestones: [...o.milestones, { days: '', amount: '' }] }))}>
        <Plus className="w-3.5 h-3.5" /> Thêm mốc
      </button>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={f.active} onChange={(e) => setF((o) => ({ ...o, active: e.target.checked }))} />
        <span>Đang áp dụng</span>
      </label>
      <Field label="Ghi chú"><input className={input} maxLength={500} value={f.note} onChange={(e) => setF((o) => ({ ...o, note: e.target.value }))} /></Field>
      {err && <div className="text-xs text-red-600">{err}</div>}
      <div className="flex justify-end gap-2">
        <button className={`${btn} border-slate-300`} onClick={onCancel}>Hủy</button>
        <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy} onClick={save}><Save className="w-3.5 h-3.5" /> Lưu</button>
      </div>
    </div>
  );
};

export const SignonSchemeSettings: React.FC = () => {
  const [schemes, setSchemes] = useState<SignonScheme[]>([]);
  const [form, setForm] = useState<SchemeForm | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    bonusService.signonSchemes().then(setSchemes).catch((e: Error) => setNotice({ ok: false, text: e.message }));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Scheme Sign-on</div>
        {!form && <button className={`${btn} border-slate-300`} onClick={() => setForm(toForm(null))}><Plus className="w-3.5 h-3.5" /> Thêm scheme</button>}
      </div>
      <table className="min-w-full text-xs">
        <thead className="text-slate-500">
          <tr>{['Mã scheme', 'Site', 'Hiệu lực', 'Các mốc', ''].map((h, i) => <th key={i} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {schemes.map((s) => (
            <tr key={s.code} className={`border-t border-slate-100 ${s.active ? '' : 'text-slate-400'}`}>
              <td className="px-2 py-1.5 whitespace-nowrap">{s.code}</td>
              <td className="px-2 py-1.5">{s.sites.join(', ')}</td>
              <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{`${displayDateVn(s.effective_from)} → ${s.effective_to ? displayDateVn(s.effective_to) : '…'}`}</td>
              <td className="px-2 py-1.5 tabular-nums">{s.milestones.map((m) => `+${m.days}: ${m.amount == null ? 'N/A' : fmtVnd(m.amount)}`).join(' · ')}</td>
              <td className="px-2 py-1.5">
                <button className="p-1 text-slate-500 hover:text-[#0B5FFF]" title="Sửa" onClick={() => setForm(toForm(s))}><Pencil className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {form && (
        <SchemeEditor key={form.code || 'new'} form={form} onCancel={() => setForm(null)}
          onSaved={() => { setForm(null); setNotice({ ok: true, text: 'Đã lưu scheme. Kỳ đã chốt giữ số tiền cũ.' }); load(); }} />
      )}
      {notice && <div className={`text-xs ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</div>}
    </div>
  );
};

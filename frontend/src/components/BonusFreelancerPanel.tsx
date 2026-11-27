// Task #10 (4) – Recruitment Bonus cho Freelancer / CTV theo kỳ lương (theo ngày chốt). Thay sheet "Freelancer Bonus"
// của file TA_Credit_Bonus_<Mon><YY>.xlsx. Admin quản lý danh sách CTV, gán CTV cho hồ sơ, chốt kỳ. Quy tắc: shared/bonus/freelancer.ts.
import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Lock, LockOpen, Plus, RefreshCw, Save } from 'lucide-react';
import { bonusService, type BonusLine, type BonusPeriod } from '../services/bonusService.ts';
import { vnTodayIso } from '../../../shared/cnbRules.ts';
import { displayDateVn, fmtVnd, isIsoDate, periodLabel, periodMonthRange, periodOfDate, recentPeriodKeys, shiftPeriod } from '../../../shared/bonus/period.ts';
import {
  FREELANCER_DEFAULT_CONFIG,
  FREELANCER_FLAGS,
  FREELANCER_REGIONS,
  FREELANCER_STATE_LABELS,
  FREELANCER_WARNING_LABELS,
  buildFreelancerPeriod,
  cleanFreelancerConfig,
  freelancerLineViews,
  groupLineViews,
  type Freelancer,
  type FreelancerConfig,
  type FreelancerFlag,
  type FreelancerRow,
  type FreelancerSource,
  type FreelancerState,
} from '../../../shared/bonus/freelancer.ts';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const input = 'border border-slate-300 rounded px-2 py-1 text-xs';

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2"><div className="text-[11px] text-slate-500">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></div>
);

const STATE_STYLE: Record<FreelancerState, string> = {
  no_freelancer: 'bg-amber-50 text-amber-700', not_joined: 'bg-slate-100 text-slate-500', hold: 'bg-sky-50 text-sky-700',
  failed: 'bg-red-50 text-red-700', future: 'bg-slate-100 text-slate-600', due: 'bg-emerald-50 text-emerald-700', paid_before: 'bg-violet-50 text-violet-700',
};

function defaultCutoff(period: string, today: string): string {
  return periodOfDate(today) === period ? today : periodMonthRange(period).to;
}

/** Số tháng trước kỳ lương để liệt kê hồ sơ nguồn Freelancer chưa gán CTV (hồ sơ đã gán luôn hiện). */
const LIST_MONTHS = 6;

type View = 'period' | 'records' | 'freelancers';
type RecordFilter = 'all' | 'no_freelancer' | 'due' | 'open';

export const BonusFreelancerPanel: React.FC<{ isAdmin: boolean; onOpenCandidate?: (id: number) => void }> = ({ isAdmin, onOpenCandidate }) => {
  const today = vnTodayIso();
  const thisPeriod = periodOfDate(today);
  const periodOptions = useMemo(() => [shiftPeriod(thisPeriod, 1), ...recentPeriodKeys(12, thisPeriod)], [thisPeriod]);
  const [period, setPeriod] = useState(thisPeriod);
  const [asof, setAsof] = useState(today);
  const [periods, setPeriods] = useState<BonusPeriod[]>([]);
  const [lines, setLines] = useState<BonusLine[]>([]);
  const [sources, setSources] = useState<FreelancerSource[]>([]);
  const [freelancers, setFreelancers] = useState<Freelancer[]>([]);
  const [cfg, setCfg] = useState<FreelancerConfig>(FREELANCER_DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [view, setView] = useState<View>('period');
  const [filter, setFilter] = useState<RecordFilter>('open');
  const [open, setOpen] = useState<Set<number>>(new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, c, fl, src] = await Promise.all([
        bonusService.periods('freelancer'), bonusService.freelancerConfig(), bonusService.freelancers(),
        bonusService.freelancerSources(periodMonthRange(shiftPeriod(period, -LIST_MONTHS)).from),
      ]);
      setPeriods(ps);
      setCfg(c);
      setFreelancers(fl);
      setSources(src);
      setLines(await bonusService.lines(ps.filter((p) => p.status === 'da_chot').map((p) => p.id)));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void reload(); }, [reload]);

  const cur = periods.find((p) => p.period_key === period) ?? null;
  const locked = cur?.status === 'da_chot';
  const paid = useMemo(() => bonusService.freelancerPaid(periods, lines), [periods, lines]);
  const result = useMemo(() => (isIsoDate(asof) || locked
    ? buildFreelancerPeriod(sources, freelancers, paid, period, locked ? String(cur?.asof_date ?? asof) : asof, cfg) : null),
  [sources, freelancers, paid, period, asof, cfg, locked, cur]);
  const views = useMemo(() => (locked && cur
    ? freelancerLineViews(lines.filter((l) => l.period_id === cur.id))
    : freelancerLineViews(result?.lines ?? [])), [locked, cur, lines, result]);
  const groups = useMemo(() => groupLineViews(views), [views]);
  const totals = useMemo(() => views.reduce((s, v) => ({ amount: s.amount + v.amount, pit: s.pit + v.pit, net: s.net + v.net }), { amount: 0, pit: 0, net: 0 }), [views]);
  const flName = useMemo(() => new Map(freelancers.map((f) => [f.id, f.name])), [freelancers]);

  const run = async (fn: () => Promise<string>): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await fn() });
      await reload();
      return true;
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const lock = () => {
    if (!result || !isIsoDate(asof)) { setNotice({ ok: false, text: 'Ngày chốt không hợp lệ.' }); return; }
    const unassigned = result.rows.filter((r) => r.state === 'no_freelancer').length;
    if (unassigned && !window.confirm(`Còn ${unassigned} hồ sơ nguồn Freelancer chưa gán CTV (không được tính). Vẫn chốt?`)) return;
    if (!window.confirm(`Chốt ${periodLabel(period)}: ${result.totals.freelancers} CTV, ${result.totals.people} ứng viên, tổng ${fmtVnd(result.totals.amount)} đ?`)) return;
    void run(async () => {
      const r = await bonusService.lock('freelancer', period, asof, result.lines);
      return `Đã chốt kỳ: ${r.count} khoản, tổng ${fmtVnd(r.total)} đ.`;
    });
  };
  const reopen = () => {
    const reason = window.prompt('Lý do mở lại kỳ (bắt buộc):', '');
    if (reason == null) return;
    void run(async () => { await bonusService.reopen('freelancer', period, reason); return 'Đã mở lại kỳ.'; });
  };
  const exportXlsx = () => void run(async () => { await bonusService.exportFreelancer(period, views); return 'Đã tải file Excel.'; });
  const saveRecord = (id: number, patch: { freelancer_id?: number | null; flag?: FreelancerFlag; note?: string }) =>
    void run(async () => { await bonusService.saveFreelancerRecord(id, patch); return 'Đã lưu.'; });
  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const records = useMemo(() => (result?.rows ?? []).filter((r) => {
    if (filter === 'no_freelancer') return r.state === 'no_freelancer';
    if (filter === 'due') return r.state === 'due';
    if (filter === 'open') return r.state !== 'paid_before' && r.state !== 'not_joined';
    return true;
  }), [result, filter]);
  const activeFl = freelancers.filter((f) => f.active);

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
        <span className={`text-xs px-2 py-1 rounded ${locked ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {locked ? `Đã chốt ngày ${displayDateVn(cur?.asof_date)}` : 'Đang mở'}
        </span>
        <div className="flex-1" />
        <button className={`${btn} border-slate-300`} disabled={loading || busy} onClick={() => void reload()}><RefreshCw className="w-3.5 h-3.5" /> Tải lại</button>
        <button className={`${btn} border-slate-300`} disabled={loading || busy || !views.length} onClick={exportXlsx}><Download className="w-3.5 h-3.5" /> Xuất Excel</button>
        {isAdmin && !locked && (
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={loading || busy || !result?.lines.length} onClick={lock}><Lock className="w-3.5 h-3.5" /> Chốt kỳ</button>
        )}
        {isAdmin && locked && <button className={`${btn} border-slate-300`} disabled={busy} onClick={reopen}><LockOpen className="w-3.5 h-3.5" /> Mở lại</button>}
      </div>

      {notice && <div className={`text-xs px-3 py-2 rounded ${notice.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{notice.text}</div>}
      {!result && <div className="text-xs px-3 py-2 rounded bg-red-50 text-red-700">Ngày chốt không hợp lệ.</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="CTV được trả" value={String(groups.length)} />
        <Stat label="Ứng viên eligible" value={String(views.length)} />
        <Stat label="PIT" value={fmtVnd(totals.pit)} />
        <Stat label="Tổng Freelancer (gross / net)" value={`${fmtVnd(totals.amount)} / ${fmtVnd(totals.net)}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([['period', `Theo CTV (${groups.length})`], ['records', `Hồ sơ (${result?.rows.length ?? 0})`], ['freelancers', `Danh sách CTV (${freelancers.length})`]] as [View, string][])
          .map(([v, l]) => <button key={v} className={`${btn} ${view === v ? 'border-[#0B5FFF] text-[#0B5FFF]' : 'border-slate-300'}`} onClick={() => setView(v)}>{l}</button>)}
        {view === 'records' && (
          <select className={`${input} ml-2`} value={filter} onChange={(e) => setFilter(e.target.value as RecordFilter)}>
            <option value="open">Chưa trả</option>
            <option value="no_freelancer">Chưa gán CTV</option>
            <option value="due">Trả kỳ này</option>
            <option value="all">Tất cả</option>
          </select>
        )}
      </div>

      <div className="text-[11px] text-slate-500">
        {`Ứng viên đủ ${cfg.minDays} ngày lịch (OBD + ${cfg.minDays} ≤ ngày chốt) và chưa trả kỳ trước thì vào kỳ này. Mức / ứng viên theo số ứng viên của CTV trong kỳ, áp cho cả lô; PIT ${Math.round(cfg.pitRate * 100)}%.`}
      </div>

      {view === 'period' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>{['', 'CTV', 'Region', 'Ứng viên', 'Mức / UV', 'Bonus', 'PIT', 'Net'].map((h, i) => <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Đang tải…</td></tr>}
              {!loading && !groups.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Không có dữ liệu.</td></tr>}
              {!loading && groups.map((g) => (
                <Fragment key={g.freelancer_id}>
                  <tr className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={() => toggle(g.freelancer_id)}>
                    <td className="px-2 py-1.5">{open.has(g.freelancer_id) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
                    <td className="px-3 py-1.5 font-medium">{g.name}</td>
                    <td className="px-3 py-1.5">{g.region}</td>
                    <td className="px-3 py-1.5 tabular-nums">{g.count}</td>
                    <td className="px-3 py-1.5 tabular-nums">{fmtVnd(g.rate)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{fmtVnd(g.amount)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-slate-500">{fmtVnd(g.pit)}</td>
                    <td className="px-3 py-1.5 tabular-nums font-medium">{fmtVnd(g.net)}</td>
                  </tr>
                  {open.has(g.freelancer_id) && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-6 py-2">
                        <table className="text-[11px]">
                          <tbody>
                            {views.filter((v) => v.freelancer_id === g.freelancer_id).map((v) => (
                              <tr key={v.record_id ?? v.candidate_code}>
                                <td className="pr-3">{v.candidate_code}</td>
                                <td className="pr-3">{v.full_name}</td>
                                <td className="pr-3">{v.cand_emp_id}</td>
                                <td className="pr-3">{v.site}</td>
                                <td className="pr-3">{v.position}</td>
                                <td className="pr-3 tabular-nums">{displayDateVn(v.ob_date)}</td>
                                <td className="pr-3">{v.emp_status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'records' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>{['Mã', 'Ứng viên', 'Site', 'OBD', 'Đủ ngày', 'Trạng thái NV', 'CTV', 'Cờ', 'Tình trạng', 'Lưu ý', 'Ghi chú'].map((h, i) => <th key={i} className="px-2 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-500">Đang tải…</td></tr>}
              {!loading && !records.length && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-500">Không có dữ liệu.</td></tr>}
              {!loading && records.map((r) => (
                <RecordRow key={r.record_id} r={r} freelancers={activeFl} flName={flName} editable={isAdmin && !busy && r.state !== 'paid_before' && !(locked && r.state === 'due')}
                  onSave={(p) => saveRecord(r.record_id, p)} onOpenCandidate={onOpenCandidate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'freelancers' && <FreelancerList freelancers={freelancers} isAdmin={isAdmin} busy={busy} onSave={(f) => run(async () => { await bonusService.saveFreelancer(f); return 'Đã lưu CTV.'; })} />}
    </div>
  );
};

const RecordRow: React.FC<{
  r: FreelancerRow;
  freelancers: Freelancer[];
  flName: Map<number, string>;
  editable: boolean;
  onSave: (p: { freelancer_id?: number | null; flag?: FreelancerFlag; note?: string }) => void;
  onOpenCandidate?: (id: number) => void;
}> = ({ r, freelancers, flName, editable, onSave, onOpenCandidate }) => {
  const [note, setNote] = useState(r.note);
  useEffect(() => setNote(r.note), [r.note]);
  const hasCurrent = r.freelancer_id == null || freelancers.some((f) => f.id === r.freelancer_id);
  return (
    <tr className="border-t border-slate-100">
      <td className="px-2 py-1 whitespace-nowrap">
        {onOpenCandidate ? <button className="text-[#0B5FFF] hover:underline" onClick={() => onOpenCandidate(r.record_id)}>{r.candidate_code}</button> : r.candidate_code}
      </td>
      <td className="px-2 py-1">{r.full_name}</td>
      <td className="px-2 py-1">{r.site}</td>
      <td className="px-2 py-1 tabular-nums">{displayDateVn(r.ob_date)}</td>
      <td className="px-2 py-1 tabular-nums">{displayDateVn(r.eligible_date)}</td>
      <td className="px-2 py-1">{r.emp_status}{r.attrition_date ? ` (${displayDateVn(r.attrition_date)})` : ''}</td>
      <td className="px-2 py-1">
        <select className={input} value={r.freelancer_id ?? ''} disabled={!editable}
          onChange={(e) => onSave({ freelancer_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">—</option>
          {!hasCurrent && <option value={r.freelancer_id!}>{flName.get(r.freelancer_id!) ?? `#${r.freelancer_id}`}</option>}
          {freelancers.map((f) => <option key={f.id} value={f.id}>{f.phone ? `${f.name} · ${f.phone}` : f.name}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <select className={input} value={r.flag} disabled={!editable} onChange={(e) => onSave({ flag: e.target.value as FreelancerFlag })}>
          {FREELANCER_FLAGS.map((f) => <option key={f} value={f}>{f || (r.suggested ? `Theo gợi ý: ${r.suggested}` : '—')}</option>)}
        </select>
      </td>
      <td className="px-2 py-1 whitespace-nowrap">
        <span className={`px-1.5 py-0.5 rounded ${STATE_STYLE[r.state]}`}>
          {r.state === 'paid_before' ? `Đã trả ${periodLabel(r.period)}` : FREELANCER_STATE_LABELS[r.state]}
        </span>
      </td>
      <td className="px-2 py-1 text-amber-700">{r.warnings.map((w) => FREELANCER_WARNING_LABELS[w]).join('; ')}</td>
      <td className="px-2 py-1">
        <input className={`${input} w-40`} value={note} disabled={!editable && r.state !== 'paid_before'} onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note.trim() !== r.note) onSave({ note: note.trim() }); }} />
      </td>
    </tr>
  );
};

const EMPTY: Omit<Freelancer, 'id'> & { id: number | null } = { id: null, name: '', phone: '', region: '', note: '', active: true };

const FreelancerList: React.FC<{ freelancers: Freelancer[]; isAdmin: boolean; busy: boolean; onSave: (f: Omit<Freelancer, 'id'> & { id: number | null }) => Promise<boolean> }> = ({ freelancers, isAdmin, busy, onSave }) => {
  const [edit, setEdit] = useState<(Omit<Freelancer, 'id'> & { id: number | null }) | null>(null);
  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    if (await onSave({ ...edit, name: edit.name.trim(), phone: edit.phone.trim(), note: edit.note.trim() })) setEdit(null);
  };
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="text-[11px] text-slate-500">CTV không phải PIC, không có Emp ID. Mỗi CTV một dòng để đếm đúng số ứng viên / CTV; tắt CTV thì không còn trong danh sách chọn.</div>
      {isAdmin && !edit && <button className={`${btn} border-slate-300`} onClick={() => setEdit({ ...EMPTY })}><Plus className="w-3.5 h-3.5" /> Thêm CTV</button>}
      {edit && (
        <div className="flex flex-wrap items-center gap-2 border border-slate-200 rounded p-2">
          <input className={`${input} w-48`} placeholder="Tên CTV" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <input className={`${input} w-32`} placeholder="Số điện thoại" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
          <select className={input} value={edit.region} onChange={(e) => setEdit({ ...edit, region: e.target.value as Freelancer['region'] })}>
            <option value="">Region</option>
            {FREELANCER_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input className={`${input} w-48`} placeholder="Ghi chú" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
          <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Bật</label>
          <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy || !edit.name.trim()} onClick={() => void save()}><Save className="w-3.5 h-3.5" /> Lưu</button>
          <button className={`${btn} border-slate-300`} onClick={() => setEdit(null)}>Hủy</button>
        </div>
      )}
      <table className="min-w-full text-xs">
        <thead className="text-slate-600"><tr>{['Tên CTV', 'Số điện thoại', 'Region', 'Ghi chú', 'Bật', ''].map((h, i) => <th key={i} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {!freelancers.length && <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-500">Chưa có CTV nào.</td></tr>}
          {freelancers.map((f) => (
            <tr key={f.id} className={`border-t border-slate-100 ${f.active ? '' : 'text-slate-400'}`}>
              <td className="px-2 py-1">{f.name}</td>
              <td className="px-2 py-1">{f.phone}</td>
              <td className="px-2 py-1">{f.region}</td>
              <td className="px-2 py-1">{f.note}</td>
              <td className="px-2 py-1">{f.active ? '✓' : ''}</td>
              <td className="px-2 py-1">{isAdmin && <button className="text-[#0B5FFF] hover:underline" onClick={() => setEdit({ ...f })}>Sửa</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const FreelancerSettings: React.FC = () => {
  const [cfg, setCfg] = useState<FreelancerConfig>(FREELANCER_DEFAULT_CONFIG);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fill = (c: FreelancerConfig) => { setCfg(c); setText(JSON.stringify(c, null, 2)); };
  useEffect(() => { bonusService.freelancerConfig().then(fill).catch((e: Error) => setNotice({ ok: false, text: e.message })); }, []);

  const save = async () => {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { setNotice({ ok: false, text: 'Cấu hình không phải JSON hợp lệ.' }); return; }
    const next = cleanFreelancerConfig(raw);
    if (JSON.stringify(next) !== JSON.stringify(raw)) {
      fill(next);
      setNotice({ ok: false, text: 'Có giá trị không hợp lệ, đã thay bằng mặc định. Kiểm tra lại rồi bấm Lưu.' });
      return;
    }
    setBusy(true);
    try {
      await bonusService.saveSettings('freelancer', { ...next });
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
      <div className="text-sm font-semibold">Mức Freelancer</div>
      <div className="text-[11px] text-slate-600">
        {`Hiện tại: đủ ${cfg.minDays} ngày · ${cfg.tiers.map((t) => `${t.max == null ? 'còn lại' : `≤ ${t.max}`}: ${fmtVnd(t.amount)}`).join(' · ')} · PIT ${Math.round(cfg.pitRate * 100)}%`}
      </div>
      <div className="text-[11px] text-slate-500">
        minDays: số ngày lịch tối thiểu từ OBD; tiers: khung theo số ứng viên của CTV trong kỳ (max tăng dần, khung cuối max = null), amount = mức / ứng viên áp cho cả lô; pitRate: thuế TNCN khấu trừ (0.1 = 10%).
      </div>
      <textarea className="w-full h-56 font-mono text-[11px] border border-slate-300 rounded p-2" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {notice && <div className={`text-xs ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</div>}
      <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy} onClick={save}><Save className="w-3.5 h-3.5" /> Lưu</button>
    </div>
  );
};

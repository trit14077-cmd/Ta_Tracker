// Quy trình 2 – Chốt OB / CnB. Kỳ T = 25/(T-1) → 24/T, chốt ngày 25.
//  - Tab "Danh sách kỳ": mọi hồ sơ có OBD trong kỳ, đủ / thiếu điều kiện và lý do, thông tin nhân sự, giấy tờ. TA sửa trước ngày 25.
//  - Tab "Đã chốt": ảnh chụp lúc chốt (gửi CnB), CnB kiểm hồ sơ (thay tab "C&B check HS Tháng N"), xuất Excel.
// Quy tắc: shared/cnbRules.ts; template: shared/cnbTemplate.ts; dữ liệu: cnbService (migration 0040).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Lock, LockOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { cnbService, type CnbBatch, type CnbItem, type CnbPreviewRow } from '../services/cnbService.ts';
import type { UserProfile } from '../services/authService.ts';
import {
  CNB_CHECK_KEYS,
  CNB_CHECK_LABELS,
  CNB_REASON_LABELS,
  CNB_WARNING_LABELS,
  cnbEligibility,
  currentCycleKey,
  cycleOf,
  daysToLock,
  docMark,
  recentCycleKeys,
  vnTodayIso,
  type CnbCheckKey,
} from '../../../shared/cnbRules.ts';
import { displayDate } from '../../../shared/cnbTemplate.ts';
import { HR_STATUS_LABELS, hrMissingCount, type HrStatus } from '../../../shared/hrInfoRules.ts';

type Tab = 'preview' | 'locked';
type Show = 'all' | 'ok' | 'out';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const DOCS: [keyof CnbPreviewRow, string][] = [['edu_certificate', 'BC'], ['health_check', 'GKSK'], ['id_card', 'CCCD'], ['resume', 'SYLL']];

const DocMarks: React.FC<{ r: CnbPreviewRow | CnbItem['src'] }> = ({ r }) => (
  <span className="inline-flex gap-1">
    {DOCS.map(([k, label]) => {
      const ok = docMark((r as Record<string, unknown>)[k as string]) === 'x';
      return (
        <span key={label} title={`${label}: ${ok ? 'đã có' : 'thiếu'}`}
          className={`px-1 rounded text-[10px] ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {label}
        </span>
      );
    })}
  </span>
);

const HrCell: React.FC<{ status?: string | null; data?: Record<string, unknown> | null }> = ({ status, data }) => {
  const missing = hrMissingCount((data ?? {}) as Record<string, string>);
  const label = status ? HR_STATUS_LABELS[status as HrStatus] ?? status : 'Chưa nhập';
  const done = status === 'verified' || (status === 'submitted' && missing === 0);
  return (
    <span className={done ? 'text-emerald-700' : 'text-amber-700'} title={missing ? `Còn thiếu ${missing} trường bắt buộc` : undefined}>
      {label}{missing && status ? ` · thiếu ${missing}` : ''}
    </span>
  );
};

export const CnbObView: React.FC<{ user: UserProfile; onOpenCandidate?: (id: number) => void }> = ({ user, onOpenCandidate }) => {
  const isAdmin = user.role === 'admin';
  const cycles = useMemo(() => recentCycleKeys(12), []);
  const [cycle, setCycle] = useState(currentCycleKey());
  const [tab, setTab] = useState<Tab>('preview');
  const [rows, setRows] = useState<CnbPreviewRow[]>([]);
  const [batch, setBatch] = useState<CnbBatch | null>(null);
  const [items, setItems] = useState<CnbItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [show, setShow] = useState<Show>('all');
  const [taFilter, setTaFilter] = useState('');
  const [q, setQ] = useState('');

  const cy = cycleOf(cycle);
  const today = vnTodayIso();
  const locked = batch?.status === 'da_chot';
  const left = daysToLock(cycle);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b] = await Promise.all([cnbService.preview(cycle), cnbService.batch(cycle)]);
      setRows(p);
      setBatch(b);
      setItems(b ? await cnbService.items(b.id) : []);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [cycle]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (!loading) setTab(locked ? 'locked' : 'preview'); }, [locked, loading]);

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

  // Xét lại bằng shared/cnbRules để hiện cảnh báo (DB đã trả lý do; hai bên dùng cùng quy tắc).
  const evaluated = useMemo(() => rows.map((r) => ({ r, ev: cnbEligibility(r, cycle, today) })), [rows, cycle, today]);
  const inItems = useMemo(() => new Set(items.map((i) => i.record_id)), [items]);
  const taList = useMemo(() => [...new Set(rows.map((r) => r.pic ?? ''))].filter(Boolean).sort(), [rows]);

  const match = (pic: string | null | undefined, texts: unknown[]) => {
    const needle = q.trim().toLowerCase();
    return (!taFilter || (pic ?? '') === taFilter)
      && (!needle || texts.some((t) => String(t ?? '').toLowerCase().includes(needle)));
  };
  const visible = evaluated.filter(({ r, ev }) =>
    (show === 'all' || (show === 'ok') === ev.ok)
    && match(r.pic, [r.candidate_code, r.emp_id, r.full_name, r.position, r.site]));
  const visibleItems = items.filter((i) => match(i.pic, [i.src.candidate_code, i.src.emp_id, i.src.full_name, i.src.position, i.src.site]));

  // Ô đếm theo TA (thay tab "Table" của sheet CnB).
  const byTa = useMemo(() => {
    const m = new Map<string, { total: number; ok: number; out: number; hrMissing: number; docMissing: number }>();
    evaluated.forEach(({ r, ev }) => {
      const k = r.pic || '—';
      const g = m.get(k) ?? { total: 0, ok: 0, out: 0, hrMissing: 0, docMissing: 0 };
      g.total += 1;
      if (ev.ok) g.ok += 1; else g.out += 1;
      if (ev.ok && (r.hr_status !== 'verified' && r.hr_status !== 'submitted')) g.hrMissing += 1;
      if (ev.ok && DOCS.some(([d]) => docMark((r as unknown as Record<string, unknown>)[d as string]) === 'o')) g.docMissing += 1;
      m.set(k, g);
    });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [evaluated]);
  const okRows = evaluated.filter(({ ev }) => ev.ok).map(({ r }) => r);

  const lock = () => {
    const msg = `Chốt ${cy.label} (${displayDate(cy.from)} → ${displayDate(cy.to)}) với ${okRows.length} người đủ điều kiện?\n`
      + 'Sau khi chốt, danh sách gửi CnB không đổi khi hồ sơ được sửa. Muốn chốt lại phải mở lại kỳ.';
    if (!window.confirm(msg)) return;
    void run(async () => {
      const r = await cnbService.lock(cycle);
      return `Đã chốt ${cy.label}: ${r.count} người${r.removed ? `, bỏ ${r.removed} người không còn đủ điều kiện` : ''}.`;
    });
  };
  const reopen = () => {
    const reason = window.prompt(`Lý do mở lại ${cy.label}? (kết quả CnB kiểm hồ sơ được giữ khi chốt lại)`);
    if (!reason?.trim()) return;
    void run(async () => { await cnbService.reopen(cycle, reason.trim()); return `Đã mở lại ${cy.label}.`; });
  };
  const addLate = (r: CnbPreviewRow) => {
    const reason = window.prompt(`Lý do bổ sung ${r.full_name || r.candidate_code} vào ${cy.label}?`);
    if (!reason?.trim()) return;
    void run(async () => { await cnbService.addLate(cycle, r.record_id, reason.trim()); return `Đã bổ sung ${r.candidate_code}.`; });
  };
  const removeItem = (i: CnbItem) => {
    const reason = window.prompt(`Lý do bỏ ${i.src.full_name || i.src.candidate_code} khỏi danh sách đã chốt?`);
    if (!reason?.trim()) return;
    void run(async () => { await cnbService.removeItem(i.id, reason.trim()); return `Đã bỏ ${i.src.candidate_code}.`; });
  };
  const setCheck = async (i: CnbItem, k: CnbCheckKey, v: string) => {
    try {
      const next = await cnbService.check(i.id, { [k]: v });
      setItems((list) => list.map((x) => (x.id === i.id ? { ...x, cnb_check: next } : x)));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  };
  const setNote = async (i: CnbItem, note: string) => {
    if (note === i.cnb_note) return;
    try {
      await cnbService.check(i.id, {}, note);
      setItems((list) => list.map((x) => (x.id === i.id ? { ...x, cnb_note: note } : x)));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  };
  const exportRun = (fn: () => Promise<void>) => void run(async () => { await fn(); return 'Đã tải file.'; });
  const lockedSrc = visibleItems.map((i) => i.src);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-800">Chốt OB / CnB</div>
          <div className="text-xs text-slate-500">
            Kỳ OB tháng T tính từ ngày 25 tháng trước đến ngày 24 tháng T, chốt ngày 25. Chỉ tính người "Chi lương" và còn làm việc.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="border border-slate-300 rounded-md px-2 py-1 text-xs" value={cycle} onChange={(e) => setCycle(e.target.value)}>
            {cycles.map((k) => <option key={k} value={k}>{cycleOf(k).label} ({displayDate(cycleOf(k).from)} → {displayDate(cycleOf(k).to)})</option>)}
          </select>
          <span className={`text-xs px-2 py-1 rounded-md ${locked ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
            {locked
              ? `Đã chốt ${batch?.locked_at ? new Date(batch.locked_at).toLocaleString('vi-VN') : ''} · ${batch?.item_count ?? 0} người`
              : left > 0 ? `Còn ${left} ngày tới ngày chốt (${displayDate(cy.lockDate)})` : left === 0 ? 'Hôm nay là ngày chốt' : `Quá ngày chốt ${-left} ngày`}
          </span>
          <button type="button" onClick={() => void reload()} disabled={loading || busy} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
            <RefreshCw className="w-3.5 h-3.5" /> Tải lại
          </button>
          {isAdmin && !locked && (
            <button type="button" onClick={lock} disabled={busy || loading} className={`${btn} border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-700`}>
              <Lock className="w-3.5 h-3.5" /> Chốt kỳ ({okRows.length})
            </button>
          )}
          {isAdmin && locked && (
            <button type="button" onClick={reopen} disabled={busy} className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`}>
              <LockOpen className="w-3.5 h-3.5" /> Mở lại kỳ
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className={`rounded-md px-3 py-2 text-xs border ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      {/* Ô đếm theo TA */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">TA</th>
              <th className="px-3 py-2 text-right">OB trong kỳ</th>
              <th className="px-3 py-2 text-right">Đủ điều kiện</th>
              <th className="px-3 py-2 text-right">Bị loại</th>
              <th className="px-3 py-2 text-right">Chưa gửi TT nhân sự</th>
              <th className="px-3 py-2 text-right">Thiếu giấy tờ</th>
              <th className="px-3 py-2 text-right">% đủ TT nhân sự</th>
            </tr>
          </thead>
          <tbody>
            {byTa.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">{loading ? 'Đang tải…' : 'Không có hồ sơ OB trong kỳ.'}</td></tr>}
            {byTa.map(([ta, g]) => (
              <tr key={ta} className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${taFilter === ta ? 'bg-blue-50' : ''}`}
                onClick={() => setTaFilter(taFilter === ta ? '' : ta)}>
                <td className="px-3 py-1.5">{ta}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.total}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{g.ok}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.out || '-'}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${g.hrMissing ? 'text-amber-700 font-semibold' : ''}`}>{g.hrMissing || '-'}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${g.docMissing ? 'text-amber-700 font-semibold' : ''}`}>{g.docMissing || '-'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{g.ok ? Math.round(((g.ok - g.hrMissing) / g.ok) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg p-3">
        <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
          {(['preview', 'locked'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs ${tab === t ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
              {t === 'preview' ? `Danh sách kỳ (${rows.length})` : `Đã chốt (${items.length})`}
            </button>
          ))}
        </div>
        {tab === 'preview' && (
          <select className="border border-slate-300 rounded-md px-2 py-1 text-xs" value={show} onChange={(e) => setShow(e.target.value as Show)}>
            <option value="all">Tất cả</option>
            <option value="ok">Đủ điều kiện</option>
            <option value="out">Bị loại</option>
          </select>
        )}
        {isAdmin && (
          <select className="border border-slate-300 rounded-md px-2 py-1 text-xs" value={taFilter} onChange={(e) => setTaFilter(e.target.value)}>
            <option value="">Tất cả TA</option>
            {taList.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <input className="border border-slate-300 rounded-md px-2 py-1 text-xs w-48 mr-auto" placeholder="Tìm mã, Emp ID, tên, vị trí, site…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tab === 'preview' ? (
          <>
            <button type="button" disabled={busy || !okRows.length} onClick={() => exportRun(() => cnbService.exportShort(cycle, okRows))} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <Download className="w-3.5 h-3.5" /> Xem trước bản gọn ({okRows.length})
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy || !lockedSrc.length} onClick={() => exportRun(() => cnbService.exportShort(cycle, lockedSrc))} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <Download className="w-3.5 h-3.5" /> Bản gọn 16 cột
            </button>
            {isAdmin && (
              <button type="button" disabled={busy || !lockedSrc.length} onClick={() => exportRun(() => cnbService.exportFull(cycle, lockedSrc))} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
                <Download className="w-3.5 h-3.5" /> Bản đầy đủ 98 cột
              </button>
            )}
            <button type="button" disabled={busy || !visibleItems.length} onClick={() => exportRun(() => cnbService.exportCheck(cycle, visibleItems))} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <Download className="w-3.5 h-3.5" /> Bảng kiểm hồ sơ
            </button>
          </>
        )}
      </div>

      {tab === 'preview' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Mã UV</th>
                <th className="px-3 py-2 text-left">Emp ID</th>
                <th className="px-3 py-2 text-left">Họ tên</th>
                <th className="px-3 py-2 text-left">Vị trí</th>
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-left">OBD</th>
                {isAdmin && <th className="px-3 py-2 text-left">TA</th>}
                <th className="px-3 py-2 text-left">Chi lương</th>
                <th className="px-3 py-2 text-left">Emp_STT</th>
                <th className="px-3 py-2 text-left">TT nhân sự</th>
                <th className="px-3 py-2 text-left">Giấy tờ</th>
                <th className="px-3 py-2 text-left">Kết quả</th>
                {isAdmin && locked && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={14} className="px-3 py-4 text-center text-slate-400">{loading ? 'Đang tải…' : 'Không có dòng phù hợp.'}</td></tr>
              )}
              {visible.map(({ r, ev }) => (
                <tr key={r.record_id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-1.5">
                    <button type="button" className="text-blue-700 hover:underline" onClick={() => onOpenCandidate?.(r.record_id)}>{r.candidate_code}</button>
                  </td>
                  <td className="px-3 py-1.5 font-mono">{r.emp_id || <span className="text-red-600">—</span>}</td>
                  <td className="px-3 py-1.5">{r.full_name}</td>
                  <td className="px-3 py-1.5">{r.position}</td>
                  <td className="px-3 py-1.5">{r.site}</td>
                  <td className="px-3 py-1.5 tabular-nums">{displayDate(r.ob_date)}</td>
                  {isAdmin && <td className="px-3 py-1.5">{r.pic}</td>}
                  <td className="px-3 py-1.5">{r.salary_pay_status || <span className="text-red-600">Chưa chọn</span>}</td>
                  <td className="px-3 py-1.5">{r.emp_status || '—'}</td>
                  <td className="px-3 py-1.5"><HrCell status={r.hr_status} data={r.hr} /></td>
                  <td className="px-3 py-1.5"><DocMarks r={r} /></td>
                  <td className="px-3 py-1.5">
                    {ev.ok
                      ? <span className="text-emerald-700">{inItems.has(r.record_id) ? 'Đã chốt' : 'Đủ điều kiện'}</span>
                      : <span className="text-red-600">{ev.reasons.map((x) => CNB_REASON_LABELS[x]).join(', ')}</span>}
                    {ev.warnings.length > 0 && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-amber-700" title={ev.warnings.map((w) => CNB_WARNING_LABELS[w]).join(', ')}>
                        <AlertTriangle className="w-3 h-3" />{ev.warnings.map((w) => CNB_WARNING_LABELS[w]).join(', ')}
                      </span>
                    )}
                  </td>
                  {isAdmin && locked && (
                    <td className="px-3 py-1.5 text-right">
                      {!inItems.has(r.record_id) && (
                        <button type="button" disabled={busy} onClick={() => addLate(r)} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}>
                          <Plus className="w-3 h-3" /> Bổ sung
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          {!batch && <div className="px-3 py-4 text-xs text-slate-500">Kỳ {cy.label} chưa chốt.</div>}
          {batch && (
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">STT</th>
                  <th className="px-3 py-2 text-left">MNV</th>
                  <th className="px-3 py-2 text-left">Họ tên</th>
                  <th className="px-3 py-2 text-left">Rank</th>
                  <th className="px-3 py-2 text-left">Ngày tuyển dụng</th>
                  {isAdmin && <th className="px-3 py-2 text-left">TA</th>}
                  <th className="px-3 py-2 text-left">Giấy tờ (TA)</th>
                  {CNB_CHECK_KEYS.map((k) => <th key={k} className="px-2 py-2 text-center">{CNB_CHECK_LABELS[k]}</th>)}
                  <th className="px-3 py-2 text-left">Ghi chú CnB</th>
                  {isAdmin && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {visibleItems.length === 0 && (
                  <tr><td colSpan={20} className="px-3 py-4 text-center text-slate-400">Không có dòng phù hợp.</td></tr>
                )}
                {visibleItems.map((i, idx) => (
                  <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5 tabular-nums">{idx + 1}</td>
                    <td className="px-3 py-1.5 font-mono">
                      <button type="button" className="text-blue-700 hover:underline" onClick={() => onOpenCandidate?.(i.record_id)}>{i.src.emp_id || i.src.candidate_code}</button>
                      {i.added_late && <span className="ml-1 px-1 rounded bg-blue-50 text-blue-700 text-[10px]" title={i.late_reason}>bổ sung</span>}
                    </td>
                    <td className="px-3 py-1.5">{i.src.full_name}</td>
                    <td className="px-3 py-1.5">{i.src.rank}</td>
                    <td className="px-3 py-1.5 tabular-nums">{displayDate(i.src.ob_date)}</td>
                    {isAdmin && <td className="px-3 py-1.5">{i.pic}</td>}
                    <td className="px-3 py-1.5"><DocMarks r={i.src} /></td>
                    {CNB_CHECK_KEYS.map((k) => {
                      const v = i.cnb_check?.[k] ?? '';
                      const cls = v === 'x' ? 'text-emerald-700' : v === 'o' ? 'text-red-600 font-semibold' : 'text-slate-400';
                      return (
                        <td key={k} className="px-2 py-1.5 text-center">
                          {isAdmin ? (
                            <select className={`border border-slate-200 rounded px-1 py-0.5 text-xs ${cls}`} value={v} onChange={(e) => void setCheck(i, k, e.target.value)}>
                              <option value="">·</option>
                              <option value="x">x</option>
                              <option value="o">o</option>
                            </select>
                          ) : <span className={cls}>{v || '·'}</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5">
                      {isAdmin ? (
                        <input className="border border-slate-200 rounded px-1.5 py-0.5 text-xs w-44" defaultValue={i.cnb_note} maxLength={500}
                          onBlur={(e) => void setNote(i, e.target.value)} />
                      ) : <span className={i.cnb_note ? 'text-red-600' : ''}>{i.cnb_note}</span>}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-1.5 text-right">
                        <button type="button" disabled={busy} onClick={() => removeItem(i)} title="Bỏ khỏi danh sách đã chốt" className={`${btn} border-red-200 text-red-700 hover:bg-red-50`}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {busy && <div className="fixed bottom-4 right-4 bg-slate-800 text-white text-xs px-3 py-2 rounded-md shadow">Đang xử lý...</div>}
    </div>
  );
};

// Chuyển từ OLD/src/components/CalendarView.tsx (M6-1). Giữ giao diện; dữ liệu qua opsService (RPC 0015 + bảng qua PostgREST, RLS).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { opsService as dataService, type CalendarEvent } from '../services/opsService.ts';
import type { DropdownDataResponse } from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';
import { EVENT_TYPES, addDays } from '../../../shared/opsRules.ts';

type Mode = 'month' | 'week' | 'day' | 'agenda';
type Kind = CalendarEvent['kind'];
const MODES: { key: Mode; label: string }[] = [
  { key: 'day', label: 'Ngày' },
  { key: 'week', label: 'Tuần' },
  { key: 'month', label: 'Tháng' },
  { key: 'agenda', label: 'Danh sách' },
];
const KIND: Record<Kind, { label: string; short: string; cls: string }> = {
  r1: { label: 'Phỏng vấn R1', short: 'R1', cls: 'bg-sky-100 text-sky-900 border-sky-200' },
  r2: { label: 'Phỏng vấn R2', short: 'R2', cls: 'bg-indigo-100 text-indigo-900 border-indigo-200' },
  interview: { label: 'Phỏng vấn khác', short: 'PV', cls: 'bg-violet-100 text-violet-900 border-violet-200' },
  ob: { label: 'Onboard', short: 'OB', cls: 'bg-emerald-100 text-emerald-900 border-emerald-200' },
  task: { label: 'Công việc', short: 'Việc', cls: 'bg-amber-100 text-amber-900 border-amber-200' },
  event: { label: 'Sự kiện', short: 'SK', cls: 'bg-slate-100 text-slate-800 border-slate-300' },
};
const KIND_ORDER: Kind[] = ['r1', 'r2', 'interview', 'ob', 'task', 'event'];
const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const statusCls = (s?: string) =>
  !s ? '' : /^(Passed|Joined|Accepted|Xong)$/.test(s) ? 'bg-emerald-600 text-white' : /^(Failed|Canceled|Noshow)$/.test(s) ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';

const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const weekday = (iso: string) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
const mondayOf = (iso: string) => addDays(iso, -weekday(iso));
const fmt = (iso: string) => iso.split('-').reverse().join('/');

function rangeOf(mode: Mode, anchor: string): [string, string] {
  if (mode === 'day') return [anchor, anchor];
  if (mode === 'week') return [mondayOf(anchor), addDays(mondayOf(anchor), 6)];
  if (mode === 'agenda') return [anchor, addDays(anchor, 30)];
  const first = anchor.slice(0, 8) + '01';
  const [y, m] = first.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return [mondayOf(first), addDays(mondayOf(last), 6)];
}
function step(mode: Mode, anchor: string, dir: number): string {
  if (mode === 'day') return addDays(anchor, dir);
  if (mode === 'week') return addDays(anchor, 7 * dir);
  if (mode === 'agenda') return addDays(anchor, 30 * dir);
  const [y, m] = anchor.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
}

/**
 * Internal calendar. The interview dates and times come from the candidate profiles (R1_Date / R1_Time,
 * R2_Date / R2_Time) and the OB date, with the result; plus interviews added in "Lịch sử phỏng vấn", tasks and own
 * events. With thousands of interviews a month, the month view shows counts per type and the day view groups by time.
 * Admin can narrow it to one TA. Not connected to Outlook or Google Calendar.
 */
export const CalendarView: React.FC<{ user: UserProfile; dropdowns: DropdownDataResponse; onOpenCandidate: (id: number) => void }> = ({ user, dropdowns, onOpenCandidate }) => {
  const today = localToday();
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState(today);
  const [pic, setPic] = useState('');
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // People (distinct candidates) with something on the calendar in the range, per TA: shown in the TA picker.
  const [people, setPeople] = useState<{ perPic: Record<string, number>; total: number }>({ perPic: {}, total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', type: 'Họp', date: today, time: '', end_time: '', note: '' });
  const [formErr, setFormErr] = useState('');
  const [from, to] = useMemo(() => rangeOf(mode, anchor), [mode, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await dataService.getCalendar(from, to, pic);
      setEvents(r.events);
      setPeople({ perPic: r.people_per_pic || {}, total: r.people_total || 0 });
      setError(r.truncated ? 'Có quá nhiều lịch trong khoảng này, chỉ hiện 2.000 mục đầu. Hãy lọc theo TA hoặc xem theo tuần.' : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được lịch.');
    } finally {
      setLoading(false);
    }
  }, [from, to, pic]);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => events.filter((e) => !hidden.has(e.kind)), [events, hidden]);
  const byDay = useMemo(() => {
    const m: Record<string, CalendarEvent[]> = {};
    shown.forEach((e) => (m[e.date] = m[e.date] || []).push(e));
    return m;
  }, [shown]);
  const kindCounts = useMemo(() => {
    const m: Partial<Record<Kind, number>> = {};
    events.forEach((e) => (m[e.kind] = (m[e.kind] || 0) + 1));
    return m;
  }, [events]);

  const openDay = (d: string) => {
    setAnchor(d);
    setMode('day');
  };
  const toggleKind = (k: Kind) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const item = (e: CalendarEvent) => {
    const k = KIND[e.kind];
    const own = e.kind === 'event' && (user.role === 'admin' || e.owner === user.username);
    return (
      <div key={e.id} className={`group flex items-center gap-1.5 border rounded px-1.5 py-1 text-xs ${k.cls}`} title={e.note || k.label}>
        <span className="text-[10px] font-bold opacity-70 w-7 shrink-0">{k.short}</span>
        <button type="button" className="flex-1 text-left truncate" onClick={() => e.candidate_id && onOpenCandidate(e.candidate_id)} data-no-i18n>
          {e.candidate_id ? <strong>{e.full_name || e.candidate_code}</strong> : <strong>{e.title}</strong>}
          {e.candidate_code && <span className="opacity-70"> · {e.candidate_code}</span>}
          {user.role === 'admin' && e.pic && <span className="opacity-70"> · {e.pic}</span>}
          {e.kind === 'task' && e.candidate_id ? <span className="opacity-70"> · {e.title}</span> : null}
        </button>
        {e.status && <span className={`px-1.5 rounded text-[10px] font-semibold ${statusCls(e.status)}`} data-no-i18n>{e.status}</span>}
        {own && (
          <button type="button" className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-600" title="Xóa sự kiện" onClick={() => window.confirm(`Xóa sự kiện "${e.title}"?`) && dataService.deleteEvent(Number(e.id.slice(3))).then(load, (err) => setError(err instanceof Error ? err.message : 'Không xóa được.'))}>
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  /** Small coloured counters per type, used in the month and week views. */
  const counters = (list: CalendarEvent[]) => {
    const m: Partial<Record<Kind, number>> = {};
    list.forEach((e) => (m[e.kind] = (m[e.kind] || 0) + 1));
    return (
      <div className="flex flex-wrap gap-0.5">
        {KIND_ORDER.filter((k) => m[k]).map((k) => (
          <span key={k} className={`px-1 rounded border text-[10px] font-semibold ${KIND[k].cls}`} data-no-i18n>
            {KIND[k].short} {m[k]}
          </span>
        ))}
      </div>
    );
  };

  /** Day view: grouped by time (09:00, 09:30...), entries without a time last. */
  const dayList = (d: string) => {
    const list = byDay[d] || [];
    const groups: Record<string, CalendarEvent[]> = {};
    list.forEach((e) => (groups[e.time || '—'] = groups[e.time || '—'] || []).push(e));
    const keys = Object.keys(groups).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a < b ? -1 : 1));
    if (!keys.length) return <p className="text-xs text-slate-400">Không có lịch.</p>;
    return (
      <div className="space-y-2">
        {keys.map((t) => (
          <div key={t} className="flex gap-3">
            <div className="w-14 shrink-0 text-xs font-bold text-slate-700 pt-1" data-no-i18n>
              {t === '—' ? 'Cả ngày' : t}
              <div className="text-[10px] font-normal text-slate-400" data-no-i18n>{groups[t].length}</div>
            </div>
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-1">{groups[t].map(item)}</div>
          </div>
        ))}
      </div>
    );
  };

  const addEvent = async () => {
    setFormErr('');
    try {
      await dataService.createEvent(form);
      setForm({ ...form, title: '', time: '', end_time: '', note: '' });
      load();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Không thêm được sự kiện.');
    }
  };

  const title = mode === 'month' ? `Tháng ${anchor.slice(5, 7)}/${anchor.slice(0, 4)}` : mode === 'day' ? `${WEEKDAYS[weekday(anchor)]} ${fmt(anchor)}` : `${fmt(from)} – ${fmt(to)}`;
  const input = 'px-2 py-1.5 text-xs border border-slate-300 rounded bg-white';
  const pics = (dropdowns.lists['pic'] || []).filter((o) => o.active).map((o) => o.value);

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAnchor(step(mode, anchor, -1))} className="p-1.5 border border-slate-300 rounded hover:bg-slate-50" aria-label="Trước"><ChevronLeft className="w-4 h-4" /></button>
        <button type="button" onClick={() => setAnchor(today)} className="px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50">Hôm nay</button>
        <button type="button" onClick={() => setAnchor(step(mode, anchor, 1))} className="p-1.5 border border-slate-300 rounded hover:bg-slate-50" aria-label="Sau"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-sm font-bold text-slate-900 ml-1" data-no-i18n>{title}</span>
        {loading && <span className="text-[11px] text-slate-400">Đang tải...</span>}
        {user.role === 'admin' && (
          <select value={pic} onChange={(e) => setPic(e.target.value)} className={`${input} ml-2`} title="Lọc theo TA">
            <option value="">Tất cả TA ({people.total} người)</option>
            {pics.map((p) => (
              <option key={p} value={p}>
                {p} ({people.perPic[p] || 0})
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex gap-1">
          {MODES.map((m) => (
            <button key={m.key} type="button" onClick={() => setMode(m.key)} className={`px-3 py-1.5 text-xs rounded border ${mode === m.key ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{m.label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-slate-500 mr-1">Hiện:</span>
        {KIND_ORDER.map((k) => (
          <button key={k} type="button" onClick={() => toggleKind(k)} className={`px-2 py-0.5 rounded border ${KIND[k].cls} ${hidden.has(k) ? 'opacity-40 line-through' : ''}`}>
            {KIND[k].label} <span data-no-i18n>({kindCounts[k] || 0})</span>
          </button>
        ))}
        <span className="ml-auto text-slate-500">Kết quả: <span className="px-1 rounded bg-emerald-600 text-white">Đạt</span> <span className="px-1 rounded bg-red-600 text-white">Rớt / hủy</span> <span className="px-1 rounded bg-amber-500 text-white">Chờ</span></span>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}

      {mode === 'month' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-7 bg-slate-50 text-[11px] font-semibold text-slate-600">
            {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 }, (_, i) => addDays(from, i)).map((d) => {
              const list = byDay[d] || [];
              const other = d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <button key={d} type="button" onClick={() => openDay(d)} className={`min-h-[84px] text-left border-t border-l border-slate-100 p-1 hover:bg-blue-50/40 ${other ? 'bg-slate-50/60' : ''}`} title="Bấm để xem lịch trong ngày">
                  <span className={`inline-block text-[11px] font-semibold mb-0.5 ${d === today ? 'bg-blue-600 text-white rounded-full px-1.5' : other ? 'text-slate-300' : 'text-slate-600'}`} data-no-i18n>{Number(d.slice(8))}</span>
                  {list.length > 0 && <div className="text-[10px] text-slate-500 mb-0.5" data-no-i18n>{list.length} lịch</div>}
                  {counters(list)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mode === 'week' && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d, i) => {
            const list = (byDay[d] || []).slice().sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1));
            return (
              <div key={d} className={`bg-white border rounded-lg p-2 min-h-[160px] ${d === today ? 'border-blue-400' : 'border-slate-200'}`}>
                <button type="button" onClick={() => openDay(d)} className="text-[11px] font-semibold text-slate-600 mb-1 hover:text-blue-700" data-no-i18n>{WEEKDAYS[i]} {fmt(d).slice(0, 5)} · {list.length}</button>
                {counters(list)}
                <div className="space-y-1 mt-1">{list.slice(0, 6).map(item)}</div>
                {list.length > 6 && <button type="button" onClick={() => openDay(d)} className="mt-1 text-[11px] text-blue-700 underline" data-no-i18n>Xem cả {list.length} lịch</button>}
              </div>
            );
          })}
        </div>
      )}

      {mode === 'day' && <div className="bg-white border border-slate-200 rounded-lg p-3">{dayList(anchor)}</div>}

      {mode === 'agenda' && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-4">
          {Object.keys(byDay).length === 0 && <p className="text-xs text-slate-400">Không có lịch trong khoảng này.</p>}
          {Object.keys(byDay).sort().map((d) => (
            <div key={d}>
              <button type="button" onClick={() => openDay(d)} className="text-xs font-bold text-slate-700 mb-1 hover:text-blue-700" data-no-i18n>{WEEKDAYS[weekday(d)]} {fmt(d)}{d === today ? ' · hôm nay' : ''} · {byDay[d].length} lịch</button>
              {counters(byDay[d])}
              <div className="space-y-1 mt-1">{byDay[d].slice().sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1)).slice(0, 10).map(item)}</div>
              {byDay[d].length > 10 && <button type="button" onClick={() => openDay(d)} className="mt-1 text-[11px] text-blue-700 underline" data-no-i18n>Xem cả {byDay[d].length} lịch</button>}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Thêm sự kiện</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Tiêu đề" className={`${input} md:col-span-2`} data-no-i18n />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={input}>
            {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} />
          <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={input} title="Bắt đầu" />
          <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className={input} title="Kết thúc" />
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ghi chú" className={`${input} col-span-2 md:col-span-5`} data-no-i18n />
          <button type="button" disabled={!form.title.trim() || !form.date} onClick={addEvent} className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Thêm
          </button>
        </div>
        {formErr && <p className="text-xs text-red-700 mt-1">{formErr}</p>}
        <p className="text-[11px] text-slate-500 mt-2">
          Ngày và giờ phỏng vấn R1, R2 lấy từ hồ sơ ứng viên (R1_Date / R1_Time, R2_Date / R2_Time), ngày Onboard lấy từ OB Date. Bấm vào tên để mở hồ sơ. Lịch nội bộ, chưa nối Outlook hay Google Calendar.
        </p>
      </div>
    </div>
  );
};

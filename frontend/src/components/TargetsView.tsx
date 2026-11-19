// Chuyển từ OLD/src/components/TargetsView.tsx (M6-1). Giữ giao diện; dữ liệu qua opsService (RPC 0015 + bảng qua PostgREST, RLS).
import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { opsService as dataService, type TargetRow } from '../services/opsService.ts';
import type { DropdownDataResponse } from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';
import { isoWeekKey } from '../../../shared/opsRules.ts';

const TYPES: { key: string; label: string }[] = [
  { key: 'day', label: 'Ngày' },
  { key: 'week', label: 'Tuần' },
  { key: 'month', label: 'Tháng' },
  { key: 'year', label: 'Năm' },
];
const localToday = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const currentKey = (type: string) => {
  const t = localToday();
  return type === 'day' ? t : type === 'month' ? t.slice(0, 7) : type === 'year' ? t.slice(0, 4) : isoWeekKey(t);
};
const fmt = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Targets by day, week, month or year, for everyone or per TA / position / department. Actual = OB Joined (by OB date)
 * in the period. Admin sets the targets; a TA sees the overall ones and their own.
 */
export const TargetsView: React.FC<{ user: UserProfile; dropdowns: DropdownDataResponse }> = ({ user, dropdowns }) => {
  const [type, setType] = useState('month');
  const [key, setKey] = useState(currentKey('month'));
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [range, setRange] = useState<[string, string] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ pic: '', position: '', dept: '', value: '' });
  const [msg, setMsg] = useState('');
  const isAdmin = user.role === 'admin';

  const load = useCallback(async () => {
    try {
      const r = await dataService.getTargets(type, key);
      setRows(r.targets);
      setRange([r.from, r.to]);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được target.');
      setRows([]);
    }
  }, [type, key]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setMsg('');
    setError('');
    try {
      await dataService.putTarget({ period_type: type, period_key: key, pic: form.pic, position: form.position, dept: form.dept, value: Number(form.value) });
      setMsg('Đã lưu target.');
      setForm({ ...form, value: '' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được target.');
    }
  };

  const pics = (dropdowns.lists['pic'] || []).filter((o) => o.active).map((o) => o.value);
  const positions = (dropdowns.lists['position'] || []).filter((o) => o.active).map((o) => o.value);
  const input = 'px-2 py-1.5 text-xs border border-slate-300 rounded bg-white';

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button key={t.key} type="button" onClick={() => { setType(t.key); setKey(currentKey(t.key)); }} className={`px-3 py-1.5 text-xs rounded border ${type === t.key ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{t.label}</button>
        ))}
        {type === 'day' && <input type="date" value={key} onChange={(e) => e.target.value && setKey(e.target.value)} className={input} />}
        {type === 'week' && <input type="week" value={key} onChange={(e) => e.target.value && setKey(e.target.value)} className={input} />}
        {type === 'month' && <input type="month" value={key} onChange={(e) => e.target.value && setKey(e.target.value)} className={input} />}
        {type === 'year' && <input type="number" min={2000} max={2100} value={key} onChange={(e) => /^\d{4}$/.test(e.target.value) && setKey(e.target.value)} className={`${input} w-24`} />}
        {range && <span className="text-xs text-slate-500" data-no-i18n>{fmt(range[0])} – {fmt(range[1])}</span>}
        <span className="ml-auto text-[11px] text-slate-500">Thực tế = số OB Joined có ngày OB trong kỳ.</span>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">TA</th>
              <th className="px-3 py-2 text-left">Vị trí</th>
              <th className="px-3 py-2 text-left">Phòng ban</th>
              <th className="px-3 py-2 text-right">Target</th>
              <th className="px-3 py-2 text-right">Thực tế</th>
              <th className="px-3 py-2 text-left w-1/4">% đạt</th>
              {isAdmin && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const pct = t.pct ?? 0;
              return (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => isAdmin && setForm({ pic: t.pic, position: t.position, dept: t.dept, value: String(t.value) })} title={isAdmin ? 'Bấm để sửa' : undefined}>
                  <td className="px-3 py-2 font-semibold" data-no-i18n>{t.pic || 'Tất cả TA'}</td>
                  <td className="px-3 py-2" data-no-i18n>{t.position || '—'}</td>
                  <td className="px-3 py-2" data-no-i18n>{t.dept || '—'}</td>
                  <td className="px-3 py-2 text-right" data-no-i18n>{t.value}</td>
                  <td className="px-3 py-2 text-right font-bold" data-no-i18n>{t.actual}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-100 rounded">
                        <div className={`h-2 rounded ${pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="w-12 text-right" data-no-i18n>{t.pct === null ? '—' : `${t.pct}%`}</span>
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={(e) => { e.stopPropagation(); if (window.confirm('Xóa target này?')) dataService.deleteTarget(t.id).then(load, (err) => setError(err instanceof Error ? err.message : 'Không xóa được.')); }} className="text-slate-400 hover:text-red-600" title="Xóa">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">Chưa có target cho kỳ này.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <h3 className="text-sm font-bold text-slate-900 mb-2">Đặt target cho kỳ đang xem</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <select value={form.pic} onChange={(e) => setForm({ ...form, pic: e.target.value })} className={input}>
              <option value="">Tất cả TA</option>
              {pics.map((p) => <option key={p}>{p}</option>)}
            </select>
            <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className={input}>
              <option value="">Mọi vị trí</option>
              {positions.map((p) => <option key={p}>{p}</option>)}
            </select>
            <input value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} placeholder="Phòng ban (để trống = tất cả)" className={input} data-no-i18n />
            <input type="number" min={0} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Target" className={input} />
            <button type="button" disabled={form.value === ''} onClick={save} className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">Lưu target</button>
          </div>
          {msg && <p className="text-xs text-emerald-700 mt-1">{msg}</p>}
          <p className="text-[11px] text-slate-500 mt-2">Cùng TA, vị trí và phòng ban thì lưu lại sẽ cập nhật target cũ. Bấm vào một dòng để sửa.</p>
        </div>
      )}
    </div>
  );
};

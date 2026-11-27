// Quy trình 1 – Mã ghế: admin (HRSS) sửa cây Ban → Đơn vị → Phòng → Đội → Tổ (bảng seat_org_paths, migration 0041).
// Thêm / sửa / tắt-bật / xóa nhánh; bấm 1 giá trị để đổi tên cho mọi nhánh bên dưới. Quy tắc: shared/seatOrgTree.ts.
// Form mã ghế tải lại danh mục mỗi lần mở, nên thay đổi ở đây có hiệu lực ngay cho lần nhập sau.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import { seatService, SeatValidationError, type SeatOrgRow } from '../services/seatService.ts';
import { SEAT_ORG_LABEL, SEAT_ORG_LEVELS, SEAT_ORG_REGIONS, seatOrgOptions, type SeatOrgLevel, type SeatOrgPath } from '../../../shared/seatOrgTree.ts';

type PathValues = Required<SeatOrgPath>;
const EMPTY: PathValues = { ban: '', don_vi: '', phong: '', doi: '', to_nhom: '', vung: '' };
const pathText = (p: SeatOrgPath) => SEAT_ORG_LEVELS.map((k) => p[k]).filter(Boolean).join(' > ');
const sortKey = (p: SeatOrgPath) => SEAT_ORG_LEVELS.map((k) => p[k] || '\u0000');
const byPath = (a: SeatOrgPath, b: SeatOrgPath) => {
  const x = sortKey(a);
  const y = sortKey(b);
  for (let i = 0; i < x.length; i++) {
    const c = x[i].localeCompare(y[i], 'vi');
    if (c) return c;
  }
  return 0;
};
const inputCls = 'w-full border rounded-md px-2 py-1 text-xs';
const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';

/** Ô thêm/sửa 1 nhánh. Gợi ý (datalist) lấy từ nhánh có sẵn theo các cấp trên đã nhập; được gõ giá trị mới. */
const PathForm: React.FC<{
  initial: SeatOrgRow | null;
  all: SeatOrgRow[];
  onCancel: () => void;
  onSaved: (msg: string) => void;
}> = ({ initial, all, onCancel, onSaved }) => {
  const [values, setValues] = useState<PathValues>(() => (initial ? { ...EMPTY, ...pickPath(initial) } : { ...EMPTY }));
  const [errors, setErrors] = useState<Partial<Record<SeatOrgLevel | 'vung', string>>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure('');
    try {
      await seatService.orgPathSave(initial ? initial.id : null, values, all);
      onSaved(initial ? 'Đã sửa nhánh.' : 'Đã thêm nhánh.');
    } catch (err) {
      if (err instanceof SeatValidationError) setErrors(err.errors as Partial<Record<SeatOrgLevel | 'vung', string>>);
      else setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-2">
      <div className="text-xs font-semibold text-slate-700">{initial ? 'Sửa nhánh' : 'Thêm nhánh mới'}</div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        {SEAT_ORG_LEVELS.map((k) => {
          const listId = `seat-org-dl-${k}`;
          return (
            <label key={k} className="block">
              <span className="block text-[11px] text-slate-600 mb-0.5">{SEAT_ORG_LABEL[k]}{k === 'ban' ? ' *' : ''}</span>
              <input
                className={`${inputCls} ${errors[k] ? 'border-red-400' : 'border-slate-300'}`}
                value={values[k]}
                list={listId}
                onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
              />
              <datalist id={listId}>
                {seatOrgOptions(all, k, values).map((o) => <option key={o} value={o} />)}
              </datalist>
              {errors[k] && <span className="block text-[11px] text-red-600 mt-0.5">{errors[k]}</span>}
            </label>
          );
        })}
        <label className="block">
          <span className="block text-[11px] text-slate-600 mb-0.5">Vùng (khóa theo nhánh)</span>
          <select
            className={`${inputCls} ${errors.vung ? 'border-red-400' : 'border-slate-300'}`}
            value={values.vung}
            onChange={(e) => setValues((s) => ({ ...s, vung: e.target.value }))}
          >
            <option value="">— Không khóa —</option>
            {SEAT_ORG_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {errors.vung && <span className="block text-[11px] text-red-600 mt-0.5">{errors.vung}</span>}
        </label>
      </div>
      <div className="text-[11px] text-slate-500">
        Vùng: khi TA chọn tới nhánh mà mọi nhánh con cùng một vùng, ô Vùng tự điền và không đổi được.
      </div>
      <div className="text-[11px] text-slate-500">
        Được dừng ở giữa (để trống các cấp sau), không được bỏ trống cấp giữa rồi điền cấp sau.
      </div>
      {failure && <div className="text-xs text-red-700">{failure}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>Hủy</button>
        <button type="submit" disabled={busy} className={`${btn} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}>
          {busy ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </form>
  );
};

function pickPath(r: SeatOrgRow): PathValues {
  return { ban: r.ban, don_vi: r.don_vi, phong: r.phong, doi: r.doi, to_nhom: r.to_nhom, vung: r.vung ?? '' };
}

export const SeatOrgTreeAdmin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [rows, setRows] = useState<SeatOrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<SeatOrgRow | 'new' | null>(null);
  const [banFilter, setBanFilter] = useState('');
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await seatService.orgPathsAll()).sort(byPath));
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

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

  const bans = useMemo(() => [...new Set(rows.map((r) => r.ban))].sort((a, b) => a.localeCompare(b, 'vi')), [rows]);
  const activeCount = rows.filter((r) => r.active).length;
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (showOff || r.active) && (!banFilter || r.ban === banFilter)
      && (!needle || pathText(r).toLowerCase().includes(needle)));
  }, [rows, showOff, banFilter, q]);

  const rename = (r: SeatOrgRow, k: SeatOrgLevel) => {
    const i = SEAT_ORG_LEVELS.indexOf(k);
    const n = rows.filter((p) => SEAT_ORG_LEVELS.slice(0, i + 1).every((x) => p[x] === r[x])).length;
    const to = window.prompt(`Đổi tên "${r[k]}" (${SEAT_ORG_LABEL[k]}). Áp dụng cho ${n} nhánh:`, r[k]);
    if (to === null || to.trim() === r[k]) return;
    void run(async () => `Đã đổi tên ở ${await seatService.orgRename(k, pickPath(r), to, rows)} nhánh.`);
  };
  const toggleActive = (r: SeatOrgRow) =>
    void run(async () => { await seatService.orgPathSetActive([r.id], !r.active); return r.active ? 'Đã tắt nhánh.' : 'Đã bật lại nhánh.'; });
  const remove = (r: SeatOrgRow) => {
    if (!window.confirm(`Xóa hẳn nhánh "${pathText(r)}"? Nếu nhánh từng được dùng, nên bấm Tắt thay vì xóa.`)) return;
    void run(async () => { await seatService.orgPathRemove([r.id]); return 'Đã xóa nhánh.'; });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl my-4 flex flex-col max-h-[calc(100vh-2rem)]">
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <div>
            <div className="text-sm font-semibold text-slate-800">Cây đơn vị (Ban → Đơn vị → Phòng → Đội → Tổ)</div>
            <div className="text-xs text-slate-500">
              Danh mục cho dropdown ở form mã ghế. Đổi tên, tắt hoặc xóa nhánh không sửa các dòng mã ghế đã nhập.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <select className="border border-slate-300 rounded-md px-2 py-1 text-xs max-w-[16rem]" value={banFilter} onChange={(e) => setBanFilter(e.target.value)}>
              <option value="">Tất cả Ban</option>
              {bans.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <input className="border border-slate-300 rounded-md px-2 py-1 text-xs w-52" placeholder="Tìm đơn vị, phòng, đội, tổ…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="inline-flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Hiện nhánh đã tắt
            </label>
            <span className="text-xs text-slate-500 mr-auto">
              {`${activeCount} nhánh đang dùng · ${rows.length - activeCount} đã tắt · đang hiện ${visible.length}`}
            </span>
            <button type="button" onClick={() => setEditing('new')} disabled={busy || editing !== null} className={`${btn} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}>
              <Plus className="w-3.5 h-3.5" /> Thêm nhánh
            </button>
          </div>

          {notice && (
            <div className={`rounded-md px-3 py-2 text-xs border ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {notice.text}
            </div>
          )}

          {editing && (
            <PathForm
              key={editing === 'new' ? 'new' : editing.id}
              initial={editing === 'new' ? null : editing}
              all={rows}
              onCancel={() => setEditing(null)}
              onSaved={(msg) => { setEditing(null); setNotice({ ok: true, text: msg }); void reload(); }}
            />
          )}

          <div className="text-[11px] text-slate-500">Bấm vào một giá trị để đổi tên cho mọi nhánh bên dưới nó.</div>
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {SEAT_ORG_LEVELS.map((k) => <th key={k} className="px-2 py-2 text-left whitespace-nowrap">{SEAT_ORG_LABEL[k]}</th>)}
                  <th className="px-2 py-2 text-left">Vùng</th>
                  <th className="px-2 py-2 text-left">Trạng thái</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Đang tải...</td></tr>}
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Không có nhánh nào.</td></tr>
                )}
                {!loading && visible.map((r, idx) => {
                  const prev = visible[idx - 1];
                  return (
                    <tr key={r.id} className={`border-t border-slate-100 ${r.active ? '' : 'bg-slate-50 text-slate-400'}`}>
                      {SEAT_ORG_LEVELS.map((k, i) => {
                        // Giá trị trùng dòng trên (cùng nhánh cha) in mờ để dễ nhìn cây.
                        const same = prev && SEAT_ORG_LEVELS.slice(0, i + 1).every((x) => prev[x] === r[x]);
                        return (
                          <td key={k} className="px-2 py-1.5 align-top">
                            {r[k] && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => rename(r, k)}
                                title="Đổi tên giá trị này"
                                className={`text-left hover:underline ${same ? 'text-slate-300' : ''}`}
                              >
                                {r[k]}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.vung || <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded text-[11px] ${r.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {r.active ? 'Đang dùng' : 'Đã tắt'}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-right">
                        <button type="button" title="Sửa" disabled={busy} onClick={() => setEditing(r)} className="p-1 rounded hover:bg-slate-100 text-slate-600">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" title={r.active ? 'Tắt' : 'Bật lại'} disabled={busy} onClick={() => toggleActive(r)} className="p-1 rounded hover:bg-slate-100 text-slate-600">
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" title="Xóa" disabled={busy} onClick={() => remove(r)} className="p-1 rounded hover:bg-red-50 text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

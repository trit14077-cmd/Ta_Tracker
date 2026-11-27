// Quy trình 1 – Mã ghế: admin (HRSS) sửa danh mục Vị trí theo AP → Ranking (bảng seat_positions, migration 0043).
// Mỗi vị trí 1 dòng, các ranking hiện dạng nhãn: bấm nhãn để tắt/bật, × để xóa; bấm tên để đổi tên. Quy tắc: shared/seatPositions.ts.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { seatService, SeatValidationError, type SeatPositionRow } from '../services/seatService.ts';
import { SEAT_RANKING_CODES } from '../../../shared/seatCodeRules.ts';

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';

const AddForm: React.FC<{ all: SeatPositionRow[]; onCancel: () => void; onSaved: (msg: string) => void }> = ({ all, onCancel, onSaved }) => {
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const names = useMemo(() => [...new Set(all.map((p) => p.vi_tri))].sort((a, b) => a.localeCompare(b, 'vi')), [all]);
  const toggle = (r: string) => setPicked((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFailure('');
    try {
      const n = await seatService.positionAdd(name, SEAT_RANKING_CODES.filter((r) => picked.has(r)), all);
      onSaved(`Đã thêm ${n} ranking cho vị trí.`);
    } catch (err) {
      if (err instanceof SeatValidationError) setErrors(err.errors as Record<string, string>);
      else setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-2">
      <div className="text-xs font-semibold text-slate-700">Thêm vị trí / thêm ranking cho vị trí có sẵn</div>
      <label className="block">
        <span className="block text-[11px] text-slate-600 mb-0.5">Vị trí theo AP (JOB) *</span>
        <input
          className={`w-full border rounded-md px-2 py-1 text-xs ${errors.vi_tri_ap ? 'border-red-400' : 'border-slate-300'}`}
          value={name}
          list="seat-pos-names"
          onChange={(e) => setName(e.target.value)}
        />
        <datalist id="seat-pos-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
        {errors.vi_tri_ap && <span className="block text-[11px] text-red-600 mt-0.5">{errors.vi_tri_ap}</span>}
      </label>
      <div>
        <span className="block text-[11px] text-slate-600 mb-0.5">Ranking *</span>
        <div className="flex flex-wrap gap-1.5">
          {SEAT_RANKING_CODES.map((r) => (
            <label key={r} className={`px-2 py-0.5 rounded border text-xs cursor-pointer ${picked.has(r) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 text-slate-700'}`}>
              <input type="checkbox" className="sr-only" checked={picked.has(r)} onChange={() => toggle(r)} />
              {r}
            </label>
          ))}
        </div>
        {errors.ranking_ap && <span className="block text-[11px] text-red-600 mt-0.5">{errors.ranking_ap}</span>}
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

export const SeatPositionAdmin: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [rows, setRows] = useState<SeatPositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await seatService.positionsAll());
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !adding) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding, onClose]);

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

  // Gom theo vị trí; vị trí chỉ còn cặp đã tắt thì ẩn khi không bật "Hiện ranking đã tắt".
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const m = new Map<string, SeatPositionRow[]>();
    for (const r of rows) {
      if (!showOff && !r.active) continue;
      if (needle && !r.vi_tri.toLowerCase().includes(needle)) continue;
      m.set(r.vi_tri, [...(m.get(r.vi_tri) ?? []), r]);
    }
    return [...m.entries()]
      .map(([vi_tri, list]) => ({ vi_tri, list: list.sort((a, b) => a.ranking.localeCompare(b.ranking)) }))
      .sort((a, b) => a.vi_tri.localeCompare(b.vi_tri, 'vi'));
  }, [rows, q, showOff]);
  const activePositions = new Set(rows.filter((r) => r.active).map((r) => r.vi_tri)).size;

  const rename = (viTri: string) => {
    const to = window.prompt(`Đổi tên vị trí "${viTri}" (áp dụng cho mọi ranking của vị trí):`, viTri);
    if (to === null || to.trim() === viTri) return;
    void run(async () => `Đã đổi tên ${await seatService.positionRename(viTri, to)} dòng.`);
  };
  const toggle = (r: SeatPositionRow) =>
    void run(async () => { await seatService.positionSetActive([r.id], !r.active); return r.active ? 'Đã tắt ranking.' : 'Đã bật lại ranking.'; });
  const remove = (r: SeatPositionRow) => {
    if (!window.confirm(`Xóa ranking ${r.ranking} của vị trí "${r.vi_tri}"?`)) return;
    void run(async () => { await seatService.positionRemove([r.id]); return 'Đã xóa ranking.'; });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl my-4 flex flex-col max-h-[calc(100vh-2rem)]">
        <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <div>
            <div className="text-sm font-semibold text-slate-800">Vị trí theo AP → Ranking</div>
            <div className="text-xs text-slate-500">
              TA chọn vị trí trong danh sách này, Ranking AP chỉ hiện các ranking của vị trí. Đổi tên, tắt hoặc xóa không sửa các dòng mã ghế đã nhập.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="p-1 rounded hover:bg-slate-100 text-slate-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <input className="border border-slate-300 rounded-md px-2 py-1 text-xs w-56" placeholder="Tìm vị trí…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="inline-flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Hiện ranking đã tắt
            </label>
            <span className="text-xs text-slate-500 mr-auto">{`${activePositions} vị trí đang dùng · đang hiện ${groups.length}`}</span>
            <button type="button" onClick={() => setAdding(true)} disabled={busy || adding} className={`${btn} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}>
              <Plus className="w-3.5 h-3.5" /> Thêm vị trí / ranking
            </button>
          </div>

          {notice && (
            <div className={`rounded-md px-3 py-2 text-xs border ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {notice.text}
            </div>
          )}

          {adding && (
            <AddForm
              all={rows}
              onCancel={() => setAdding(false)}
              onSaved={(msg) => { setAdding(false); setNotice({ ok: true, text: msg }); void reload(); }}
            />
          )}

          <div className="text-[11px] text-slate-500">Bấm tên vị trí để đổi tên. Bấm nhãn ranking để tắt/bật, bấm × để xóa.</div>
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-2 text-left">Vị trí theo AP (JOB)</th>
                  <th className="px-2 py-2 text-left">Ranking</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-500">Đang tải...</td></tr>}
                {!loading && groups.length === 0 && (
                  <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-500">Không có vị trí nào.</td></tr>
                )}
                {!loading && groups.map((g) => (
                  <tr key={g.vi_tri} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 align-top">
                      <button type="button" disabled={busy} onClick={() => rename(g.vi_tri)} title="Đổi tên vị trí" className="text-left hover:underline">
                        {g.vi_tri}
                      </button>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {g.list.map((r) => (
                          <span key={r.id} className={`inline-flex items-center rounded border ${r.active ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-400 line-through'}`}>
                            <button type="button" disabled={busy} onClick={() => toggle(r)} title={r.active ? 'Tắt' : 'Bật lại'} className="px-1.5 py-0.5">
                              {r.ranking}
                            </button>
                            <button type="button" disabled={busy} onClick={() => remove(r)} title="Xóa" aria-label="Xóa" className="px-1 py-0.5 text-slate-400 hover:text-red-600">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { type FieldDefinition, SECTIONS } from '../../../shared/fieldCatalog.ts';

interface Props {
  /** Every column the user may show (candidate code and name are always shown and not listed). */
  fields: FieldDefinition[];
  /** Keys currently shown, in the current order. */
  current: string[];
  onSave: (visible: string[], order: string[]) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}

/** Choose which columns of the candidate list to show and in what order. Hiding a column never deletes data. */
export const ColumnCustomizer: React.FC<Props> = ({ fields, current, onSave, onReset, onClose }) => {
  // One ordered list: the shown columns first (in their order), then the rest in catalog order.
  const [order, setOrder] = useState<string[]>(() => {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const shown = current.filter((k) => byKey.has(k));
    const rest = fields.filter((f) => !shown.includes(f.key)).map((f) => f.key);
    return [...shown, ...rest];
  });
  const [checked, setChecked] = useState<Set<string>>(() => new Set(current));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const sectionOf = (f: FieldDefinition) => SECTIONS.find((s) => s.id === f.sectionId)?.shortTitle || '';

  const move = (key: string, dir: -1 | 1) =>
    setOrder((o) => {
      const i = o.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const toggle = (key: string) =>
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không lưu được cấu hình cột.');
      setBusy(false);
    }
  };

  const shownList = order.filter((k) => {
    const f = byKey.get(k);
    if (!f) return false;
    const needle = q.trim().toLowerCase();
    return !needle || f.label.toLowerCase().includes(needle) || f.key.includes(needle);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <div className="text-sm font-bold text-slate-900">Tùy chỉnh cột</div>
            <div className="text-[11px] text-slate-500">
              Chọn cột hiển thị và sắp xếp thứ tự. Cấu hình lưu riêng cho tài khoản của bạn, ẩn cột không xóa dữ liệu.
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-500 hover:text-slate-900" title="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pt-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm cột..."
            className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
          <div className="mt-1 text-[11px] text-slate-500">
            <span>Đã chọn</span> {checked.size} / {fields.length}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto px-5 py-2 divide-y divide-slate-100">
          {shownList.map((k) => {
            const f = byKey.get(k)!;
            return (
              <li key={k} className="flex items-center gap-2 py-1.5">
                <input type="checkbox" checked={checked.has(k)} onChange={() => toggle(k)} className="rounded border-slate-300 text-blue-600" />
                <span className={`flex-1 text-sm ${checked.has(k) ? 'text-slate-900' : 'text-slate-400'}`}>{f.label}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{sectionOf(f)}</span>
                <button type="button" title="Lên" className="p-1 text-slate-500 hover:text-blue-600" onClick={() => move(k, -1)}>
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" title="Xuống" className="p-1 text-slate-500 hover:text-blue-600" onClick={() => move(k, 1)}>
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
        {error && <p className="mx-5 mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => run(onReset)} className="px-3 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-md bg-white">
            Về mặc định
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-md bg-white">
            Hủy
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onSave(order.filter((k) => checked.has(k)), order))}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            Lưu cấu hình
          </button>
        </div>
      </div>
    </div>
  );
};

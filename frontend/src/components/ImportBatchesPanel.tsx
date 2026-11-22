// M7-4: lịch sử lô nhập Excel + hoàn tác theo lô (0028, PO chốt 22/11/2026). Chỉ Admin (nằm trong màn Nhập Excel).
// Luôn chạy thử trước (xem sẽ gỡ / giữ hồ sơ nào), rồi mới cho gỡ thật sau khi xác nhận.
import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw, Undo2, X } from 'lucide-react';
import { importService, type ImportBatch, type ImportRollbackResult } from '../services/importService.ts';

const REASON: Record<string, string> = {
  EDITED: 'đã được sửa sau khi nhập',
  HAS_DATA: 'đã có bình luận / công việc / lịch / file / HR info…',
};

const fmt = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const ImportBatchesPanel: React.FC<{ refreshKey?: number; onChanged?: () => void }> = ({ refreshKey, onChanged }) => {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ batch: ImportBatch; result: ImportRollbackResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBatches(await importService.listImportBatches());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách lô nhập.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const openPreview = async (batch: ImportBatch) => {
    setBusy(true);
    setError('');
    setDone('');
    try {
      setPreview({ batch, result: await importService.rollbackImportBatch(batch.id, true) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không hoàn tác được lô nhập.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      const r = await importService.rollbackImportBatch(preview.batch.id, false);
      setDone(`Đã hoàn tác lô #${r.batch_id}: gỡ ${r.removed} hồ sơ, giữ lại ${r.kept_count} hồ sơ.`);
      setPreview(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không hoàn tác được lô nhập.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" /> Lịch sử nhập và hoàn tác theo lô
          </h3>
          <p className="text-xs text-slate-600 mt-0.5 max-w-3xl">
            Hoàn tác chỉ gỡ các hồ sơ của lô <strong>chưa bị sửa</strong> và <strong>chưa có dữ liệu kèm theo</strong>; hồ sơ khác được giữ
            nguyên. Mỗi hồ sơ bị gỡ được lưu bản chụp trong Nhật ký (IMPORT_ROLLBACK).
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Tải lại
        </button>
      </div>

      {error && <div className="mx-5 mt-3 px-3 py-2 text-xs rounded-md bg-red-50 border border-red-200 text-red-700">{error}</div>}
      {done && <div className="mx-5 mt-3 px-3 py-2 text-xs rounded-md bg-green-50 border border-green-200 text-green-800">{done}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold">
              <th className="py-2 px-3 w-14">Lô</th>
              <th className="py-2 px-3 w-32">Thời gian</th>
              <th className="py-2 px-3 w-28">Người nhập</th>
              <th className="py-2 px-3">Ghi chú</th>
              <th className="py-2 px-3 w-24 text-right">Còn trong lô</th>
              <th className="py-2 px-3 w-24 text-right">Gỡ được</th>
              <th className="py-2 px-3 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  {loading ? 'Đang tải…' : 'Chưa có lô nhập Excel nào.'}
                </td>
              </tr>
            )}
            {batches.map((b) => (
              <tr key={b.id} className="border-b border-slate-100 align-top">
                <td className="py-2 px-3 font-mono-tabular font-semibold">#{b.id}</td>
                <td className="py-2 px-3 font-mono-tabular">{fmt(b.created_at)}</td>
                <td className="py-2 px-3">{b.created_by || '—'}</td>
                <td className="py-2 px-3 text-slate-600">
                  {b.note}
                  {b.rolled_back_at && (
                    <div className="mt-0.5 text-amber-700">
                      Đã hoàn tác {fmt(b.rolled_back_at)}{b.rolled_back_by ? ` bởi ${b.rolled_back_by}` : ''}
                    </div>
                  )}
                </td>
                <td className="py-2 px-3 text-right font-mono-tabular">{b.remaining.toLocaleString('vi-VN')}</td>
                <td className="py-2 px-3 text-right font-mono-tabular">{b.removable.toLocaleString('vi-VN')}</td>
                <td className="py-2 px-3 text-right">
                  <button
                    type="button"
                    disabled={busy || b.remaining === 0}
                    onClick={() => openPreview(b)}
                    className="px-2 py-1 text-xs border border-amber-300 text-amber-800 rounded hover:bg-amber-50 disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Hoàn tác…
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">Hoàn tác lô nhập #{preview.batch.id}</h4>
              <button type="button" onClick={() => setPreview(null)} aria-label="Đóng" className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 overflow-y-auto text-xs text-slate-700">
              <p>
                Sẽ <strong className="text-red-700">gỡ {preview.result.removed.toLocaleString('vi-VN')} hồ sơ</strong> khỏi hệ thống và{' '}
                <strong>giữ lại {preview.result.kept_count.toLocaleString('vi-VN')} hồ sơ</strong>.
              </p>
              {preview.result.kept.length > 0 && (
                <div>
                  <p className="font-semibold mb-1">Hồ sơ được giữ lại:</p>
                  <ul className="border border-slate-200 rounded-md divide-y divide-slate-100 max-h-60 overflow-y-auto">
                    {preview.result.kept.map((k) => (
                      <li key={k.id} className="px-3 py-1.5 flex justify-between gap-3">
                        <span>
                          <span className="font-mono-tabular font-semibold">{k.candidate_code}</span> {k.full_name}
                        </span>
                        <span className="text-slate-500">{REASON[k.reason] || k.reason}</span>
                      </li>
                    ))}
                  </ul>
                  {preview.result.kept_count > preview.result.kept.length && (
                    <p className="mt-1 text-slate-500">… và {preview.result.kept_count - preview.result.kept.length} hồ sơ khác.</p>
                  )}
                </div>
              )}
              {preview.result.removed === 0 && <p className="text-slate-500">Không còn hồ sơ nào gỡ được trong lô này.</p>}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setPreview(null)} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md hover:bg-slate-50">
                Hủy
              </button>
              <button
                type="button"
                disabled={busy || preview.result.removed === 0}
                onClick={confirm}
                className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-40"
              >
                {busy ? 'Đang gỡ…' : `Gỡ ${preview.result.removed.toLocaleString('vi-VN')} hồ sơ`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

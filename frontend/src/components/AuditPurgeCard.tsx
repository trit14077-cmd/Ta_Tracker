// Nhật ký 12 tháng (Q7, D-10) – chỉ Admin. Hệ cũ không có; theo đặc tả: dòng cũ hơn 12 tháng xuất CSV lên Drive rồi mới xóa.
import React, { useEffect, useState } from 'react';
import { Archive, LoaderCircle } from 'lucide-react';
import { auditService } from '../services/auditService.ts';

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export const AuditPurgeCard: React.FC = () => {
  const [info, setInfo] = useState<{ before: string; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => auditService.purgePreview().then(setInfo, (e) => setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không tải được.' }));
  useEffect(() => {
    load();
  }, []);

  const run = async () => {
    if (!info || !window.confirm(`Xuất ${info.count} dòng nhật ký trước ${fmtDate(info.before)} ra Google Drive (thư mục "TA Tracker Nhật ký") rồi xóa khỏi hệ thống?`)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await auditService.purgeRun();
      setMsg({
        ok: true,
        text: `Đã xuất và xóa ${r.exported} dòng (${r.files.length} file CSV trên Drive).` + (r.remaining > 0 ? ` Còn ${r.remaining} dòng: bấm lại để tiếp tục.` : ''),
      });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không dọn được nhật ký.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div>
        <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Archive className="w-4 h-4 text-slate-600" /> Lưu trữ nhật ký cũ (chỉ Admin)
        </div>
        <p className="mt-1 text-slate-600">
          Hệ thống giữ nhật ký 12 tháng. Dòng cũ hơn được xuất ra file CSV trong Google Drive (thư mục "TA Tracker Nhật ký") rồi mới xóa.
          {info && <span data-no-i18n> {info.count} dòng trước {fmtDate(info.before)}.</span>}
        </p>
        {msg && <p className={`mt-1 ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} data-no-i18n>{msg.text}</p>}
      </div>
      <button
        type="button"
        disabled={busy || !info || info.count === 0}
        onClick={run}
        className="inline-flex items-center gap-1.5 px-3 py-2 font-semibold text-white bg-slate-800 rounded-md hover:bg-slate-900 disabled:opacity-50"
      >
        {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />} Xuất ra Drive và xóa
      </button>
    </div>
  );
};

// Chuyển từ OLD/src/components/AlertsBell.tsx (M6-3). Giữ giao diện; dữ liệu qua RPC alerts (0017).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { opsService as dataService, type AlertsData } from '../services/opsService.ts';
import { fmtIso } from './TasksView.tsx';

/**
 * The bell in the top bar: overdue tasks, tasks due today or tomorrow, candidates who passed round 2 without verified
 * HR information, and offers missing required documents. Refreshed every 5 minutes and whenever it is opened.
 */
export const AlertsBell: React.FC<{ onOpenCandidate: (id: number) => void; onGoTasks: () => void }> = ({ onOpenCandidate, onGoTasks }) => {
  const [data, setData] = useState<AlertsData | null>(() => dataService.peekAlerts()); // last time's, until the server answers
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => dataService.getAlerts().then(setData, () => undefined), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const c = data?.counts;
  // Số trên chuông chỉ tính công việc quá hạn / sắp đến hạn; hồ sơ cần xử lý nằm ở tab Công việc (chỉ nhắc 1 dòng).
  const total = c ? c.overdue + c.due_soon : 0;
  const todo = c ? c.passed_no_hr + c.missing_docs : 0;
  const group = (title: string, n: number, cls: string, body: React.ReactNode) =>
    n > 0 ? (
      <div className="py-1.5 border-t border-slate-100 first:border-t-0">
        <div className={`px-2 text-[11px] font-bold uppercase tracking-wide ${cls}`}>
          {title} ({n})
        </div>
        {body}
      </div>
    ) : null;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => { setOpen((o) => !o); if (!open) load(); }} className="relative p-1.5 rounded-md text-slate-600 hover:bg-slate-100" title="Cảnh báo" aria-label="Cảnh báo">
        <Bell className="w-4 h-4" />
        {total > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center" data-no-i18n>{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-1.5 text-xs">
          {!data && <p className="p-3 text-slate-500">Đang tải...</p>}
          {data && total === 0 && todo === 0 && <p className="p-3 text-slate-500">Không có cảnh báo nào.</p>}
          {data && (
            <>
              {group('Quá hạn', c!.overdue, 'text-red-700', data.overdue.map((t) => (
                <button key={t.id} type="button" onClick={() => { setOpen(false); if (t.candidate_id) onOpenCandidate(t.candidate_id); else onGoTasks(); }} className="block w-full text-left px-2 py-1 rounded hover:bg-slate-50" data-no-i18n>
                  <span className="font-medium text-slate-900">{t.title}</span>
                  <span className="block text-[11px] text-red-600">Hạn {fmtIso(t.due)}{t.candidate_code ? ` · ${t.candidate_code}` : ''}</span>
                </button>
              )))}
              {group('Sắp đến hạn', c!.due_soon, 'text-amber-700', data.due_soon.map((t) => (
                <button key={t.id} type="button" onClick={() => { setOpen(false); if (t.candidate_id) onOpenCandidate(t.candidate_id); else onGoTasks(); }} className="block w-full text-left px-2 py-1 rounded hover:bg-slate-50" data-no-i18n>
                  <span className="font-medium text-slate-900">{t.title}</span>
                  <span className="block text-[11px] text-slate-500">Hạn {fmtIso(t.due)} {t.due_time}{t.candidate_code ? ` · ${t.candidate_code}` : ''}</span>
                </button>
              )))}
              {todo > 0 && (
                <button type="button" onClick={() => { setOpen(false); onGoTasks(); }} className="block w-full text-left px-2 py-2 border-t border-slate-100 first:border-t-0 hover:bg-slate-50" data-no-i18n>
                  <span className="font-medium text-slate-900">{todo} hồ sơ cần xử lý</span>
                  <span className="block text-[11px] text-slate-500">
                    {c!.missing_docs} Offer thiếu giấy tờ, {c!.passed_no_hr} đạt R2 chưa có thông tin nhân sự. Xem ở tab Công việc.
                  </span>
                </button>
              )}
              {total > 0 && (
                <button type="button" onClick={() => { setOpen(false); onGoTasks(); }} className="block w-full text-center mt-1 py-1.5 text-blue-700 border-t border-slate-100 hover:bg-slate-50">
                  Mở trang Công việc
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

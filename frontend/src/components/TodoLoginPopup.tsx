// Popup ở trang đầu sau khi đăng nhập: chỉ báo SỐ LƯỢNG việc cần xử lý, không liệt kê ứng viên (chi tiết ở tab Công việc).
// Mỗi lần đăng nhập hiện một lần (nhớ trong sessionStorage), bấm "Để sau" hoặc ra ngoài để đóng.
import React, { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { opsService as dataService, type AlertsData } from '../services/opsService.ts';

export const TodoLoginPopup: React.FC<{ userId: string; onGoTasks: () => void }> = ({ userId, onGoTasks }) => {
  const key = `todo-popup:${userId}`;
  const [data, setData] = useState<AlertsData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(key)) return;
    dataService.getAlerts().then((d) => {
      const n = d.counts.overdue + d.counts.due_soon + d.counts.missing_docs + d.counts.passed_no_hr;
      if (n > 0) {
        setData(d);
        setOpen(true);
      }
      sessionStorage.setItem(key, '1');
    }, () => undefined);
  }, [key]);

  if (!open || !data) return null;
  const c = data.counts;
  const rows: [string, number][] = [
    ['Công việc quá hạn', c.overdue],
    ['Công việc sắp đến hạn', c.due_soon],
    ['Offer còn thiếu giấy tờ', c.missing_docs],
    ['Đạt R2, chưa có thông tin nhân sự', c.passed_no_hr],
  ];
  const close = () => setOpen(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden" role="dialog" aria-label="Việc cần xử lý">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Bell className="w-4 h-4 text-red-600" /> Bạn có việc cần xử lý
          </div>
          <button type="button" onClick={close} className="p-1 text-slate-500 hover:text-slate-900" title="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="px-5 py-3 divide-y divide-slate-100 text-sm">
          {rows.filter(([, n]) => n > 0).map(([label, n]) => (
            <li key={label} className="flex items-center justify-between py-2">
              <span className="text-slate-700">{label}</span>
              <span className="font-extrabold tabular-nums text-slate-900" data-no-i18n>{n.toLocaleString('vi-VN')}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50">
          <button type="button" onClick={close} className="px-3 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-md bg-white">
            Để sau
          </button>
          <button
            type="button"
            onClick={() => { close(); onGoTasks(); }}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
          >
            Xem trong Công việc
          </button>
        </div>
      </div>
    </div>
  );
};

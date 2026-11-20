// M7-6: cấu hình Google Form "THÔNG TIN NHÂN VIÊN" – giao diện chép từ thẻ tương ứng của OLD WorkspaceAdminView (màn
// Workspace đã bỏ theo D-09), nay đặt dưới trang Drop-list. Lưu vào app_settings.hr_form (chỉ Admin).
import React, { useEffect, useState } from 'react';
import { adminService as dataService, type HrFormConfig } from '../services/adminService.ts';

export const HrFormConfigCard: React.FC = () => {
  const [hrCfg, setHrCfg] = useState<HrFormConfig | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    dataService.getHrFormConfig().then(setHrCfg, () => setHrCfg(null));
  }, []);
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không thực hiện được.' });
    } finally {
      setBusy('');
    }
  };
  if (!hrCfg) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 mt-4">
      <h3 className="text-sm font-bold text-slate-900">Form thông tin nhân viên (Google Form của công ty)</h3>
      <p className="text-xs text-slate-600 mt-1">
        Nút “Link form” trong hồ sơ ứng viên đã đạt vòng 2 sao chép link này. Khi mở form thông tin nhân sự, hệ thống tự tìm câu trả lời của ứng viên trong sheet trả lời theo SĐT, rồi theo CCCD, và điền sẵn các ô còn trống. Sheet phải được chia sẻ (quyền xem) cho tài khoản Google chạy hệ thống.
      </p>
      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
        <input value={hrCfg.form_url} onChange={(e) => setHrCfg({ ...hrCfg, form_url: e.target.value })} placeholder="Link Google Form" className="px-2 py-1.5 text-xs border border-slate-300 rounded" data-no-i18n />
        <input value={hrCfg.sheet_id} onChange={(e) => setHrCfg({ ...hrCfg, sheet_id: e.target.value })} placeholder="ID hoặc link sheet trả lời" className="px-2 py-1.5 text-xs border border-slate-300 rounded" data-no-i18n />
        <div className="flex gap-2">
          <input value={hrCfg.sheet_tab} onChange={(e) => setHrCfg({ ...hrCfg, sheet_tab: e.target.value })} placeholder="Tên tab" className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded" data-no-i18n />
          <button
            type="button"
            disabled={busy !== ''}
            onClick={() =>
              run('hrcfg', async () => {
                setHrCfg(await dataService.putHrFormConfig(hrCfg));
                return 'Đã lưu cấu hình form thông tin nhân viên.';
              })
            }
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Lưu
          </button>
        </div>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
    </div>
  );
};

// Hồ sơ cần xử lý (chuyển từ chuông thông báo sang tab Công việc): ứng viên đạt R2 chưa có thông tin nhân sự,
// và Offer còn thiếu giấy tờ (kèm tên giấy tờ thiếu). Dữ liệu từ RPC alerts (0017), TA chỉ thấy hồ sơ của mình.
import React, { useCallback, useEffect, useState } from 'react';
import { opsService as dataService, type AlertsData } from '../services/opsService.ts';

type SectionKey = 'missing_docs' | 'passed_no_hr';

export const CandidateTodoPanel: React.FC<{ onOpenCandidate: (id: number) => void }> = ({ onOpenCandidate }) => {
  const [data, setData] = useState<AlertsData | null>(() => dataService.peekAlerts());
  const [open, setOpen] = useState<SectionKey>('missing_docs');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    dataService.getAlerts().then((d) => { setData(d); setError(''); }, () => setError('Không tải được danh sách hồ sơ cần xử lý.'));
  }, []);
  useEffect(load, [load]);

  const needle = q.trim().toLowerCase();
  const match = (p: { candidate_code: string; full_name: string }) =>
    !needle || p.candidate_code.toLowerCase().includes(needle) || p.full_name.toLowerCase().includes(needle);

  const missing = (data?.missing_docs ?? []).filter(match);
  const noHr = (data?.passed_no_hr ?? []).filter(match);
  const tabs: { key: SectionKey; label: string; n: number; cls: string }[] = [
    { key: 'missing_docs', label: 'Offer còn thiếu giấy tờ', n: data?.counts.missing_docs ?? 0, cls: 'text-amber-700' },
    { key: 'passed_no_hr', label: 'Đạt R2, chưa có thông tin nhân sự', n: data?.counts.passed_no_hr ?? 0, cls: 'text-blue-700' },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">Hồ sơ cần xử lý</h3>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm mã hoặc tên ứng viên..."
          className="w-60 px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setOpen(t.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${open === t.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-300 hover:bg-slate-50 ' + t.cls}`}
          >
            {t.label} <span data-no-i18n>({t.n})</span>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-500">Đang tải...</p>}
      {data && (
        <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 sticky top-0">
              <tr>
                <th className="text-left font-semibold px-3 py-2 w-28">Mã</th>
                <th className="text-left font-semibold px-3 py-2">Ứng viên</th>
                {open === 'missing_docs' && <th className="text-left font-semibold px-3 py-2">Thiếu</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(open === 'missing_docs' ? missing : noHr).map((p) => (
                <tr key={p.candidate_id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpenCandidate(p.candidate_id)} data-no-i18n>
                  <td className="px-3 py-1.5 font-mono text-slate-700">{p.candidate_code}</td>
                  <td className="px-3 py-1.5 font-medium text-slate-900">{p.full_name}</td>
                  {open === 'missing_docs' && <td className="px-3 py-1.5 text-amber-700">{(p as { detail?: string }).detail}</td>}
                </tr>
              ))}
              {(open === 'missing_docs' ? missing : noHr).length === 0 && (
                <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">Không có hồ sơ nào.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

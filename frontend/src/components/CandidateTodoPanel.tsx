// Hồ sơ cần xử lý (chuyển từ chuông thông báo sang tab Công việc): Offer còn thiếu giấy tờ, và ứng viên đạt R2
// chưa có thông tin nhân sự. Dữ liệu từ RPC alerts (0017), TA chỉ thấy hồ sơ của mình.
import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ClipboardList, FileWarning, Search, UserCog } from 'lucide-react';
import { opsService as dataService, type AlertsData } from '../services/opsService.ts';

type SectionKey = 'missing_docs' | 'passed_no_hr';

const SECTIONS: { key: SectionKey; label: string; hint: string; icon: React.ElementType; tone: string; active: string; chip: string }[] = [
  {
    key: 'missing_docs',
    label: 'Offer còn thiếu giấy tờ',
    hint: 'Cần bổ sung giấy tờ bắt buộc',
    icon: FileWarning,
    tone: 'text-amber-700',
    active: 'border-amber-400 bg-amber-50 ring-2 ring-amber-100',
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  {
    key: 'passed_no_hr',
    label: 'Đạt R2, chưa có thông tin nhân sự',
    hint: 'Gửi form và nhập thông tin nhân sự',
    icon: UserCog,
    tone: 'text-blue-700',
    active: 'border-blue-400 bg-blue-50 ring-2 ring-blue-100',
    chip: 'bg-blue-50 text-blue-800 border-blue-200',
  },
];

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

  const list = open === 'missing_docs' ? (data?.missing_docs ?? []).filter(match) : (data?.passed_no_hr ?? []).filter(match);
  const sec = SECTIONS.find((s) => s.key === open)!;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <ClipboardList className="w-4 h-4" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900 leading-tight">Hồ sơ cần xử lý</h3>
            <p className="text-[11px] text-slate-500">Bấm vào một dòng để mở hồ sơ ứng viên.</p>
          </div>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm mã hoặc tên ứng viên..."
            className="w-64 pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SECTIONS.map((s) => {
          const n = data?.counts[s.key] ?? 0;
          const on = open === s.key;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              onClick={() => setOpen(s.key)}
              className={`flex items-center gap-3 text-left rounded-lg border-2 px-4 py-3 transition-colors ${on ? s.active : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${s.tone}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-bold text-slate-900">{s.label}</span>
                <span className="block text-[11px] text-slate-500">{s.hint}</span>
              </span>
              <span className={`text-2xl font-extrabold tabular-nums ${s.tone}`} data-no-i18n>{n.toLocaleString('vi-VN')}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-500">Đang tải...</p>}
      {data && (
        <div className="max-h-[22rem] overflow-y-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10">
              <tr className="border-b border-slate-200">
                <th className="text-left font-semibold px-4 py-2 w-28">Mã</th>
                <th className="text-left font-semibold px-4 py-2 w-64">Ứng viên</th>
                <th className="text-left font-semibold px-4 py-2">{open === 'missing_docs' ? 'Giấy tờ còn thiếu' : 'Việc cần làm'}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((p) => (
                <tr key={p.candidate_id} className="group cursor-pointer odd:bg-white even:bg-slate-50/50 hover:bg-blue-50/60" onClick={() => onOpenCandidate(p.candidate_id)} data-no-i18n>
                  <td className="px-4 py-2 font-mono text-slate-600">{p.candidate_code}</td>
                  <td className="px-4 py-2 font-semibold text-slate-900">{p.full_name}</td>
                  <td className="px-4 py-2">
                    {open === 'missing_docs' ? (
                      <span className="flex flex-wrap gap-1">
                        {String((p as { detail?: string }).detail ?? '').split(',').map((d) => d.trim()).filter(Boolean).map((d) => (
                          <span key={d} className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${sec.chip}`}>{d}</span>
                        ))}
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${sec.chip}`}>Nhập thông tin nhân sự</span>
                    )}
                  </td>
                  <td className="pr-3 text-slate-300 group-hover:text-blue-600"><ChevronRight className="w-4 h-4" /></td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">{needle ? 'Không có hồ sơ nào khớp.' : 'Không có hồ sơ nào cần xử lý.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

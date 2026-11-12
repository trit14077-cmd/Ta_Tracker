import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Download, Filter, BarChart3 } from 'lucide-react';
import {
  dataService,
  DropdownDataResponse,
  FunnelReportResponse,
} from '../services/dataService.ts';

interface FunnelReportViewProps {
  dropdowns: DropdownDataResponse;
}

export const FunnelReportView: React.FC<FunnelReportViewProps> = ({ dropdowns }) => {
  const [filters, setFilters] = useState<{
    pic: string;
    source: string;
    position: string;
    site: string;
    ob_month: string;
  }>({
    pic: '',
    source: '',
    position: '',
    site: '',
    ob_month: '',
  });

  const [report, setReport] = useState<FunnelReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'pic' | 'source' | 'position'>('pic');

  const distinctSources = useMemo(() => {
    const vals = new Set(Object.values(dropdowns.subSourceMapping || {}).filter(Boolean));
    return Array.from(vals).sort();
  }, [dropdowns.subSourceMapping]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dataService.getFunnelReport(filters);
      setReport(data);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const pct = (num: number, den: number): string => {
    if (!den || den <= 0) return '0.0%';
    return `${((num / den) * 100).toFixed(1)}%`;
  };

  const s = report?.summary || {
    leads: 0,
    r1Passed: 0,
    r2Passed: 0,
    accepted: 0,
    joined: 0,
  };

  const stages = [
    { label: '1. Tổng Hồ sơ (Leads)', count: s.leads, prev: s.leads, color: 'bg-slate-800' },
    { label: '2. Đạt Vòng 1 (R1 Passed)', count: s.r1Passed, prev: s.leads, color: 'bg-blue-700' },
    { label: '3. Đạt Vòng 2 (R2 Passed)', count: s.r2Passed, prev: s.r1Passed, color: 'bg-blue-600' },
    { label: '4. Nhận Offer (Accepted)', count: s.accepted, prev: s.r2Passed, color: 'bg-teal-600' },
    { label: '5. Đã Onboard (Joined)', count: s.joined, prev: s.accepted, color: 'bg-emerald-600' },
  ];

  const activeRows =
    activeTab === 'pic'
      ? report?.byPic || []
      : activeTab === 'source'
      ? report?.bySource || []
      : report?.byPosition || [];

  return (
    <div className="space-y-5">
      {/* Header & Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              <span>Báo cáo Phễu Tuyển dụng (Recruitment Funnel)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Theo dõi tỷ lệ chuyển đổi từ Leads → R1 Passed → R2 Passed → Accepted → Joined.
            </p>
          </div>

          <a
            href={dataService.getFunnelExportUrl(filters)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất Báo cáo Phễu (.xlsx)</span>
          </a>
        </div>

        {/* Filter Controls */}
        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              PIC phụ trách
            </label>
            <select
              value={filters.pic}
              onChange={(e) => setFilters((f) => ({ ...f, pic: e.target.value }))}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
            >
              <option value="">Tất cả PIC</option>
              {(dropdowns.lists.pic || []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Nguồn chính (Source)
            </label>
            <select
              value={filters.source}
              onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
            >
              <option value="">Tất cả Nguồn</option>
              {distinctSources.map((src) => (
                <option key={src} value={src}>
                  {src}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Vị trí ứng tuyển (Position)
            </label>
            <select
              value={filters.position}
              onChange={(e) => setFilters((f) => ({ ...f, position: e.target.value }))}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
            >
              <option value="">Tất cả Vị trí</option>
              {(dropdowns.lists.position || []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Điểm làm việc (Site)
            </label>
            <select
              value={filters.site}
              onChange={(e) => setFilters((f) => ({ ...f, site: e.target.value }))}
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
            >
              <option value="">Tất cả Site</option>
              {(dropdowns.lists.site || []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Tháng Onboard (OB_Month)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={filters.ob_month}
                onChange={(e) => setFilters((f) => ({ ...f, ob_month: e.target.value }))}
                placeholder="VD: Nov'26"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-mono-tabular"
              />
              <button
                type="button"
                onClick={() =>
                  setFilters({ pic: '', source: '', position: '', site: '', ob_month: '' })
                }
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200 shrink-0"
              >
                Xóa lọc
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Visual Funnel Stages */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <h3 className="text-sm font-bold text-slate-900 mb-4">
          Biểu đồ Phễu Chuyển đổi Tổng quan
        </h3>

        {loading ? (
          <div className="py-8 text-center text-xs text-slate-500">
            Đang tổng hợp số liệu phễu tuyển dụng...
          </div>
        ) : (
          <div className="space-y-3">
            {stages.map((st, idx) => {
              const widthPct = s.leads > 0 ? Math.max(4, Math.round((st.count / s.leads) * 100)) : 0;
              return (
                <div
                  key={st.label}
                  className="grid grid-cols-1 md:grid-cols-12 items-center gap-3 py-1.5"
                >
                  <div className="md:col-span-3 text-xs font-semibold text-slate-800">
                    {st.label}
                  </div>
                  <div className="md:col-span-6 bg-slate-100 rounded-md h-7 overflow-hidden flex items-center">
                    <div
                      style={{ width: `${widthPct}%` }}
                      className={`h-full ${st.color} transition-all duration-200`}
                    />
                  </div>
                  <div className="md:col-span-3 flex items-center justify-end gap-3 font-mono-tabular text-xs">
                    <span className="font-bold text-slate-900 text-sm">{st.count}</span>
                    <span className="text-slate-500">({pct(st.count, s.leads)} tổng)</span>
                    {idx > 0 && (
                      <span className="text-blue-700 font-medium">
                        {pct(st.count, st.prev)} bước trước
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Breakdown Table by PIC / Source / Position */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span>Bảng phân tích chi tiết theo tiêu chí</span>
          </span>

          <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-md">
            <button
              type="button"
              onClick={() => setActiveTab('pic')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                activeTab === 'pic' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Theo PIC phụ trách
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('source')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                activeTab === 'source' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Theo Nguồn (Source)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('position')}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                activeTab === 'position' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Theo Vị trí (Position)
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="py-2.5 px-4">
                  {activeTab === 'pic'
                    ? 'PIC phụ trách'
                    : activeTab === 'source'
                    ? 'Nguồn tuyển dụng (Source)'
                    : 'Vị trí ứng tuyển (Position)'}
                </th>
                <th className="py-2.5 px-4 text-right">Leads</th>
                <th className="py-2.5 px-4 text-right">R1 Passed</th>
                <th className="py-2.5 px-4 text-right">R2 Passed</th>
                <th className="py-2.5 px-4 text-right">Accepted</th>
                <th className="py-2.5 px-4 text-right">Joined</th>
                <th className="py-2.5 px-4 text-right">Tỷ lệ Joined / Leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {activeRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Chưa có dữ liệu ứng viên để thống kê.
                  </td>
                </tr>
              ) : (
                activeRows.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-medium text-slate-900">{row.key}</td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold">
                      {row.leads}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular">{row.r1Passed}</td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular">{row.r2Passed}</td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular">{row.accepted}</td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-emerald-700">
                      {row.joined}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-blue-700">
                      {pct(row.joined, row.leads)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

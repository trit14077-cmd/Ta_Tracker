import React, { useState, useEffect, useCallback } from 'react';
import { History, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { FIELD_BY_KEY } from '../shared/fieldCatalog.ts';
import { dataService, AuditLogItem } from '../services/dataService.ts';

export const AuditLogView: React.FC = () => {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);

  const [candidateCode, setCandidateCode] = useState<string>('');
  const [actor, setActor] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<string>('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dataService.listAuditLogs({
        page,
        pageSize: 50,
        candidate_code: candidateCode.trim(),
        actor: actor.trim(),
        action: actionFilter,
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } finally {
      setLoading(false);
    }
  }, [page, candidateCode, actor, actionFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              <span>Nhật ký Hệ thống (Append-only Audit Log)</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Lưu vết bất biến mọi thao tác tạo mới, chỉnh sửa trường, lưu trữ và nhập Excel (Ai, Lúc nào, Trường nào, Giá trị cũ → Giá trị mới).
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono-tabular">
            Tổng bản ghi: <strong>{total}</strong>
          </span>
        </div>

        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={candidateCode}
              onChange={(e) => {
                setCandidateCode(e.target.value);
                setPage(1);
              }}
              placeholder="Lọc theo Mã ứng viên..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md"
            />
          </div>

          <input
            type="text"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              setPage(1);
            }}
            placeholder="Lọc theo tài khoản thực hiện..."
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
          />

          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
          >
            <option value="">Tất cả loại thao tác</option>
            <option value="CREATE">CREATE (Tạo mới)</option>
            <option value="UPDATE">UPDATE (Cập nhật trường)</option>
            <option value="ARCHIVE">ARCHIVE (Lưu trữ / Khôi phục)</option>
            <option value="IMPORT">IMPORT (Nhập Excel)</option>
            <option value="DROPDOWN">DROPDOWN (Danh mục)</option>
            <option value="USER">USER (Tài khoản)</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="py-2.5 px-3 w-44">Thời gian (UTC)</th>
                <th className="py-2.5 px-3 w-36">Người thực hiện</th>
                <th className="py-2.5 px-3 w-28">Hành động</th>
                <th className="py-2.5 px-3 w-36">Mã ứng viên</th>
                <th className="py-2.5 px-3 w-44">Trường thông tin</th>
                <th className="py-2.5 px-3">Giá trị cũ</th>
                <th className="py-2.5 px-3">Giá trị mới</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Đang tải nhật ký thay đổi...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Chưa có bản ghi nhật ký nào.
                  </td>
                </tr>
              ) : (
                items.map((log) => {
                  const fieldDef = FIELD_BY_KEY[log.field_key];
                  return (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono-tabular text-slate-500">
                        {log.created_at.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {log.actor_username}{' '}
                        <span className="text-slate-400">({log.actor_role})</span>
                      </td>
                      <td className="py-2 px-3 font-mono-tabular font-semibold text-blue-700">
                        {log.action}
                      </td>
                      <td className="py-2 px-3 font-mono-tabular font-semibold text-slate-900">
                        {log.candidate_code || '—'}
                      </td>
                      <td className="py-2 px-3 text-slate-700">
                        {fieldDef ? `${fieldDef.label} (${log.field_key})` : log.field_key || '—'}
                      </td>
                      <td className="py-2 px-3 text-rose-700 font-mono-tabular">
                        {log.old_value || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="py-2 px-3 text-emerald-800 font-mono-tabular">
                        {log.new_value || <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>Hiển thị tối đa 50 bản ghi mỗi trang</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 border border-slate-300 rounded bg-white disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono-tabular">
              Trang {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 border border-slate-300 rounded bg-white disabled:opacity-40"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

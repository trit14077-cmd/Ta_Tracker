import React, { useState } from 'react';
import { X, Send } from 'lucide-react';
import { candidateService, type DropdownDataResponse } from '../services/candidateService.ts';

interface ProposeDropdownModalProps {
  initialListKey?: string;
  dropdowns: DropdownDataResponse;
  onClose: () => void;
  onSuccess: () => void;
}

export const ProposeDropdownModal: React.FC<ProposeDropdownModalProps> = ({
  initialListKey = 'sub_source',
  dropdowns,
  onClose,
  onSuccess,
}) => {
  const [listKey, setListKey] = useState(initialListKey);
  const [proposedValue, setProposedValue] = useState('');
  const [parentValue, setParentValue] = useState('');
  const [mappedSource, setMappedSource] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const regions = (dropdowns.lists.region || []).filter((r) => r.active).map((r) => r.value);
  const locations = (dropdowns.lists.location || []).filter((l) => l.active).map((l) => l.value);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!proposedValue.trim()) {
      setError('Vui lòng nhập giá trị đề xuất mới.');
      return;
    }
    if (listKey === 'location' && !parentValue) {
      setError('Vui lòng chọn Vùng/Miền (Region) cha cho Tỉnh/Thành mới.');
      return;
    }
    if (listKey === 'site' && !parentValue) {
      setError('Vui lòng chọn Tỉnh/Thành (Location) cha cho Điểm làm việc mới.');
      return;
    }
    if (listKey === 'sub_source' && !mappedSource.trim()) {
      setError('Vui lòng nhập Nguồn chính (Source) tương ứng cho Sub_Source mới.');
      return;
    }

    setSubmitting(true);
    try {
      await candidateService.submitDropdownRequest({
        listKey,
        proposedValue: proposedValue.trim(),
        parentValue: parentValue.trim(),
        mappedSource: mappedSource.trim(),
        reason: reason.trim(),
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể gửi đề xuất.');
    } finally {
      setSubmitting(false);
    }
  };

  const listMeta = dropdowns.listMeta || [
    { listKey: 'sub_source', label: 'Nguồn chi tiết (Sub_Source)' },
    { listKey: 'position', label: 'Vị trí tuyển dụng (Position)' },
    { listKey: 'site', label: 'Điểm làm việc (Site / Kho)' },
    { listKey: 'location', label: 'Tỉnh / Thành phố (Location)' },
    { listKey: 'region', label: 'Vùng / Miền (Region)' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">
            Đề xuất thêm giá trị mới vào Drop-list
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Danh mục cần bổ sung
            </label>
            <select
              value={listKey}
              onChange={(e) => {
                setListKey(e.target.value);
                setParentValue('');
              }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600"
            >
              {listMeta.map((m) => (
                <option key={m.listKey} value={m.listKey}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Giá trị đề xuất thêm mới *
            </label>
            <input
              type="text"
              value={proposedValue}
              onChange={(e) => setProposedValue(e.target.value)}
              placeholder="Nhập tên tùy chọn muốn bổ sung..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            />
          </div>

          {listKey === 'location' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Thuộc Vùng / Miền (Region) *
              </label>
              <select
                value={parentValue}
                onChange={(e) => setParentValue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="">-- Chọn Vùng/Miền --</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          {listKey === 'site' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Thuộc Tỉnh / Thành (Location) *
              </label>
              <select
                value={parentValue}
                onChange={(e) => setParentValue(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="">-- Chọn Tỉnh/Thành --</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}

          {listKey === 'sub_source' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ánh xạ sang Nguồn chính (Source) *
              </label>
              <input
                type="text"
                value={mappedSource}
                onChange={(e) => setMappedSource(e.target.value)}
                placeholder="Ví dụ: Social Media, Job Board, Campus & Event..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Lý do / Ghi chú gửi Admin
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: Mở thêm cơ sở mới hoặc kênh tuyển dụng mới..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Đang gửi...' : 'Gửi đề xuất'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

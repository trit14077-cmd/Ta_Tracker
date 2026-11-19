import React from 'react';
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import { FIELD_CATALOG } from '../../../shared/fieldCatalog.ts';
import type { CandidateRecord } from '../services/candidateService.ts';

interface ConflictResolutionModalProps {
  serverRow: CandidateRecord;
  localDraft: Record<string, unknown>;
  onAcceptServerVersion: (serverRow: CandidateRecord) => void;
  onForceSaveLocalVersion: (latestRowVersion: number) => void;
  onClose: () => void;
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  serverRow,
  localDraft,
  onAcceptServerVersion,
  onForceSaveLocalVersion,
  onClose,
}) => {
  const diffs = FIELD_CATALOG.filter((f) => {
    if (f.type === 'readonly_timestamp' || f.type === 'readonly_computed') return false;
    const sVal = String(serverRow[f.key] ?? '').trim();
    const lVal = String(localDraft[f.key] ?? '').trim();
    return sVal !== lVal;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Phát hiện xung đột phiên bản (409 ROW_CONFLICT)
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Hồ sơ <span className="font-mono-tabular font-semibold">{String(serverRow.candidate_code)}</span> đã được cập nhật lên phiên bản{' '}
                <span className="font-mono-tabular font-semibold">v{serverRow.row_version}</span> bởi người dùng khác trong lúc bạn đang chỉnh sửa.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <p className="text-sm text-slate-700">
            Dưới đây là bảng so sánh giữa <strong>dữ liệu hiện tại trên máy chủ (v{serverRow.row_version})</strong> và{' '}
            <strong>dữ liệu bạn đang nhập</strong>. Vui lòng chọn cách xử lý:
          </p>

          {diffs.length === 0 ? (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded text-sm text-slate-600">
              Nội dung các trường bạn nhập giống với dữ liệu hiện tại trên máy chủ (chỉ khác số phiên bản).
            </div>
          ) : (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                    <th className="py-2.5 px-3 w-1/3">Trường thông tin</th>
                    <th className="py-2.5 px-3 w-1/3">Giá trị trên Máy chủ (v{serverRow.row_version})</th>
                    <th className="py-2.5 px-3 w-1/3">Giá trị của Bạn đang sửa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {diffs.map((field) => {
                    const sVal = String(serverRow[field.key] ?? '');
                    const lVal = String(localDraft[field.key] ?? '');
                    return (
                      <tr key={field.key} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-800">{field.label}</td>
                        <td className="py-2 px-3 text-emerald-800 bg-emerald-50/40 font-mono-tabular">
                          {sVal || <span className="text-slate-400 italic">(Trống)</span>}
                        </td>
                        <td className="py-2 px-3 text-blue-800 bg-blue-50/40 font-mono-tabular">
                          {lVal || <span className="text-slate-400 italic">(Trống)</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => onAcceptServerVersion(serverRow)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tải lại bản trên Máy chủ (Hủy sửa của tôi)</span>
          </button>
          <button
            type="button"
            onClick={() => onForceSaveLocalVersion(serverRow.row_version)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Ghi đè bằng bản của tôi (Lưu lên v{serverRow.row_version + 1})</span>
          </button>
        </div>
      </div>
    </div>
  );
};

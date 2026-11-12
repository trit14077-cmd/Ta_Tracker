import React, { useState } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  Play,
  RotateCcw,
} from 'lucide-react';
import { FIELD_BY_KEY } from '../shared/fieldCatalog.ts';
import {
  dataService,
  ImportPreviewResponse,
} from '../services/dataService.ts';

interface ImportExcelViewProps {
  onImportSuccess: () => void;
}

export const ImportExcelView: React.FC<ImportExcelViewProps> = ({
  onImportSuccess,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [committing, setCommitting] = useState<boolean>(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'valid' | 'invalid'>('all');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [commitResult, setCommitResult] = useState<{
    importedCount: number;
    skippedCount: number;
  } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setPreview(null);
    setCommitResult(null);
    setErrorMsg('');

    setLoadingPreview(true);
    try {
      const res = await dataService.previewImportFile(file);
      setPreview(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi phân tích file Excel/CSV.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCommitValidRows = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.valid).map((r) => r.data);
    if (validRows.length === 0) return;

    setCommitting(true);
    setErrorMsg('');
    try {
      const res = await dataService.commitImportRows(validRows);
      setCommitResult(res);
      onImportSuccess();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể nhập dữ liệu vào hệ thống.');
    } finally {
      setCommitting(false);
    }
  };

  const filteredRows = preview
    ? preview.rows.filter((r) => {
        if (filterMode === 'valid') return r.valid;
        if (filterMode === 'invalid') return !r.valid;
        return true;
      })
    : [];

  return (
    <div className="space-y-5">
      {/* Header & Instructions */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Nhập dữ liệu từ Excel / CSV (Dành cho Admin)
          </h2>
          <p className="text-xs text-slate-600 mt-1 max-w-3xl">
            Tự động nhận diện cột theo tên tiêu đề, kiểm tra hợp lệ toàn bộ 61 trường, tự động tách cột{' '}
            <code className="font-mono-tabular bg-slate-100 px-1 py-0.5 rounded">OB_Sub_STT</code>{' '}
            cũ (Tuyển mới / Tuyển thay thế / Tái tuyển dụng sang <code className="font-mono-tabular bg-slate-100 px-1 py-0.5 rounded">Hire_Type</code>),
            chuyển đổi giờ thập phân Excel (<code className="font-mono-tabular bg-slate-100 px-1 py-0.5 rounded">0.375 → 09:00</code>) và không bao giờ ghi đè hồ sơ đã tồn tại.
          </p>
        </div>

        <a
          href={dataService.getImportTemplateUrl()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Tải File Mẫu (.xlsx 61 cột)</span>
        </a>
      </div>

      {/* Upload Dropzone */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-8 cursor-pointer hover:border-blue-500 hover:bg-blue-50/20 transition-colors">
          <Upload className="w-8 h-8 text-blue-600 mb-2" />
          <span className="text-sm font-semibold text-slate-800">
            {selectedFile ? selectedFile.name : 'Chọn file .xlsx hoặc .csv từ máy tính'}
          </span>
          <span className="text-xs text-slate-500 mt-1">
            Hỗ trợ định dạng Microsoft Excel (.xlsx) và CSV (.csv) — tối đa 15MB
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>

        {loadingPreview && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 text-center">
            Đang đọc file, tự động ánh xạ tiêu đề cột và kiểm tra quy tắc xác thực...
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {commitResult && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-xs text-emerald-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="font-bold text-sm">
                  Đã nhập thành công {commitResult.importedCount} hồ sơ ứng viên vào cơ sở dữ liệu!
                </p>
                <p className="mt-0.5">
                  Số dòng lỗi đã bỏ qua: {commitResult.skippedCount}. Mọi thao tác đã được ghi vào Nhật ký (Audit Log).
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setSelectedFile(null);
                setCommitResult(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-white border border-emerald-300 rounded hover:bg-emerald-100"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Nhập file khác</span>
            </button>
          </div>
        )}
      </div>

      {/* Preview & Validation Summary */}
      {preview && !commitResult && (
        <div className="space-y-4">
          {/* Column Auto-Mapping Summary */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-blue-600" />
              <span>
                Kết quả tự động ánh xạ cột từ file &ldquo;{preview.fileName}&rdquo; (
                {preview.columnMapping.filter((c) => c.fieldKey).length}/
                {preview.columnMapping.length} cột khớp danh mục):
              </span>
            </h3>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {preview.columnMapping.map((col) => {
                const fDef = col.fieldKey ? FIELD_BY_KEY[col.fieldKey] : null;
                return (
                  <span
                    key={col.colIndex}
                    className={`px-2 py-0.5 rounded text-[11px] border ${
                      fDef
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    <strong>{col.header || `(Cột ${col.colIndex + 1})`}</strong> →{' '}
                    {fDef ? `${fDef.label} (#${fDef.index})` : 'Bỏ qua (Không khớp)'}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Row Validation Controls */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  filterMode === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Tất cả dòng ({preview.totalRows})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('valid')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  filterMode === 'valid'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                Hợp lệ ({preview.validCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('invalid')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  filterMode === 'invalid'
                    ? 'bg-red-600 text-white'
                    : 'bg-red-50 text-red-800 hover:bg-red-100'
                }`}
              >
                Có lỗi ({preview.invalidCount})
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={committing || preview.validCount === 0}
                onClick={handleCommitValidRows}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {committing
                    ? 'Đang nhập vào cơ sở dữ liệu...'
                    : `Chỉ nhập ${preview.validCount} dòng hợp lệ`}
                </span>
              </button>
            </div>
          </div>

          {/* Preview Rows Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-16">Dòng Excel</th>
                    <th className="py-2.5 px-3 w-28">Trạng thái</th>
                    <th className="py-2.5 px-3 w-36">Mã UV</th>
                    <th className="py-2.5 px-3 w-44">Họ và tên</th>
                    <th className="py-2.5 px-3 w-28">SĐT (Chuẩn)</th>
                    <th className="py-2.5 px-3 w-40">PIC</th>
                    <th className="py-2.5 px-3 w-40">Vị trí</th>
                    <th className="py-2.5 px-3 w-36">Hire_Type</th>
                    <th className="py-2.5 px-3">Chi tiết lỗi theo cột / Ghi chú chuẩn hóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRows.map((r) => {
                    const errEntries = Object.entries(r.errors);
                    const noticeEntries = Object.entries(r.notices);
                    return (
                      <tr
                        key={r.rowNumber}
                        className={r.valid ? 'hover:bg-slate-50' : 'bg-red-50/30 hover:bg-red-50/50'}
                      >
                        <td className="py-2 px-3 font-mono-tabular font-semibold text-slate-700">
                          #{r.rowNumber}
                        </td>
                        <td className="py-2 px-3">
                          {r.valid ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Hợp lệ</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Lỗi ({errEntries.length})</span>
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 font-mono-tabular font-semibold">
                          {r.data.candidate_code || '—'}
                        </td>
                        <td className="py-2 px-3 font-medium">{r.data.full_name || '—'}</td>
                        <td className="py-2 px-3 font-mono-tabular">{r.data.phone || '—'}</td>
                        <td className="py-2 px-3">{r.data.pic || '—'}</td>
                        <td className="py-2 px-3">{r.data.position || '—'}</td>
                        <td className="py-2 px-3">{r.data.hire_type || '—'}</td>
                        <td className="py-2 px-3 space-y-1">
                          {errEntries.map(([fKey, msg]) => {
                            const fLabel = FIELD_BY_KEY[fKey]?.label || fKey;
                            return (
                              <div key={fKey} className="text-red-700">
                                <strong>[{fLabel}]:</strong> {msg}
                              </div>
                            );
                          })}
                          {noticeEntries.map(([fKey, msg]) => (
                            <div key={fKey} className="text-blue-700">
                              {msg}
                            </div>
                          ))}
                          {errEntries.length === 0 && noticeEntries.length === 0 && (
                            <span className="text-slate-400">Đạt toàn bộ kiểm tra</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

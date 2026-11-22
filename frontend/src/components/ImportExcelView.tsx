// Chuyển từ OLD/src/components/ImportExcelView.tsx (M7-4). Giữ giao diện; dữ liệu qua importService (gasImport + Edge records-import).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  Play,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { FIELD_BY_KEY } from '../../../shared/fieldCatalog.ts';
import { ImportBatchesPanel } from './ImportBatchesPanel.tsx';
import { importService as dataService, type ImportPreviewResponse, type ImportRowItem, type ImportStatusResponse } from '../services/importService.ts';

interface ImportExcelViewProps {
  onImportSuccess: () => void;
}

type RowFilter = 'all' | 'valid' | 'invalid' | 'duplicate' | 'warning';

const MAX_UPLOAD_MB = 60;

export const ImportExcelView: React.FC<ImportExcelViewProps> = ({ onImportSuccess }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [batchesKey, setBatchesKey] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Row browser (server-side paging)
  const [filterMode, setFilterMode] = useState<RowFilter>('invalid');
  const [sheetFilter, setSheetFilter] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [rows, setRows] = useState<ImportRowItem[]>([]);
  const [rowsTotal, setRowsTotal] = useState<number>(0);
  const [rowsPages, setRowsPages] = useState<number>(1);
  const [loadingRows, setLoadingRows] = useState<boolean>(false);

  // Which sheets take part in the import
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [applyingSelection, setApplyingSelection] = useState<boolean>(false);

  // Commit progress
  const [status, setStatus] = useState<ImportStatusResponse | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const loadRows = useCallback(async () => {
    if (!preview) return;
    setLoadingRows(true);
    try {
      const res = await dataService.getImportRows(preview.batchId, {
        filter: filterMode,
        sheet: sheetFilter,
        page,
        pageSize: 50,
      });
      setRows(res.items);
      setRowsTotal(res.total);
      setRowsPages(res.totalPages);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tải danh sách dòng.');
    } finally {
      setLoadingRows(false);
    }
  }, [preview, filterMode, sheetFilter, page]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const resetAll = () => {
    stopPolling();
    setPreview(null);
    setSelectedFile(null);
    setStatus(null);
    setSelectedSheets(new Set());
    setRows([]);
    setErrorMsg('');
    setFilterMode('invalid');
    setSheetFilter('');
    setPage(1);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    resetAll();
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setErrorMsg(`File lớn hơn ${MAX_UPLOAD_MB} MB. Hãy chia nhỏ file rồi nhập lần lượt.`);
      return;
    }
    setSelectedFile(file);
    setLoadingPreview(true);
    try {
      const res = await dataService.previewImportFile(file);
      setPreview(res);
      setSelectedSheets(new Set(res.sheets.filter((s) => s.selected).map((s) => s.name)));
      setFilterMode(res.invalidCount > 0 ? 'invalid' : 'all');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi khi phân tích file Excel/CSV.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const selectionChanged =
    preview !== null &&
    (preview.sheets.filter((s) => s.selected).length !== selectedSheets.size ||
      preview.sheets.some((s) => s.selected !== selectedSheets.has(s.name)));

  const handleApplySelection = async () => {
    if (!preview) return;
    setApplyingSelection(true);
    setErrorMsg('');
    try {
      const res = await dataService.selectImportSheets(preview.batchId, Array.from(selectedSheets));
      setPreview(res);
      setSelectedSheets(new Set(res.sheets.filter((s) => s.selected).map((s) => s.name)));
      setSheetFilter('');
      setPage(1);
      setFilterMode(res.invalidCount > 0 ? 'invalid' : 'all');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể áp dụng lựa chọn sheet.');
    } finally {
      setApplyingSelection(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const ok = window.confirm(
      `Nhập ${preview.validCount.toLocaleString('vi-VN')} dòng hợp lệ vào hệ thống?\n` +
        `${preview.invalidCount.toLocaleString('vi-VN')} dòng lỗi và ${preview.duplicateCount.toLocaleString('vi-VN')} dòng trùng hoàn toàn sẽ được bỏ qua.\n` +
        'Hồ sơ đã tồn tại không bao giờ bị ghi đè.'
    );
    if (!ok) return;
    setErrorMsg('');
    try {
      await dataService.startImportCommit(preview.batchId);
      setStatus({ state: 'importing', progress: { done: 0, total: preview.validCount } });
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const st = await dataService.getImportStatus(preview.batchId);
          setStatus(st);
          if (st.state === 'done' || st.state === 'error') {
            stopPolling();
            if (st.state === 'done') {
              onImportSuccess();
              setBatchesKey((k) => k + 1);
            }
          }
        } catch (err: unknown) {
          stopPolling();
          setErrorMsg(err instanceof Error ? err.message : 'Mất kết nối khi theo dõi tiến độ nhập.');
        }
      }, 700);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể bắt đầu nhập dữ liệu.');
    }
  };

  const importing = status?.state === 'importing';
  const done = status?.state === 'done';
  const pct =
    status && status.progress.total > 0 ? Math.round((status.progress.done / status.progress.total) * 100) : 0;

  const filterButton = (mode: RowFilter, label: string, count: number, activeClass: string, idleClass: string) => (
    <button
      type="button"
      onClick={() => {
        setFilterMode(mode);
        setPage(1);
      }}
      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
        filterMode === mode ? activeClass : idleClass
      }`}
    >
      {label} ({count.toLocaleString('vi-VN')})
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Nhập dữ liệu từ Excel / CSV (Dành cho Admin)</h2>
          <p className="text-xs text-slate-600 mt-1 max-w-3xl">
            Đọc <strong>tất cả các sheet</strong> trong file (tối đa 50.000 dòng, {MAX_UPLOAD_MB} MB), tự nhận dòng
            tiêu đề và ánh xạ cột theo tên, kiểm tra hợp lệ toàn bộ 76 trường, tách cột{' '}
            <code className="font-mono-tabular bg-slate-100 px-1 py-0.5 rounded">OB_Sub_STT</code> cũ sang{' '}
            <code className="font-mono-tabular bg-slate-100 px-1 py-0.5 rounded">Hire_Type</code>, đổi giờ thập phân
            (<code className="font-mono-tabular bg-slate-100 px-1 py-0.5 rounded">0.375 → 09:00</code>). Sheet không
            nhận diện được sẽ bị bỏ qua và báo lý do. Không bao giờ ghi đè hồ sơ đã tồn tại.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            dataService.downloadImportTemplate().catch(() => undefined);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Tải File Mẫu (.xlsx 76 cột)</span>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <label
          className={`flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-8 transition-colors ${
            importing ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-blue-500 hover:bg-blue-50/20'
          }`}
        >
          <Upload className="w-8 h-8 text-blue-600 mb-2" />
          <span className="text-sm font-semibold text-slate-800">
            {selectedFile ? selectedFile.name : 'Chọn file .xlsx hoặc .csv từ máy tính'}
          </span>
          <span className="text-xs text-slate-500 mt-1">
            Microsoft Excel (.xlsx) hoặc CSV (.csv), nhiều sheet được, tối đa {MAX_UPLOAD_MB} MB
          </span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" />
        </label>

        {loadingPreview && (
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 text-center">
            Đang đọc file và kiểm tra từng dòng. File lớn có thể mất vài chục giây, vui lòng không đóng trang...
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 p-3.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {status?.state === 'error' && (
          <div className="mt-4 p-3.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            Việc nhập bị dừng giữa chừng: {status.errorMessage || 'lỗi không xác định'}. Một phần dữ liệu có thể đã
            được lưu ({status.progress.done.toLocaleString('vi-VN')}/
            {status.progress.total.toLocaleString('vi-VN')} dòng). Hãy tải file lên lại: các mã đã nhập sẽ được báo là
            đã tồn tại và bị bỏ qua, nên không bị nhập trùng.
          </div>
        )}

        {importing && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between text-xs text-blue-900 mb-2">
              <span className="font-semibold">Đang nhập vào cơ sở dữ liệu...</span>
              <span className="font-mono-tabular">
                {status!.progress.done.toLocaleString('vi-VN')} / {status!.progress.total.toLocaleString('vi-VN')} (
                {pct}%)
              </span>
            </div>
            <div className="h-2 bg-blue-100 rounded overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {done && status?.result && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-xs text-emerald-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="font-bold text-sm">
                  Đã nhập thành công {status.result.importedCount.toLocaleString('vi-VN')} hồ sơ ứng viên.
                </p>
                <p className="mt-0.5">
                  Bỏ qua {status.result.skippedCount.toLocaleString('vi-VN')} dòng lỗi và{' '}
                  {status.result.duplicateCount.toLocaleString('vi-VN')} dòng trùng hoàn toàn
                  {status.result.raceSkippedCount > 0
                    ? `, ${status.result.raceSkippedCount} dòng trùng mã phát sinh trong lúc nhập`
                    : ''}
                  . Mọi thao tác đã được ghi vào Nhật ký.
                </p>
                {preview && status.result.skippedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      dataService.downloadImportErrors(preview.batchId).catch(() => undefined);
                    }}
                    className="inline-flex items-center gap-1 mt-1 text-emerald-800 underline font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" /> Tải danh sách dòng lỗi (.xlsx)
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-white border border-emerald-300 rounded hover:bg-emerald-100 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Nhập file khác</span>
            </button>
          </div>
        )}
      </div>

      {preview && !done && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Tổng số dòng (sheet đã chọn)', value: preview.totalRows, cls: 'text-slate-900' },
              { label: 'Hợp lệ (sẽ nhập)', value: preview.validCount, cls: 'text-emerald-700' },
              { label: 'Có lỗi (bị bỏ qua)', value: preview.invalidCount, cls: 'text-red-700' },
              { label: 'Trùng hoàn toàn (bỏ qua)', value: preview.duplicateCount, cls: 'text-slate-600' },
              { label: 'Chưa có PIC (cảnh báo)', value: preview.warningCount, cls: 'text-amber-700' },
            ].map((c) => (
              <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-3">
                <div className="text-[11px] font-semibold text-slate-500">{c.label}</div>
                <div className={`text-xl font-bold font-mono-tabular ${c.cls}`}>
                  {c.value.toLocaleString('vi-VN')}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-blue-600" />
              Kết quả theo sheet của file &ldquo;{preview.fileName}&rdquo; ({preview.sheets.length} sheet,{' '}
              {preview.sheets.filter((s) => s.recognized).length} sheet nhận diện được)
            </div>
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
              <span>
                Tick các sheet muốn nhập. Dòng trùng hoàn toàn (cùng mã, họ tên, SĐT) giữa các sheet tự được bỏ qua; cùng
                mã nhưng khác người sẽ báo lỗi.
              </span>
              <button
                type="button"
                disabled={!selectionChanged || applyingSelection || importing || selectedSheets.size === 0}
                onClick={handleApplySelection}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 rounded-md hover:bg-slate-900 disabled:opacity-40 whitespace-nowrap"
              >
                {applyingSelection ? 'Đang kiểm tra lại...' : 'Áp dụng lựa chọn'}
              </button>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 w-10 text-center font-semibold">Nhập</th>
                  <th className="text-left font-semibold px-3 py-2">Sheet</th>
                  <th className="text-left font-semibold px-3 py-2">Trạng thái</th>
                  <th className="text-right font-semibold px-3 py-2">Dòng</th>
                  <th className="text-right font-semibold px-3 py-2">Hợp lệ</th>
                  <th className="text-right font-semibold px-3 py-2">Lỗi</th>
                  <th className="text-right font-semibold px-3 py-2">Trùng</th>
                  <th className="text-left font-semibold px-3 py-2">Cột khớp / không khớp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.sheets.map((sh) => (
                  <tr key={sh.name} className={sh.recognized ? '' : 'bg-amber-50/50'}>
                    <td className="px-3 py-2 text-center">
                      {sh.recognized && (
                        <input
                          type="checkbox"
                          checked={selectedSheets.has(sh.name)}
                          disabled={applyingSelection || importing}
                          onChange={(e) =>
                            setSelectedSheets((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(sh.name);
                              else next.delete(sh.name);
                              return next;
                            })
                          }
                          aria-label={`Nhập sheet ${sh.name}`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{sh.name}</td>
                    <td className="px-3 py-2">
                      {sh.recognized ? (
                        <span className="text-emerald-700 font-semibold">
                          Đã nhận (tiêu đề ở dòng {sh.headerRow})
                          {sh.codeRatio < 0.5 && (
                            <span className="block text-amber-700 font-normal">
                              Ít dòng có mã ứng viên ({Math.round(sh.codeRatio * 100)}%): có thể không phải dữ liệu ứng viên.
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-amber-800">
                          <strong>Bỏ qua:</strong> {sh.reason}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-tabular">{sh.totalRows.toLocaleString('vi-VN')}</td>
                    <td className="px-3 py-2 text-right font-mono-tabular text-emerald-700">
                      {sh.validCount.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-tabular text-red-700">
                      {sh.invalidCount.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-tabular text-slate-600">
                      {sh.duplicateCount.toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {sh.recognized ? (
                        <>
                          {sh.matchedColumns}/{sh.totalColumns} cột khớp
                          {sh.unmappedHeaders.length > 0 && (
                            <span className="text-amber-700">
                              {' '}
                              · bỏ qua: {sh.unmappedHeaders.slice(0, 6).join(', ')}
                              {sh.unmappedHeaders.length > 6 ? `, +${sh.unmappedHeaders.length - 6}` : ''}
                            </span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {filterButton('all', 'Tất cả', preview.totalRows, 'bg-slate-900 text-white', 'bg-slate-100 text-slate-700 hover:bg-slate-200')}
              {filterButton('valid', 'Hợp lệ', preview.validCount, 'bg-emerald-600 text-white', 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100')}
              {filterButton('invalid', 'Có lỗi', preview.invalidCount, 'bg-red-600 text-white', 'bg-red-50 text-red-800 hover:bg-red-100')}
              {filterButton('duplicate', 'Trùng hoàn toàn', preview.duplicateCount, 'bg-slate-600 text-white', 'bg-slate-100 text-slate-700 hover:bg-slate-200')}
              {filterButton('warning', 'Chưa có PIC', preview.warningCount, 'bg-amber-600 text-white', 'bg-amber-50 text-amber-800 hover:bg-amber-100')}
              <select
                value={sheetFilter}
                onChange={(e) => {
                  setSheetFilter(e.target.value);
                  setPage(1);
                }}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="">Tất cả sheet</option>
                {preview.sheets
                  .filter((s) => s.recognized && s.selected)
                  .map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {preview.invalidCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    dataService.downloadImportErrors(preview.batchId).catch(() => undefined);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Tải danh sách lỗi (.xlsx)</span>
                </button>
              )}
              <button
                type="button"
                disabled={importing || preview.validCount === 0}
                onClick={handleCommit}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {importing ? 'Đang nhập...' : `Chỉ nhập ${preview.validCount.toLocaleString('vi-VN')} dòng hợp lệ`}
                </span>
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-32">Sheet</th>
                    <th className="py-2.5 px-3 w-16">Dòng</th>
                    <th className="py-2.5 px-3 w-24">Trạng thái</th>
                    <th className="py-2.5 px-3 w-32">Mã UV</th>
                    <th className="py-2.5 px-3 w-40">Họ và tên</th>
                    <th className="py-2.5 px-3 w-28">SĐT (chuẩn)</th>
                    <th className="py-2.5 px-3 w-32">PIC</th>
                    <th className="py-2.5 px-3">Chi tiết lỗi theo cột / ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loadingRows && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-500">
                        Đang tải...
                      </td>
                    </tr>
                  )}
                  {!loadingRows && rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-500">
                        Không có dòng nào thuộc bộ lọc này.
                      </td>
                    </tr>
                  )}
                  {!loadingRows &&
                    rows.map((r) => {
                      const errEntries = Object.entries(r.errors);
                      const noticeEntries = Object.entries(r.notices);
                      return (
                        <tr
                          key={`${r.sheet}-${r.rowNumber}`}
                          className={r.valid ? 'hover:bg-slate-50' : 'bg-red-50/30 hover:bg-red-50/50'}
                        >
                          <td className="py-2 px-3 text-slate-700">{r.sheet}</td>
                          <td className="py-2 px-3 font-mono-tabular font-semibold text-slate-700">#{r.rowNumber}</td>
                          <td className="py-2 px-3">
                            {r.status === 'duplicate' ? (
                              <span className="inline-flex items-center gap-1 text-slate-500 font-semibold">
                                Trùng (bỏ qua)
                              </span>
                            ) : r.valid ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Hợp lệ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Lỗi ({errEntries.length})
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono-tabular font-semibold">{r.data.candidate_code || '—'}</td>
                          <td className="py-2 px-3 font-medium">{r.data.full_name || '—'}</td>
                          <td className="py-2 px-3 font-mono-tabular">{r.data.phone || '—'}</td>
                          <td className="py-2 px-3">{r.data.pic || '—'}</td>
                          <td className="py-2 px-3 space-y-1">
                            {errEntries.map(([fKey, msg]) => (
                              <div key={fKey} className="text-red-700">
                                <strong>[{FIELD_BY_KEY[fKey]?.label || fKey}]:</strong> {msg}
                              </div>
                            ))}
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
            <div className="px-4 py-2.5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                {rowsTotal.toLocaleString('vi-VN')} dòng · trang {page}/{rowsPages}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Trang trước"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={page >= rowsPages}
                  onClick={() => setPage((p) => Math.min(rowsPages, p + 1))}
                  className="p-1.5 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Trang sau"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ImportBatchesPanel refreshKey={batchesKey} onChanged={onImportSuccess} />
    </div>
  );
};

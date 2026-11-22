// M7-4: nhập Excel – thay các hàm nhập của dataService cũ. Bộ máy đọc file / ghép trùng / xem trước chạy ở trình duyệt
// (gasImport.ts, chép nguyên văn từ hệ cũ); 3 lời gọi server cũ được nối sang backend mới:
//   /api/import/existing -> RPC import_existing (0021) · /api/import/chunk, /finish -> Edge records-import.
// Server kiểm lại từng dòng bằng cùng quy tắc shared/ và không ghi đè hồ sơ có sẵn.
import { supabase } from '../lib/supabase.ts';
import { ApiError, candidateService, fnError } from './candidateService.ts';
import { FIELD_CATALOG } from '../../../shared/fieldCatalog.ts';
import { createGasImport } from './gasImport.ts';
import { downloadXlsx } from './xlsxDownload.ts';

export interface ImportBatch {
  id: number;
  created_at: string;
  created_by: string;
  note: string;
  row_count: number;
  remaining: number;
  removable: number;
  rolled_back_at: string | null;
  rolled_back_by: string;
}

export interface ImportRollbackResult {
  batch_id: number;
  dry_run: boolean;
  removed: number;
  kept_count: number;
  kept: { id: number; candidate_code: string; full_name: string; reason: 'EDITED' | 'HAS_DATA' }[];
}

export interface ImportRowItem {
  sheet: string;
  rowNumber: number;
  status: 'valid' | 'invalid' | 'duplicate';
  valid: boolean;
  errors: Record<string, string>;
  notices: Record<string, string>;
  data: Record<string, string>;
}

export interface ImportSheetReport {
  name: string;
  recognized: boolean;
  selected: boolean;
  reason: string;
  headerRow: number;
  totalRows: number;
  codeRatio: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  matchedColumns: number;
  totalColumns: number;
  unmappedHeaders: string[];
}

export interface ImportPreviewResponse {
  batchId: string;
  fileName: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  warningCount: number;
  sheets: ImportSheetReport[];
}

export interface ImportRowsResponse {
  items: ImportRowItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ImportStatusResponse {
  state: 'ready' | 'importing' | 'done' | 'error';
  progress: { done: number; total: number };
  result?: { importedCount: number; skippedCount: number; duplicateCount: number; raceSkippedCount: number };
  errorMessage?: string;
}

// Lô đang nhập (1 file mỗi lần, như hệ cũ): id lô server tạo ở lần gửi đầu, để mọi dòng của file gắn cùng import_batch_id.
let serverBatchId: number | null = null;
let fileName = '';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const body = options?.body ? JSON.parse(String(options.body)) : {};
  if (url === '/api/import/existing') {
    const { data, error } = await supabase.rpc('import_existing');
    if (error) throw new ApiError(error.code === 'PT403' ? 'Chỉ Admin được nhập Excel.' : 'Không tải được danh sách hồ sơ hiện có.', 500, error.code || 'ERROR');
    serverBatchId = null;
    return data as T;
  }
  if (url === '/api/import/chunk') {
    const { data, error } = await supabase.functions.invoke('records-import', { body: { op: 'chunk', batch_id: serverBatchId, file_name: fileName, ...body } });
    if (error) throw await fnError(error, 'Không ghi được dữ liệu nhập.');
    serverBatchId = (data as { batch_id: number }).batch_id;
    return data as T;
  }
  if (url === '/api/import/finish') {
    const { data, error } = await supabase.functions.invoke('records-import', { body: { op: 'finish', batch_id: serverBatchId, ...body } });
    if (error) throw await fnError(error, 'Không ghi được kết quả nhập.');
    return data as T;
  }
  throw new ApiError(`Không hỗ trợ ${url}`, 500, 'NOT_AVAILABLE');
}

const engine = createGasImport({
  request,
  getConfig: async () => {
    const d = await candidateService.getDropdowns();
    return { lists: d.lists, subSourceMapping: d.subSourceMapping, regionToLocations: d.regionToLocations, locationToSites: d.locationToSites };
  },
  downloadXlsx: (name, rows, sheet) => downloadXlsx(name, rows, sheet),
});

export const importService = {
  async previewImportFile(file: File): Promise<ImportPreviewResponse> {
    fileName = file.name;
    return engine.preview(file);
  },
  async selectImportSheets(batchId: string, sheets: string[]): Promise<ImportPreviewResponse> {
    return engine.select(batchId, sheets);
  },
  async getImportRows(batchId: string, params: { filter?: string; sheet?: string; page?: number; pageSize?: number }): Promise<ImportRowsResponse> {
    return engine.rows(batchId, params);
  },
  async startImportCommit(batchId: string): Promise<void> {
    return engine.start(batchId);
  },
  async getImportStatus(batchId: string): Promise<ImportStatusResponse> {
    return engine.status(batchId);
  },
  async downloadImportErrors(batchId: string): Promise<void> {
    return engine.downloadErrors(batchId);
  },
  // ===== M7-4: hoàn tác theo lô (0028) – chỉ Admin, chỉ lô nhập Excel =====
  async listImportBatches(): Promise<ImportBatch[]> {
    const { data, error } = await supabase.functions.invoke('records-import', { body: { op: 'batches' } });
    if (error) throw await fnError(error, 'Không tải được danh sách lô nhập.');
    return ((data as { batches?: ImportBatch[] })?.batches) || [];
  },
  /** dryRun = true: chỉ xem trước sẽ gỡ/giữ những gì; false: gỡ thật. */
  async rollbackImportBatch(batchId: number, dryRun: boolean): Promise<ImportRollbackResult> {
    const { data, error } = await supabase.functions.invoke('records-import', { body: { op: 'rollback', batch_id: batchId, dry_run: dryRun } });
    if (error) throw await fnError(error, 'Không hoàn tác được lô nhập.');
    return data as ImportRollbackResult;
  },
  async downloadImportTemplate(): Promise<void> {
    await downloadXlsx('TA_TRACKER_Template_76_Cot.xlsx', [FIELD_CATALOG.map((f) => f.excelHeader)], 'Template_76_Cot');
  },
};

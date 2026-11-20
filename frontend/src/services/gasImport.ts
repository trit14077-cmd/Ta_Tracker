// Chép nguyên văn từ OLD/src/services/gasImport.ts (M7-4); chỉ đổi đường dẫn import. Lời gọi server nối ở importService.ts.
/**
 * Excel/CSV import for the Google Apps Script version of the app.
 *
 * Apps Script cannot receive a file upload or keep state between calls, so everything up to the final write happens
 * in the browser: the workbook is parsed here, every sheet is mapped and validated here (with the SAME shared rules
 * as the server), and only validated rows are sent to the backend in small chunks. The backend re-validates every
 * row and never overwrites an existing candidate, so a tampered browser cannot bypass any rule.
 *
 * The behaviour mirrors the Node server import (server.ts): header detection, legacy column handling,
 * duplicate merging, sheet selection, row browsing, error download.
 */
import { FIELD_CATALOG, FIELD_BY_KEY } from '../../../shared/fieldCatalog.ts';
import {
  applyLegacyImportTransformations,
  validateAndComputeCandidate,
  sanitizeCellForSpreadsheet,
  DropdownConfigBundle,
} from '../../../shared/validation.ts';
import type {
  ImportPreviewResponse,
  ImportRowItem,
  ImportRowsResponse,
  ImportSheetReport,
  ImportStatusResponse,
} from './importService.ts';

const IMPORT_MAX_ROWS = 50000;
const IMPORT_CHUNK_SIZE = 500;
const IMPORT_HEADER_SCAN_ROWS = 10;
const IMPORT_MIN_MATCHED_COLUMNS = 5;
const IMPORT_MIN_CODE_RATIO = 0.5;

type RowStatus = 'valid' | 'invalid' | 'duplicate';
interface EngineRow extends ImportRowItem {
  raw: Record<string, string>;
}
interface ParsedSheet {
  name: string;
  rows: { rowNumber: number; raw: Record<string, string> }[];
}
interface Batch {
  id: string;
  fileName: string;
  parsed: ParsedSheet[];
  sheets: ImportSheetReport[];
  rows: EngineRow[];
  existing: Map<string, { name: string; phone: string }>;
  config: DropdownConfigBundle;
  state: 'ready' | 'importing' | 'done' | 'error';
  progress: { done: number; total: number };
  result?: ImportStatusResponse['result'];
  errorMessage?: string;
}

export interface GasImportDeps {
  request<T>(url: string, options?: RequestInit): Promise<T>;
  getConfig(): Promise<DropdownConfigBundle>;
  downloadXlsx(filename: string, rows: string[][], sheetName: string): Promise<void>;
}

function mapHeaderToFieldKey(rawHeader: string): string | null {
  // Excel headers may contain line breaks (e.g. "Employment Contract\nSigned Date") or decomposed accents
  const clean = String(rawHeader ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!clean) return null;
  for (const field of FIELD_CATALOG) {
    if (
      field.key.toLowerCase() === clean ||
      field.excelHeader.toLowerCase() === clean ||
      field.label.toLowerCase() === clean
    ) {
      return field.key;
    }
    if (field.aliases) {
      for (const alias of field.aliases) if (alias.toLowerCase() === clean) return field.key;
    }
  }
  return null;
}

function mapHeaderRow(cells: unknown[]): { colIndex: number; header: string; fieldKey: string | null }[] {
  const mapping = cells.map((h, idx) => ({
    colIndex: idx,
    header: String(h ?? '').replace(/\s+/g, ' ').trim(),
    fieldKey: mapHeaderToFieldKey(String(h ?? '')),
  }));
  // The legacy Excel names column AA "R1_CDD_FB" by mistake; it is R2_CDD_FB.
  const r1fb = mapping.filter((c) => c.fieldKey === 'r1_cdd_fb');
  if (r1fb.length > 1) r1fb[1].fieldKey = 'r2_cdd_fb';
  const seen = new Set<string>();
  for (const c of mapping) {
    if (!c.fieldKey) continue;
    if (seen.has(c.fieldKey)) c.fieldKey = null;
    else seen.add(c.fieldKey);
  }
  return mapping;
}

/** Excel serial date (days since 1899-12-30) -> "DD/MM/YYYY". */
function excelSerialToDisplayDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const d = new Date(Math.floor(serial - 25569) * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 30));

export function createGasImport(deps: GasImportDeps) {
  let batch: Batch | null = null;

  const need = (batchId: string): Batch => {
    if (!batch || batch.id !== batchId) {
      throw new Error('Không tìm thấy lô nhập. Vui lòng tải file lên lại.');
    }
    return batch;
  };

  function summary(b: Batch): ImportPreviewResponse {
    const validCount = b.rows.filter((r) => r.status === 'valid').length;
    const duplicateCount = b.rows.filter((r) => r.status === 'duplicate').length;
    return {
      batchId: b.id,
      fileName: b.fileName,
      totalRows: b.rows.length,
      validCount,
      invalidCount: b.rows.length - validCount - duplicateCount,
      duplicateCount,
      warningCount: b.rows.filter((r) => r.status === 'valid' && r.notices.pic).length,
      sheets: b.sheets,
    };
  }

  /** Same rules as applyImportSelection in server.ts. */
  function applySelection(b: Batch, selected: Set<string>): void {
    const rows: EngineRow[] = [];
    for (const rep of b.sheets) rep.selected = selected.has(rep.name);

    const evaluate = (sheet: string, rowNumber: number, raw: Record<string, string>): EngineRow => {
      const validation = validateAndComputeCandidate(applyLegacyImportTransformations(raw), b.config, { lenient: true });
      const status: RowStatus = validation.valid ? 'valid' : 'invalid';
      if (status === 'valid' && !validation.sanitized.pic) {
        validation.notices.pic =
          'Dòng chưa có PIC: không TA nào nhìn thấy dòng này, chỉ Admin thấy. Hãy bổ sung PIC nếu cần.';
      }
      return {
        sheet,
        rowNumber,
        status,
        valid: status === 'valid',
        errors: validation.errors,
        notices: validation.notices,
        data: validation.sanitized,
        raw,
      };
    };

    const firstSeen = new Map<string, { index: number; raw: Record<string, string> }>();
    for (const ps of b.parsed) {
      const rep = b.sheets.find((s) => s.name === ps.name)!;
      if (!rep.selected) continue;
      for (const item of ps.rows) {
        const row = evaluate(ps.name, item.rowNumber, { ...item.raw });
        const code = row.data.candidate_code;
        if (code) {
          const inDb = b.existing.get(code);
          const earlier = firstSeen.get(code);
          if (inDb) {
            const same =
              (!inDb.name || !row.data.full_name || inDb.name === row.data.full_name) &&
              (!inDb.phone || !row.data.phone || inDb.phone === row.data.phone);
            if (same) {
              row.status = 'duplicate';
              row.valid = false;
              row.errors = {};
              row.notices = { candidate_code: 'Đã có trong hệ thống (cùng người): bỏ qua, không ghi đè.' };
            } else {
              row.errors.candidate_code = `Mã ứng viên "${code}" đã có trong cơ sở dữ liệu nhưng là ứng viên khác (không ghi đè).`;
              row.status = 'invalid';
              row.valid = false;
            }
          } else if (earlier) {
            const first = rows[earlier.index];
            const nameOk = !first.data.full_name || !row.data.full_name || first.data.full_name === row.data.full_name;
            const phoneOk = !first.data.phone || !row.data.phone || first.data.phone === row.data.phone;
            if (nameOk && phoneOk) {
              let filled = 0;
              for (const [k, v] of Object.entries(item.raw)) {
                if (v !== '' && (earlier.raw[k] === undefined || earlier.raw[k] === '')) {
                  earlier.raw[k] = v;
                  filled += 1;
                }
              }
              if (filled > 0) {
                const prev = rows[earlier.index];
                const merged = evaluate(prev.sheet, prev.rowNumber, earlier.raw);
                merged.notices = { ...merged.notices, merge: `Đã bổ sung ${filled} ô còn trống từ ${ps.name}, dòng ${item.rowNumber}.` };
                rows[earlier.index] = merged;
              }
              const f = rows[earlier.index];
              row.status = 'duplicate';
              row.valid = false;
              row.errors = {};
              row.notices = {
                candidate_code:
                  filled > 0
                    ? `Cùng người với ${f.sheet}, dòng ${f.rowNumber}: bỏ qua dòng này, đã bổ sung ${filled} ô còn trống vào dòng đó.`
                    : `Trùng hoàn toàn với ${f.sheet}, dòng ${f.rowNumber}: bỏ qua.`,
              };
            } else {
              const f = rows[earlier.index];
              row.errors.candidate_code = `Mã ứng viên "${code}" đã dùng cho ứng viên khác ở ${f.sheet}, dòng ${f.rowNumber} (cùng mã nhưng khác họ tên hoặc SĐT).`;
              row.status = 'invalid';
              row.valid = false;
            }
          } else {
            firstSeen.set(code, { index: rows.length, raw: { ...item.raw } });
          }
        }
        rows.push(row);
      }
    }

    for (const rep of b.sheets) {
      rep.validCount = 0;
      rep.invalidCount = 0;
      rep.duplicateCount = 0;
    }
    for (const r of rows) {
      const rep = b.sheets.find((s) => s.name === r.sheet)!;
      if (r.status === 'valid') rep.validCount += 1;
      else if (r.status === 'invalid') rep.invalidCount += 1;
      else rep.duplicateCount += 1;
    }
    b.rows = rows;
  }

  async function preview(file: File): Promise<ImportPreviewResponse> {
    const XLSX = await import('xlsx');
    await tick();
    let workbook;
    try {
      workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
    } catch {
      throw new Error('Không thể đọc file Excel/CSV. Vui lòng kiểm tra định dạng file.');
    }
    if (workbook.SheetNames.length === 0) throw new Error('File tải lên không có sheet dữ liệu nào.');
    await tick();

    const parsed: ParsedSheet[] = [];
    const sheets: ImportSheetReport[] = [];
    let total = 0;

    for (const sheetName of workbook.SheetNames) {
      await tick(); // keep the page responsive between sheets
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
      const report: ImportSheetReport = {
        name: sheetName,
        recognized: false,
        selected: false,
        reason: '',
        headerRow: 0,
        totalRows: 0,
        codeRatio: 0,
        validCount: 0,
        invalidCount: 0,
        duplicateCount: 0,
        matchedColumns: 0,
        totalColumns: 0,
        unmappedHeaders: [],
      };
      if (matrix.length < 2) {
        report.reason = 'Sheet trống hoặc chỉ có một dòng.';
        sheets.push(report);
        continue;
      }
      let bestIdx = -1;
      let bestMapping: ReturnType<typeof mapHeaderRow> = [];
      let bestScore = 0;
      for (let i = 0; i < Math.min(IMPORT_HEADER_SCAN_ROWS, matrix.length); i++) {
        const mapping = mapHeaderRow(matrix[i] || []);
        const score = mapping.filter((c) => c.fieldKey).length;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
          bestMapping = mapping;
        }
      }
      const hasCode = bestMapping.some((c) => c.fieldKey === 'candidate_code');
      if (bestIdx < 0 || bestScore < IMPORT_MIN_MATCHED_COLUMNS || !hasCode) {
        report.reason = hasCode
          ? `Chỉ khớp ${bestScore} cột với danh mục (cần ít nhất ${IMPORT_MIN_MATCHED_COLUMNS}).`
          : 'Không tìm thấy cột Mã ứng viên (tiêu đề "No." hoặc "Mã ứng viên") trong các dòng đầu của sheet.';
        sheets.push(report);
        continue;
      }
      report.recognized = true;
      report.headerRow = bestIdx + 1;
      report.matchedColumns = bestScore;
      report.totalColumns = bestMapping.filter((c) => c.header).length;
      report.unmappedHeaders = bestMapping.filter((c) => c.header && !c.fieldKey).map((c) => c.header);

      const ps: ParsedSheet = { name: sheetName, rows: [] };
      let withCode = 0;
      for (let rIdx = bestIdx + 1; rIdx < matrix.length; rIdx++) {
        const cells = matrix[rIdx] || [];
        if (cells.every((c) => String(c ?? '').trim() === '')) continue;
        if (total >= IMPORT_MAX_ROWS) {
          throw new Error(`File có hơn ${IMPORT_MAX_ROWS.toLocaleString('vi-VN')} dòng dữ liệu. Hãy chia thành nhiều file nhỏ hơn rồi nhập lần lượt.`);
        }
        const raw: Record<string, string> = {};
        for (const col of bestMapping) {
          if (!col.fieldKey) continue;
          const cell = cells[col.colIndex];
          const def = FIELD_BY_KEY[col.fieldKey];
          if (def?.type === 'date' && typeof cell === 'number' && cell > 10000) {
            const asText = excelSerialToDisplayDate(cell);
            if (asText) {
              raw[col.fieldKey] = asText;
              continue;
            }
          }
          raw[col.fieldKey] = cell === null || cell === undefined ? '' : String(cell).trim();
        }
        if (raw.candidate_code) withCode += 1;
        ps.rows.push({ rowNumber: rIdx + 1, raw });
        total += 1;
      }
      report.totalRows = ps.rows.length;
      report.codeRatio = ps.rows.length > 0 ? withCode / ps.rows.length : 0;
      parsed.push(ps);
      sheets.push(report);
    }

    if (!sheets.some((s) => s.recognized)) {
      throw new Error('Không sheet nào có dòng tiêu đề khớp danh mục trường. Hãy dùng đúng tên cột như file mẫu (tải ở trang này).');
    }

    // What is already in the database (code, name, phone), so duplicates are detected without overwriting anything
    const [config, existingRes] = await Promise.all([
      deps.getConfig(),
      deps.request<{ rows: string[][] }>('/api/import/existing'),
    ]);
    const existing = new Map<string, { name: string; phone: string }>();
    for (const [code, name, phone] of existingRes.rows) existing.set(code, { name, phone });
    await tick();

    const b: Batch = {
      id: 'local-' + Date.now().toString(36),
      fileName: file.name,
      parsed,
      sheets,
      rows: [],
      existing,
      config,
      state: 'ready',
      progress: { done: 0, total: 0 },
    };
    applySelection(
      b,
      new Set(sheets.filter((s) => s.recognized && s.codeRatio >= IMPORT_MIN_CODE_RATIO).map((s) => s.name))
    );
    batch = b;
    return summary(b);
  }

  async function select(batchId: string, names: string[]): Promise<ImportPreviewResponse> {
    const b = need(batchId);
    if (b.state !== 'ready') throw new Error('Lô này đã được nhập hoặc đang nhập.');
    const recognized = new Set(b.sheets.filter((s) => s.recognized).map((s) => s.name));
    if (names.some((n) => !recognized.has(n))) throw new Error('Danh sách sheet không hợp lệ.');
    await tick();
    applySelection(b, new Set(names));
    return summary(b);
  }

  async function rows(
    batchId: string,
    params: { filter?: string; sheet?: string; page?: number; pageSize?: number }
  ): Promise<ImportRowsResponse> {
    const b = need(batchId);
    const filter = params.filter || 'all';
    const sheet = (params.sheet || '').trim();
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(10, params.pageSize || 50));
    const filtered = b.rows.filter((r) => {
      if (sheet && r.sheet !== sheet) return false;
      if (filter === 'valid') return r.status === 'valid';
      if (filter === 'invalid') return r.status === 'invalid';
      if (filter === 'duplicate') return r.status === 'duplicate';
      if (filter === 'warning') return r.status === 'valid' && Boolean(r.notices.pic);
      return true;
    });
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize).map(({ raw: _raw, ...pub }) => pub),
      total: filtered.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    };
  }

  async function start(batchId: string): Promise<void> {
    const b = need(batchId);
    if (b.state !== 'ready') throw new Error('Lô này đã được nhập hoặc đang nhập. Hãy tải file lên lại nếu cần.');
    const valid = b.rows.filter((r) => r.status === 'valid');
    if (valid.length === 0) throw new Error('Không có dòng hợp lệ nào để lưu vào hệ thống.');
    const duplicateCount = b.rows.filter((r) => r.status === 'duplicate').length;
    const invalidCount = b.rows.length - valid.length - duplicateCount;
    b.state = 'importing';
    b.progress = { done: 0, total: valid.length };

    // Runs in the background; the page polls status().
    void (async () => {
      let imported = 0;
      let rejected = 0;
      try {
        for (let i = 0; i < valid.length; i += IMPORT_CHUNK_SIZE) {
          const slice = valid.slice(i, i + IMPORT_CHUNK_SIZE);
          const res = await deps.request<{ imported: number; rejected: unknown[] }>('/api/import/chunk', {
            method: 'POST',
            body: JSON.stringify({
              rows: slice.map((r) => r.raw),
              meta: slice.map((r) => ({ sheet: r.sheet, rowNumber: r.rowNumber })),
            }),
          });
          imported += res.imported;
          rejected += res.rejected.length;
          b.progress.done = Math.min(i + IMPORT_CHUNK_SIZE, valid.length);
        }
        await deps.request('/api/import/finish', {
          method: 'POST',
          body: JSON.stringify({ fileName: b.fileName, imported, invalid: invalidCount, duplicates: duplicateCount, rejected }),
        });
        b.result = { importedCount: imported, skippedCount: invalidCount, duplicateCount, raceSkippedCount: rejected };
        b.state = 'done';
      } catch (e) {
        b.state = 'error';
        b.errorMessage = e instanceof Error ? e.message : 'Lỗi không xác định khi ghi dữ liệu.';
      }
    })();
  }

  async function status(batchId: string): Promise<ImportStatusResponse> {
    const b = need(batchId);
    return { state: b.state, progress: b.progress, result: b.result, errorMessage: b.errorMessage };
  }

  async function downloadErrors(batchId: string): Promise<void> {
    const b = need(batchId);
    const matrix: string[][] = [['Sheet', 'Dòng Excel', 'Mã ứng viên', 'Họ tên', 'PIC', 'Cột lỗi', 'Nội dung lỗi']];
    for (const r of b.rows) {
      if (r.status !== 'invalid') continue;
      for (const [fKey, msg] of Object.entries(r.errors)) {
        matrix.push([
          sanitizeCellForSpreadsheet(r.sheet),
          String(r.rowNumber),
          sanitizeCellForSpreadsheet(r.data.candidate_code),
          sanitizeCellForSpreadsheet(r.data.full_name),
          sanitizeCellForSpreadsheet(r.data.pic),
          sanitizeCellForSpreadsheet(FIELD_BY_KEY[fKey]?.excelHeader || fKey),
          sanitizeCellForSpreadsheet(msg),
        ]);
      }
    }
    await deps.downloadXlsx('TA_TRACKER_Loi_Nhap_Excel.xlsx', matrix, 'Loi_khi_nhap');
  }

  return { preview, select, rows, start, status, downloadErrors };
}

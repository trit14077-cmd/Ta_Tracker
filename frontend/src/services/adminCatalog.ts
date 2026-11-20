// M7-6: phần thuần của quản trị danh mục / View (không gọi mạng) – test: tests/functions/admin-catalog.test.ts.
import { FIELD_BY_KEY, FIELD_CATALOG } from '../../../shared/fieldCatalog.ts';

/** Các cột hồ sơ dùng danh mục listKey (fieldCatalog.dropdownListKey). PIC: đổi mã lan sang hồ sơ bằng FK cascade. */
export function dropdownColumns(listKey: string): string[] {
  if (listKey === 'pic') return [];
  return FIELD_CATALOG.filter((f) => (f as { dropdownListKey?: string }).dropdownListKey === listKey).map((f) => f.key);
}

// = VIEW_FILTER_KEYS_ / SORT_COLS_ / sanitizeViewConfig_ của Api.gs, Api2.gs
const VIEW_FILTER_KEYS = ['pic', 'position', 'site', 'source', 'r1_status', 'r2_status', 'ob_status', 'emp_status', 'ob_month', 'region', 'location', 'tenor', 'date_from', 'date_to'];
const SORT_COLS = ['id', 'created_at', 'candidate_code', 'full_name', 'position', 'site', 'pic', 'source', 'r1_date', 'r1_status', 'r2_date', 'r2_status', 'ob_date', 'ob_month', 'ob_status', 'basic_salary', 'emp_status', 'attrition_date'];

export interface ViewConfig {
  filters: Record<string, string>;
  visibleFields?: string[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export function sanitizeViewConfig(raw: unknown): { config: ViewConfig } | { error: string } {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const filtersIn = (input.filters && typeof input.filters === 'object' ? input.filters : {}) as Record<string, unknown>;
  const filters: Record<string, string> = {};
  for (const key of VIEW_FILTER_KEYS) {
    const v = String(filtersIn[key] ?? '').trim();
    if (!v) continue;
    if ((key === 'date_from' || key === 'date_to') && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'Ngày trong bộ lọc phải có dạng YYYY-MM-DD.' };
    filters[key] = v;
  }
  const config: ViewConfig = { filters };
  if (Array.isArray(input.visibleFields)) {
    const bad = input.visibleFields.map(String).find((k) => !FIELD_BY_KEY[k]);
    if (bad) return { error: `Cột "${bad}" không tồn tại trong danh mục trường.` };
    config.visibleFields = input.visibleFields.map(String);
  }
  const sortBy = String(input.sortBy ?? '').trim();
  if (sortBy) {
    if (!SORT_COLS.includes(sortBy)) return { error: `Không thể sắp xếp theo cột "${sortBy}".` };
    config.sortBy = sortBy;
    config.sortDir = String(input.sortDir ?? '').toLowerCase() === 'asc' ? 'asc' : 'desc';
  }
  return { config };
}

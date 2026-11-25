import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PipelineKpiStrip, type DraggedCandidate } from './PipelineKpiStrip.tsx';
import { boardPosition, BOARD_SUBS } from '../../../shared/pipelineRules.ts';
import {
  Search,
  Filter,
  Download,
  Plus,
  Edit3,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Check,
  X,
  Columns,
  AlertTriangle,
} from 'lucide-react';
import { FIELD_CATALOG, VISIBLE_FIELDS, SECTIONS, type FieldDefinition } from '../../../shared/fieldCatalog.ts';
import { StageBadge } from './StageBadge.tsx';
import { dupText } from '../../../shared/dup.ts';
import { ColumnCustomizer } from './ColumnCustomizer.tsx';
import {
  formatVndDisplay,
  parseDisplayDateToIso,
} from '../../../shared/validation.ts';
import {
  candidateService,
  type ColumnPrefs,
  type CandidateRecord,
  type CandidateListParams,
  type DropdownDataResponse,
  ApiError,
} from '../services/candidateService.ts';
import { canEditPic, type UserProfile } from '../services/authService.ts';
import { StatusChip } from './StatusChip.tsx';
import { SearchableSelect } from './SearchableSelect.tsx';
import { ConflictResolutionModal } from './ConflictResolutionModal.tsx';
import { CandidateFormView } from './CandidateFormView.tsx';
import { CandidateDetailModal } from './CandidateDetailModal.tsx';
import { CommentsPanel } from './CommentsPanel.tsx';
import { requiredDocuments } from '../../../shared/documentRules.ts';

interface CandidateTableViewProps {
  user: UserProfile;
  dropdowns: DropdownDataResponse;
  globalSearch: string;
  onRefreshDropdowns: () => void;
}

const STATUS_FIELD_KEYS = new Set([
  'r1_status',
  'r2_status',
  'ob_status',
  'emp_status',
]);

/** Cột hiển thị mặc định theo số thứ tự (index) trong danh mục trường; 1 = Mã ứng viên, 4 = Họ và tên đã được ghim. */
const DEFAULT_COLUMN_INDEXES = new Set([4, 5, 6, 7, 8, 13, 15]);
const TENOR_BUCKETS =['<1D', '<3D', '<7D', '<15D', '<30D', '>30D'];

export const CandidateTableView: React.FC<CandidateTableViewProps> = ({
  user,
  dropdowns,
  globalSearch,
  onRefreshDropdowns,
}) => {
  // Popups: the entry form (new / edit) and the read-only detail opened by double-clicking a row.
  const [formModal, setFormModal] = useState<{ candidate: CandidateRecord | null } | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [detailRow, setDetailRow] = useState<CandidateRecord | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const onCreateNew = () => setFormModal({ candidate: null });
  const onEditCandidate = (c: CandidateRecord) => {
    setDetailRow(null);
    setFormModal({ candidate: c });
  };
  const closeFormModal = () => {
    if (formDirty && !window.confirm('Có thay đổi chưa lưu. Đóng cửa sổ và bỏ các thay đổi?')) return;
    setFormDirty(false);
    setFormModal(null);
  };
  const [items, setItems] = useState<CandidateRecord[]>([]);
  // KPI cards (Lead, R1, SU, LU, R2, OB) above the list; rows are dragged onto them (Google version only).
  const kpiEnabled = candidateService.supportsAttachments();
  const dragRef = useRef<DraggedCandidate | null>(null);
  const [kpiKey, setKpiKey] = useState(0);
  // Clicking a KPI card shows only the candidates in that box ('' = all).
  const [box, setBox] = useState('');
  // Clicking a sub-indicator of a card shows only its candidates ('' = none). It always sits inside `box`.
  const [sub, setSub] = useState('');
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  // A remembered copy of this page is on screen and the current one is being fetched (dataService.peekCandidates).
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Sorting
  const [sortBy, setSortBy] = useState<string>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Search & Filters
  const [localSearch, setLocalSearch] = useState<string>(globalSearch);
  const [showFilters, setShowFilters] = useState<boolean>(false); // bộ lọc nâng cao ẩn mặc định, bấm nút để mở
  const [filters, setFilters] = useState<{
    pic: string;
    position: string;
    site: string;
    source: string;
    r1_status: string;
    r2_status: string;
    ob_status: string;
    emp_status: string;
    tenor: string;
    date_from_display: string;
    date_to_display: string;
    ob_month: string;
    region: string;
    location: string;
    archived: boolean;
    dup: boolean;
  }>({
    pic: '',
    position: '',
    site: '',
    source: '',
    r1_status: '',
    r2_status: '',
    ob_status: '',
    emp_status: '',
    tenor: '',
    date_from_display: '',
    date_to_display: '',
    ob_month: '',
    region: '',
    location: '',
    archived: false,
    dup: false,
  });

  // Column group (section 1..10) collapse state
  const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});

  // Saved views are no longer picked on this page (the "View" row was removed): the list shows every candidate the
  // user may see, with the filter bar and the personal column layout. Views kept in the sheet are left untouched.

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{
    rowId: number;
    fieldKey: string;
    value: string;
    error?: string;
  } | null>(null);
  const [savingInline, setSavingInline] = useState<boolean>(false);

  // Optimistic locking conflict modal state for inline edits
  const [conflictState, setConflictState] = useState<{
    serverRow: CandidateRecord;
    localDraft: Record<string, unknown>;
  } | null>(null);

  useEffect(() => {
    setLocalSearch(globalSearch);
    setPage(1);
  }, [globalSearch]);

  // Search waits until the user pauses typing: one list request per pause, not one per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState<string>(localSearch);
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(localSearch), 300);
    return () => window.clearTimeout(t);
  }, [localSearch]);

  const buildQueryParams = useCallback((): CandidateListParams => {
    const fromIso = parseDisplayDateToIso(filters.date_from_display).iso;
    const toIso = parseDisplayDateToIso(filters.date_to_display).iso;
    return {
      page,
      pageSize,
      sortBy,
      sortDir,
      search: debouncedSearch.trim(),
      pic: filters.pic,
      position: filters.position,
      site: filters.site,
      source: filters.source,
      r1_status: filters.r1_status,
      r2_status: filters.r2_status,
      ob_status: filters.ob_status,
      emp_status: filters.emp_status,
      tenor: filters.tenor,
      date_from: fromIso,
      date_to: toIso,
      ob_month: filters.ob_month.trim(),
      region: filters.region,
      location: filters.location,
      archived: filters.archived,
      dup: filters.dup,
      box: box || undefined,
      sub: sub || undefined,
    };
  }, [page, pageSize, sortBy, sortDir, debouncedSearch, filters, box, sub]);

  // Only the newest request may update the table: a slow older response must not overwrite a newer one.
  const listSeq = useRef<number>(0);
  const fetchCandidates = useCallback(async () => {
    const seq = ++listSeq.current;
    const params = buildQueryParams();
    // The copy of this page from last time is shown at once; the current one replaces it when it arrives.
    const copy = candidateService.peekCandidates(params);
    if (copy) {
      setItems(copy.items);
      setTotal(copy.total);
      setTotalPages(copy.totalPages);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }
    setErrorMsg('');
    try {
      const res = await candidateService.listCandidates(params);
      if (seq !== listSeq.current) return;
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err: unknown) {
      if (seq !== listSeq.current) return;
      setErrorMsg(err instanceof Error ? err.message : 'Không thể tải danh sách ứng viên.');
    } finally {
      if (seq === listSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [buildQueryParams]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const canUserEditRow = (row: CandidateRecord): boolean => {
    if (user.role === 'admin') return true;
    return canEditPic(user, row.pic);
  };

  const handleSort = (fieldKey: string) => {
    if (sortBy === fieldKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(fieldKey);
      setSortDir('asc');
    }
    setPage(1);
  };

  const getInlineDropdownOptions = (row: CandidateRecord, field: FieldDefinition): string[] => {
    if (!field.dropdownListKey) return [];
    const activeOpts = (dropdowns.lists[field.dropdownListKey] || [])
      .filter((o) => o.active)
      .map((o) => o.value);

    if (field.key === 'location') {
      const reg = String(row.region ?? '');
      if (!reg) return [];
      const allowed = dropdowns.regionToLocations[reg] || [];
      return activeOpts.filter((v) => allowed.includes(v));
    }
    if (field.key === 'site') {
      const loc = String(row.location ?? '');
      if (!loc) return [];
      const allowed = dropdowns.locationToSites[loc] || [];
      return activeOpts.filter((v) => allowed.includes(v));
    }
    return activeOpts;
  };

  const _startInlineEdit = (row: CandidateRecord, field: FieldDefinition) => {
    if (!canUserEditRow(row)) return;
    if (field.type === 'readonly_timestamp' || field.type === 'readonly_computed') return;
    if (field.key === 'pic' && user.role === 'pic') return;

    setEditingCell({
      rowId: row.id,
      fieldKey: field.key,
      value: String(row[field.key] ?? ''),
    });
  };

  const commitInlineEdit = async (
    row: CandidateRecord,
    fieldKey: string,
    newValue: string,
    overrideVersion?: number
  ) => {
    const currentVal = String(row[fieldKey] ?? '');
    if (newValue === currentVal && !overrideVersion) {
      setEditingCell(null);
      return;
    }

    // Build updated row payload including dependent child clearing if region or location changes
    const patchPayload: Record<string, unknown> = {
      [fieldKey]: newValue,
    };

    if (fieldKey === 'region') {
      const validLocs = dropdowns.regionToLocations[newValue] || [];
      if (row.location && !validLocs.includes(String(row.location))) {
        patchPayload.location = '';
        patchPayload.site = '';
      }
    } else if (fieldKey === 'location') {
      const validSites = dropdowns.locationToSites[newValue] || [];
      if (row.site && !validSites.includes(String(row.site))) {
        patchPayload.site = '';
      }
    }

    // Saved at once on screen: the new value shows while the server saves it; on an error the old row comes back and
    // the cell opens again with the message.
    setSavingInline(true);
    setItems((prev) => prev.map((it) => (it.id === row.id ? ({ ...it, ...patchPayload } as CandidateRecord) : it)));
    setEditingCell(null);
    try {
      const res = await candidateService.updateCandidate(row.id, {
        ...patchPayload,
        row_version: overrideVersion ?? row.row_version,
      });
      setItems((prev) => prev.map((it) => (it.id === row.id ? res.candidate : it)));
      setConflictState(null);
    } catch (err: unknown) {
      setItems((prev) => prev.map((it) => (it.id === row.id ? row : it)));
      setEditingCell({ rowId: row.id, fieldKey, value: newValue });
      if (err instanceof ApiError) {
        if (err.status === 409 && err.code === 'ROW_CONFLICT' && err.currentRow) {
          setConflictState({
            serverRow: err.currentRow,
            localDraft: { ...row, ...patchPayload },
          });
          return;
        }
        const fieldErr = err.fields?.[fieldKey] || Object.values(err.fields || {})[0] || err.message;
        setEditingCell((prev) => (prev ? { ...prev, error: fieldErr } : null));
      } else {
        setEditingCell((prev) =>
          prev ? { ...prev, error: 'Lỗi lưu dữ liệu.' } : null
        );
      }
    } finally {
      setSavingInline(false);
    }
  };

  // The row's second action button opens the internal comments of that candidate (archiving moved to the detail popup).
  const [commentRow, setCommentRow] = useState<CandidateRecord | null>(null);

  // Distinct Sources from subSourceMapping
  const distinctSources = useMemo(() => {
    const vals = new Set(Object.values(dropdowns.subSourceMapping || {}).filter(Boolean));
    return Array.from(vals).sort();
  }, [dropdowns.subSourceMapping]);

  // Compute visible columns based on collapsed column groups; always keep candidate_code and full_name pinned
  const pinnedFields = useMemo(
    () => FIELD_CATALOG.filter((f) => f.pinned),
    []
  );
  // Personal column layout (saved on the server per user). When set it replaces the view / group choice.
  const [colPrefs, setColPrefs] = useState<ColumnPrefs>(() => candidateService.peekColumnPrefs() || { visible: null, order: [] });
  const [showCols, setShowCols] = useState(false);
  useEffect(() => {
    Promise.resolve(candidateService.getColumnPrefs()).then(setColPrefs).catch(() => undefined);
  }, []);
  const customCols = colPrefs.visible !== null;
  const scrollableFields = useMemo(() => {
    if (colPrefs.visible !== null) {
      const want = new Set(colPrefs.visible);
      const rank = new Map(colPrefs.order.map((k, i) => [k, i]));
      return VISIBLE_FIELDS.filter((f) => !f.pinned && want.has(f.key)).sort(
        (a, b) => (rank.get(a.key) ?? 9999) - (rank.get(b.key) ?? 9999) || a.index - b.index
      );
    }
    // Mặc định: chỉ các cột số 4, 5, 6, 7, 8, 13, 15 của danh mục (cột 1 và 4 được ghim). TA tự thêm cột khác ở "Tùy chỉnh cột".
    return VISIBLE_FIELDS.filter((f) => !f.pinned && DEFAULT_COLUMN_INDEXES.has(f.index) && !collapsedGroups[f.sectionId]);
  }, [collapsedGroups, colPrefs]);

  const [exporting, setExporting] = useState<boolean>(false);
  const handleExport = async () => {
    setExporting(true);
    setErrorMsg('');
    try {
      await candidateService.downloadCandidatesExport(buildQueryParams());
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể xuất file Excel.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {kpiEnabled && (
        <PipelineKpiStrip
          pic={user.role === 'admin' ? filters.pic : ''}
          refreshKey={kpiKey}
          dragRef={dragRef}
          activeBox={box}
          activeSub={sub}
          onSelectBox={(b) => {
            // From a sub-indicator to its whole card: keep the card; otherwise toggle it.
            setBox((cur) => (cur === b && !sub ? '' : b));
            setSub('');
            setPage(1);
          }}
          onSelectSub={(s) => {
            // s may be one sub-indicator or a group (the R2 card = Passed, Failed, Canceled), all inside one box.
            const col = BOARD_SUBS.find((x) => x.key === s.split(',')[0])?.col || '';
            if (sub === s) {
              setSub('');
              setBox('');
            } else {
              setSub(s);
              setBox(col);
            }
            setPage(1);
          }}
          onMoved={() => {
            fetchCandidates();
            setKpiKey((k) => k + 1);
          }}
        />
      )}

      {/* Action & Filter Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
        {/* One search box only: the one in the top bar (it feeds this list). New candidate on the left. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nhập ứng viên mới</span>
            </button>
            {localSearch.trim() && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                Đang tìm: <strong className="text-slate-900" data-no-i18n>{localSearch.trim()}</strong>
                <span className="text-slate-400">(ô tìm kiếm ở thanh trên cùng)</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${showFilters
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Bộ lọc nâng cao</span>
            </button>

            <button
              type="button"
              disabled={exporting}
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exporting ? 'Đang xuất...' : 'Xuất Excel (76 cột)'}</span>
            </button>
          </div>
        </div>

        {/* Multi-criteria Filter Bar */}
        {showFilters && (
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                PIC phụ trách
              </label>
              <select
                value={filters.pic}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, pic: e.target.value }));
                  setPage(1);
                }}
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
                Vị trí (Position)
              </label>
              <select
                value={filters.position}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, position: e.target.value }));
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Tất cả vị trí</option>
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
                onChange={(e) => {
                  setFilters((f) => ({ ...f, site: e.target.value }));
                  setPage(1);
                }}
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
                Nguồn chính (Source)
              </label>
              <select
                value={filters.source}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, source: e.target.value }));
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Tất cả Nguồn</option>
                {distinctSources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Kết quả V1 (R1_STT)
              </label>
              <select
                value={filters.r1_status}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, r1_status: e.target.value }));
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Tất cả R1_STT</option>
                {(dropdowns.lists.r1_status || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Kết quả V2 (R2_STT)
              </label>
              <select
                value={filters.r2_status}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, r2_status: e.target.value }));
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Tất cả R2_STT</option>
                {(dropdowns.lists.r2_status || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Trạng thái OB (OB Status)
              </label>
              <select
                value={filters.ob_status}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, ob_status: e.target.value }));
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Tất cả OB Status</option>
                {(dropdowns.lists.ob_status || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Làm việc (Emp_STT)
              </label>
              <select
                value={filters.emp_status}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, emp_status: e.target.value }));
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Tất cả Emp_STT</option>
                {(dropdowns.lists.emp_status || []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Thâm niên (Tenor)
              </label>
              <select
                value={filters.tenor}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, tenor: e.target.value }));
                  setPage(1);
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="">Tất cả Tenor</option>
                {TENOR_BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Tháng OB (VD: Nov&apos;26)
              </label>
              <input
                type="text"
                value={filters.ob_month}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, ob_month: e.target.value }));
                  setPage(1);
                }}
                placeholder="VD: Nov'26"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Từ ngày (DD/MM/YYYY)
              </label>
              <input
                type="text"
                value={filters.date_from_display}
                onChange={(e) => {
                  setFilters((f) => ({ ...f, date_from_display: e.target.value }));
                  setPage(1);
                }}
                placeholder="01/11/2026"
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Đến ngày (DD/MM/YYYY)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={filters.date_to_display}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, date_to_display: e.target.value }));
                    setPage(1);
                  }}
                  placeholder="30/11/2026"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white font-mono-tabular"
                />
                <button
                  type="button"
                  title="Xóa toàn bộ bộ lọc"
                  onClick={() => {
                    setFilters({
                      pic: '',
                      position: '',
                      site: '',
                      source: '',
                      r1_status: '',
                      r2_status: '',
                      ob_status: '',
                      emp_status: '',
                      tenor: '',
                      date_from_display: '',
                      date_to_display: '',
                      ob_month: '',
                      region: '',
                      location: '',
                      archived: false,
                      dup: false,
                    });
                    setLocalSearch('');
                    setPage(1);
                  }}
                  className="px-2 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded hover:bg-slate-200 shrink-0"
                >
                  Xóa lọc
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Column Groups Bar (10 sections) */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowCols(true)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border mr-1 ${customCols ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'
              }`}
            title={customCols ? 'Đang dùng cột tùy chỉnh' : 'Tùy chỉnh cột'}
          >
            <Columns className="w-3.5 h-3.5" /> Tùy chỉnh cột
          </button>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 mr-1">
            <Columns className="w-3.5 h-3.5" />
            <span>Nhóm cột (Click để ẩn/hiện):</span>
          </span>
          {SECTIONS.map((sec) => {
            const isHidden = Boolean(collapsedGroups[sec.id]);
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() =>
                  setCollapsedGroups((prev) => ({
                    ...prev,
                    [sec.id]: !prev[sec.id],
                  }))
                }
                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap ${isHidden
                  ? 'bg-slate-100 text-slate-400 border-slate-200 line-through'
                  : 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                  }`}
              >
                {sec.shortTitle}
              </button>
            );
          })}

          <label className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.dup}
              onChange={(e) => {
                setFilters((f) => ({ ...f, dup: e.target.checked }));
                setPage(1);
              }}
              className="rounded border-red-300 text-red-600"
            />
            <span>Chỉ hiện hồ sơ trùng SĐT</span>
          </label>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.archived}
              onChange={(e) => {
                setFilters((f) => ({ ...f, archived: e.target.checked }));
                setPage(1);
              }}
              className="rounded border-slate-300 text-blue-600"
            />
            <span>Hiện cả hồ sơ đã lưu trữ</span>
          </label>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* High-Density 61-Column Data Grid with Pinned Code & Name */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto relative">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                {/* Action column pinned at left 0 */}
                <th className="sticky left-0 z-20 bg-slate-100 py-2.5 px-2.5 border-r border-slate-200 w-[84px] min-w-[84px] text-center">
                  Thao tác
                </th>

                {/* Pinned Candidate Code */}
                {pinnedFields.map((pf, idx) => {
                  const leftOffset = idx === 0 ? 'left-[84px]' : 'left-[224px]';
                  const widthCls = idx === 0 ? 'w-[140px] min-w-[140px]' : 'w-[190px] min-w-[190px]';
                  return (
                    <th
                      key={pf.key}
                      onClick={() => handleSort(pf.key)}
                      className={`sticky ${leftOffset} z-20 bg-slate-100 py-2.5 px-3 border-r border-slate-200 ${widthCls} cursor-pointer hover:bg-slate-200/70 select-none`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">
                          <span className="text-slate-400 font-mono-tabular mr-1">
                            #{pf.index}
                          </span>
                          {pf.label}
                        </span>
                        <ArrowUpDown className="w-3 h-3 text-slate-400 shrink-0" />
                      </div>
                    </th>
                  );
                })}

                {/* Scrollable Fields */}
                {scrollableFields.map((field) => (
                  <th
                    key={field.key}
                    style={{ minWidth: field.width || 140 }}
                    onClick={() => handleSort(field.key)}
                    className="py-2.5 px-3 border-r border-slate-200 cursor-pointer hover:bg-slate-200/60 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span>
                        <span className="text-slate-400 font-mono-tabular mr-1">
                          #{field.index}
                        </span>
                        {field.label}
                      </span>
                      <ArrowUpDown className="w-3 h-3 text-slate-400 shrink-0" />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {loading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="py-3 px-3 bg-slate-50 border-r border-slate-100" />
                    <td className="py-3 px-3 bg-slate-50 border-r border-slate-100">
                      <div className="h-3.5 bg-slate-200 rounded w-20" />
                    </td>
                    <td className="py-3 px-3 bg-slate-50 border-r border-slate-100">
                      <div className="h-3.5 bg-slate-200 rounded w-32" />
                    </td>
                    {scrollableFields.slice(0, 8).map((f) => (
                      <td key={f.key} className="py-3 px-3 border-r border-slate-100">
                        <div className="h-3.5 bg-slate-100 rounded w-24" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={3 + scrollableFields.length}
                    className="py-12 px-6 text-center text-slate-500"
                  >
                    <p className="text-sm font-semibold text-slate-700">
                      Chưa có hồ sơ ứng viên nào khớp với điều kiện tìm kiếm
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Nhấn &ldquo;Nhập ứng viên mới&rdquo; để thêm hồ sơ đầu tiên hoặc điều chỉnh bộ lọc tìm kiếm.
                    </p>
                    <button
                      type="button"
                      onClick={onCreateNew}
                      className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Nhập ứng viên mới</span>
                    </button>
                  </td>
                </tr>
              ) : (
                items.map((row) => {
                  const editable = canUserEditRow(row);
                  const renderCell = (field: FieldDefinition, isPinnedIdx?: number) => {
                    const isEditingThis =
                      editingCell?.rowId === row.id && editingCell?.fieldKey === field.key;
                    const rawVal = String(row[field.key] ?? '');
                    const _isReadonly =
                      field.type === 'readonly_timestamp' ||
                      field.type === 'readonly_computed' ||
                      (field.key === 'pic' && user.role === 'pic');

                    const stickyClass =
                      isPinnedIdx === 0
                        ? 'sticky left-[84px] z-10 bg-white group-hover:bg-slate-50 w-[140px] min-w-[140px] font-mono-tabular font-semibold text-slate-900'
                        : isPinnedIdx === 1
                          ? 'sticky left-[224px] z-10 bg-white group-hover:bg-slate-50 w-[190px] min-w-[190px] font-semibold text-slate-900'
                          : '';

                    if (isEditingThis) {
                      return (
                        <td
                          key={field.key}
                          className={`py-1.5 px-2 border-r border-slate-200 bg-blue-50/50 align-top ${stickyClass}`}
                        >
                          <div className="space-y-1 min-w-[150px]">
                            {field.type === 'dropdown' ||
                              field.type === 'dependent_dropdown' ||
                              field.type === 'time' ? (
                              <SearchableSelect
                                compact
                                value={editingCell.value}
                                options={getInlineDropdownOptions(row, field)}
                                onChange={(val) =>
                                  commitInlineEdit(row, field.key, val)
                                }
                              />
                            ) : (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  autoFocus
                                  disabled={savingInline}
                                  value={editingCell.value}
                                  onChange={(e) =>
                                    setEditingCell((prev) =>
                                      prev ? { ...prev, value: e.target.value, error: undefined } : null
                                    )
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitInlineEdit(row, field.key, editingCell.value);
                                    } else if (e.key === 'Escape') {
                                      setEditingCell(null);
                                    }
                                  }}
                                  className="w-full px-2 py-1 text-xs bg-white border border-blue-500 rounded focus:outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={savingInline}
                                  onClick={() =>
                                    commitInlineEdit(row, field.key, editingCell.value)
                                  }
                                  className="p-1 text-white bg-blue-600 rounded hover:bg-blue-700"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCell(null)}
                                  className="p-1 text-slate-500 bg-slate-200 rounded hover:bg-slate-300"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            {editingCell.error && (
                              <p className="text-[11px] text-red-600 leading-tight">
                                {editingCell.error}
                              </p>
                            )}
                          </div>
                        </td>
                      );
                    }

                    const isMono =
                      field.type === 'phone' ||
                      field.type === 'date' ||
                      field.type === 'time' ||
                      field.type === 'money' ||
                      field.type === 'percentage' ||
                      field.type === 'readonly_timestamp' ||
                      field.key === 'ob_month' ||
                      field.key === 'tenor';

                    return (
                      <td
                        key={field.key}
                        title={row.dup && (field.key === 'full_name' || field.key === 'phone') ? dupText(row.dup) : undefined}
                        style={row.dup && (field.key === 'full_name' || field.key === 'phone') ? { backgroundColor: '#fef2f2', color: '#b91c1c', fontWeight: 600 } : undefined}
                        className={`py-2 px-3 border-r border-slate-200 whitespace-nowrap ${stickyClass} ${isMono ? 'font-mono-tabular' : ''
                          } ${field.type === 'money' || field.type === 'percentage' ? 'text-right' : ''} ${''
                          }`}
                      >
                        {STATUS_FIELD_KEYS.has(field.key) ? (
                          <StatusChip value={rawVal} />
                        ) : field.type === 'money' ? (
                          rawVal ? (
                            `${formatVndDisplay(rawVal)} ₫`
                          ) : (
                            <span className="text-slate-300">—</span>
                          )
                        ) : field.type === 'percentage' ? (
                          rawVal ? (
                            `${rawVal}%`
                          ) : (
                            <span className="text-slate-300">—</span>
                          )
                        ) : field.type === 'document' ? (
                          rawVal ? (
                            <span>{rawVal.includes('|') ? rawVal.split('|')[1] : 'Đã nộp'}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )
                        ) : rawVal ? (
                          <span>{rawVal}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                        {field.key === 'full_name' &&
                          /^(Accepted|Joined)$/.test(String(row.ob_status || '')) &&
                          requiredDocuments(String(row.position || ''), String(row.rank || '')).some((k) => !String(row[k] || '')) && (
                            <span
                              className="ml-2 px-1.5 py-0.5 text-[10px] font-bold text-red-700 bg-red-100 rounded"
                              title="Thiếu giấy tờ bắt buộc (mục 9)"
                            >
                              Thiếu giấy tờ
                            </span>
                          )}
                        {field.key === 'full_name' && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <StageBadge candidate={row as unknown as Record<string, unknown>} />
                            {row.cccd_dup && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200"
                                title={dupText(row.cccd_dup).replace('số điện thoại', 'số CCCD')}
                              >
                                Trùng CCCD
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  };

                  const pos = boardPosition(row as unknown as Record<string, unknown>);
                  const canDrag = kpiEnabled && editable && !row.is_archived;
                  return (
                    <tr
                      key={row.id}
                      draggable={canDrag}
                      onDragStart={(e) => {
                        dragRef.current = { id: Number(row.id), row_version: Number(row.row_version), full_name: String(row.full_name || ''), col: pos.col, failedAt: pos.failedAt };
                        e.dataTransfer.setData('text/plain', String(row.id));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        dragRef.current = null;
                      }}
                      onDoubleClick={() => {
                        setDetailError('');
                        setDetailRow(row);
                      }}
                      title={canDrag ? 'Kéo thả vào thẻ R1 / SU / LU / OB ở trên để chuyển bước. Nhấp đúp để xem toàn bộ thông tin' : 'Nhấp đúp để xem toàn bộ thông tin'}
                      className={`group transition-colors cursor-pointer ${row.is_archived ? 'bg-slate-100/70 text-slate-400' : 'hover:bg-slate-50'
                        }`}
                    >
                      {/* Row Action Cell */}
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 py-2 px-2 border-r border-slate-200 text-center">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onEditCandidate(row)}
                            title={
                              editable
                                ? 'Mở biểu mẫu chỉnh sửa chi tiết'
                                : 'Xem chi tiết hồ sơ (Chỉ xem)'
                            }
                            className="p-1 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCommentRow(row);
                            }}
                            title="Bình luận nội bộ về hồ sơ này"
                            aria-label={`Bình luận về ${String(row.full_name || row.candidate_code)}`}
                            className="p-1 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* Pinned Code & Full Name */}
                      {pinnedFields.map((pf, idx) => renderCell(pf, idx))}

                      {/* Scrollable Columns */}
                      {scrollableFields.map((f) => renderCell(f))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span>
              Tổng số: <strong className="font-mono-tabular text-slate-900">{total}</strong> ứng viên
            </span>
            {refreshing && (
              <span className="inline-flex items-center gap-1 text-blue-700" title="Đang hiện dữ liệu lần trước, bản mới nhất đang được tải">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
                Đang cập nhật…
              </span>
            )}
            <span>·</span>
            <span>
              Gợi ý: Nhấp đúp vào ô bất kỳ (thuộc PIC của bạn) để sửa trực tiếp.
            </span>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
            >
              <option value={25}>25 dòng / trang</option>
              <option value={50}>50 dòng / trang</option>
              <option value={100}>100 dòng / trang</option>
            </select>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-2.5 font-mono-tabular font-medium text-slate-800">
                Trang {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {showCols && (
        <ColumnCustomizer
          fields={VISIBLE_FIELDS.filter((f) => !f.pinned)}
          current={scrollableFields.map((f) => f.key)}
          onSave={async (visible, order) => setColPrefs(candidateService.setColumnPrefs({ visible, order }))}
          onReset={async () => setColPrefs(candidateService.setColumnPrefs({ visible: null, order: [] }))}
          onClose={() => setShowCols(false)}
        />
      )}
      {detailRow && (
        <CandidateDetailModal
          candidate={detailRow}
          user={user}
          canEdit={canUserEditRow(detailRow)}
          busy={detailBusy}
          error={detailError}
          onClose={() => setDetailRow(null)}
          onEdit={() => onEditCandidate(detailRow)}
          onDelete={async () => {
            const restoring = Boolean(detailRow.is_archived);
            if (
              !restoring &&
              !window.confirm(
                `Xóa hồ sơ ${String(detailRow.candidate_code)} - ${String(detailRow.full_name)}?

Hồ sơ được chuyển vào mục lưu trữ và biến khỏi danh sách. Admin vẫn khôi phục được bằng cách bật "Hiện cả hồ sơ đã lưu trữ".`
              )
            )
              return;
            setDetailBusy(true);
            setDetailError('');
            try {
              await candidateService.toggleArchiveCandidate(detailRow.id, !restoring, detailRow.row_version);
              setDetailRow(null);
              fetchCandidates();
            } catch (err: unknown) {
              setDetailError(err instanceof Error ? err.message : 'Không thể thực hiện thao tác.');
            } finally {
              setDetailBusy(false);
            }
          }}
        />
      )}

      {commentRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCommentRow(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCommentRow(null);
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="comment-dialog-title" className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="comment-dialog-title" className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-blue-600" /> Bình luận nội bộ
                </h2>
                <p className="text-[11px] text-slate-500 truncate" data-no-i18n>
                  {String(commentRow.full_name || '—')} ({String(commentRow.candidate_code || '')})
                </p>
              </div>
              <button type="button" onClick={() => setCommentRow(null)} title="Đóng" autoFocus className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              <CommentsPanel candidateId={Number(commentRow.id)} user={user} />
            </div>
          </div>
        </div>
      )}

      {formModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 p-3 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-6xl bg-slate-50 rounded-lg shadow-xl border border-slate-200">
            <CandidateFormView
              user={user}
              dropdowns={dropdowns}
              editingCandidate={formModal.candidate}
              onDirtyChange={setFormDirty}
              onSaved={(_cand: CandidateRecord, stayForNext?: boolean) => {
                fetchCandidates();
                if (!stayForNext) {
                  setFormDirty(false);
                  setFormModal(null);
                } else {
                  setFormModal({ candidate: null });
                }
              }}
              onCancel={closeFormModal}
              onRefreshDropdowns={onRefreshDropdowns}
            />
          </div>
        </div>
      )}

      {/* Conflict Modal for Inline Editing */}
      {conflictState && editingCell && (
        <ConflictResolutionModal
          serverRow={conflictState.serverRow}
          localDraft={conflictState.localDraft}
          onAcceptServerVersion={(serverCand) => {
            setItems((prev) =>
              prev.map((it) => (it.id === serverCand.id ? serverCand : it))
            );
            setConflictState(null);
            setEditingCell(null);
          }}
          onForceSaveLocalVersion={(latestVersion) => {
            const targetRow = items.find((r) => r.id === editingCell.rowId);
            if (targetRow) {
              commitInlineEdit(
                targetRow,
                editingCell.fieldKey,
                editingCell.value,
                latestVersion
              );
            }
          }}
          onClose={() => setConflictState(null)}
        />
      )}
    </div>
  );
};

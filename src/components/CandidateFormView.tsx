import React, { useState, useEffect, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Save,
  PlusCircle,
  Zap,
  Layers,
  AlertTriangle,
  Info,
  CheckCircle2,
  ArrowLeft,
  Lock,
} from 'lucide-react';
import { FIELD_CATALOG, SECTIONS, FieldDefinition } from '../shared/fieldCatalog.ts';
import {
  validateAndComputeCandidate,
  normalizeAndValidatePhone,
  parseDisplayDateToIso,
  computeObMonth,
  computeTenor,
  computeSourceFromSubSource,
} from '../shared/validation.ts';
import {
  dataService,
  CandidateRecord,
  DropdownDataResponse,
  UserProfile,
  ApiError,
} from '../services/dataService.ts';
import { SearchableSelect } from './SearchableSelect.tsx';
import { ConflictResolutionModal } from './ConflictResolutionModal.tsx';
import { ProposeDropdownModal } from './ProposeDropdownModal.tsx';

interface CandidateFormViewProps {
  user: UserProfile;
  dropdowns: DropdownDataResponse;
  editingCandidate?: CandidateRecord | null;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: (candidate: CandidateRecord, stayForNext: boolean) => void;
  onCancel?: () => void;
  onRefreshDropdowns: () => void;
}

export const CandidateFormView: React.FC<CandidateFormViewProps> = ({
  user,
  dropdowns,
  editingCandidate,
  onDirtyChange,
  onSaved,
  onCancel,
  onRefreshDropdowns,
}) => {
  const isEditMode = Boolean(editingCandidate);

  // "Nhập nhanh" mode shows only sections 1 to 3
  const [quickMode, setQuickMode] = useState<boolean>(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<number, boolean>>({});

  const buildInitialValues = (cand?: CandidateRecord | null): Record<string, string> => {
    const base: Record<string, string> = {};
    for (const f of FIELD_CATALOG) {
      if (cand) {
        base[f.key] = String(cand[f.key] ?? '');
      } else {
        base[f.key] = '';
      }
    }
    if (!cand) {
      // PIC defaults to the logged-in user's PIC
      if (user.pic_code) {
        base.pic = user.pic_code;
      } else if (dropdowns.lists.pic?.[0]?.value) {
        base.pic = '';
      }
    }
    return base;
  };

  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitialValues(editingCandidate)
  );
  const [rowVersion, setRowVersion] = useState<number>(editingCandidate?.row_version || 1);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [fieldNotices, setFieldNotices] = useState<Record<string, string>>({});
  const [phoneDuplicates, setPhoneDuplicates] = useState<
    { candidate_code: string; full_name: string; pic: string; position?: string }[]
  >([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // 409 ROW_CONFLICT state
  const [conflictRow, setConflictRow] = useState<CandidateRecord | null>(null);
  // Propose new dropdown option modal
  const [proposeListKey, setProposeListKey] = useState<string | null>(null);

  // Check if current user is allowed to edit this candidate
  const canEdit = useMemo(() => {
    if (user.role === 'admin') return true;
    if (!isEditMode) return Boolean(user.pic_code);
    return Boolean(user.pic_code && String(editingCandidate?.pic) === user.pic_code);
  }, [user, isEditMode, editingCandidate]);

  useEffect(() => {
    setValues(buildInitialValues(editingCandidate));
    setRowVersion(editingCandidate?.row_version || 1);
    setIsDirty(false);
    onDirtyChange(false);
    setFieldErrors({});
    setFieldNotices({});
    setPhoneDuplicates([]);
    setBannerMessage(null);
  }, [editingCandidate]);

  // Warn before browser tab close/refresh when form has unsaved edits
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Real-time computed preview for read-only fields: source, ob_month, tenor
  const computedPreview = useMemo(() => {
    const source = computeSourceFromSubSource(values.sub_source, dropdowns.subSourceMapping);
    const obParsed = parseDisplayDateToIso(values.ob_date);
    const attrParsed = parseDisplayDateToIso(values.attrition_date);
    const obMonth = obParsed.iso ? computeObMonth(obParsed.iso) : '';
    const tenor = obParsed.iso
      ? computeTenor(obParsed.iso, values.emp_status, attrParsed.iso)
      : '';
    return {
      source,
      ob_month: obMonth,
      tenor,
    };
  }, [
    values.sub_source,
    values.ob_date,
    values.emp_status,
    values.attrition_date,
    dropdowns.subSourceMapping,
  ]);

  const updateField = (key: string, rawVal: string) => {
    setValues((prev) => {
      const next = { ...prev, [key]: rawVal };

      // Dependent dropdown cascade rule:
      // Location options depend on Region; Site options depend on Location.
      // Changing a parent clears an invalid child.
      if (key === 'region') {
        const validLocs = dropdowns.regionToLocations[rawVal] || [];
        if (next.location && !validLocs.includes(next.location)) {
          next.location = '';
          next.site = '';
        }
      } else if (key === 'location') {
        const validSites = dropdowns.locationToSites[rawVal] || [];
        if (next.site && !validSites.includes(next.site)) {
          next.site = '';
        }
      }

      return next;
    });

    if (!isDirty) {
      setIsDirty(true);
      onDirtyChange(true);
    }

    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
    }
  };

  // Phone blur handler: normalize 0854498989 / "0854 498 989" / +84854498989 -> 854498989, tell user, and check duplicates
  const handlePhoneBlur = async () => {
    const raw = values.phone;
    if (!raw.trim()) {
      setPhoneDuplicates([]);
      return;
    }
    const norm = normalizeAndValidatePhone(raw);
    if (norm.wasNormalized && !norm.error) {
      setValues((prev) => ({ ...prev, phone: norm.normalized }));
    }
    if (norm.notice) {
      setFieldNotices((prev) => ({ ...prev, phone: norm.notice! }));
    } else {
      setFieldNotices((prev) => {
        const copy = { ...prev };
        delete copy.phone;
        return copy;
      });
    }

    if (norm.error) {
      setFieldErrors((prev) => ({ ...prev, phone: norm.error! }));
      return;
    }

    try {
      const checkRes = await dataService.checkPhoneDuplicate(
        norm.normalized,
        values.candidate_code
      );
      setPhoneDuplicates(checkRes.duplicates || []);
    } catch {
      // ignore network error on duplicate check
    }
  };

  const getDropdownOptionsForField = (field: FieldDefinition): string[] => {
    if (!field.dropdownListKey) return [];
    const allActive = (dropdowns.lists[field.dropdownListKey] || [])
      .filter((i) => i.active)
      .map((i) => i.value);

    // Keep current value in options if editing a row that had a deactivated value
    const currentVal = values[field.key];
    const withCurrent = (list: string[]) =>
      currentVal && !list.includes(currentVal) ? [currentVal, ...list] : list;

    if (field.key === 'location') {
      if (!values.region) return [];
      const allowedByRegion = dropdowns.regionToLocations[values.region] || [];
      return withCurrent(allActive.filter((v) => allowedByRegion.includes(v)));
    }

    if (field.key === 'site') {
      if (!values.location) return [];
      const allowedByLocation = dropdowns.locationToSites[values.location] || [];
      return withCurrent(allActive.filter((v) => allowedByLocation.includes(v)));
    }

    return withCurrent(allActive);
  };

  const handleSave = async (stayForNext: boolean, overrideRowVersion?: number) => {
    setBannerMessage(null);

    // Client-side validation first
    const clientValidation = validateAndComputeCandidate(values, dropdowns, {
      existingValues: editingCandidate || undefined,
    });

    if (Object.keys(clientValidation.notices).length > 0) {
      setFieldNotices((prev) => ({ ...prev, ...clientValidation.notices }));
    }

    // Update normalized phone in UI if normalized
    if (clientValidation.sanitized.phone && clientValidation.sanitized.phone !== values.phone) {
      setValues((prev) => ({ ...prev, phone: clientValidation.sanitized.phone }));
    }

    if (!clientValidation.valid) {
      setFieldErrors(clientValidation.errors);
      // Automatically expand any section containing an error and switch off quickMode if error is in sections 4-10
      const errorKeys = Object.keys(clientValidation.errors);
      const errorSections = new Set(
        errorKeys.map((k) => FIELD_CATALOG.find((f) => f.key === k)?.sectionId || 1)
      );
      setCollapsedSections((prev) => {
        const copy = { ...prev };
        for (const secId of errorSections) {
          copy[secId] = false;
        }
        return copy;
      });
      if (Array.from(errorSections).some((s) => s > 3)) {
        setQuickMode(false);
      }
      setBannerMessage({
        type: 'error',
        text: `Có ${errorKeys.length} trường dữ liệu chưa hợp lệ. Vui lòng kiểm tra hướng dẫn sửa màu đỏ bên dưới từng trường.`,
      });
      return;
    }

    // Build payload sending DD/MM/YYYY dates or normalized values to server
    const payloadToSend: Record<string, unknown> = {
      ...values,
      phone: clientValidation.sanitized.phone,
    };

    setSaving(true);
    try {
      if (isEditMode && editingCandidate) {
        const res = await dataService.updateCandidate(editingCandidate.id, {
          ...payloadToSend,
          row_version: overrideRowVersion ?? rowVersion,
        });
        setIsDirty(false);
        onDirtyChange(false);
        setRowVersion(res.candidate.row_version);
        setConflictRow(null);
        setBannerMessage({
          type: 'success',
          text: `Đã lưu cập nhật hồ sơ "${res.candidate.candidate_code}" (Phiên bản v${res.candidate.row_version}).`,
        });
        onSaved(res.candidate, stayForNext);
      } else {
        const res = await dataService.createCandidate(payloadToSend);
        setIsDirty(false);
        onDirtyChange(false);

        if (stayForNext) {
          // Reset form for next candidate while preserving PIC
          const fresh = buildInitialValues(null);
          setValues(fresh);
          setFieldErrors({});
          setFieldNotices(res.notices || {});
          setPhoneDuplicates(res.phoneDuplicates || []);
          setBannerMessage({
            type: 'success',
            text: `Đã tạo hồ sơ "${res.candidate.candidate_code}" thành công. Sẵn sàng nhập ứng viên tiếp theo.`,
          });
          onSaved(res.candidate, true);
        } else {
          onSaved(res.candidate, false);
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409 && err.code === 'ROW_CONFLICT' && err.currentRow) {
          setConflictRow(err.currentRow);
          return;
        }
        if (err.code === 'VALIDATION_FAILED' && err.fields) {
          setFieldErrors(err.fields);
          setBannerMessage({
            type: 'error',
            text: 'Máy chủ từ chối dữ liệu do lỗi xác thực. Vui lòng xem chi tiết bên dưới các trường.',
          });
          return;
        }
        setBannerMessage({ type: 'error', text: err.message });
      } else {
        setBannerMessage({
          type: 'error',
          text: 'Lỗi kết nối máy chủ khi lưu hồ sơ.',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const visibleSections = useMemo(
    () => (quickMode ? SECTIONS.filter((s) => s.quickEntry) : SECTIONS),
    [quickMode]
  );

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Quay lại danh sách</span>
            </button>
          )}
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isEditMode
                ? `Chỉnh sửa hồ sơ: ${editingCandidate?.candidate_code} — ${editingCandidate?.full_name}`
                : 'Nhập mới hồ sơ ứng viên (61 trường / 10 phân mục)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditMode ? (
                <>
                  Phiên bản hiện tại: <span className="font-mono-tabular font-semibold">v{rowVersion}</span> · Ngày tạo:{' '}
                  <span className="font-mono-tabular">{values.created_at || '—'}</span>
                </>
              ) : (
                'Các trường đánh dấu (*) là bắt buộc. Ngày nhập dạng DD/MM/YYYY, số điện thoại 9 chữ số không có số 0 đầu.'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick Mode Toggle ("Nhập nhanh" shows sections 1 to 3) */}
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-md border border-slate-200">
            <button
              type="button"
              onClick={() => setQuickMode(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                quickMode
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Nhập nhanh (Mục 1–3)</span>
            </button>
            <button
              type="button"
              onClick={() => setQuickMode(false)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                !quickMode
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Đầy đủ (10 mục / 61 trường)</span>
            </button>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSave(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Đang lưu...' : 'Lưu'}</span>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSave(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Lưu và nhập tiếp</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Read-only permission notice if PIC views another PIC's candidate */}
      {!canEdit && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2.5 text-xs text-amber-900">
          <Lock className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Chế độ chỉ xem:</strong> Hồ sơ này thuộc quyền phụ trách của PIC{' '}
            <strong>{String(editingCandidate?.pic || 'Khác')}</strong>. Tài khoản của bạn ({user.username} —{' '}
            {user.pic_code || 'Chưa gán PIC'}) chỉ được phép chỉnh sửa hồ sơ có PIC trùng với mã PIC của mình.
          </span>
        </div>
      )}

      {/* Status Banner */}
      {bannerMessage && (
        <div
          className={`p-3.5 rounded-lg border flex items-center gap-2.5 text-xs font-medium ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {bannerMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{bannerMessage.text}</span>
        </div>
      )}

      {/* Duplicate phone non-blocking warning */}
      {phoneDuplicates.length > 0 && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Cảnh báo trùng số điện thoại ({values.phone}) — Hệ thống vẫn cho phép lưu nhưng vui lòng kiểm tra:
            </p>
            <ul className="mt-1 space-y-0.5 list-disc list-inside text-amber-800">
              {phoneDuplicates.map((d) => (
                <li key={d.candidate_code}>
                  Mã UV: <span className="font-mono-tabular font-semibold">{d.candidate_code}</span> —{' '}
                  {d.full_name} (PIC: {d.pic})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Collapsible Sections */}
      <div className="space-y-4">
        {visibleSections.map((section) => {
          const sectionFields = FIELD_CATALOG.filter((f) => f.sectionId === section.id);
          const isCollapsed = Boolean(collapsedSections[section.id]);
          const sectionErrorCount = sectionFields.filter((f) => Boolean(fieldErrors[f.key])).length;

          return (
            <div
              key={section.id}
              className="bg-white border border-slate-200 rounded-lg overflow-hidden"
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsedSections((prev) => ({
                    ...prev,
                    [section.id]: !prev[section.id],
                  }))
                }
                className="w-full px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-left hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                  <span className="text-sm font-bold text-slate-900">{section.title}</span>
                  <span className="text-xs text-slate-500">
                    ({sectionFields.length} trường)
                  </span>
                </div>

                {sectionErrorCount > 0 && (
                  <span className="text-xs font-semibold text-red-600">
                    {sectionErrorCount} lỗi cần sửa
                  </span>
                )}
              </button>

              {!isCollapsed && (
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                  {sectionFields.map((field) => {
                    const isReadonly =
                      field.type === 'readonly_timestamp' || field.type === 'readonly_computed';
                    const isPicLockedForPicUser =
                      field.key === 'pic' && user.role === 'pic' && Boolean(user.pic_code);
                    const disabled = !canEdit || isReadonly || isPicLockedForPicUser;
                    const errText = fieldErrors[field.key];
                    const noticeText = fieldNotices[field.key];

                    let displayValue = values[field.key] ?? '';
                    if (field.key === 'created_at' && !displayValue) {
                      displayValue = 'Tự động ghi khi lưu';
                    } else if (field.key === 'source') {
                      displayValue = computedPreview.source;
                    } else if (field.key === 'ob_month') {
                      displayValue = computedPreview.ob_month;
                    } else if (field.key === 'tenor') {
                      displayValue = computedPreview.tenor;
                    }

                    return (
                      <div key={field.key} className="flex flex-col">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-slate-700">
                            <span className="text-slate-400 font-mono-tabular mr-1">
                              #{field.index}
                            </span>
                            {field.label}
                            {field.required && <span className="text-red-600 ml-0.5">*</span>}
                          </label>
                          {isReadonly && (
                            <span className="text-[11px] text-slate-400">Tự động</span>
                          )}
                        </div>

                        {field.type === 'dropdown' ||
                        field.type === 'dependent_dropdown' ||
                        field.type === 'time' ? (
                          <SearchableSelect
                            value={displayValue}
                            options={getDropdownOptionsForField(field)}
                            onChange={(val) => updateField(field.key, val)}
                            disabled={
                              disabled ||
                              (field.key === 'location' && !values.region) ||
                              (field.key === 'site' && !values.location)
                            }
                            error={Boolean(errText)}
                            placeholder={
                              field.key === 'location' && !values.region
                                ? 'Chọn Vùng/Miền trước...'
                                : field.key === 'site' && !values.location
                                ? 'Chọn Tỉnh/Thành trước...'
                                : `Chọn ${field.label}...`
                            }
                            onProposeNewValue={
                              field.dropdownListKey && field.type !== 'time'
                                ? () => setProposeListKey(field.dropdownListKey!)
                                : undefined
                            }
                          />
                        ) : (
                          <input
                            type="text"
                            value={displayValue}
                            disabled={disabled}
                            onChange={(e) => updateField(field.key, e.target.value)}
                            onBlur={field.key === 'phone' ? handlePhoneBlur : undefined}
                            placeholder={
                              field.type === 'date'
                                ? 'DD/MM/YYYY (VD: 15/11/2026)'
                                : field.type === 'phone'
                                ? '9 chữ số (VD: 854498989)'
                                : field.type === 'money'
                                ? 'Số nguyên VND (VD: 9500000)'
                                : field.type === 'percentage'
                                ? '0 - 100 (VD: 85)'
                                : isReadonly
                                ? 'Tự động tính toán'
                                : `Nhập ${field.label.toLowerCase()}...`
                            }
                            className={`w-full px-3 py-2 text-sm rounded-md border transition-colors ${
                              field.type === 'phone' ||
                              field.type === 'date' ||
                              field.type === 'money' ||
                              field.type === 'percentage' ||
                              field.key === 'candidate_code' ||
                              isReadonly
                                ? 'font-mono-tabular'
                                : ''
                            } ${
                              disabled
                                ? 'bg-slate-100 text-slate-600 border-slate-200 cursor-not-allowed'
                                : errText
                                ? 'bg-white border-red-500 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-200'
                                : 'bg-white border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
                            }`}
                          />
                        )}

                        {errText && (
                          <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{errText}</span>
                          </p>
                        )}

                        {!errText && noticeText && (
                          <p className="mt-1 text-xs text-blue-700 flex items-start gap-1">
                            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{noticeText}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Sticky Action Bar */}
      {canEdit && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
          <div className="text-xs text-slate-600">
            {isDirty ? (
              <span className="text-amber-700 font-medium">
                Bạn đang có thay đổi chưa lưu trên biểu mẫu.
              </span>
            ) : (
              <span>Tất cả thay đổi đã đồng bộ.</span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
              >
                Hủy
              </button>
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Đang lưu...' : 'Lưu'}</span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Lưu và nhập tiếp</span>
            </button>
          </div>
        </div>
      )}

      {/* Optimistic Lock Conflict Modal */}
      {conflictRow && (
        <ConflictResolutionModal
          serverRow={conflictRow}
          localDraft={values}
          onAcceptServerVersion={(serverCand) => {
            setValues(buildInitialValues(serverCand));
            setRowVersion(serverCand.row_version);
            setConflictRow(null);
            setIsDirty(false);
            onDirtyChange(false);
          }}
          onForceSaveLocalVersion={(latestVersion) => {
            setRowVersion(latestVersion);
            setConflictRow(null);
            handleSave(false, latestVersion);
          }}
          onClose={() => setConflictRow(null)}
        />
      )}

      {/* Propose New Dropdown Value Modal */}
      {proposeListKey && (
        <ProposeDropdownModal
          initialListKey={proposeListKey}
          dropdowns={dropdowns}
          onClose={() => setProposeListKey(null)}
          onSuccess={() => {
            onRefreshDropdowns();
            setBannerMessage({
              type: 'success',
              text: 'Đã gửi đề xuất bổ sung giá trị mới tới Admin phê duyệt.',
            });
          }}
        />
      )}
    </div>
  );
};

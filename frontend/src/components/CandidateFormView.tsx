import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Save,
  PlusCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  ArrowLeft,
  Lock,
  Check,
  Upload,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { FIELD_CATALOG, SECTIONS, type FieldDefinition, isFieldApplicable } from '../../../shared/fieldCatalog.ts';
import { lookupPositionInfo, positionGroupLabel, sortPositions } from '../../../shared/positionMap.ts';
import { REASON_FIELD, type ReasonRound, allowedReasons } from '../../../shared/reasonRules.ts';
import { sortWdSteps, wdStepGroup, WD_STEPS_BY_PROCESS } from '../../../shared/wdRules.ts';
import { requiredDocuments, visibleDocumentKeys, docFolderName, docFileName } from '../../../shared/documentRules.ts';
import { copyText, summaryPrompt } from '../../../shared/aiPrompts.ts';
import { FAIL_LABEL, failedStage, lockedFieldKeys } from '../../../shared/pipelineRules.ts';

/** Section that holds each round; every section after it is locked once that round failed. */
const FAIL_SECTION = { r1: 4, r2: 5, ob: 6 } as const;

// Position and Site come first; the fields below them are filled automatically (Hiring Operation).
const FIRST_KEYS = ['position', 'site'];
const REASON_SUB_KEYS = Object.values(REASON_FIELD).map((f) => f.sub);
import {
  validateAndComputeCandidate,
  normalizeAndValidatePhone,
  parseDisplayDateToIso,
  computeObMonth,
  computeTenor,
  computeSourceFromSubSource,
} from '../../../shared/validation.ts';
import {
  candidateService,
  type CandidateRecord,
  type DropdownDataResponse,
  type FormInfo,
  ApiError,
} from '../services/candidateService.ts';
import { canEditPic, type UserProfile } from '../services/authService.ts';
import { SearchableSelect } from './SearchableSelect.tsx';
import { DatePickButton } from './DatePickButton.tsx';
import { ConflictResolutionModal } from './ConflictResolutionModal.tsx';
import { ProposeDropdownModal } from './ProposeDropdownModal.tsx';
import { HrInfoBanner } from './HrInfoBanner.tsx';
import { AttachmentsPanel } from './AttachmentsPanel.tsx';

interface CandidateFormViewProps {
  user: UserProfile;
  dropdowns: DropdownDataResponse;
  editingCandidate?: CandidateRecord | null;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: (candidate: CandidateRecord, stayForNext: boolean) => void;
  onCancel?: () => void;
  onRefreshDropdowns: () => void;
  /** Set when the form was opened from a TA form link: the PIC is fixed by the form and each save is recorded as a submission. */
  formLink?: { code: string; pic_code: string; template_version: number } | null;
  /** New profile only: values filled in from an online application, and a note about it shown on top. */
  prefill?: { values: Record<string, string>; note: React.ReactNode } | null;
}

export const CandidateFormView: React.FC<CandidateFormViewProps> = ({
  user,
  dropdowns,
  editingCandidate,
  onDirtyChange,
  onSaved,
  onCancel,
  onRefreshDropdowns,
  formLink,
  prefill,
}) => {
  const isEditMode = Boolean(editingCandidate);

  // A TA sees the link of their own form (Google version only) to copy and share.
  const [myForm, setMyForm] = useState<FormInfo | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  useEffect(() => {
    if (isEditMode || user.role === 'admin' || !candidateService.supportsWorkspaces()) return;
    candidateService.getMyForm().then(setMyForm, () => setMyForm(null));
  }, [isEditMode, user.role]);

  // The form is a row of step tabs; only the current step is shown. A step unlocks when every step before it is complete.
  const [step, setStep] = useState<number>(1);
  const [cvFile, setCvFile] = useState<File | null>(null);
  // A picked CV is shown for the TA to check; it is only attached to the profile after the TA confirms.
  const [cvPreviewUrl, setCvPreviewUrl] = useState('');
  const [cvConfirmed, setCvConfirmed] = useState(false);
  const [promptCopied, setPromptCopied] = useState('');
  useEffect(() => {
    setCvConfirmed(false);
    if (!cvFile) {
      setCvPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(cvFile);
    setCvPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cvFile]);
  // Section 9 documents picked but not yet uploaded (uploaded after the record is saved).
  const [docFiles, setDocFiles] = useState<Record<string, File>>({});
  const docInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [autoCode, setAutoCode] = useState<string>('');
  const cvInputRef = useRef<HTMLInputElement>(null);

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
      if (prefill) for (const [k, v] of Object.entries(prefill.values)) if (k in base && v) base[k] = v;
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
  const [phoneCheckFailed, setPhoneCheckFailed] = useState<boolean>(false);
  const [emailDuplicates, setEmailDuplicates] = useState<
    { candidate_code: string; full_name: string; pic: string; position?: string }[]
  >([]);
  const [emailCheckFailed, setEmailCheckFailed] = useState<boolean>(false);
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
    return canEditPic(user, editingCandidate?.pic);
  }, [user, isEditMode, editingCandidate]);

  // New candidate: preview the auto code for the chosen PIC (the server assigns the real one when saving).
  useEffect(() => {
    if (isEditMode) return;
    const pic = user.role === 'pic' ? user.pic_code || '' : values.pic;
    if (!pic) {
      setAutoCode('');
      return;
    }
    let cancelled = false;
    candidateService
      .nextCandidateCode(pic)
      .then((c) => !cancelled && setAutoCode(c))
      .catch(() => !cancelled && setAutoCode(''));
    return () => {
      cancelled = true;
    };
  }, [isEditMode, values.pic, user.role, user.pic_code]);

  useEffect(() => {
    setStep(1);
    setCvFile(null);
    setDocFiles({});
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

      // Choosing a Site fills its Location and Region
      if (key === 'site' && rawVal) {
        const loc = Object.keys(dropdowns.locationToSites).find((l) => dropdowns.locationToSites[l].includes(rawVal));
        if (loc) {
          next.location = loc;
          const reg = Object.keys(dropdowns.regionToLocations).find((r) => dropdowns.regionToLocations[r].includes(loc));
          if (reg) next.region = reg;
        }
      }

      // Hiring Operation: Position + Site fill Dept, Unit and Rank
      if (key === 'site' || key === 'position') {
        const info = lookupPositionInfo(next.site, next.position);
        next.dept = info?.dept || '';
        next.unit = info?.unit || '';
        next.rank = info?.ranks[0] || '';
      }

      // Status -> reason: changing a status clears a reason that does not fit it
      for (const round of Object.keys(REASON_FIELD) as ReasonRound[]) {
        const { status, sub } = REASON_FIELD[round];
        if (key === status && next[sub]) {
          const allowed = allowedReasons(round, rawVal);
          if (allowed && !allowed.includes(next[sub])) next[sub] = '';
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

  // Phone blur handler: normalize 0854498989 -> 854498989, tell user, and check duplicates
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
      setPhoneCheckFailed(false);
      return;
    }

    try {
      const checkRes = await candidateService.checkPhoneDuplicate(
        norm.normalized,
        editingCandidate?.id
      );
      setPhoneDuplicates(checkRes.duplicates || []);
      setPhoneCheckFailed(!!checkRes.checkFailed);
    } catch {
      setPhoneCheckFailed(true);
    }
  };

  // Email blur handler: kiểm tra trùng (không chặn lưu)
  const handleEmailBlur = async () => {
    const email = (values.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailDuplicates([]);
      setEmailCheckFailed(false);
      return;
    }
    try {
      const res = await candidateService.checkEmailDuplicate(email, editingCandidate?.id);
      setEmailDuplicates(res.duplicates || []);
      setEmailCheckFailed(res.checkFailed);
    } catch {
      setEmailCheckFailed(true);
    }
  };

  const getDropdownOptionsForField = (field: FieldDefinition): string[] => {
    if (!field.dropdownListKey) return [];
    const allActive = (dropdowns.lists[field.dropdownListKey] || [])
      .filter((i) => i.active)
      .map((i) => i.value);

    const currentVal = values[field.key];
    const withCurrent = (list: string[]) =>
      currentVal && !list.includes(currentVal) ? [currentVal, ...list] : list;

    if (field.key === 'location') {
      if (!values.region) return [];
      const allowedByRegion = dropdowns.regionToLocations[values.region] || [];
      return withCurrent(allActive.filter((v) => allowedByRegion.includes(v)));
    }

    if (field.key === 'site') {
      return withCurrent(allActive);
    }

    if (field.key === 'rank') {
      const info = lookupPositionInfo(values.site, values.position);
      if (info) return withCurrent([...info.ranks, ...allActive.filter((v) => !info.ranks.includes(v))]);
    }

    for (const round of Object.keys(REASON_FIELD) as ReasonRound[]) {
      if (field.key === REASON_FIELD[round].sub) {
        const allowed = allowedReasons(round, values[REASON_FIELD[round].status]);
        if (allowed === null) return withCurrent([]);
        return withCurrent(allActive.filter((v) => allowed.includes(v)));
      }
    }

    if (field.key === 'position') return withCurrent(sortPositions(allActive));

    if (field.key === 'wd_step') return withCurrent(sortWdSteps(values.wd_process, allActive));

    return withCurrent(allActive);
  };

  const validationValues = useMemo(
    () => (isEditMode ? values : { ...values, candidate_code: autoCode || 'AUTO' }),
    [values, isEditMode, autoCode]
  );
  const liveValidation = useMemo(
    () =>
      validateAndComputeCandidate(validationValues, dropdowns, {
        existingValues: editingCandidate || undefined,
        isCreate: !isEditMode,
      }),
    [validationValues, dropdowns, editingCandidate, isEditMode]
  );
  const stepErrorKeys = (sectionId: number): string[] =>
    FIELD_CATALOG.filter((f) => f.sectionId === sectionId && liveValidation.errors[f.key]).map((f) => f.key);
  const stepComplete = (sectionId: number): boolean => stepErrorKeys(sectionId).length === 0;

  const reachableStep = useMemo(() => {
    for (const sec of SECTIONS) {
      if (!stepComplete(sec.id)) return sec.id;
    }
    return SECTIONS[SECTIONS.length - 1].id;
  }, [liveValidation]);

  const stageMaxSection = useMemo(() => {
    const g = (k: string) => String(values[k] ?? '').trim();
    let m = 4;
    if (g('r1_status') === 'Passed' || g('r2_status') || g('r2_date')) m = 5;
    if (g('r2_status') === 'Passed' || g('ob_status') || g('ob_date')) m = 6;
    if (g('ob_status')) m = 10;
    if (g('ob_status') === 'Joined') m = 11;
    return m;
  }, [values]);
  const sectionHasData = (id: number) =>
    FIELD_CATALOG.some((f) => f.sectionId === id && f.type !== 'readonly_computed' && f.type !== 'readonly_timestamp' && String(values[f.key] ?? '').trim() !== '');
  const notReached = (id: number) => id > stageMaxSection && !sectionHasData(id);
  const NEXT_ROUND_HINT: Record<number, string> = {
    5: 'Chọn R1 = Passed (hoặc nhập lịch R2) để mở Vòng 2.',
    6: 'Chọn R2 = Passed (hoặc nhập ngày Onboard) để mở Onboard.',
    7: 'Chọn trạng thái Onboard để mở các mục lương, hợp đồng, giấy tờ.',
    11: 'Follow WD mở khi Onboard = Joined.',
  };
  const hintFor = (id: number) => NEXT_ROUND_HINT[id] || NEXT_ROUND_HINT[id <= 10 && id >= 7 ? 7 : 11];

  const goToStep = (target: number) => {
    if (target > reachableStep || notReached(target)) return;
    setBannerMessage(null);
    setStep(target);
  };

  const handleNext = () => {
    const keys = stepErrorKeys(step);
    if (keys.length > 0) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = liveValidation.errors[k];
        return next;
      });
      setBannerMessage({
        type: 'error',
        text: `Mục này còn ${keys.length} trường chưa hợp lệ hoặc chưa điền. Điền đủ rồi mới sang mục tiếp theo được.`,
      });
      return;
    }
    const next = Math.min(SECTIONS.length, step + 1);
    if (next !== step && notReached(next)) {
      setBannerMessage({ type: 'error', text: `Ứng viên chưa tới bước tiếp theo. ${hintFor(next)}` });
      return;
    }
    setBannerMessage(null);
    setStep(next);
  };

  const uploadStagedDocs = async (cand: CandidateRecord): Promise<{ cand: CandidateRecord; failed: string[] }> => {
    let cur = cand;
    const failed: string[] = [];
    for (const [key, file] of Object.entries(docFiles)) {
      try {
        cur = await candidateService.uploadDoc(cur.id, key, file);
      } catch (e) {
        failed.push(`${FIELD_CATALOG.find((f) => f.key === key)?.label || key}: ${e instanceof Error ? e.message : 'lỗi không rõ'}`);
      }
    }
    return { cand: cur, failed };
  };

  const autoFilledSet = useMemo(() => {
    const s = new Set<string>(['candidate_code']);
    if (values.site && Object.values(dropdowns.locationToSites).some((sites) => sites.includes(values.site))) {
      s.add('location');
      s.add('region');
    }
    const info = lookupPositionInfo(values.site, values.position);
    if (info?.dept) s.add('dept');
    if (info?.unit) s.add('unit');
    if (info && info.ranks.length === 1) s.add('rank');
    return s;
  }, [values.site, values.position, dropdowns.locationToSites]);

  const failedAt = useMemo(() => failedStage(values), [values]);
  const lockedSet = useMemo(() => new Set(lockedFieldKeys(values)), [values]);

  const handleSave = async (stayForNext: boolean, overrideRowVersion?: number) => {
    setBannerMessage(null);
    if (cvFile && !cvConfirmed) {
      setBannerMessage({ type: 'error', text: 'Bạn đã chọn file CV. Hãy xem file, tích ô "Tôi đã kiểm tra CV" ở mục CV rồi bấm Lưu, hoặc bấm "bỏ" để không đính kèm file.' });
      return;
    }

    const clientValidation = validateAndComputeCandidate(validationValues, dropdowns, {
      existingValues: editingCandidate || undefined,
      isCreate: !isEditMode,
    });

    if (Object.keys(clientValidation.notices).length > 0) {
      setFieldNotices((prev) => ({ ...prev, ...clientValidation.notices }));
    }

    if (clientValidation.sanitized.phone && clientValidation.sanitized.phone !== values.phone) {
      setValues((prev) => ({ ...prev, phone: clientValidation.sanitized.phone }));
    }

    if (!clientValidation.valid) {
      setFieldErrors(clientValidation.errors);
      const errorKeys = Object.keys(clientValidation.errors);
      const firstBad = Math.min(
        ...errorKeys.map((k) => FIELD_CATALOG.find((f) => f.key === k)?.sectionId || 1)
      );
      setStep(firstBad);
      setBannerMessage({
        type: 'error',
        text: `Có ${errorKeys.length} trường dữ liệu chưa hợp lệ. Vui lòng kiểm tra hướng dẫn sửa màu đỏ bên dưới từng trường.`,
      });
      return;
    }

    const payloadToSend: Record<string, unknown> = {
      ...values,
      phone: clientValidation.sanitized.phone,
      birth: clientValidation.sanitized.birth,
      cv_link: clientValidation.sanitized.cv_link,
    };
    if (!isEditMode) payloadToSend.candidate_code = '';
    if (!isEditMode && formLink) {
      payloadToSend.form_code = formLink.code;
      payloadToSend.pic = formLink.pic_code;
    }
    delete payloadToSend.cv_file;

    setSaving(true);
    try {
      if (isEditMode && editingCandidate) {
        const res = await candidateService.updateCandidate(editingCandidate.id, {
          ...payloadToSend,
          row_version: overrideRowVersion ?? rowVersion,
        });
        if (Object.keys(docFiles).length) {
          const up = await uploadStagedDocs(res.candidate);
          res.candidate = up.cand;
          setDocFiles({});
          if (up.failed.length) setBannerMessage({ type: 'error', text: `Đã lưu hồ sơ nhưng chưa tải được: ${up.failed.join('; ')}` });
          setValues((p) => ({ ...p, ...Object.fromEntries(FIELD_CATALOG.filter((f) => f.type === 'document').map((f) => [f.key, String(up.cand[f.key] ?? '')])) }));
        }
        if (cvFile) {
          try {
            res.candidate = await candidateService.uploadCv(res.candidate.id, cvFile);
            setCvFile(null);
          } catch (e) {
            setBannerMessage({ type: 'error', text: `Đã lưu hồ sơ nhưng chưa tải được file CV: ${e instanceof Error ? e.message : 'lỗi không rõ'}` });
          }
        }
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
        const res = await candidateService.createCandidate(payloadToSend);
        if (Object.keys(docFiles).length) {
          const up = await uploadStagedDocs(res.candidate);
          res.candidate = up.cand;
          setDocFiles({});
          if (up.failed.length) window.alert(`Đã lưu hồ sơ ${res.candidate.candidate_code} nhưng chưa tải được: ${up.failed.join('; ')}. Bạn mở hồ sơ để tải lại.`);
        }
        if (cvFile) {
          try {
            res.candidate = await candidateService.uploadCv(res.candidate.id, cvFile);
          } catch (e) {
            window.alert(`Đã lưu hồ sơ ${res.candidate.candidate_code} nhưng chưa tải được file CV: ${e instanceof Error ? e.message : 'lỗi không rõ'}. Bạn mở hồ sơ để tải lại.`);
          }
        }
        setCvFile(null);
        setIsDirty(false);
        onDirtyChange(false);

        if (stayForNext) {
          const fresh = buildInitialValues(null);
          setValues(fresh);
          setStep(1);
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
                : 'Nhập mới hồ sơ ứng viên (76 trường / 11 mục)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEditMode ? (
                <>
                  Phiên bản hiện tại: <span className="font-mono-tabular font-semibold">v{rowVersion}</span> · Ngày tạo:{' '}
                  <span className="font-mono-tabular">{values.created_at || '—'}</span>
                </>
              ) : (
                'Điền đủ các trường đánh dấu (*) của mục hiện tại thì mới sang được mục tiếp theo. Mã ứng viên tự động.'
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
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

      {/* Read-only permission notice */}
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

      {failedAt && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-900 text-xs flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Ứng viên đã rớt ở <strong>{FAIL_LABEL[failedAt]}</strong> nên mọi bước phía sau đã bị khóa và làm mờ. Nếu cần mở lại, hãy đổi trạng thái {FAIL_LABEL[failedAt]} (ví dụ về Pending).
          </span>
        </div>
      )}

      {isEditMode && editingCandidate && (
        <div className="rounded-lg overflow-hidden border border-emerald-200">
          <HrInfoBanner candidate={editingCandidate as unknown as React.ComponentProps<typeof HrInfoBanner>['candidate']} canEdit={canEdit} />
        </div>
      )}

      {!isEditMode && prefill && (
        <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-900">{prefill.note}</div>
      )}

      {!isEditMode && !formLink && myForm && (
        <div className="p-3 rounded-lg border border-slate-200 bg-white text-xs flex flex-wrap items-center gap-2">
          <span className="text-slate-600">
            Link form của bạn (v{myForm.template_version}, {myForm.submissions} lần gửi, {myForm.status === 'active' ? 'đang bật' : 'đang tắt'}):
          </span>
          <input readOnly value={myForm.link} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-[200px] px-2 py-1 border border-slate-300 rounded bg-slate-50 text-[11px]" data-no-i18n />
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(myForm.link).then(() => setLinkCopied(true), () => setLinkCopied(false));
              setTimeout(() => setLinkCopied(false), 2000);
            }}
            className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200 rounded hover:bg-blue-50"
          >
            {linkCopied ? 'Đã sao chép' : 'Sao chép link'}
          </button>
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

      {phoneCheckFailed && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="font-semibold">Không kiểm tra được trùng số điện thoại — vui lòng kiểm tra thủ công trước khi lưu.</p>
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

      {emailCheckFailed && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="font-semibold">Không kiểm tra được trùng email — vui lòng kiểm tra thủ công trước khi lưu.</p>
        </div>
      )}

      {emailDuplicates.length > 0 && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Cảnh báo trùng email ({values.email}) — Hệ thống vẫn cho phép lưu nhưng vui lòng kiểm tra:
            </p>
            <ul className="mt-1 space-y-0.5 list-disc list-inside text-amber-800">
              {emailDuplicates.map((d, i) => (
                <li key={`${d.candidate_code}-${i}`}>
                  Mã UV: <span className="font-mono-tabular font-semibold">{d.candidate_code}</span> —{' '}
                  {d.full_name} (PIC: {d.pic})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <datalist id="suggest-pending_at">
        {(dropdowns.lists.pending_at || []).filter((o) => o.active).map((o) => (
          <option key={o.value} value={o.value} />
        ))}
      </datalist>

      {/* Step tabs */}
      <div className="bg-white border border-slate-200 rounded-lg p-2 flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => {
          const failLocked = failedAt !== null && section.id > FAIL_SECTION[failedAt];
          const notYet = !failLocked && notReached(section.id);
          const locked = section.id > reachableStep || notYet;
          const done = section.id < reachableStep && !failLocked && !notYet;
          const current = section.id === step;
          return (
            <button
              key={section.id}
              type="button"
              disabled={locked}
              onClick={() => goToStep(section.id)}
              title={failLocked ? `Đã khóa vì ứng viên rớt ở ${FAIL_LABEL[failedAt!]} (vẫn mở xem được)` : notYet ? `Ứng viên chưa tới bước này. ${hintFor(section.id)}` : locked ? 'Điền đủ các mục phía trước để mở mục này' : section.title}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border transition-colors ${
                current
                  ? `bg-blue-600 text-white border-blue-600 shadow-sm ${failLocked ? 'opacity-50' : ''}`
                  : failLocked
                  ? 'bg-slate-50 text-slate-400 border-slate-200 opacity-50 hover:opacity-70'
                  : locked
                  ? 'bg-slate-50 text-slate-400 border-slate-100 opacity-50 cursor-not-allowed'
                  : done
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {failLocked ? <Lock className="w-3 h-3 text-red-400" /> : done && !current ? <Check className="w-3.5 h-3.5" /> : locked ? <Lock className="w-3 h-3" /> : null}
              <span>{section.shortTitle}</span>
            </button>
          );
        })}
      </div>

      {/* Current step frame */}
      <div className="space-y-4">
        {SECTIONS.filter((sec) => sec.id === step).map((section) => {
          const shownDocs = visibleDocumentKeys(values.position);
          const sectionFields = FIELD_CATALOG.filter(
            (f) => f.sectionId === section.id && isFieldApplicable(f, values) && (f.type !== 'document' || shownDocs.includes(f.key))
          ).sort(
            (a, b) =>
              (a.type === 'document' ? 1 : 0) - (b.type === 'document' ? 1 : 0) ||
              (FIRST_KEYS.includes(a.key) ? FIRST_KEYS.indexOf(a.key) : 99) -
                (FIRST_KEYS.includes(b.key) ? FIRST_KEYS.indexOf(b.key) : 99)
          );
          const requiredDocKeys = requiredDocuments(values.position, values.rank);
          const sectionErrorCount = sectionFields.filter((f) => Boolean(fieldErrors[f.key])).length;
          const requiredHere = sectionFields.filter(
            (f) => f.required || (f.requiredOnCreate && !isEditMode)
          );

          return (
            <div
              key={section.id}
              className="bg-white border-2 border-blue-500 rounded-lg overflow-hidden shadow-lg ring-4 ring-blue-100"
            >
              <div className="px-5 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-bold text-blue-900">{section.title}</span>
                  <span className="text-xs text-blue-700">
                    Đang điền · {sectionFields.length} trường
                    {requiredHere.length > 0 ? ` · ${requiredHere.length} bắt buộc (*)` : ''}
                  </span>
                </div>
                {sectionErrorCount > 0 && (
                  <span className="text-xs font-semibold text-red-600">{sectionErrorCount} lỗi cần sửa</span>
                )}
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                {sectionFields.map((field, fieldIdx) => {
                  const isReadonly =
                    field.type === 'readonly_timestamp' || field.type === 'readonly_computed';
                  const isPicLockedForPicUser =
                    field.key === 'pic' && user.role === 'pic' && Boolean(user.pic_code);
                  const isAutoCode = field.key === 'candidate_code' && !isEditMode;
                  const isAutoFilled = isAutoCode || autoFilledSet.has(field.key);
                  const isStepLocked = lockedSet.has(field.key);
                  const disabled = !canEdit || isReadonly || isPicLockedForPicUser || isAutoFilled || isStepLocked || (field.sectionId === 11 && user.role === 'admin');
                  const errText = fieldErrors[field.key];
                  const noticeText = fieldNotices[field.key];
                  const isRequired = Boolean(field.required || (field.requiredOnCreate && !isEditMode) || requiredDocKeys.includes(field.key));

                  let displayValue = values[field.key] ?? '';
                  if (field.key === 'created_at' && !displayValue) {
                    displayValue = 'Tự động ghi khi lưu';
                  } else if (isAutoCode) {
                    displayValue = autoCode || 'Chọn PIC để tạo mã';
                  } else if (field.key === 'source') {
                    displayValue = computedPreview.source;
                  } else if (field.key === 'ob_month') {
                    displayValue = computedPreview.ob_month;
                  } else if (field.key === 'tenor') {
                    displayValue = computedPreview.tenor;
                  }

                  const firstDoc = field.type === 'document' && (fieldIdx === 0 || sectionFields[fieldIdx - 1].type !== 'document');
                  return (
                    <React.Fragment key={field.key}>
                    {firstDoc && (
                      <div className="col-span-full pt-2 mt-1 border-t border-slate-200 text-xs font-bold text-slate-700">
                        Giấy tờ <span className="font-normal text-slate-500">· bấm vào ô để tải file lên (PDF, Word hoặc ảnh, tối đa 10 MB)</span>
                      </div>
                    )}
                    <div className={`flex flex-col ${field.key === 'cv_file' ? 'md:col-span-2 lg:col-span-3' : ''} ${(isReadonly || isAutoFilled || isStepLocked) && field.key !== 'cv_file' ? 'opacity-50' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">
                          <span className="text-slate-400 font-mono-tabular mr-1">#{field.index}</span>
                          {field.label}
                          {isRequired && <span className="text-red-600 ml-0.5">*</span>}
                        </label>
                        {isStepLocked ? (
                          <span className="text-[11px] text-red-500 inline-flex items-center gap-0.5"><Lock className="w-3 h-3" /> Đã khóa</span>
                        ) : (
                          (isReadonly || isAutoFilled) && field.key !== 'cv_file' && (
                            <span className="text-[11px] text-slate-400" title={autoFilledSet.has(field.key) ? `Tự điền theo ${['rank', 'dept', 'unit'].includes(field.key) ? 'Vị trí và Kho' : 'Kho (Site)'}; đổi Vị trí hoặc Kho để thay đổi.` : undefined}>
                              Tự động
                            </span>
                          )
                        )}
                      </div>

                      {field.type === 'document' ? (
                        (() => {
                          const staged = docFiles[field.key];
                          const stored = values[field.key] || '';
                          const isFile = stored.includes('|');
                          const storedName = isFile ? stored.split('|')[1] : '';
                          const isLegacy = Boolean(stored) && !isFile;
                          const needed = requiredDocKeys.includes(field.key);
                          const missing = needed && !staged && !stored;
                          const ownerCode = String((values.emp_id || '').trim() || (isEditMode ? editingCandidate?.candidate_code : autoCode) || '');
                          const planned = staged
                            ? `${docFolderName(values.emp_id || '', ownerCode, values.full_name)}/${docFileName(values.emp_id || '', ownerCode, values.full_name, field.docName || field.label, staged.name)}`
                            : '';
                          return (
                            <div
                              className={`rounded-md border p-3 text-xs flex-1 min-h-[118px] flex flex-col gap-1.5 ${
                                missing ? 'border-red-300 bg-red-50' : staged || stored ? 'border-emerald-300 bg-emerald-50' : 'border-dashed border-slate-300 bg-slate-50'
                              }`}
                            >
                              <input
                                type="file"
                                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                className="hidden"
                                ref={(el) => {
                                  docInputs.current[field.key] = el;
                                }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  e.target.value = '';
                                  if (!f) return;
                                  if (f.size > 10 * 1024 * 1024) {
                                    setFieldErrors((p) => ({ ...p, [field.key]: 'File tối đa 10 MB.' }));
                                    return;
                                  }
                                  setFieldErrors((p) => {
                                    const c = { ...p };
                                    delete c[field.key];
                                    return c;
                                  });
                                  setDocFiles((p) => ({ ...p, [field.key]: f }));
                                  if (!isDirty) {
                                    setIsDirty(true);
                                    onDirtyChange(true);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => docInputs.current[field.key]?.click()}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50 disabled:opacity-50"
                              >
                                <Upload className="w-3.5 h-3.5" />
                                {staged || stored ? 'Bấm để chọn file khác' : 'Bấm để tải file lên'}
                              </button>
                              {missing && <p className="mt-1.5 font-semibold text-red-700">Thiếu giấy tờ bắt buộc</p>}
                              {staged && (
                                <p className="mt-1.5 text-slate-800">
                                  <strong>{staged.name}</strong> · tải lên khi bấm Lưu
                                  <br />
                                  <span className="text-slate-500">Sẽ lưu thành: {planned}</span>{' '}
                                  <button
                                    type="button"
                                    className="text-red-600 underline"
                                    onClick={() =>
                                      setDocFiles((p) => {
                                        const c = { ...p };
                                        delete c[field.key];
                                        return c;
                                      })
                                    }
                                  >
                                    bỏ
                                  </button>
                                </p>
                              )}
                              {!staged && isFile && (
                                <p className="mt-1.5 text-slate-800 flex flex-wrap items-center gap-2">
                                  <span className="font-semibold break-all">{storedName}</span>
                                  {editingCandidate && (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-blue-700 underline"
                                      onClick={() =>
                                        candidateService
                                          .downloadDoc(editingCandidate.id, field.key, storedName)
                                          .catch((e) => setBannerMessage({ type: 'error', text: e instanceof Error ? e.message : 'Không tải được file.' }))
                                      }
                                    >
                                      <Download className="w-3 h-3" /> Tải xuống
                                    </button>
                                  )}
                                  {editingCandidate && canEdit && (
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-red-600 underline"
                                      onClick={async () => {
                                        if (!window.confirm(`Xóa file "${storedName}"?`)) return;
                                        try {
                                          const c = await candidateService.deleteDoc(editingCandidate.id, field.key);
                                          setValues((p) => ({ ...p, [field.key]: '' }));
                                          setRowVersion(c.row_version);
                                        } catch (e) {
                                          setBannerMessage({ type: 'error', text: e instanceof Error ? e.message : 'Không xóa được file.' });
                                        }
                                      }}
                                    >
                                      <Trash2 className="w-3 h-3" /> Xóa
                                    </button>
                                  )}
                                </p>
                              )}
                              {!staged && isLegacy && <p className="mt-1.5 text-slate-600">Đã nộp (dữ liệu cũ, chưa có file). Bấm nút trên để tải file lên.</p>}
                              {!staged && !stored && !missing && <p className="mt-1.5 text-slate-500">Chưa nộp</p>}
                            </div>
                          );
                        })()
                      ) : field.key === 'cv_file' ? (
                        <div className="flex flex-wrap items-center gap-2 p-3 rounded-md border border-dashed border-slate-300 bg-slate-50">
                          <input
                            ref={cvInputRef}
                            type="file"
                            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              e.target.value = '';
                              if (!f) return;
                              if (f.size > 10 * 1024 * 1024) {
                                setFieldErrors((p) => ({ ...p, cv_file: 'File CV tối đa 10 MB.' }));
                                return;
                              }
                              setFieldErrors((p) => {
                                const c = { ...p };
                                delete c.cv_file;
                                return c;
                              });
                              setCvFile(f);
                              if (!isDirty) {
                                setIsDirty(true);
                                onDirtyChange(true);
                              }
                            }}
                          />
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() => cvInputRef.current?.click()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50 disabled:opacity-50"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            {cvFile || values.cv_file ? 'Chọn file khác' : 'Tải file CV lên'}
                          </button>
                          {cvFile && (
                            <span className="text-xs text-slate-800">
                              <strong>{cvFile.name}</strong> ({Math.round(cvFile.size / 1024)} KB) · sẽ được tải lên khi bấm Lưu{' '}
                              <button type="button" className="text-red-600 underline ml-1" onClick={() => setCvFile(null)}>
                                bỏ
                              </button>
                            </span>
                          )}
                          {!cvFile && values.cv_file && editingCandidate && (
                            <span className="text-xs text-slate-800 inline-flex items-center gap-2">
                              Đã có: <strong>{values.cv_file.split('|')[1] || values.cv_file}</strong>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-blue-700 underline"
                                onClick={() =>
                                  candidateService
                                    .downloadCv(editingCandidate.id, values.cv_file.split('|')[1] || 'cv')
                                    .catch((e) => setBannerMessage({ type: 'error', text: e instanceof Error ? e.message : 'Không tải được file CV.' }))
                                }
                              >
                                <Download className="w-3 h-3" /> Tải xuống
                              </button>
                              {canEdit && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-red-600 underline"
                                  onClick={async () => {
                                    if (!window.confirm('Xóa file CV đã tải lên của hồ sơ này?')) return;
                                    try {
                                      const c = await candidateService.deleteCv(editingCandidate.id);
                                      setValues((p) => ({ ...p, cv_file: '' }));
                                      setRowVersion(c.row_version);
                                    } catch (e) {
                                      setBannerMessage({ type: 'error', text: e instanceof Error ? e.message : 'Không xóa được file CV.' });
                                    }
                                  }}
                                >
                                  <Trash2 className="w-3 h-3" /> Xóa file
                                </button>
                              )}
                            </span>
                          )}
                          {!cvFile && !values.cv_file && (
                            <span className="text-xs text-slate-500">PDF, Word hoặc ảnh, tối đa 10 MB. Có thể chỉ dán link ở ô bên trên.</span>
                          )}
                          {cvFile && (
                            <div className="w-full mt-1 space-y-2">
                              {/\.pdf$/i.test(cvFile.name) && cvPreviewUrl ? (
                                <iframe src={cvPreviewUrl} title="Xem trước CV" className="w-full h-80 border border-slate-300 rounded bg-white" />
                              ) : /\.(png|jpe?g)$/i.test(cvFile.name) && cvPreviewUrl ? (
                                <img src={cvPreviewUrl} alt="Xem trước CV" className="max-h-80 border border-slate-300 rounded bg-white" />
                              ) : (
                                <p className="text-xs text-slate-600">
                                  Không xem trước được file Word trong app. Hãy mở file để kiểm tra nội dung.
                                  {cvPreviewUrl && (
                                    <>
                                      {' '}
                                      <a href={cvPreviewUrl} download={cvFile.name} className="text-blue-700 underline">Mở file</a>
                                    </>
                                  )}
                                </p>
                              )}
                              <label className="flex items-start gap-2 text-xs text-slate-800">
                                <input type="checkbox" checked={cvConfirmed} onChange={(e) => setCvConfirmed(e.target.checked)} className="mt-0.5" />
                                <span>Tôi đã kiểm tra CV và các thông tin nhập từ CV (kể cả phần Tóm tắt kinh nghiệm); đồng ý đính kèm file này vào hồ sơ khi Lưu.</span>
                              </label>
                            </div>
                          )}
                        </div>
                      ) : field.type === 'dropdown' ||
                      field.type === 'dependent_dropdown' ||
                      field.type === 'time' ? (
                        <SearchableSelect
                          value={displayValue}
                          options={getDropdownOptionsForField(field)}
                          groupOf={field.key === 'position' ? positionGroupLabel : field.key === 'wd_step' && WD_STEPS_BY_PROCESS[values.wd_process] ? (o: string) => wdStepGroup(values.wd_process, o) : undefined}
                          onChange={(val) => updateField(field.key, val)}
                          disabled={
                            disabled ||
                            (field.key === 'location' && !values.region) ||
                            (REASON_SUB_KEYS.includes(field.key) && getDropdownOptionsForField(field).length === 0)
                          }
                          error={Boolean(errText)}
                          placeholder={
                            field.key === 'location' && !values.region
                              ? 'Chọn Vùng/Miền trước...'
                              : `Chọn ${field.label}...`
                          }
                          onProposeNewValue={
                            field.dropdownListKey && field.type !== 'time'
                              ? () => setProposeListKey(field.dropdownListKey!)
                              : undefined
                          }
                        />
                      ) : field.multiline ? (
                        <textarea
                          rows={4}
                          value={displayValue}
                          disabled={disabled}
                          onChange={(e) => updateField(field.key, e.target.value)}
                          placeholder={`Nhập ${field.label.toLowerCase()}...`}
                          className={`w-full px-3 py-2 text-sm rounded-md border transition-colors resize-y ${
                            disabled
                              ? 'bg-slate-100 text-slate-600 border-slate-200 cursor-not-allowed'
                              : 'bg-white border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
                          }`}
                        />
                      ) : (
                        <div className="relative">
                        <input
                          type="text"
                          list={field.key === 'pending_at' ? 'suggest-pending_at' : undefined}
                          value={displayValue}
                          disabled={disabled}
                          onChange={(e) => updateField(field.key, e.target.value)}
                          onBlur={field.key === 'phone' ? handlePhoneBlur : field.key === 'email' ? handleEmailBlur : undefined}
                          placeholder={
                            field.key === 'birth'
                              ? 'DD/MM/YYYY hoặc YYYY (VD: 15/08/1999 hoặc 1999)'
                              : field.key === 'cv_link'
                              ? 'https://www.linkedin.com/in/... hoặc link Drive'
                              : field.type === 'date'
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
                            field.key === 'birth' ||
                            isReadonly
                              ? 'font-mono-tabular'
                              : ''
                          } ${
                            disabled
                              ? 'bg-slate-100 text-slate-600 border-slate-200 cursor-not-allowed'
                              : errText
                              ? 'bg-white border-red-500 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-200'
                              : 'bg-white border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'
                          } ${field.type === 'date' && !disabled ? 'pr-9' : ''}`}
                        />
                        {field.type === 'date' && (
                          <DatePickButton value={String(displayValue ?? '')} disabled={disabled} onPick={(d) => updateField(field.key, d)} />
                        )}
                        </div>
                      )}

                      {errText && (
                        <p className="mt-1 text-xs text-red-600 flex items-start gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{errText}</span>
                        </p>
                      )}

                      {field.key === 'experience_summary' && !isReadonly && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await copyText(summaryPrompt({ position: values.position, experienceYears: values.experience_years }));
                              setPromptCopied(ok ? 'Đã sao chép prompt. Dán vào Claude cùng file CV, kiểm tra kết quả rồi dán vào ô này.' : 'Không sao chép được, hãy thử lại.');
                            }}
                            className="px-2 py-1 font-semibold text-blue-700 border border-blue-200 rounded hover:bg-blue-50"
                          >
                            Sao chép prompt tóm tắt
                          </button>
                          <span>{promptCopied || 'Dán prompt vào Claude kèm file CV, kiểm tra kết quả rồi dán vào ô này.'}</span>
                        </div>
                      )}

                      {!errText && noticeText && (
                        <p className="mt-1 text-xs text-blue-700 flex items-start gap-1">
                          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{noticeText}</span>
                        </p>
                      )}
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {section.id === 7 && candidateService.supportsAttachments() && (
                <div className="px-5 pb-5">
                  {isEditMode && editingCandidate ? (
                    <AttachmentsPanel candidateId={Number(editingCandidate.id)} canEdit={canEdit && !lockedSet.has('basic_salary')} />
                  ) : (
                    <p className="text-xs text-slate-500 border border-dashed border-slate-300 rounded-md p-3">
                      <strong>Salary Proposal và Payslips:</strong> lưu hồ sơ trước, sau đó mở lại hồ sơ để tải file lên.
                    </p>
                  )}
                </div>
              )}

              <div className="px-5 py-3 border-t border-blue-100 bg-slate-50 flex items-center justify-between">
                <button
                  type="button"
                  disabled={step <= 1}
                  onClick={() => goToStep(step - 1)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Mục trước
                </button>
                <span className="text-[11px] text-slate-500">
                  Mục {step}/{SECTIONS.length}
                  {step < SECTIONS.length && !stepComplete(step) && ' · còn trường bắt buộc chưa điền'}
                </span>
                <button
                  type="button"
                  disabled={step >= SECTIONS.length}
                  onClick={handleNext}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40"
                >
                  Mục tiếp theo <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
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

import React, { useState } from 'react';
import { X, Edit3, Archive, RotateCcw, FileText, Download } from 'lucide-react';
import { FIELD_CATALOG, SECTIONS, isFieldApplicable } from '../../../shared/fieldCatalog.ts';
import { StageBadge } from './StageBadge.tsx';
import { dupText } from '../../../shared/dup.ts';
import { formatVndDisplay } from '../../../shared/validation.ts';
import { candidateService, type CandidateRecord } from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';
import { CommentsPanel } from './CommentsPanel.tsx';
import { StatusChip } from './StatusChip.tsx';
import { CvBuilderModal } from './CvBuilderModal.tsx';
import { HrInfoBanner } from './HrInfoBanner.tsx';
import { CandidateOpsPanel } from './CandidateOpsPanel.tsx';
import { requiredDocuments, visibleDocumentKeys } from '../../../shared/documentRules.ts';

const STATUS_KEYS = new Set(['r1_status', 'r2_status', 'ob_status', 'emp_status']);

interface Props {
  candidate: CandidateRecord;
  user: UserProfile;
  canEdit: boolean;
  busy?: boolean;
  error?: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  extra?: React.ReactNode;
}

export const CandidateDetailModal: React.FC<Props> = ({
  candidate,
  user,
  canEdit,
  busy,
  error,
  onEdit,
  onDelete,
  onClose,
  extra,
}) => {
  const archived = Boolean(candidate.is_archived);
  const [showCv, setShowCv] = useState(false);
  const needDocs = requiredDocuments(String(candidate.position || ''), String(candidate.rank || ''));
  const missingDocs = needDocs.filter((k) => !String(candidate[k] || ''));
  const shownDocs = visibleDocumentKeys(String(candidate.position || ''));

  const show = (key: string, type: string): React.ReactNode => {
    const v = String(candidate[key] ?? '');
    if (!v) return <span className="text-slate-300">—</span>;
    if (STATUS_KEYS.has(key)) return <StatusChip value={v} />;
    if (key === 'cv_link') {
      return (
        <a href={v} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline break-all">
          {v}
        </a>
      );
    }
    const fdef = FIELD_CATALOG.find((x) => x.key === key);
    if (fdef?.type === 'document') {
      if (!v.includes('|')) return <span className="text-slate-600">Đã nộp (dữ liệu cũ)</span>;
      const name = v.split('|')[1] || v;
      return (
        <button
          type="button"
          className="text-blue-700 underline text-left break-all inline-flex items-center gap-1"
          onClick={() => candidateService.downloadDoc(candidate.id, key, name).catch(() => undefined)}
        >
          <Download className="w-3 h-3 shrink-0" />
          <span>{name}</span>
        </button>
      );
    }
    if (key === 'cv_file') {
      const name = v.split('|')[1] || v;
      return (
        <button
          type="button"
          className="text-blue-700 underline text-left inline-flex items-center gap-1"
          onClick={() => candidateService.downloadCv(candidate.id, name).catch(() => undefined)}
        >
          <Download className="w-3 h-3 shrink-0" />
          <span>{name}</span>
        </button>
      );
    }
    if (type === 'money') return <span className="font-mono-tabular font-medium">{formatVndDisplay(v)} ₫</span>;
    if (type === 'percentage') return <span className="font-mono-tabular font-medium">{v}%</span>;
    if (type === 'date') return <span className="font-mono-tabular font-medium">{v}</span>;
    return v;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate flex items-center gap-2">
              <span>{String(candidate.full_name || '—')}</span>
              <span className="font-mono-tabular text-slate-500 font-semibold">
                ({String(candidate.candidate_code || '')})
              </span>
              {archived && (
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                  Đã lưu trữ
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
              <span>Chi tiết hồ sơ ứng viên</span>
              <StageBadge candidate={candidate as unknown as Record<string, unknown>} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowCv(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-white border border-blue-200 rounded-md hover:bg-blue-50"
            >
              <FileText className="w-3.5 h-3.5" /> Tạo CV
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                <Edit3 className="w-3.5 h-3.5" /> Sửa
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded disabled:opacity-50 ${
                  archived
                    ? 'text-emerald-700 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100'
                    : 'text-amber-700 bg-amber-50 border border-amber-300 hover:bg-amber-100'
                }`}
              >
                {archived ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                <span>{archived ? 'Khôi phục' : 'Lưu trữ'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
              title="Đóng (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!archived && (
          <HrInfoBanner
            candidate={candidate as unknown as React.ComponentProps<typeof HrInfoBanner>['candidate']}
            canEdit={canEdit}
          />
        )}

        {error && <div className="px-5 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200">{error}</div>}
        {!canEdit && (
          <div className="px-5 py-2 text-[11px] text-slate-500 bg-slate-50 border-b border-slate-200">
            Chế độ chỉ xem. Bạn không phải là PIC phụ trách hồ sơ này ({String(candidate.pic || '—')}).
          </div>
        )}

        <div className="overflow-y-auto p-5 space-y-5">
          {extra}
          {candidate.dup && (
            <p className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {dupText(candidate.dup)}
            </p>
          )}
          {SECTIONS.map((section) => {
            const fields = FIELD_CATALOG.filter(
              (f) =>
                f.sectionId === section.id &&
                isFieldApplicable(f, candidate as unknown as Record<string, unknown>) &&
                (f.type !== 'document' || shownDocs.includes(f.key))
            );
            return (
              <section key={section.id}>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 pb-1 border-b border-slate-200">
                  {section.title}
                </h3>
                {section.id === 9 && missingDocs.length > 0 && (
                  <p className="mb-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                    Thiếu giấy tờ bắt buộc:{' '}
                    {missingDocs.map((k) => FIELD_CATALOG.find((f) => f.key === k)?.label).join(', ')}
                  </p>
                )}
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
                  {fields.map((f) => (
                    <div key={f.key} className={f.multiline ? 'sm:col-span-2 lg:col-span-3' : ''}>
                      <dt className="text-[11px] text-slate-500">
                        <span className="font-mono-tabular mr-1">#{f.index}</span>
                        {f.label}
                      </dt>
                      <dd
                        className={`text-xs font-medium break-words ${f.multiline ? 'whitespace-pre-wrap' : ''} ${
                          candidate.dup && (f.key === 'full_name' || f.key === 'phone')
                            ? 'text-red-700 font-bold'
                            : 'text-slate-900'
                        }`}
                      >
                        {show(f.key, f.type)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
          {/* M6-1: phỏng vấn, checklist tuyển, công việc của hồ sơ (như hệ cũ) */}
          <CandidateOpsPanel candidate={candidate} user={user} canEdit={canEdit && !archived} />
          <CommentsPanel candidateId={Number(candidate.id)} user={user} />
        </div>
      </div>
      {showCv && <CvBuilderModal candidate={candidate} onClose={() => setShowCv(false)} />}
    </div>
  );
};

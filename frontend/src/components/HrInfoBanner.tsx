// Chuyển lại từ OLD/src/components/HrInfoBanner.tsx (M6-4). Dữ liệu qua hrService (RPC 0018 + Edge hr-info-save / hr-form).
// PO 20/11/2026: gộp "Link trả lời" vào "Mở form thông tin nhân sự" – mở form là tự tìm câu trả lời Google Form của ứng viên
// (theo SĐT rồi CCCD) và điền sẵn các ô còn trống; ô đã có giá trị khác thì chỉ đổi khi người dùng bấm.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ClipboardList, Link2, X } from 'lucide-react';
import { ApiError, candidateService } from '../services/candidateService.ts';
import { hrService as dataService, type HrDuplicates, type HrFormResponse, type HrInfoRecord } from '../services/hrService.ts';
import { copyText } from '../../../shared/aiPrompts.ts';
import { HR_FIELDS, HR_GROUPS, HR_STATUS_LABELS, HrField, hrEligible, hrMissingCount } from '../../../shared/hrInfoRules.ts';

const STATUS_CLS: Record<string, string> = {
  none: 'bg-slate-100 text-slate-600',
  draft: 'bg-amber-50 text-amber-700',
  submitted: 'bg-blue-50 text-blue-700',
  verified: 'bg-emerald-50 text-emerald-700',
};

function dupMessage(d: HrDuplicates | null): string {
  if (!d || d.count === 0) return '';
  if (d.with.length) return `Số CCCD này trùng với hồ sơ: ${d.with.map((w) => `${w.code} (${w.pic})`).join(', ')}.`;
  const parts: string[] = [];
  if (d.own.length) parts.push(`hồ sơ của bạn: ${d.own.join(', ')}`);
  if (d.others) parts.push(`${d.others} hồ sơ của TA khác`);
  return `Số CCCD này trùng với ${parts.join(' và ')}.`;
}

interface CandidateLike {
  id: number | string;
  full_name?: string;
  candidate_code?: string;
  [k: string]: unknown;
}

/**
 * Banner shown in the header of a profile that passed round 2: shows the state of the HR Information and opens the form.
 * Only appears in the Google Apps Script version.
 */
export const HrInfoBanner: React.FC<{ candidate: CandidateLike; canEdit: boolean }> = ({ candidate, canEdit }) => {
  const id = Number(candidate.id);
  const eligible = candidateService.supportsAttachments() && hrEligible(candidate as Record<string, unknown>);
  const [status, setStatus] = useState<HrInfoRecord['status'] | 'none' | ''>('');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await dataService.getHrInfo(id);
      setStatus(r.info ? r.info.status : 'none');
    } catch {
      setStatus('');
    }
  }, [id]);

  useEffect(() => {
    if (eligible) refresh();
  }, [eligible, refresh]);

  const copyFormLink = async () => {
    setNote(null);
    try {
      const r = await dataService.hrFormLink(id);
      const ok = await copyText(r.url);
      setNote({ type: ok ? 'ok' : 'err', text: ok ? `Đã sao chép link form (lần gửi thứ ${r.sends.length}). Gửi cho ứng viên qua Zalo hoặc SMS.` : `Không sao chép tự động được. Link: ${r.url}` });
    } catch (e) {
      setNote({ type: 'err', text: e instanceof Error ? e.message : 'Không lấy được link form.' });
    }
  };

  if (!eligible || !status) return null;

  return (
    <>
      <div className="px-5 py-2.5 border-b border-emerald-200 bg-emerald-50 flex flex-wrap items-center gap-3 text-xs">
        <button type="button" onClick={copyFormLink} className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-emerald-800 bg-white border border-emerald-300 rounded-md hover:bg-emerald-100">
          <Link2 className="w-3.5 h-3.5" /> Link form
        </button>
        <ClipboardList className="w-4 h-4 text-emerald-700 shrink-0" />
        <span className="text-emerald-900 font-semibold">Ứng viên đã đạt vòng 2 — cần thu thập thông tin nhân sự.</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_CLS[status]}`}>{HR_STATUS_LABELS[status]}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700"
        >
          {status === 'none' ? 'Mở form thông tin nhân sự' : canEdit && status !== 'verified' ? 'Mở form để nhập / xác nhận' : 'Xem thông tin nhân sự'}
        </button>
      </div>
      {note && (
        <div className={`px-5 py-1.5 text-xs border-b ${note.type === 'ok' ? 'text-emerald-800 bg-white border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'}`} data-no-i18n>{note.text}</div>
      )}
      {open && (
        <HrInfoModal
          candidate={candidate}
          canEdit={canEdit}
          onClose={() => {
            setOpen(false);
            refresh();
          }}
        />
      )}
    </>
  );
};

const inputCls = (err: boolean, disabled: boolean) =>
  `w-full px-3 py-2 text-sm rounded-md border ${disabled ? 'bg-slate-100 text-slate-600 border-slate-200' : err ? 'bg-white border-red-500' : 'bg-white border-slate-300 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100'}`;

/** The HR Information form of one candidate: fill it in, save a draft, submit it complete, then the TA verifies and locks it. */
export const HrInfoModal: React.FC<{ candidate: CandidateLike; canEdit: boolean; onClose: () => void }> = ({ candidate, canEdit, onClose }) => {
  const id = Number(candidate.id);
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState(true);
  const [info, setInfo] = useState<HrInfoRecord | null>(null);
  const [data, setData] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<HrDuplicates | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  // câu trả lời Google Form (gộp từ nút "Link trả lời" cũ)
  const [answer, setAnswer] = useState<HrFormResponse | null>(null);
  const dataRef = useRef<Record<string, string>>({});
  dataRef.current = data;
  const [answerNote, setAnswerNote] = useState<{ type: 'ok' | 'info' | 'warn'; text: string } | null>(null);

  const initial = useCallback(
    (saved: Record<string, string> | null) => {
      const out: Record<string, string> = {};
      for (const f of HR_FIELDS) {
        const own = saved ? String(saved[f.key] ?? '') : '';
        // The first time, copy what the recruitment profile already knows.
        out[f.key] = own || (!saved && f.prefill ? String(candidate[f.prefill] ?? '') : '');
      }
      return out;
    },
    [candidate],
  );

  useEffect(() => {
    (async () => {
      try {
        const r = await dataService.getHrInfo(id);
        setEligible(r.eligible);
        setInfo(r.info);
        setDups(r.duplicates);
        const base = initial(r.info ? r.info.data : null);
        setData(base);
        if (r.eligible && r.info?.status !== 'verified') {
          // không chặn form: tìm câu trả lời ở nền rồi điền các ô còn trống (chưa lưu cho tới khi bấm Lưu)
          dataService.hrFormResponse(id).then(
            (res) => {
              setAnswer(res);
              if (!res.found) {
                setAnswerNote({
                  type: 'info',
                  text: res.reason === 'empty'
                    ? 'Sheet trả lời Google Form chưa có câu trả lời nào.'
                    : `Chưa thấy ứng viên gửi Google Form (tìm theo SĐT ${res.searched?.phone || '—'}${res.searched?.cccd ? ' và số CCCD' : ''}).`,
                });
                return;
              }
              if (!canEdit) return setAnswerNote({ type: 'info', text: `Ứng viên đã gửi Google Form lúc ${res.submitted_at}.` });
              let n = 0;
              const next = { ...dataRef.current };
              for (const f of HR_FIELDS) {
                const v = String(res.mapped?.[f.key] ?? '').trim();
                if (v && !String(next[f.key] ?? '').trim()) {
                  next[f.key] = v;
                  n++;
                }
              }
              if (n) setData(next);
              const many = (res.count || 0) > 1 ? ` Ứng viên đã gửi ${res.count} lần, đang dùng lần mới nhất.` : '';
              setAnswerNote({
                type: 'ok',
                text: n
                  ? `Đã điền sẵn ${n} ô trống từ Google Form (gửi lúc ${res.submitted_at}, tìm theo ${res.match_by === 'phone' ? 'SĐT' : 'CCCD'}). Chưa lưu – hãy kiểm tra rồi bấm Lưu.${many}`
                  : `Ứng viên đã gửi Google Form lúc ${res.submitted_at}; không có ô trống nào cần điền.${many}`,
              });
            },
            (e) => setAnswerNote({ type: 'warn', text: e instanceof Error ? e.message : 'Không đọc được câu trả lời Google Form.' }),
          );
        }
      } catch (e) {
        setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Không tải được thông tin nhân sự.' });
      } finally {
        setLoading(false);
      }
    })();
  }, [id, initial, canEdit]);

  const locked = !canEdit || info?.status === 'verified' || !eligible;
  const differing = answer?.found && !locked
    ? HR_FIELDS.filter((f) => {
        const v = String(answer.mapped?.[f.key] ?? '').trim();
        return v && v !== String(data[f.key] ?? '').trim();
      })
    : [];
  const missing = hrMissingCount(data);

  const act = async (fn: () => Promise<{ info: HrInfoRecord; duplicates: HrDuplicates }>, okText: string) => {
    setBusy(true);
    setMsg(null);
    setErrors({});
    try {
      const r = await fn();
      setInfo(r.info);
      setDups(r.duplicates);
      setData(initial(r.info.data));
      setMsg({ type: 'ok', text: okText });
    } catch (e) {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'Không thực hiện được.' });
    } finally {
      setBusy(false);
    }
  };

  const renderField = (f: HrField) => {
    const err = errors[f.key];
    const common = {
      value: data[f.key] ?? '',
      disabled: locked,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setData((d) => ({ ...d, [f.key]: e.target.value })),
    };
    return (
      <div key={f.key} className={f.type === 'textarea' ? 'md:col-span-2' : ''}>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          {f.label} {f.required && <span className="text-red-600">*</span>}
        </label>
        {f.type === 'select' ? (
          <select {...common} className={inputCls(Boolean(err), locked)}>
            <option value="">— Chọn —</option>
            {f.options?.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ) : f.type === 'textarea' ? (
          <textarea {...common} rows={2} maxLength={500} className={inputCls(Boolean(err), locked)} data-no-i18n />
        ) : (
          <input
            {...common}
            type="text"
            maxLength={300}
            inputMode={f.type === 'cccd' || f.type === 'cmnd' || f.type === 'account' || f.type === 'phone' ? 'numeric' : undefined}
            className={inputCls(Boolean(err), locked)}
            data-no-i18n
          />
        )}
        {err ? <p className="mt-1 text-[11px] text-red-600">{err}</p> : f.hint ? <p className="mt-1 text-[11px] text-slate-500">{f.hint}</p> : null}
        {f.key === 'id_number' && dupMessage(dups) && (
          <p className="mt-1 text-[11px] font-bold text-red-700 flex items-start gap-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {dupMessage(dups)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate">
              Thông tin nhân sự — {String(candidate.full_name || '')} <span className="text-slate-500 font-semibold">({String(candidate.candidate_code || '')})</span>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_CLS[info ? info.status : 'none']}`}>{HR_STATUS_LABELS[info ? info.status : 'none']}</span>
              {info?.status === 'verified' && <span data-no-i18n>Xác nhận bởi {info.verified_by}</span>}
              {!locked && missing > 0 && <span>Còn {missing} trường bắt buộc chưa nhập</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-900" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        {msg && (
          <div className={`px-5 py-2 text-xs border-b ${msg.type === 'ok' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'}`}>{msg.text}</div>
        )}
        {answerNote && (
          <div
            className={`px-5 py-2 text-xs border-b flex flex-wrap items-center gap-2 ${
              answerNote.type === 'ok' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : answerNote.type === 'warn' ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-slate-600 bg-slate-50 border-slate-200'
            }`}
          >
            <span data-no-i18n>{answerNote.text}</span>
            {differing.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setData((d) => {
                    const next = { ...d };
                    for (const f of differing) next[f.key] = String(answer?.mapped?.[f.key] ?? '').trim();
                    return next;
                  })
                }
                className="ml-auto px-2.5 py-1 font-semibold text-emerald-800 bg-white border border-emerald-300 rounded-md hover:bg-emerald-100"
                title={differing.map((f) => f.label).join(', ')}
              >
                Lấy theo Google Form cho {differing.length} ô đang khác
              </button>
            )}
          </div>
        )}
        {!eligible && !loading && (
          <div className="px-5 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">Chỉ nhập thông tin nhân sự cho ứng viên đã đạt vòng 2 (Passed).</div>
        )}
        {info?.status === 'verified' && (
          <div className="px-5 py-2 text-xs text-slate-700 bg-slate-50 border-b border-slate-200">Thông tin đã được xác nhận và khóa. Bấm “Mở lại để sửa” nếu cần chỉnh.</div>
        )}

        <div className="overflow-y-auto p-5 space-y-5">
          {loading ? (
            <p className="text-xs text-slate-500">Đang tải...</p>
          ) : (
            HR_GROUPS.map((g) => (
              <section key={g.id}>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 pb-1 border-b border-slate-200">{g.title}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">{HR_FIELDS.filter((f) => f.group === g.id).map(renderField)}</div>
              </section>
            ))
          )}
          <p className="text-[11px] text-slate-500">Thông tin này chỉ Admin và TA phụ trách hồ sơ xem được. Nhật ký chỉ ghi tên các trường đã đổi, không ghi nội dung.</p>
        </div>

        {!loading && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white hover:bg-slate-50">Đóng</button>
            {canEdit && eligible && info?.status === 'verified' && (
              <button type="button" disabled={busy} onClick={() => act(() => dataService.verifyHrInfo(id, false), 'Đã mở lại. Bạn có thể sửa thông tin.')} className="px-3 py-1.5 text-xs font-semibold text-amber-800 border border-amber-300 rounded-md bg-white hover:bg-amber-50 disabled:opacity-50">
                Mở lại để sửa
              </button>
            )}
            {!locked && (
              <>
                <button type="button" disabled={busy} onClick={() => act(() => dataService.saveHrInfo(id, data, 'draft'), 'Đã lưu nháp.')} className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-50">
                  Lưu nháp
                </button>
                <button type="button" disabled={busy} onClick={() => act(() => dataService.saveHrInfo(id, data, 'submit'), 'Đã lưu thông tin đầy đủ. Hãy kiểm tra lại rồi bấm Xác nhận.')} className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
                  Lưu (đã nhập đủ)
                </button>
              </>
            )}
            {!locked && info?.status === 'submitted' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('Xác nhận bạn đã đối chiếu thông tin với giấy tờ của ứng viên? Sau khi xác nhận sẽ bị khóa cho đến khi mở lại.')) return;
                  act(() => dataService.verifyHrInfo(id, true), 'Đã xác nhận thông tin nhân sự.');
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
              >
                Xác nhận
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

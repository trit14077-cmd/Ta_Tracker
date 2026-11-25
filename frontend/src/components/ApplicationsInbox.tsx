import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Inbox, LoaderCircle, Mail, MapPin, Phone, RotateCcw, UserPlus, X } from 'lucide-react';
import { type CandidateRecord, type DropdownDataResponse } from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';
import { applicationsService as dataService, type ApplicationItem } from '../services/applicationsService.ts';
import { CandidateFormView } from './CandidateFormView.tsx';

// Chép nguyên từ OLD/src/components/ApplicationsInbox.tsx (M7-3). Dữ liệu qua applicationsService (RPC 0024, Edge files).
/**
 * "Ứng tuyển online" on the candidate page: the link to send to candidates (public form, no login) and the
 * applications that came back. "Tạo hồ sơ" opens the new-candidate form with the values filled in; after saving,
 * the application is marked done and its CV is attached to the profile (apps-script/Apply.gs).
 */

type Status = 'new' | 'done' | 'skipped' | 'all';
const TABS: [Status, string][] = [
  ['new', 'Mới'],
  ['done', 'Đã tạo hồ sơ'],
  ['skipped', 'Đã bỏ qua'],
  ['all', 'Tất cả'],
];
function fmtTime(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const errText = (e: unknown, fb: string) => (e instanceof Error && e.message ? e.message : fb);

interface Props {
  user: UserProfile;
  dropdowns: DropdownDataResponse;
  onClose: () => void;
  /** A profile was created from an application (the list of candidates should reload). */
  onCandidateCreated: () => void;
  /** The number of new applications changed (for the badge of the button). */
  onCountChange: (n: number) => void;
}

export const ApplicationsInbox: React.FC<Props> = ({ user, dropdowns, onClose, onCandidateCreated, onCountChange }) => {
  const isAdmin = user.role === 'admin';
  const [status, setStatus] = useState<Status>('new');
  const [picFilter, setPicFilter] = useState('');
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(0);

  // The link to share: a TA has their own; Admin picks a TA or the general link.
  const [linkPic, setLinkPic] = useState(isAdmin ? '' : user.pic_code || '');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [linkNonce, setLinkNonce] = useState(0);
  useEffect(() => {
    setLink('');
    dataService.applicationLink(isAdmin ? linkPic : '').then(
      (r) => setLink(r.url),
      (e) => setError(errText(e, 'Chưa lấy được link ứng tuyển.'))
    );
  }, [isAdmin, linkPic, linkNonce]);

  // Admin: the careers page on the company domain (links then use it instead of script.google.com).
  const [pageUrl, setPageUrl] = useState('');
  const [pageUrlSaved, setPageUrlSaved] = useState('');
  const [showPageUrl, setShowPageUrl] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const savePageUrl = async () => {
    setSavingUrl(true);
    setUrlMsg(null);
    try {
      const r = await dataService.setApplyPageUrl(pageUrl.trim());
      setPageUrlSaved(r.page_url);
      setUrlMsg({ ok: true, text: r.page_url ? 'Đã lưu. Các link ứng tuyển giờ dùng địa chỉ trang công ty.' : 'Đã xóa. Link quay về trang tuyển dụng đi kèm hệ thống.' });
      setLinkNonce((n) => n + 1);
    } catch (e) {
      setUrlMsg({ ok: false, text: errText(e, 'Chưa lưu được.') });
    } finally {
      setSavingUrl(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const t = document.createElement('textarea');
      t.value = link;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await dataService.listApplications(status, picFilter);
      setItems(r.items);
      setCounts(r.counts);
      if (r.links.page_url !== undefined) {
        setPageUrlSaved(r.links.page_url || '');
        setPageUrl((cur) => cur || r.links.page_url || '');
      }
      if (!picFilter) onCountChange(r.counts.new || 0);
    } catch (e) {
      setError(errText(e, 'Không tải được hồ sơ ứng tuyển.'));
    } finally {
      setLoading(false);
    }
  }, [status, picFilter, onCountChange]);
  useEffect(() => {
    load();
  }, [load]);

  const setAppStatus = async (a: ApplicationItem, s: 'new' | 'skipped') => {
    setBusyId(a.id);
    try {
      await dataService.setApplicationStatus(a, s);
      await load();
    } catch (e) {
      setError(errText(e, 'Không cập nhật được.'));
    } finally {
      setBusyId(0);
    }
  };

  // ---------- create the profile from an application
  const [creating, setCreating] = useState<ApplicationItem | null>(null);
  const [createMsg, setCreateMsg] = useState('');
  const prefillOf = (a: ApplicationItem) => {
    const values: Record<string, string> = { full_name: a.full_name, phone: a.phone, email: a.email, experience_summary: a.note };
    if (a.pic) values.pic = a.pic;
    else if (user.pic_code) values.pic = user.pic_code;
    // "Khu vực mong muốn" fills Location (and its Region) when it is exactly one of the locations of the list.
    const area = a.area.trim().toLowerCase();
    if (area) {
      for (const [region, locs] of Object.entries(dropdowns.regionToLocations || {})) {
        const hit = locs.find((l) => l.toLowerCase() === area);
        if (hit) {
          values.region = region;
          values.location = hit;
          break;
        }
      }
    }
    return values;
  };
  const afterSaved = async (cand: CandidateRecord) => {
    const a = creating;
    setCreating(null);
    if (!a) return;
    try {
      const r = await dataService.convertApplication(a, Number(cand.id));
      setCreateMsg(`Đã tạo hồ sơ ${String(cand.candidate_code)} cho ${a.full_name}${r.cv_attached ? ', đã gắn CV ứng viên gửi' : ''}.`);
    } catch (e) {
      setCreateMsg(`Đã tạo hồ sơ ${String(cand.candidate_code)} nhưng chưa đánh dấu được hồ sơ ứng tuyển: ${errText(e, 'lỗi')}`);
    }
    onCandidateCreated();
    load();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, onClose]);

  const picOptions = (dropdowns.lists.pic || []).filter((o) => o.active);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 p-3 sm:p-6 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="apps-title" className="w-full max-w-4xl bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <h2 id="apps-title" className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="w-4 h-4 text-blue-600" /> Ứng tuyển online
          </h2>
          <button type="button" onClick={onClose} title="Đóng" className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Link to share */}
        <div className="px-5 py-4 border-b border-slate-200 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-800">Link gửi ứng viên</span>
            {isAdmin ? (
              <select value={linkPic} onChange={(e) => setLinkPic(e.target.value)} className="px-2 py-1 text-xs border border-slate-300 rounded bg-white">
                <option value="">Link chung (chưa gán TA)</option>
                {picOptions.map((o) => (
                  <option key={o.value} value={o.value}>Link của {o.value}</option>
                ))}
              </select>
            ) : (
              <span className="text-slate-500">(hồ sơ gửi qua link này tự gán cho {user.pic_code})</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={link || 'Đang lấy link...'} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-[220px] px-3 py-2 text-xs border border-slate-300 rounded-md bg-slate-50 text-slate-700" data-no-i18n />
            <button type="button" disabled={!link} onClick={copy} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Đã sao chép' : 'Sao chép link'}
            </button>
            {link && (
              <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-blue-700 border border-blue-200 rounded-md hover:bg-blue-50">
                <ExternalLink className="w-3.5 h-3.5" /> Mở thử
              </a>
            )}
          </div>
          <p className="text-[11px] text-slate-500">Ứng viên mở link là điền được ngay, không cần đăng nhập. Hồ sơ gửi về nằm ở danh sách bên dưới, chưa vào danh sách ứng viên cho đến khi bạn bấm "Tạo hồ sơ".</p>
          {isAdmin && (
            <div className="pt-1">
              <button type="button" onClick={() => setShowPageUrl((v) => !v)} className="text-[11px] font-semibold text-blue-700 underline">
                {pageUrlSaved ? `Trang tuyển dụng của công ty: ${pageUrlSaved}` : 'Dùng tên miền của công ty cho link'}
              </button>
              {showPageUrl && (
                <div className="mt-2 p-3 rounded-md border border-slate-200 bg-slate-50 space-y-2">
                  <label htmlFor="page-url" className="block text-[11px] font-semibold text-slate-700">Địa chỉ trang tuyển dụng (đã đặt trang apply.html lên tên miền công ty)</label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="page-url"
                      value={pageUrl}
                      onChange={(e) => setPageUrl(e.target.value)}
                      placeholder="https://tuyendung.thesupra.vn/"
                      className="flex-1 min-w-[220px] px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      data-no-i18n
                    />
                    <button type="button" disabled={savingUrl} onClick={savePageUrl} className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 rounded-md hover:bg-slate-900 disabled:opacity-50">
                      {savingUrl ? 'Đang lưu...' : 'Lưu'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">Để trống rồi bấm Lưu để quay về trang đi kèm hệ thống. Link cũ đã gửi cho ứng viên vẫn dùng được.</p>
                  {urlMsg && <p className={`text-[11px] ${urlMsg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{urlMsg.text}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Inbox */}
        <div className="px-5 pt-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
          <div role="tablist" className="flex gap-1">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={status === k}
                onClick={() => setStatus(k)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${status === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {label}
                {counts[k] !== undefined && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px]" data-no-i18n>{counts[k]}</span>}
              </button>
            ))}
          </div>
          {isAdmin && (
            <select value={picFilter} onChange={(e) => setPicFilter(e.target.value)} className="mb-2 px-2 py-1 text-xs border border-slate-300 rounded bg-white">
              <option value="">Tất cả TA</option>
              {picOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.value}</option>
              ))}
            </select>
          )}
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {createMsg && <div className="px-3 py-2 text-xs rounded border text-emerald-800 bg-emerald-50 border-emerald-200" role="status">{createMsg}</div>}
          {error && <div className="px-3 py-2 text-xs rounded border text-red-700 bg-red-50 border-red-200">{error}</div>}
          {loading ? (
            <div className="py-10 flex justify-center text-slate-400"><LoaderCircle className="w-5 h-5 animate-spin" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">{status === 'new' ? 'Chưa có hồ sơ mới. Gửi link phía trên cho ứng viên để bắt đầu nhận hồ sơ.' : 'Không có hồ sơ.'}</p>
          ) : (
            items.map((a) => (
              <article key={a.id} className={`rounded-lg border p-3 text-xs ${a.status === 'new' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900" data-no-i18n>{a.full_name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-slate-600" data-no-i18n>
                      <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" />{a.phone}</span>
                      {a.email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3 text-slate-400" />{a.email}</span>}
                      {a.position && <span className="inline-flex items-center gap-1 font-semibold text-slate-700" data-no-i18n>{a.position}</span>}
                      {a.area && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-400" />{a.area}</span>}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500 shrink-0">
                    <div>{fmtTime(a.created_at)}</div>
                    {isAdmin && <div data-no-i18n>{a.pic || 'Link chung'}</div>}
                  </div>
                </div>
                {a.note && <p className="mt-2 text-slate-700 whitespace-pre-wrap line-clamp-3" data-no-i18n>{a.note}</p>}
                {a.dup && (
                  <p className="mt-2 text-[11px] font-semibold text-red-700">
                    Trùng SĐT với {a.dup.count} hồ sơ đã có{a.dup.codes.length ? `: ${a.dup.codes.join(', ')}` : ' (của TA khác)'}.
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {a.cv_name && (
                    <button type="button" onClick={() => dataService.downloadApplicationCv(a.id, a.cv_name).catch((e) => setError(errText(e, 'Không tải được CV.')))} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-semibold text-slate-700 border border-slate-300 rounded-md bg-white hover:bg-slate-50 max-w-[260px]">
                      <Download className="w-3.5 h-3.5 shrink-0" /> <span className="truncate" data-no-i18n>{a.cv_name}</span>
                    </button>
                  )}
                  <span className="flex-1" />
                  {a.status === 'new' && (
                    <>
                      <button type="button" disabled={busyId === a.id} onClick={() => setAppStatus(a, 'skipped')} className="px-2.5 py-1.5 font-semibold text-slate-600 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-50">
                        Bỏ qua
                      </button>
                      <button type="button" disabled={busyId === a.id} onClick={() => { setCreateMsg(''); setCreating(a); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50">
                        <UserPlus className="w-3.5 h-3.5" /> Tạo hồ sơ
                      </button>
                    </>
                  )}
                  {a.status === 'skipped' && (
                    <button type="button" disabled={busyId === a.id} onClick={() => setAppStatus(a, 'new')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-semibold text-slate-700 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-50">
                      <RotateCcw className="w-3.5 h-3.5" /> Đưa lại vào Mới
                    </button>
                  )}
                  {a.status === 'done' && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-50 text-emerald-800 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Đã tạo hồ sơ <span data-no-i18n>{a.candidate_code}</span>
                    </span>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      {creating && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/60 p-3 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-6xl bg-slate-50 rounded-lg shadow-xl border border-slate-200">
            <CandidateFormView
              user={user}
              dropdowns={dropdowns}
              editingCandidate={null}
              prefill={{
                values: prefillOf(creating),
                note: (
                  <>
                    Tạo hồ sơ từ form ứng tuyển online của <strong>{creating.full_name}</strong>
                    {creating.area ? <> (khu vực mong muốn: <strong>{creating.area}</strong>)</> : null}. Họ tên, SĐT, email và phần giới thiệu đã điền sẵn; hãy chọn vị trí, kho và nguồn.
                    {creating.cv_name ? ' CV ứng viên gửi sẽ tự gắn vào hồ sơ sau khi lưu.' : ''}
                  </>
                ),
              }}
              onDirtyChange={() => undefined}
              onSaved={(cand) => afterSaved(cand)}
              onCancel={() => setCreating(null)}
              onRefreshDropdowns={() => undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
};

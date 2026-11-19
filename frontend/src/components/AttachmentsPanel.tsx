import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import {
  candidateService,
  type AttachmentInfo,
  type AttachmentKindInfo,
} from '../services/candidateService.ts';

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const AttachmentsPanel: React.FC<{ candidateId: number; canEdit: boolean }> = ({ candidateId, canEdit }) => {
  const [kinds, setKinds] = useState<AttachmentKindInfo[]>([]);
  const [items, setItems] = useState<AttachmentInfo[]>([]);
  const [max, setMax] = useState(20);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const pick = useRef<HTMLInputElement>(null);
  const target = useRef<{ kind: string; replaceId: number }>({ kind: '', replaceId: 0 });

  const load = useCallback(async () => {
    try {
      const r = await candidateService.listAttachments(candidateId);
      setKinds(r.kinds);
      setItems(r.attachments);
      setMax(r.max_per_kind);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách tài liệu.');
    }
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError('');
    setMsg('');
    try {
      const m = await fn();
      if (m) setMsg(m);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được.');
    } finally {
      setBusy('');
    }
  };

  const onFiles = (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return;
    const { kind, replaceId } = target.current;
    if (replaceId) {
      run(`r:${replaceId}`, async () => {
        await candidateService.uploadAttachment(candidateId, kind, list[0]);
        return 'Đã thay file.';
      });
      return;
    }
    run(`u:${kind}`, async () => {
      const failed: string[] = [];
      let ok = 0;
      for (const f of list) {
        try {
          await candidateService.uploadAttachment(candidateId, kind, f);
          ok++;
        } catch (e) {
          failed.push(`${f.name}: ${e instanceof Error ? e.message : 'lỗi không rõ'}`);
        }
      }
      if (failed.length) throw new Error(`${ok ? `Đã tải ${ok} file. ` : ''}Không tải được: ${failed.join('; ')}`);
      return `Đã tải lên ${ok} file.`;
    });
  };

  if (!kinds.length && !error) return null;

  return (
    <section>
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 pb-1 border-b border-slate-200">Salary Proposal và Payslips</h3>
      <p className="text-[11px] text-slate-500 mb-2">Chỉ Admin và TA phụ trách hồ sơ này xem được. PDF, Word, Excel hoặc ảnh, tối đa 10 MB mỗi file, tối đa {max} file mỗi loại.</p>
      <input
        ref={pick}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xlsx,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          onFiles(files);
          e.target.value = '';
        }}
      />
      {error && <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
      {msg && <p className="mb-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">{msg}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {kinds.map((k) => {
          const mine = items.filter((a) => a.kind === k.key);
          return (
            <div key={k.key} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-800">{k.label}</div>
                  <div className="text-[11px] text-slate-500">{k.hint}</div>
                </div>
                {canEdit && k.applicable && (
                  <button
                    type="button"
                    disabled={busy !== '' || mine.length >= max}
                    onClick={() => {
                      target.current = { kind: k.key, replaceId: 0 };
                      pick.current?.click();
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
                  >
                    <Upload className="w-3 h-3" /> Tải lên
                  </button>
                )}
              </div>
              {!k.applicable && <p className="mt-2 text-[11px] text-amber-700">Không áp dụng cho Rank hiện tại của hồ sơ này.</p>}
              <ul className="mt-2 space-y-1.5">
                {mine.map((a) => (
                  <li key={a.id} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-1.5">
                    <span className="font-medium break-all" data-no-i18n>{a.file_name}</span>
                    <span className="text-slate-500" data-no-i18n>
                      {fmtSize(a.size)} · {a.uploaded_by} · {fmtTime(a.uploaded_at)}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy !== ''}
                        onClick={() => alert(`Tải xuống file: ${a.file_name}`)}
                        className="inline-flex items-center gap-1 text-blue-700 underline disabled:opacity-50"
                      >
                        <Download className="w-3 h-3" /> Tải xuống
                      </button>
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            disabled={busy !== ''}
                            onClick={() => {
                              target.current = { kind: a.kind, replaceId: a.id };
                              pick.current?.click();
                            }}
                            className="inline-flex items-center gap-1 text-slate-700 underline disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" /> Thay
                          </button>
                          <button
                            type="button"
                            disabled={busy !== ''}
                            onClick={() => {
                              if (!window.confirm(`Xóa file "${a.file_name}"? Không thể khôi phục.`)) return;
                              run(`x:${a.id}`, async () => {
                                await candidateService.deleteAttachment(candidateId, a.id);
                                return 'Đã xóa file.';
                              });
                            }}
                            className="inline-flex items-center gap-1 text-red-600 underline disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" /> Xóa
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
                {mine.length === 0 && k.applicable && <li className="text-[11px] text-slate-400">Chưa có file.</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
};

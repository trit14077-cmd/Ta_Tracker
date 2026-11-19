import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2, Send } from 'lucide-react';
import { candidateService, type CandidateComment } from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';

const COMMENT_MAX = 5000;

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Internal comments of a candidate. Only people who can open the candidate see them; never shown to the candidate or put in a CV. */
export const CommentsPanel: React.FC<{ candidateId: number; user: UserProfile; readOnly?: boolean }> = ({ candidateId, user, readOnly }) => {
  const [items, setItems] = useState<CandidateComment[]>([]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await candidateService.getComments(candidateId));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được bình luận.');
    }
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được.');
    } finally {
      setBusy(false);
    }
  };

  const canChange = (c: CandidateComment) => user.role === 'admin' || c.author_username === user.username;

  return (
    <section>
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 pb-1 border-b border-slate-200">
        Bình luận nội bộ <span className="font-normal normal-case text-slate-400">({items.length}) · không hiển thị cho ứng viên</span>
      </h3>
      {error && <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
      <ul className="space-y-2">
        {items.length === 0 && <li className="text-xs text-slate-400">Chưa có bình luận nào.</li>}
        {items.map((c) => (
          <li key={c.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <b className="text-slate-700">{c.author_username}</b>
              <span>{c.author_role === 'admin' ? 'Admin' : 'TA'}</span>
              <span>· {fmtTime(c.created_at)}</span>
              {c.updated_at && <span className="text-slate-400">· đã sửa {fmtTime(c.updated_at)}</span>}
              {!readOnly && canChange(c) && editing !== c.id && (
                <span className="ml-auto inline-flex gap-1">
                  <button type="button" title="Sửa" className="p-1 hover:text-blue-600" onClick={() => { setEditing(c.id); setEditText(c.body); }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button" title="Xóa" className="p-1 hover:text-red-600" disabled={busy}
                    onClick={() => { if (window.confirm('Xóa bình luận này?')) run(() => candidateService.deleteComment(c.id)); }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
            </div>
            {editing === c.id ? (
              <div className="mt-1.5 space-y-1.5">
                <textarea
                  rows={3} value={editText} maxLength={COMMENT_MAX} onChange={(e) => setEditText(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded border border-slate-300 focus:outline-none focus:border-blue-600"
                />
                <div className="flex gap-2">
                  <button
                    type="button" disabled={busy || !editText.trim()}
                    onClick={() => run(async () => { await candidateService.editComment(c.id, editText); setEditing(null); })}
                    className="px-2.5 py-1 text-xs font-semibold text-white bg-blue-600 rounded disabled:opacity-50"
                  >Lưu</button>
                  <button type="button" onClick={() => setEditing(null)} className="px-2.5 py-1 text-xs text-slate-600 border border-slate-300 rounded">Hủy</button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-900 whitespace-pre-wrap break-words">{c.body}</p>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="mt-2 flex gap-2 items-end">
          <textarea
            rows={2} value={text} maxLength={COMMENT_MAX} onChange={(e) => setText(e.target.value)} placeholder="Viết bình luận nội bộ..."
            className="flex-1 px-2 py-1.5 text-xs rounded border border-slate-300 focus:outline-none focus:border-blue-600"
          />
          <button
            type="button" disabled={busy || !text.trim()}
            onClick={() => run(async () => { await candidateService.addComment(candidateId, text); setText(''); })}
            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-white bg-blue-600 rounded disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" /> Gửi
          </button>
        </div>
      )}
    </section>
  );
};

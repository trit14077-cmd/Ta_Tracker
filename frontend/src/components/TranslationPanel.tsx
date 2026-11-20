// Chép nguyên từ OLD/src/components/TranslationPanel.tsx (M7-2). Dữ liệu qua candidateService (RPC 0023 translation_list / translation_save).
import React, { useCallback, useEffect, useState } from 'react';
import { candidateService as dataService, type TranslationInfo } from '../services/candidateService.ts';
import { FIELD_BY_KEY } from '../../../shared/fieldCatalog.ts';
import { copyText, translationPrompt } from '../../../shared/aiPrompts.ts';

const STATUS: Record<string, { label: string; cls: string }> = {
  none: { label: 'Chưa dịch', cls: 'bg-slate-100 text-slate-600' },
  translated: { label: 'Đã dịch', cls: 'bg-emerald-50 text-emerald-700' },
  outdated: { label: 'Cần cập nhật', cls: 'bg-amber-50 text-amber-700' },
};

/**
 * English version of the text fields. The Vietnamese original is kept as it is; the English text is stored apart.
 * Nothing is translated automatically: copy the prompt into Claude, check the answer, paste it here and save.
 */
export const TranslationPanel: React.FC<{ candidateId: number; canEdit: boolean; refreshKey?: number }> = ({ candidateId, canEdit, refreshKey }) => {
  const [items, setItems] = useState<TranslationInfo[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await dataService.getTranslations(candidateId);
      setItems(list);
      setDrafts(Object.fromEntries(list.map((t) => [t.field_key, t.en_text])));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được bản dịch.');
    }
  }, [candidateId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!items.length && !error) return null;

  return (
    <section>
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2 pb-1 border-b border-slate-200">Bản dịch tiếng Anh</h3>
      <p className="text-[11px] text-slate-500 mb-2">
        Bấm “Sao chép prompt dịch”, dán vào Claude, kiểm tra kết quả rồi dán vào ô tiếng Anh và bấm Lưu. Bản gốc tiếng Việt không bị thay đổi.
      </p>
      {error && <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
      {msg && <p className="mb-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">{msg}</p>}
      {items.map((t) => {
        const st = STATUS[t.status];
        const dirty = (drafts[t.field_key] ?? '') !== t.en_text;
        return (
          <div key={t.field_key} className="border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800">{FIELD_BY_KEY[t.field_key]?.label || t.field_key}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Bản gốc (tiếng Việt)</div>
              <div className="text-xs whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded px-2 py-1.5 min-h-[2rem]" data-no-i18n>
                {t.source_text || '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">Bản tiếng Anh</div>
              <textarea
                value={drafts[t.field_key] ?? ''}
                disabled={!canEdit}
                maxLength={5000}
                rows={4}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.field_key]: e.target.value }))}
                className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 disabled:bg-slate-50"
                data-no-i18n
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!t.source_text.trim()}
                onClick={async () => {
                  const ok = await copyText(translationPrompt(t.source_text));
                  setMsg(ok ? 'Đã sao chép prompt dịch. Dán vào Claude.' : 'Không sao chép được, hãy chọn và sao chép thủ công.');
                }}
                className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50"
              >
                Sao chép prompt dịch
              </button>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy !== '' || !dirty}
                  onClick={async () => {
                    setBusy(t.field_key);
                    setError('');
                    try {
                      await dataService.putTranslation(candidateId, t.field_key, drafts[t.field_key] ?? '');
                      setMsg('Đã lưu bản dịch.');
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Không lưu được bản dịch.');
                    } finally {
                      setBusy('');
                    }
                  }}
                  className="px-2.5 py-1 text-[11px] font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Lưu bản dịch
                </button>
              )}
              {t.updated_at && (
                <span className="text-[11px] text-slate-500" data-no-i18n>
                  Cập nhật bởi {t.updated_by}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
};

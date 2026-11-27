import React, { useMemo, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import type { CandidateRecord } from '../services/candidateService.ts';
import { getTodayIsoInHoChiMinh } from '../../../shared/validation.ts';
import {
  DEFAULT_EXTRAS,
  EMAIL_TEMPLATES,
  type EmailExtras,
  type EmailFlow,
  type EmailSender,
  type EmailTemplateId,
  type EmailSuggestion,
  composeEmail,
  copyEmailHtml,
  flowOfRank,
  suggestEmails,
} from '../../../shared/emailTemplates.ts';

const SENDER_KEY = 'ta.emailSender';
const EMPTY_SENDER: EmailSender = { name: '', title: 'Talent Acquisition Specialist', phone: '', email: '' };

function loadSender(): EmailSender {
  try {
    return { ...EMPTY_SENDER, ...JSON.parse(localStorage.getItem(SENDER_KEY) || '{}') };
  } catch {
    return EMPTY_SENDER;
  }
}

const DUE: Record<EmailSuggestion['due'], { label: string; cls: string }> = {
  now: { label: 'Cần gửi bây giờ', cls: 'bg-emerald-100 text-emerald-800' },
  later: { label: 'Chưa đến lúc / đã qua', cls: 'bg-slate-100 text-slate-600' },
  need_ob_date: { label: 'Chờ ngày OB', cls: 'bg-amber-100 text-amber-800' },
};
const TIMING = { before_ob: 'Trước OB', after_ob: 'Sau OB' } as const;

const firstPick = (list: EmailSuggestion[]) => (list.find((t) => t.due === 'now') || list[0]).id;

const FLOW_LABEL: Record<EmailFlow, string> = { rank6: 'Luồng 1 – Rank 6', rank5up: 'Luồng 2 – Rank 5 trở lên' };

export const EmailComposerModal: React.FC<{ candidate: CandidateRecord; onClose: () => void }> = ({ candidate, onClose }) => {
  const c = candidate as unknown as Record<string, unknown>;
  const today = getTodayIsoInHoChiMinh();
  const [flow, setFlow] = useState<EmailFlow>(flowOfRank(String(c.rank || '')));
  const templates = useMemo(() => suggestEmails(c, today, flow), [c, today, flow]);
  const [tplId, setTplId] = useState<EmailTemplateId>(() => firstPick(suggestEmails(c, today, flow)));
  const [extras, setExtras] = useState<EmailExtras>({ ...DEFAULT_EXTRAS, sendDate: today });
  const [sender, setSender] = useState<EmailSender>(loadSender);
  const [copied, setCopied] = useState('');

  const meta = EMAIL_TEMPLATES.find((t) => t.id === tplId)!;
  const mail = useMemo(() => composeEmail(tplId, c, extras, sender), [tplId, c, extras, sender]);

  const pickFlow = (f: EmailFlow) => {
    setFlow(f);
    setTplId(firstPick(suggestEmails(c, today, f)));
  };
  const setX = (k: keyof EmailExtras, v: string) => setExtras((p) => ({ ...p, [k]: v }));
  const setS = (k: keyof EmailSender, v: string) =>
    setSender((p) => {
      const next = { ...p, [k]: v };
      localStorage.setItem(SENDER_KEY, JSON.stringify(next));
      return next;
    });

  const flash = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(''), 1500);
  };
  const copySubject = async () => {
    try {
      await navigator.clipboard.writeText(mail.subject);
      flash('subject');
    } catch {
      /* ignore */
    }
  };
  const copyBody = async () => {
    if (await copyEmailHtml(mail)) flash('body');
  };

  // chỉ hiện ô nhập cần cho mẫu đang chọn
  const need: Record<EmailTemplateId, (keyof EmailExtras)[]> = {
    r6_new_hire: ['sendDate'],
    support_prep: ['workAddress'],
    ob_schedule: ['workEmail'],
    reminder: ['obTime', 'workAddress'],
    after_ob_contacts: [],
  };
  const LABELS: Record<keyof EmailExtras, string> = {
    obTime: 'Giờ nhận việc',
    workEmail: 'Email công ty của nhân sự mới',
    workAddress: 'Địa điểm làm việc (trống thì lấy Kho/Địa điểm trong hồ sơ)',
    sendDate: 'Ngày gửi',
  };

  const input = 'w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:border-blue-600';
  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-900">Soạn email theo mẫu – {String(c.full_name || '')}</div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-900" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[340px_1fr]">
          <div className="p-4 space-y-3 overflow-y-auto border-r border-slate-200 text-xs">
            <div className="flex flex-wrap gap-1.5">
              {(['rank6', 'rank5up'] as EmailFlow[]).map((f) => (
                <button key={f} type="button" onClick={() => pickFlow(f)} className={`px-2.5 py-1 rounded border ${flow === f ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-700'}`}>
                  {FLOW_LABEL[f]}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-slate-500">
              Rank: {String(c.rank || '(trống)')} · Ngày OB: {String(c.ob_date || '(chưa có)')}
            </div>
            <div className="space-y-1">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTplId(t.id)}
                  className={`w-full text-left px-2.5 py-1.5 rounded border ${tplId === t.id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  <div>
                    <span className="font-semibold">Bước {t.step}.</span> {t.label}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-slate-500">{TIMING[t.timing]}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${DUE[t.due].cls}`}>{DUE[t.due].label}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="rounded bg-slate-50 border border-slate-200 p-2 space-y-1">
              {meta.purpose}
            </div>
            {need[tplId].map((k) => (
              <label key={k} className="block space-y-1">
                <span className="font-semibold text-slate-700">{LABELS[k]}</span>
                <input className={input} type={k === 'sendDate' ? 'date' : k === 'obTime' ? 'time' : 'text'} value={extras[k]} onChange={(e) => setX(k, e.target.value)} />
              </label>
            ))}
            <details className="border-t border-slate-200 pt-2" open={!sender.name}>
              <summary className="font-semibold text-slate-700 cursor-pointer">Chữ ký người gửi (lưu trên máy này)</summary>
              <div className="space-y-2 mt-2">
                {(['name', 'title', 'phone', 'email'] as (keyof EmailSender)[]).map((k) => (
                  <input key={k} className={input} placeholder={{ name: 'Họ tên', title: 'Chức danh', phone: 'Số điện thoại', email: 'Email' }[k]} value={sender[k]} onChange={(e) => setS(k, e.target.value)} />
                ))}
              </div>
            </details>
          </div>
          <div className="flex flex-col overflow-hidden">
            <div className="p-3 border-b border-slate-200 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600 shrink-0">Tiêu đề</span>
                <div className="flex-1 text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded font-mono truncate">{mail.subject}</div>
                <button type="button" onClick={copySubject} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
                  {copied === 'subject' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy tiêu đề
                </button>
                <button type="button" onClick={copyBody} className={`${btn} text-white bg-blue-600 hover:bg-blue-700`}>
                  {copied === 'body' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy nội dung
                </button>
              </div>
              {mail.missing.length > 0 && (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Còn thiếu: {mail.missing.join(', ')}. Điền vào hồ sơ hoặc ô bên trái, hoặc sửa tay sau khi dán.
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-5 bg-white" dangerouslySetInnerHTML={{ __html: mail.html }} />
          </div>
        </div>
      </div>
    </div>
  );
};

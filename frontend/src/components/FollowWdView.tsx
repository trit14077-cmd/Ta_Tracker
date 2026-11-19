// Chuyển từ OLD/src/components/FollowWdView.tsx (M5-3). Chỉ đổi import: danh sách = RPC list_candidates (lọc OB Joined),
// lưu ô = Edge records-save (patch, kiểm row_version). Giao diện giữ nguyên.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Copy, Check, AlertTriangle, Search, Calendar, User, GitBranch, MapPin, Users, Ban } from 'lucide-react';
import { FIELD_BY_KEY } from '../../../shared/fieldCatalog.ts';
import { WD_STEP_GROUP_MATCH, WD_STEP_GROUP_OTHER, WD_STEPS_BY_PROCESS } from '../../../shared/wdRules.ts';
import {
  candidateService as dataService,
  ApiError,
  type CandidateRecord,
  type DropdownDataResponse,
} from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';

/**
 * Follow WD: everyone whose OB Status is "Joined", with the Workday follow-up fields (section 11 of the candidate form).
 * Three sub-tabs: Tổng quan (numbers), Nhắc việc (who must act, with a copyable reminder), Danh sách (editable table).
 * Each TA fills in their own people; Admin only views. Row-level security is applied by the server.
 */

type SubTab = 'overview' | 'remind' | 'list';
const WD_STATUSES = ['In-Progress', 'Done', 'Cut-off'] as const;
const NONE = '(Chưa cập nhật)';

const statusOf = (r: CandidateRecord): string => String(r.wd_status || '') || NONE;
const s = (r: CandidateRecord, k: string): string => String(r[k] ?? '');

/** Parses DD/MM/YYYY into a comparable number (0 when empty or invalid). */
function dmyToNum(v: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v || '');
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}
function todayNum(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

const STATUS_PILL: Record<string, string> = {
  'In-Progress': 'bg-sky-100 text-sky-700',
  Done: 'bg-emerald-100 text-emerald-700',
  'Cut-off': 'bg-slate-200 text-slate-600',
  [NONE]: 'bg-amber-100 text-amber-700',
};
const STATUS_STRIPE: Record<string, string> = {
  'In-Progress': 'border-l-sky-400',
  Done: 'border-l-emerald-500',
  'Cut-off': 'border-l-slate-400',
  [NONE]: 'border-l-amber-400',
};

// Static class names (Tailwind cannot build them from variables).
const TINT = {
  orange: { top: 'border-t-orange-400', icon: 'bg-orange-100 text-orange-600', head: 'bg-orange-50 text-orange-700', bar: 'bg-orange-400' },
  violet: { top: 'border-t-violet-500', icon: 'bg-violet-100 text-violet-600', head: 'bg-violet-50 text-violet-700', bar: 'bg-violet-500' },
  fuchsia: { top: 'border-t-fuchsia-500', icon: 'bg-fuchsia-100 text-fuchsia-600', head: 'bg-fuchsia-50 text-fuchsia-700', bar: 'bg-fuchsia-500' },
  indigo: { top: 'border-t-indigo-500', icon: 'bg-indigo-100 text-indigo-600', head: 'bg-indigo-50 text-indigo-700', bar: 'bg-indigo-500' },
  teal: { top: 'border-t-teal-500', icon: 'bg-teal-100 text-teal-600', head: 'bg-teal-50 text-teal-700', bar: 'bg-teal-500' },
  slate: { top: 'border-t-slate-500', icon: 'bg-slate-200 text-slate-600', head: 'bg-slate-100 text-slate-700', bar: 'bg-slate-500' },
} as const;
type TintKey = keyof typeof TINT;

const Pill: React.FC<{ n: number; tone: 'sky' | 'emerald' | 'slate' }> = ({ n, tone }) =>
  n ? (
    <span
      className={`inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-full text-[12px] font-bold ${
        tone === 'sky' ? 'bg-sky-100 text-sky-700' : tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
      }`}
    >
      {n}
    </span>
  ) : (
    <span className="text-slate-300">–</span>
  );

const StatusChip: React.FC<{ value: string }> = ({ value }) => (
  <span className={`inline-flex items-center px-3 py-1 rounded-full text-[12px] font-bold ${STATUS_PILL[value] || 'bg-slate-100 text-slate-700'}`}>
    {value}
  </span>
);

interface Props {
  user: UserProfile;
  dropdowns: DropdownDataResponse;
}

export const FollowWdView: React.FC<Props> = ({ user, dropdowns }) => {
  const [rows, setRows] = useState<CandidateRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sub, setSub] = useState<SubTab>('overview');
  const [updatedAt, setUpdatedAt] = useState('');

  const [fSite, setFSite] = useState('');
  const [fTa, setFTa] = useState('');
  const [fMonth, setFMonth] = useState('');
  const [fEmp, setFEmp] = useState('');
  const [fPending, setFPending] = useState('');
  const [fStatus, setFStatus] = useState<string>('');
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState('');
  const [saveError, setSaveError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const all: CandidateRecord[] = [];
      let page = 1;
      for (;;) {
        const res = await dataService.listCandidates({ ob_status: 'Joined', pageSize: 200, page, sortBy: 'ob_date', sortDir: 'desc' });
        all.push(...res.items);
        if (page >= res.totalPages || all.length >= 10000) break;
        page += 1;
      }
      setRows(all);
      const d = new Date();
      setUpdatedAt(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu Follow WD.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const distinct = (k: string): string[] => [...new Set(rows.map((r) => s(r, k)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!fSite || s(r, 'site') === fSite) &&
        (!fTa || s(r, 'pic') === fTa) &&
        (!fMonth || s(r, 'ob_month') === fMonth) &&
        (!fEmp || s(r, 'emp_status') === fEmp) &&
        (!fPending || s(r, 'pending_at') === fPending) &&
        (!needle || `${s(r, 'emp_id')} ${s(r, 'candidate_code')} ${s(r, 'full_name')} ${s(r, 'position')} ${s(r, 'site')} ${s(r, 'wd_note')}`.toLowerCase().includes(needle))
    );
  }, [rows, fSite, fTa, fMonth, fEmp, fPending, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: filtered.length, 'In-Progress': 0, Done: 0, 'Cut-off': 0, [NONE]: 0 };
    for (const r of filtered) c[statusOf(r)] = (c[statusOf(r)] || 0) + 1;
    return c;
  }, [filtered]);

  const pct = (n: number) => (counts.total ? Math.round((n / counts.total) * 100) : 0);

  /** Groups rows by a key and counts the WD statuses of each group. */
  const group = (keyOf: (r: CandidateRecord) => string) => {
    const m = new Map<string, Record<string, number>>();
    const canon = new Map<string, string>(); // same name typed with different case or spaces counts once
    for (const r of filtered) {
      const raw = (keyOf(r) || '').replace(/\s+/g, ' ').trim();
      const lower = raw.toLowerCase();
      if (!canon.has(lower)) canon.set(lower, raw);
      const k = canon.get(lower) || '(Trống)';
      const o = m.get(k) || { total: 0, 'In-Progress': 0, Done: 0, 'Cut-off': 0, [NONE]: 0 };
      o.total += 1;
      o[statusOf(r)] += 1;
      m.set(k, o);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'vi'));
  };

  // Follow WD is filled in by each TA for their own people; Admin only views the combined picture.
  const canEditRow = (r: CandidateRecord) => user.role !== 'admin' && Boolean(user.pic_code) && s(r, 'pic') === user.pic_code;

  const saveCell = async (row: CandidateRecord, key: string, value: string) => {
    if (value === s(row, key)) return;
    setSaveError('');
    try {
      const res = await dataService.updateCandidate(row.id, { [key]: value, row_version: row.row_version });
      setRows((prev) => prev.map((x) => (x.id === row.id ? res.candidate : x)));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setSaveError(`Hồ sơ ${s(row, 'emp_id') || s(row, 'candidate_code')} vừa được người khác sửa. Đã tải lại dữ liệu mới.`);
        load();
      } else {
        setSaveError(e instanceof Error ? e.message : 'Không lưu được thay đổi.');
      }
    }
  };

  const options = (listKey: string): string[] => (dropdowns.lists[listKey] || []).filter((o) => o.active).map((o) => o.value);

  const pendingSuggestions = useMemo(
    () => [...new Set([...options('pending_at'), ...rows.map((r) => s(r, 'pending_at')).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'vi')),
    [rows, dropdowns]
  );

  // ---------- reminder text
  const reminderText = (person: string, list: CandidateRecord[]): string => {
    const lines = list.map((r, i) => {
      const proc = [s(r, 'wd_process'), s(r, 'wd_step')].filter(Boolean).join(' · ') || 'chưa ghi quy trình';
      const dl = s(r, 'wd_deadline');
      return `${i + 1}. ${s(r, 'emp_id') || s(r, 'candidate_code')} ${s(r, 'full_name')}: ${proc}${dl ? ` (hạn ${dl})` : ''}`;
    });
    return `Chào ${person}, nhờ bạn xử lý giúp ${list.length} case Workday đang chờ:\n${lines.join('\n')}\nCảm ơn bạn!`;
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied(''), 1800);
  };

  // ---------- shared pieces
  const selectCls = 'h-10 px-3 text-[13px] border border-[#ECEEF2] rounded-xl bg-white text-[#111827] focus:outline-none focus:border-[#92EEFF]';
  const card = 'bg-white rounded-2xl border border-[#ECEEF2] shadow-[0_1px_2px_rgba(17,24,39,0.04),0_6px_20px_rgba(17,24,39,0.05)]';

  const Filters = (
    <div className={`${card} p-3 flex flex-wrap items-center gap-3`}>
      {sub !== 'overview' && (
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm Emp ID, họ tên, vị trí, site, ghi chú..."
            className="w-full h-10 pl-9 pr-3 text-[13px] border border-slate-200 rounded-xl focus:outline-none focus:border-blue-500"
          />
        </div>
      )}
      <select className={selectCls} value={fSite} onChange={(e) => setFSite(e.target.value)}>
        <option value="">Tất cả Site</option>
        {distinct('site').map((v) => <option key={v}>{v}</option>)}
      </select>
      {user.role === 'admin' && (
        <select className={selectCls} value={fTa} onChange={(e) => setFTa(e.target.value)}>
          <option value="">Tất cả TA</option>
          {distinct('pic').map((v) => <option key={v}>{v}</option>)}
        </select>
      )}
      <select className={selectCls} value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
        <option value="">Tất cả tháng OBD</option>
        {distinct('ob_month').map((v) => <option key={v}>{v}</option>)}
      </select>
      <select className={selectCls} value={fEmp} onChange={(e) => setFEmp(e.target.value)}>
        <option value="">Tất cả trạng thái nhân sự</option>
        {distinct('emp_status').map((v) => <option key={v}>{v}</option>)}
      </select>
      {sub !== 'overview' && (
        <select className={selectCls} value={fPending} onChange={(e) => setFPending(e.target.value)}>
          <option value="">Tất cả người chờ xử lý</option>
          {distinct('pending_at').map((v) => <option key={v}>{v}</option>)}
        </select>
      )}
      <span className="text-[13px] text-slate-500 ml-auto whitespace-nowrap">{filtered.length} / {rows.length} người</span>
    </div>
  );

  const GroupCard: React.FC<{
    title: string;
    tint: TintKey;
    icon: React.ReactNode;
    data: [string, Record<string, number>][];
    bars?: boolean;
    firstCol?: string;
  }> = ({ title, tint, icon, data, bars, firstCol }) => {
    const t = TINT[tint];
    const max = Math.max(1, ...data.map(([, o]) => o.total));
    return (
      <div className={`${card} border-t-[4px] ${t.top} overflow-hidden flex flex-col min-w-0`}>
        <div className="px-5 pt-4 pb-3 flex items-center gap-3 shrink-0">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${t.icon}`}>{icon}</span>
          <span className="font-extrabold text-[15px] text-slate-900">{title}</span>
          <span className="ml-auto text-[12px] font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">{data.length} nhóm</span>
        </div>
        <div className="h-[330px] overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-[13px]">
            <colgroup>
              <col />
              <col className={bars ? 'w-[130px]' : 'w-[52px]'} />
              <col className="w-[88px]" />
              <col className="w-[52px]" />
              <col className="w-[64px]" />
            </colgroup>
            <thead className="sticky top-0 z-[1]">
              <tr className={`${t.head} text-[12px]`}>
                <th className="text-left px-5 py-2.5 font-bold">{firstCol || 'Nhóm'}</th>
                <th className="px-1 py-2.5 font-bold text-center">Tổng</th>
                <th className="px-1 py-2.5 font-bold text-center">In-Progress</th>
                <th className="px-1 py-2.5 font-bold text-center">Done</th>
                <th className="px-1 py-2.5 font-bold text-center">Cut-off</th>
              </tr>
            </thead>
            <tbody>
              {data.map(([k, o]) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="px-5 py-2.5 text-slate-800 truncate" title={k}>{k}</td>
                  <td className="px-1 py-2.5">
                    {bars ? (
                      <div className="flex items-center gap-2 pl-1">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${Math.round((o.total / max) * 100)}%` }} />
                        </div>
                        <b className="w-6 text-right">{o.total}</b>
                      </div>
                    ) : (
                      <div className="text-center font-extrabold">{o.total}</div>
                    )}
                  </td>
                  <td className="px-1 py-2.5 text-center"><Pill n={o['In-Progress']} tone="sky" /></td>
                  <td className="px-1 py-2.5 text-center"><Pill n={o.Done} tone="emerald" /></td>
                  <td className="px-1 py-2.5 text-center"><Pill n={o['Cut-off']} tone="slate" /></td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Chưa có dữ liệu</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ---------- Tổng quan
  const noPay = filtered.filter((r) => s(r, 'salary_pay_status') === 'Không chi lương');
  const kpis = [
    { label: 'Tổng nhân sự (Joined)', n: counts.total, top: 'border-t-slate-400', num: 'text-slate-700', sub: '' },
    { label: 'In-Progress', n: counts['In-Progress'], top: 'border-t-sky-500', num: 'text-sky-600', sub: `đang xử lý · ${pct(counts['In-Progress'])}%` },
    { label: 'Done', n: counts.Done, top: 'border-t-emerald-500', num: 'text-emerald-600', sub: `hoàn tất · ${pct(counts.Done)}%` },
    { label: 'Cut-off', n: counts['Cut-off'], top: 'border-t-slate-500', num: 'text-slate-600', sub: `${pct(counts['Cut-off'])}%` },
    { label: 'Chưa cập nhật', n: counts[NONE], top: 'border-t-amber-400', num: 'text-amber-600', sub: 'chưa có WD Status' },
  ];

  const Overview = (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-4">
        {kpis.map((c) => (
          <div key={c.label} className={`${card} border-t-[5px] ${c.top} px-5 py-4`}>
            <div className={`text-[36px] leading-none font-extrabold ${c.num}`}>{c.n}</div>
            <div className="text-[13px] font-bold text-slate-800 mt-2">{c.label}</div>
            <div className="text-[12px] text-slate-500 h-4">{c.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <GroupCard title="Theo tháng OBD" tint="orange" icon={<Calendar className="w-5 h-5" />} firstCol="Tháng OBD" data={group((r) => s(r, 'ob_month'))} />
        <GroupCard title="Theo người chờ xử lý" tint="violet" icon={<User className="w-5 h-5" />} firstCol="Người xử lý" data={group((r) => s(r, 'pending_at'))} />
        <div className={`${card} border-t-[4px] ${TINT.slate.top} overflow-hidden flex flex-col min-w-0`}>
          <div className="px-5 pt-4 pb-3 flex items-center gap-3 shrink-0">
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${TINT.slate.icon}`}><Ban className="w-5 h-5" /></span>
            <span className="font-extrabold text-[15px] text-slate-900">Không chi lương</span>
            <span className="ml-auto text-[12px] font-semibold text-slate-500 bg-slate-100 rounded-full px-3 py-1">{noPay.length} người</span>
          </div>
          <div className="px-5 pb-4 text-[13px] text-slate-600 space-y-2 h-[330px] overflow-y-auto overflow-x-hidden">
            {noPay.length === 0 ? (
              <p className="text-slate-500">Không có ai có Tình trạng chi lương = Không chi lương (trong bộ lọc hiện tại).</p>
            ) : (
              noPay.map((r) => (
                <p key={r.id} className="border-b border-slate-100 pb-2">
                  <strong className="font-mono-tabular text-slate-900">{s(r, 'emp_id') || s(r, 'candidate_code')}</strong>{' '}
                  {s(r, 'full_name')} <span className="text-slate-400">· {s(r, 'site')}</span>
                </p>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <GroupCard title="Theo quy trình · bước" tint="fuchsia" icon={<GitBranch className="w-5 h-5" />} firstCol="Quy trình · Bước" data={group((r) => [s(r, 'wd_process'), s(r, 'wd_step')].filter(Boolean).join(' · '))} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <GroupCard title="Theo Site" tint="indigo" icon={<MapPin className="w-5 h-5" />} firstCol="Site" bars data={group((r) => s(r, 'site'))} />
        <GroupCard title="Theo TA" tint="teal" icon={<Users className="w-5 h-5" />} firstCol="TA" bars data={group((r) => s(r, 'pic'))} />
      </div>
    </div>
  );

  // ---------- Nhắc việc
  const inProgress = filtered.filter((r) => statusOf(r) === 'In-Progress');
  const reminders = useMemo(() => {
    const m = new Map<string, CandidateRecord[]>();
    for (const r of inProgress) {
      const k = s(r, 'pending_at') || 'Chưa gán người xử lý';
      m.set(k, [...(m.get(k) || []), r]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [inProgress]);

  const Remind = (
    <div className="space-y-3">
      <p className="text-[13px] text-slate-500">Card bên dưới = case In-Progress đang chờ từng người để nhắc (Done và Cut-off không nhắc). Bấm "Copy tin nhắn nhắc" rồi dán vào Zalo hoặc email.</p>
      <div className="grid grid-cols-4 gap-4 auto-rows-fr">
        {reminders.map(([person, list]) => (
          <div key={person} className={`${card} border-t-[4px] border-t-sky-500 p-5 flex flex-col min-w-0`}>
            <div className="flex items-center gap-2">
              <div className="font-extrabold text-[15px] text-slate-900 truncate" title={person}>{person}</div>
              <span className="ml-auto shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-sky-100 text-sky-700 text-[13px] font-extrabold">{list.length}</span>
            </div>
            <div className="mt-3 text-[13px] space-y-1.5 flex-1 min-h-[120px]">
              {list.slice(0, 4).map((r) => {
                const overdue = dmyToNum(s(r, 'wd_deadline')) > 0 && dmyToNum(s(r, 'wd_deadline')) < todayNum();
                return (
                  <div key={r.id} className="truncate">
                    <span className="font-mono-tabular font-bold text-slate-900">{s(r, 'emp_id') || s(r, 'candidate_code')}</span>{' '}
                    <span className="text-slate-500">{s(r, 'full_name')}</span>
                    {overdue && <span className="ml-1.5 text-[10px] font-bold text-red-600 bg-red-50 rounded px-1">quá hạn</span>}
                  </div>
                );
              })}
              {list.length > 4 && <div className="text-slate-500">... và {list.length - 4} case nữa (xem tab Danh sách)</div>}
            </div>
            <button
              type="button"
              onClick={() => copy(person, reminderText(person, list))}
              className="mt-4 inline-flex items-center justify-center gap-2 h-10 px-4 text-[13px] font-bold border border-slate-200 rounded-full hover:bg-slate-50"
            >
              {copied === person ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copied === person ? 'Đã copy' : 'Copy tin nhắn nhắc'}
            </button>
          </div>
        ))}
        {reminders.length === 0 && <p className="text-sm text-slate-500 col-span-4">Không có case In-Progress nào trong bộ lọc hiện tại.</p>}
      </div>
    </div>
  );

  // ---------- Danh sách (each TA edits their own people)
  const listRows = useMemo(() => {
    const base = fStatus ? filtered.filter((r) => statusOf(r) === fStatus) : filtered;
    const rank = (r: CandidateRecord) => ({ 'In-Progress': 0, [NONE]: 1, Done: 2, 'Cut-off': 3 }[statusOf(r)] ?? 4);
    return [...base].sort((a, b) => rank(a) - rank(b) || (dmyToNum(s(a, 'wd_deadline')) || 99999999) - (dmyToNum(s(b, 'wd_deadline')) || 99999999));
  }, [filtered, fStatus]);

  const cellCls =
    'w-full min-w-[130px] h-9 px-2.5 text-[13px] border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-500 disabled:bg-transparent disabled:border-transparent disabled:text-slate-700 disabled:appearance-none';

  const cellSelect = (r: CandidateRecord, key: string) => {
    const cur = s(r, key);
    const opts = options(key);
    const list = cur && !opts.includes(cur) ? [cur, ...opts] : opts;
    return (
      <select disabled={!canEditRow(r)} value={cur} onChange={(e) => saveCell(r, key, e.target.value)} className={cellCls}>
        <option value="">—</option>
        {key === 'wd_step' && WD_STEPS_BY_PROCESS[s(r, 'wd_process')] ? (
          <>
            <optgroup label={WD_STEP_GROUP_MATCH}>
              {list.filter((o) => WD_STEPS_BY_PROCESS[s(r, 'wd_process')].includes(o)).map((o) => <option key={o}>{o}</option>)}
            </optgroup>
            <optgroup label={WD_STEP_GROUP_OTHER}>
              {list.filter((o) => !WD_STEPS_BY_PROCESS[s(r, 'wd_process')].includes(o)).map((o) => <option key={o}>{o}</option>)}
            </optgroup>
          </>
        ) : (
          list.map((o) => <option key={o}>{o}</option>)
        )}
      </select>
    );
  };

  const cellText = (r: CandidateRecord, key: string, placeholder: string) => (
    <input
      list={key === 'pending_at' ? 'wd-pending-suggest' : undefined}
      defaultValue={s(r, key)}
      key={`${r.id}-${key}-${r.row_version}`}
      disabled={!canEditRow(r)}
      placeholder={canEditRow(r) ? placeholder : ''}
      onBlur={(e) => saveCell(r, key, e.target.value.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cellCls}
    />
  );

  const chipDefs = [
    { k: '', label: 'Tất cả', n: counts.total, stripe: 'border-l-slate-800' },
    { k: 'In-Progress', label: 'In-Progress', n: counts['In-Progress'], stripe: 'border-l-sky-500' },
    { k: 'Done', label: 'Done', n: counts.Done, stripe: 'border-l-emerald-500' },
    { k: 'Cut-off', label: 'Cut-off', n: counts['Cut-off'], stripe: 'border-l-slate-500' },
    { k: NONE, label: 'Chưa cập nhật', n: counts[NONE], stripe: 'border-l-amber-400' },
  ];

  const List = (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {chipDefs.map((c) => (
          <button
            key={c.k || 'all'}
            type="button"
            onClick={() => setFStatus(c.k)}
            className={`inline-flex items-center gap-3 h-11 pl-4 pr-3 rounded-xl border-l-[5px] ${c.stripe} text-[14px] font-extrabold bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08)] ${fStatus === c.k ? 'ring-2 ring-slate-800' : 'hover:bg-slate-50'}`}
          >
            {c.label}
            <span className="inline-flex items-center justify-center min-w-[30px] h-6 px-2 rounded-full bg-slate-100 text-slate-700 text-[12px]">{c.n}</span>
          </button>
        ))}
      </div>
      {saveError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {saveError}
        </div>
      )}
      <div className={`${card} overflow-auto max-h-[68vh]`}>
        <table className="text-[13px] whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
            <tr>
              {['Emp ID', 'Họ tên', 'WD Status', 'Vị trí', 'Site', 'OBD', 'Emp_STT', 'TA', 'Tình trạng ký HĐTV', 'Tình trạng chi lương', 'Quy trình', 'Bước', 'Pending Ai?', 'Deadline', 'Note'].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-extrabold text-[12px] border-b border-slate-200">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {listRows.map((r) => {
              const st = statusOf(r);
              const overdue = st === 'In-Progress' && dmyToNum(s(r, 'wd_deadline')) > 0 && dmyToNum(s(r, 'wd_deadline')) < todayNum();
              return (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                  <td className={`pl-4 pr-3 py-2.5 border-l-4 ${STATUS_STRIPE[st] || 'border-l-slate-300'} font-mono-tabular font-bold text-blue-700`}>
                    {s(r, 'emp_id') || <span className="text-slate-400">{s(r, 'candidate_code')}</span>}
                  </td>
                  <td className="px-4 py-2.5 font-bold text-slate-900">{s(r, 'full_name')}</td>
                  <td className="px-4 py-2.5 min-w-[150px]">
                    {canEditRow(r) ? (
                      <select
                        value={s(r, 'wd_status')}
                        onChange={(e) => saveCell(r, 'wd_status', e.target.value)}
                        className={`h-8 pl-3 pr-2 rounded-full text-[12px] font-bold border-0 focus:outline-none cursor-pointer ${STATUS_PILL[st]}`}
                      >
                        <option value="">{NONE}</option>
                        {WD_STATUSES.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <StatusChip value={st} />
                    )}
                  </td>
                  <td className="px-4 py-2.5">{s(r, 'position')}</td>
                  <td className="px-4 py-2.5">{s(r, 'site')}</td>
                  <td className="px-4 py-2.5 font-mono-tabular">{s(r, 'ob_date')}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-3 py-1 rounded-full text-[12px] font-bold ${s(r, 'emp_status') === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {s(r, 'emp_status') || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{s(r, 'pic')}</td>
                  <td className="px-2 py-1.5">{cellSelect(r, 'contract_sign_status')}</td>
                  <td className="px-2 py-1.5">{cellSelect(r, 'salary_pay_status')}</td>
                  <td className="px-2 py-1.5">{cellSelect(r, 'wd_process')}</td>
                  <td className="px-2 py-1.5">{cellSelect(r, 'wd_step')}</td>
                  <td className="px-2 py-1.5">{cellText(r, 'pending_at', 'Gõ tên người xử lý')}</td>
                  <td className={`px-2 py-1.5 ${overdue ? 'bg-red-50' : ''}`}>{cellText(r, 'wd_deadline', 'DD/MM/YYYY')}</td>
                  <td className="px-2 py-1.5">{cellText(r, 'wd_note', 'Ghi chú')}</td>
                </tr>
              );
            })}
            {listRows.length === 0 && (
              <tr><td colSpan={15} className="px-4 py-10 text-center text-slate-400">Chưa có ai ở trạng thái Joined khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-slate-500">Sửa trực tiếp trong bảng, tự lưu khi chọn hoặc rời ô. Ô đỏ nhạt là Deadline đã quá hạn mà chưa xong. {user.role === 'admin' ? 'Admin chỉ xem, không sửa ở đây.' : 'Chỉ sửa được người do bạn phụ trách.'}</p>
    </div>
  );

  const tabs: { id: SubTab; label: string }[] = [
    { id: 'overview', label: 'Tổng quan' },
    { id: 'remind', label: 'Nhắc việc' },
    { id: 'list', label: 'Danh sách' },
  ];

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1180px] space-y-4">
        <datalist id="wd-pending-suggest">
          {pendingSuggestions.map((n) => <option key={n} value={n} />)}
        </datalist>

        <div className={`${card} px-3 py-2.5 flex items-center gap-4 flex-wrap`}>
          <div className="inline-flex bg-slate-100 rounded-full p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSub(t.id)}
                className={`px-5 h-9 text-[13px] font-extrabold rounded-full transition-colors ${sub === t.id ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-slate-500">Nhân sự có OB Status = Joined. Mỗi TA tự điền Follow WD cho người của mình.</span>
          <span className="ml-auto text-[13px] text-slate-500 whitespace-nowrap">
            {updatedAt && `Cập nhật ${updatedAt} · `}
            {rows.length} dòng
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 h-10 px-4 text-[13px] font-bold text-blue-700 border border-blue-200 rounded-full hover:bg-blue-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tải lại
          </button>
        </div>

        {user.role === 'admin' && (
          <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-2xl text-[13px] text-blue-900">
            <strong>Admin chỉ xem.</strong> Follow WD do từng TA tự điền cho người của mình; màn hình này tổng hợp từ tất cả TA, bạn không sửa được ở đây.
          </div>
        )}
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-[13px] text-red-800">{error}</div>}
        {Filters}
        {loading && rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">Đang tải dữ liệu Follow WD...</div>
        ) : sub === 'overview' ? (
          Overview
        ) : sub === 'remind' ? (
          Remind
        ) : (
          List
        )}
        <p className="text-[12px] text-slate-400">
          {FIELD_BY_KEY.wd_process.label} và {FIELD_BY_KEY.wd_step.label}: Admin sửa danh sách trong mục Drop-list. {FIELD_BY_KEY.pending_at.label}: TA tự gõ tên.
        </p>
      </div>
    </div>
  );
};

// Bonus hàng tháng (task #8–#10). Admin: tính, chốt kỳ, xuất Excel trình duyệt, cấu hình mức tiền.
// TA: "Bonus của tôi" – chỉ các khoản đã chốt có ta_pic = PIC của mình (RLS 0045). Quy tắc: shared/bonus/*.ts.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { UserProfile } from '../services/authService.ts';
import { bonusService, type MyBonusLine } from '../services/bonusService.ts';
import { BonusReferralPanel } from './BonusReferralPanel.tsx';
import { BonusSignonPanel, SignonSchemeSettings } from './BonusSignonPanel.tsx';
import { BonusTaCreditPanel, TaCreditSettings, TaProfileSettings } from './BonusTaCreditPanel.tsx';
import { cleanAmount, fmtVnd, periodLabel, type BonusKind } from '../../../shared/bonus/period.ts';
import { REFERRAL_DEFAULT_RATES, cleanReferralRates, type ReferralRates } from '../../../shared/bonus/referral.ts';

type Tab = 'referral' | 'signon' | 'ta_credit' | 'settings' | 'mine';

export const BONUS_KIND_LABELS: Record<BonusKind, string> = {
  referral: 'Referral', signon: 'Sign-on', ta_credit: 'TA Credit', onsite: 'Onsite', freelancer: 'Freelancer',
};

const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';
const input = 'border border-slate-300 rounded px-2 py-1 text-xs';

const ReferralSettings: React.FC = () => {
  const [rates, setRates] = useState<ReferralRates>(REFERRAL_DEFAULT_RATES);
  const [byDc, setByDc] = useState<[string, string][]>([]);
  const [cand, setCand] = useState('');
  const [def, setDef] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fill = (r: ReferralRates) => {
    setRates(r);
    setCand(String(r.candidate));
    setDef(String(r.referrerDefault));
    setByDc(Object.entries(r.referrerByDc).map(([k, v]) => [k, String(v)]));
  };
  useEffect(() => {
    bonusService.referralRates().then(fill).catch((e: Error) => setNotice({ ok: false, text: e.message }));
  }, []);

  const save = async () => {
    const c = cleanAmount(cand);
    const d = cleanAmount(def);
    const map: Record<string, number> = {};
    for (const [k, v] of byDc) {
      const a = cleanAmount(v);
      if (!k.trim()) continue;
      if (a == null) { setNotice({ ok: false, text: `Mức tiền không hợp lệ: ${k}` }); return; }
      map[k.trim()] = a;
    }
    if (c == null || d == null) { setNotice({ ok: false, text: 'Mức tiền phải là số nguyên không âm.' }); return; }
    const next = cleanReferralRates({ candidate: c, referrerDefault: d, referrerByDc: map });
    setBusy(true);
    try {
      await bonusService.saveSettings('referral', { ...next });
      fill(next);
      setNotice({ ok: true, text: 'Đã lưu mức tiền. Kỳ đã chốt giữ mức cũ.' });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3 max-w-xl">
      <div className="text-sm font-semibold">Mức thưởng Referral</div>
      <label className="flex items-center gap-2 text-xs"><span className="w-56">Ứng viên được giới thiệu (đ)</span>
        <input className={input} value={cand} onChange={(e) => setCand(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-xs"><span className="w-56">Người giới thiệu – mức chung (đ)</span>
        <input className={input} value={def} onChange={(e) => setDef(e.target.value)} /></label>
      <div className="text-xs text-slate-600">Mức riêng cho người giới thiệu theo DC của ứng viên:</div>
      {byDc.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={`${input} w-56`} value={k} placeholder="Tên DC / site" onChange={(e) => setByDc((o) => o.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
          <input className={input} value={v} onChange={(e) => setByDc((o) => o.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
          <button className="p-1 text-slate-400 hover:text-red-600" title="Xóa" onClick={() => setByDc((o) => o.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <button className={`${btn} border-slate-300`} onClick={() => setByDc((o) => [...o, ['', '']])}><Plus className="w-3.5 h-3.5" /> Thêm DC</button>
      {notice && <div className={`text-xs ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</div>}
      <div className="flex items-center gap-2">
        <button className={`${btn} border-[#0B5FFF] bg-[#0B5FFF] text-white`} disabled={busy} onClick={save}><Save className="w-3.5 h-3.5" /> Lưu</button>
        <span className="text-[11px] text-slate-500">{`Hiện tại: ứng viên ${fmtVnd(rates.candidate)} đ · người giới thiệu ${fmtVnd(rates.referrerDefault)} đ`}</span>
      </div>
    </div>
  );
};

const MyBonusPanel: React.FC = () => {
  const [lines, setLines] = useState<MyBonusLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => {
    bonusService.myLines().then(setLines).catch((e: Error) => setErr(e.message)).finally(() => setLoading(false));
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, MyBonusLine[]>();
    for (const l of lines) {
      const k = l.bonus_periods?.period_key ?? '';
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [lines]);

  if (loading) return <div className="text-xs text-slate-500">Đang tải…</div>;
  if (err) return <div className="text-xs text-red-600">{err}</div>;
  if (!groups.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 text-center text-xs text-slate-600">
        Chưa có bonus nào được chốt cho bạn. Bonus TA Credit, Onsite, Recruitment sẽ hiện ở đây sau khi Admin chốt kỳ.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map(([k, ls]) => {
        const total = ls.reduce((s, l) => s + l.net, 0);
        return (
          <div key={k} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 flex justify-between text-xs font-semibold">
              <span>{k ? periodLabel(k) : '—'}</span><span className="tabular-nums">{`${fmtVnd(total)} đ`}</span>
            </div>
            <table className="min-w-full text-xs">
              <tbody>
                {ls.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{BONUS_KIND_LABELS[l.kind] ?? l.kind}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtVnd(l.amount)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{l.pit ? `PIT ${fmtVnd(l.pit)}` : ''}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtVnd(l.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
};

export const BonusView: React.FC<{ user: UserProfile; onOpenCandidate?: (id: number) => void }> = ({ user, onOpenCandidate }) => {
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState<Tab>(isAdmin ? 'referral' : 'mine');
  const tabs: { id: Tab; label: string }[] = isAdmin
    ? [{ id: 'referral', label: 'Referral' }, { id: 'signon', label: 'Sign-on' }, { id: 'ta_credit', label: 'TA Credit' }, { id: 'settings', label: 'Cấu hình' }]
    : [{ id: 'mine', label: 'Bonus của tôi' }];
  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs -mb-px border-b-2 ${tab === t.id ? 'border-[#0B5FFF] text-[#0B5FFF] font-semibold' : 'border-transparent text-slate-600'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'referral' && isAdmin && <BonusReferralPanel isAdmin={isAdmin} onOpenCandidate={onOpenCandidate} />}
      {tab === 'signon' && isAdmin && <BonusSignonPanel isAdmin={isAdmin} onOpenCandidate={onOpenCandidate} />}
      {tab === 'ta_credit' && isAdmin && <BonusTaCreditPanel isAdmin={isAdmin} />}
      {tab === 'settings' && isAdmin && (
        <div className="space-y-3"><ReferralSettings /><SignonSchemeSettings /><TaProfileSettings /><TaCreditSettings /></div>
      )}
      {tab === 'mine' && <MyBonusPanel />}
    </div>
  );
};

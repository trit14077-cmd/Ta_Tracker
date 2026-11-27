// Quy trình 1 – Mã ghế. TA nhập dòng ở tài khoản riêng, gửi HRBP; HRSS (admin) xác nhận, cấp mã và xuất file.
// Quy tắc: shared/seatCodeRules.ts, shared/seatOrgTree.ts (docs/SEAT_CODE_RULES.md). Dữ liệu: seatService (0038, 0041).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Briefcase, CheckCircle2, Download, Hash, Network, Pencil, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { seatService, SeatValidationError, type SeatRequest, type SeatSummaryRow } from '../services/seatService.ts';
import { SeatOrgTreeAdmin } from './SeatOrgTreeAdmin.tsx';
import { SeatPositionAdmin } from './SeatPositionAdmin.tsx';
import { SearchableSelect } from './SearchableSelect.tsx';
import type { UserProfile } from '../services/authService.ts';
import {
  SEAT_MAX_QTY,
  SEAT_RANKING_CODES,
  SEAT_RANKS,
  SEAT_REGIONS,
  SEAT_STATUS_LABEL,
  SEAT_STATUSES,
  formatSheetDate,
  normText,
  validateSeatRequest,
  type SeatInputKey,
  type SeatStatus,
} from '../../../shared/seatCodeRules.ts';
import { SEAT_ORG_LEVELS, seatOrgOptions, seatOrgSet, seatVungRequired, type SeatOrgLevel, type SeatOrgPath } from '../../../shared/seatOrgTree.ts';
import { seatPositionOptions, seatRankGroup, seatRankingOptions, type SeatPositionPair } from '../../../shared/seatPositions.ts';

const STATUS_CLS: Record<SeatStatus, string> = {
  nhap: 'bg-slate-100 text-slate-700',
  gui: 'bg-blue-50 text-blue-700',
  xac_nhan: 'bg-amber-50 text-amber-700',
  da_cap_ma: 'bg-emerald-50 text-emerald-700',
};

/** Tab "Tổng hợp" (bước 1, TongHop): số ghế theo tháng gửi × TA, tách theo trạng thái. Dữ liệu từ RPC seat_summary (0039). */
const SeatSummaryPanel: React.FC<{ rows: SeatSummaryRow[] }> = ({ rows }) => {
  const groups = useMemo(() => {
    const m = new Map<string, { thang: string; ta: string; total: number; by: Partial<Record<SeatStatus, number>> }>();
    rows.forEach((r) => {
      const k = `${r.thang}|${r.ta}`;
      const g = m.get(k) ?? { thang: r.thang, ta: r.ta, total: 0, by: {} };
      g.total += Number(r.so_ghe);
      g.by[r.status] = (g.by[r.status] ?? 0) + Number(r.so_ghe);
      m.set(k, g);
    });
    return [...m.values()];
  }, [rows]);
  const sum = (s?: SeatStatus) => groups.reduce((n, g) => n + (s ? g.by[s] ?? 0 : g.total), 0);
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
      <div className="px-3 pt-3 text-xs font-semibold text-slate-700">Tổng hợp số ghế theo tháng gửi</div>
      <table className="min-w-full text-xs mt-2">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">Tháng</th>
            <th className="px-3 py-2 text-left">TA</th>
            {SEAT_STATUSES.map((s) => <th key={s} className="px-3 py-2 text-right">{SEAT_STATUS_LABEL[s]}</th>)}
            <th className="px-3 py-2 text-right">Tổng ghế</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 && <tr><td colSpan={SEAT_STATUSES.length + 3} className="px-3 py-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>}
          {groups.map((g) => (
            <tr key={`${g.thang}|${g.ta}`} className="border-t border-slate-100">
              <td className="px-3 py-1.5">{g.thang.slice(5)}/{g.thang.slice(0, 4)}</td>
              <td className="px-3 py-1.5">{g.ta || '—'}</td>
              {SEAT_STATUSES.map((s) => <td key={s} className="px-3 py-1.5 text-right tabular-nums">{g.by[s] ?? 0}</td>)}
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{g.total}</td>
            </tr>
          ))}
        </tbody>
        {groups.length > 0 && (
          <tfoot className="bg-slate-50 font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={2}>Cộng</td>
              {SEAT_STATUSES.map((s) => <td key={s} className="px-3 py-2 text-right tabular-nums">{sum(s)}</td>)}
              <td className="px-3 py-2 text-right tabular-nums">{sum()}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};

type FormValues = Record<SeatInputKey, string>;
const EMPTY_FORM: FormValues = {
  ban: '', don_vi: '', phong: '', doi: '', to_nhom: '', nhom_site: '', vung: '', nhom_chuc_danh: '',
  ranking_ap: '', ranking_offer: '', vi_tri_ap: '', vi_tri_offer_vi: '', vi_tri_offer_en: '', so_luong: '1',
  quan_ly_truc_tiep: '', note: '',
};

const FIELDS: { key: SeatInputKey; label: string; required?: boolean; select?: readonly string[]; number?: boolean; wide?: boolean; optionalSelect?: boolean }[] = [
  { key: 'ban', label: 'Ban/ Chuỗi/ Khối', required: true },
  { key: 'don_vi', label: 'Các đơn vị thành viên' },
  { key: 'phong', label: 'Phòng/ Bộ Phận/ Nhóm' },
  { key: 'doi', label: 'Đội' },
  { key: 'to_nhom', label: 'Tổ (PP/IB/OB/IN/GV)' },
  { key: 'nhom_site', label: 'Nhóm (Site)' },
  { key: 'vung', label: 'Phòng/Vùng/Miền', required: true, select: SEAT_REGIONS },
  { key: 'nhom_chuc_danh', label: 'Nhóm Chức Danh', required: true, select: SEAT_RANKS },
  { key: 'ranking_ap', label: 'Ranking theo AP', required: true, select: SEAT_RANKING_CODES },
  { key: 'ranking_offer', label: 'Ranking Offer', select: SEAT_RANKING_CODES, optionalSelect: true },
  { key: 'vi_tri_ap', label: 'Vị trí theo AP (JOB)', required: true, wide: true },
  { key: 'vi_tri_offer_vi', label: 'Vị trí theo Offer (Tiếng Việt)', wide: true },
  { key: 'vi_tri_offer_en', label: 'Vị trí theo Offer (Tiếng Anh)', wide: true },
  { key: 'so_luong', label: `Số lượng ghế (1–${SEAT_MAX_QTY})`, required: true, number: true },
  { key: 'quan_ly_truc_tiep', label: 'Quản lý trực tiếp', required: true },
  { key: 'note', label: 'Note', wide: true },
];

const isOrgLevel = (k: SeatInputKey): k is SeatOrgLevel => (SEAT_ORG_LEVELS as readonly string[]).includes(k);

const inputCls = 'w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200';

// Dropdown phụ thuộc: chỉ hiện giá trị thuộc nhánh của các cấp trên (như sheet NhapLieu).
const OrgSelect: React.FC<{ level: SeatOrgLevel; paths: SeatOrgPath[]; values: FormValues; onChange: (v: string) => void }> = ({ level, paths, values, onChange }) => {
  const options = seatOrgOptions(paths, level, values);
  const cur = values[level];
  const stale = Boolean(cur) && !options.includes(cur);
  const disabled = !cur && options.length === 0;
  return (
    <select className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`} value={cur} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{disabled ? '— Không có —' : level === 'ban' ? '— Chọn —' : '— Để trống —'}</option>
      {stale && <option value={cur}>{cur} (không có trong danh mục)</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
};

const SeatForm: React.FC<{ initial: SeatRequest | null; onClose: () => void; onSaved: (msg: string) => void }> = ({ initial, onClose, onSaved }) => {
  const [values, setValues] = useState<FormValues>(() => {
    if (!initial) return EMPTY_FORM;
    const v = { ...EMPTY_FORM };
    (Object.keys(v) as SeatInputKey[]).forEach((k) => { v[k] = String(initial[k] ?? ''); });
    return v;
  });
  const [errors, setErrors] = useState<Partial<Record<SeatInputKey, string>>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const warnings = useMemo(() => validateSeatRequest(values).warnings, [values]);
  // 0041: danh mục Ban → Đơn vị → Phòng → Đội → Tổ. null = chưa tải / lỗi → nhập tay như cũ (DB vẫn kiểm).
  const [orgPaths, setOrgPaths] = useState<SeatOrgPath[] | null>(null);
  useEffect(() => {
    let alive = true;
    seatService.orgPaths().then((p) => { if (alive && p.length) setOrgPaths(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  // 0043: danh mục Vị trí AP → Ranking. null = chưa tải / lỗi → nhập tay như cũ (DB vẫn kiểm).
  const [positions, setPositions] = useState<SeatPositionPair[] | null>(null);
  useEffect(() => {
    let alive = true;
    seatService.positions().then((p) => { if (alive && p.length) setPositions(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const positionList = useMemo(() => (positions ? seatPositionOptions(positions) : []), [positions]);
  const rankingList = positions ? seatRankingOptions(positions, values.vi_tri_ap) : null;

  // Đổi 1 cấp tổ chức: xóa cấp dưới; nếu nhánh mới khóa vùng (0042) thì điền luôn Vùng.
  const set = (k: SeatInputKey, v: string) => setValues((s) => {
    // Chọn vị trí: ranking cũ không thuộc vị trí mới thì bỏ; vị trí chỉ có 1 ranking thì điền luôn.
    if (k === 'vi_tri_ap' && positions) {
      const ranks = seatRankingOptions(positions, v);
      const ranking = ranks.length === 1 ? ranks[0] : ranks.includes(s.ranking_ap) ? s.ranking_ap : '';
      return { ...s, vi_tri_ap: v, ranking_ap: ranking, nhom_chuc_danh: seatRankGroup(ranking) || s.nhom_chuc_danh };
    }
    // Nhóm chức danh theo chữ số của Ranking AP (6B → Rank 6).
    if (k === 'ranking_ap') return { ...s, ranking_ap: v, nhom_chuc_danh: seatRankGroup(v) || s.nhom_chuc_danh };
    if (!isOrgLevel(k)) return { ...s, [k]: v };
    const next = seatOrgSet(s, k, v);
    const locked = orgPaths ? seatVungRequired(orgPaths, next) : null;
    return locked ? { ...next, vung: locked } : next;
  });
  const vungLocked = orgPaths ? seatVungRequired(orgPaths, values) : null;
  // Như DB: chỉ kiểm nhánh/vùng khi thêm mới hoặc khi đổi 1 trong 5 cột hoặc Vùng (dòng cũ không bị khóa nếu danh mục đổi sau).
  const orgChanged = !initial || [...SEAT_ORG_LEVELS, 'vung' as const].some((k) => normText(values[k]) !== normText(initial[k]));
  const posChanged = !initial || (['vi_tri_ap', 'ranking_ap'] as const).some((k) => normText(values[k]) !== normText(initial[k]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    setErrors({});
    try {
      await seatService.save(
        initial ? initial.id : null,
        values,
        orgChanged ? orgPaths ?? undefined : undefined,
        posChanged ? positions ?? undefined : undefined,
      );
      onSaved(initial ? 'Đã lưu dòng mã ghế.' : 'Đã thêm dòng mã ghế (nháp). Gửi HRBP khi đã đủ.');
    } catch (err) {
      if (err instanceof SeatValidationError) {
        setErrors(err.errors);
        setFormError('Kiểm lại các trường được đánh dấu.');
      } else {
        setFormError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">{initial ? 'Sửa dòng mã ghế' : 'Thêm dòng mã ghế'}</div>
          <button type="button" onClick={onClose} className="text-xs text-slate-500 hover:text-slate-800">Đóng</button>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <label key={f.key} className={`block text-xs text-slate-700 ${f.wide ? 'md:col-span-2' : ''}`}>
              <span className="font-medium">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
              {orgPaths && isOrgLevel(f.key) ? (
                <OrgSelect level={f.key} paths={orgPaths} values={values} onChange={(v) => set(f.key, v)} />
              ) : f.key === 'vung' && vungLocked ? (
                <>
                  <select className={inputCls} value={values.vung} onChange={(e) => set('vung', e.target.value)}>
                    <option value={vungLocked}>{vungLocked}</option>
                    {values.vung && values.vung !== vungLocked && <option value={values.vung}>{values.vung} (sai vùng)</option>}
                  </select>
                  <span className="block text-[11px] text-slate-500 mt-0.5">Theo Đội đã chọn.</span>
                </>
              ) : f.key === 'vi_tri_ap' && positions ? (
                <SearchableSelect
                  value={values.vi_tri_ap}
                  options={values.vi_tri_ap && !positionList.includes(values.vi_tri_ap) ? [values.vi_tri_ap, ...positionList] : positionList}
                  onChange={(v) => set('vi_tri_ap', v)}
                  placeholder="— Chọn vị trí —"
                  error={Boolean(errors.vi_tri_ap)}
                />
              ) : f.key === 'ranking_ap' && rankingList ? (
                <select className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`} value={values.ranking_ap} disabled={!values.vi_tri_ap} onChange={(e) => set('ranking_ap', e.target.value)}>
                  <option value="">{values.vi_tri_ap ? '— Chọn —' : '— Chọn vị trí trước —'}</option>
                  {values.ranking_ap && !rankingList.includes(values.ranking_ap) && <option value={values.ranking_ap}>{values.ranking_ap} (không thuộc vị trí)</option>}
                  {rankingList.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.select ? (
                <select className={inputCls} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">{f.optionalSelect ? '— Không —' : '— Chọn —'}</option>
                  {f.select.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  className={inputCls}
                  type={f.number ? 'number' : 'text'}
                  min={f.number ? 1 : undefined}
                  max={f.number ? SEAT_MAX_QTY : undefined}
                  value={values[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
              {errors[f.key] && <span className="block text-red-600 mt-0.5">{errors[f.key]}</span>}
            </label>
          ))}
        </div>
        {warnings.length > 0 && (
          <div className="mx-5 mb-3 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-0.5">
            {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
          </div>
        )}
        {formError && <div className="mx-5 mb-3 text-xs text-red-700">{formError}</div>}
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">Hủy</button>
          <button type="submit" disabled={busy} className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>
    </div>
  );
};

export const SeatRequestsView: React.FC<{ user: UserProfile }> = ({ user }) => {
  const isAdmin = user.role === 'admin';
  const [rows, setRows] = useState<SeatRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | SeatStatus>('all');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<SeatRequest | 'new' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [counter, setCounter] = useState<number | null>(null);
  const [taFilter, setTaFilter] = useState('');
  const [vungFilter, setVungFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [q, setQ] = useState('');
  const [summary, setSummary] = useState<SeatSummaryRow[] | null>(null);
  const [orgAdmin, setOrgAdmin] = useState(false);
  const [posAdmin, setPosAdmin] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await seatService.list());
      if (isAdmin) setCounter(await seatService.counterGet());
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { void reload(); }, [reload]);

  const monthOf = (r: SeatRequest) => (r.ngay_gui || r.created_at || '').slice(0, 7);
  const taOf = (r: SeatRequest) => r.owner?.username ?? '';
  const taList = useMemo(() => [...new Set(rows.map(taOf))].filter(Boolean).sort(), [rows]);
  const monthList = useMemo(() => [...new Set(rows.map(monthOf))].filter(Boolean).sort().reverse(), [rows]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      (filter === 'all' || r.status === filter)
      && (!taFilter || taOf(r) === taFilter)
      && (!vungFilter || r.vung === vungFilter)
      && (!monthFilter || monthOf(r) === monthFilter)
      && (!needle || [r.ban, r.don_vi, r.phong, r.doi, r.vi_tri_ap, r.quan_ly_truc_tiep, r.note, r.ma_ghe.join(' ')]
        .some((v) => String(v ?? '').toLowerCase().includes(needle))));
  }, [rows, filter, taFilter, vungFilter, monthFilter, q]);
  const visibleSeats = useMemo(() => visible.reduce((n, r) => n + r.so_luong, 0), [visible]);

  const toggleSummary = async () => {
    if (summary) { setSummary(null); return; }
    try {
      setSummary(await seatService.summary());
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  };
  const selected = useMemo(() => rows.filter((r) => picked.has(r.id)), [rows, picked]);
  const countBy = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  const canEdit = (r: SeatRequest) => (r.status === 'nhap' && r.owner_id === user.id) || (isAdmin && r.status !== 'da_cap_ma');
  const ids = (list: SeatRequest[], pred: (r: SeatRequest) => boolean) => list.filter(pred).map((r) => r.id);
  const mine = (r: SeatRequest) => r.owner_id === user.id;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      const msg = await fn();
      setNotice({ ok: true, text: msg });
      setPicked(new Set());
      await reload();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allVisiblePicked = visible.length > 0 && visible.every((r) => picked.has(r.id));
  const toggleAll = () => setPicked(allVisiblePicked ? new Set() : new Set(visible.map((r) => r.id)));

  const sendToHrbp = () => run(async () => {
    const list = ids(selected, (r) => r.status === 'nhap' && mine(r));
    const n = await seatService.move(list, 'nhap', 'gui');
    return `Đã gửi ${n} dòng cho HRBP. Ngày gửi ghi theo hôm nay.`;
  });
  const removeDrafts = () => run(async () => {
    const n = await seatService.remove(ids(selected, (r) => r.status === 'nhap' && mine(r)));
    return `Đã xóa ${n} dòng nháp.`;
  });
  const hrbpConfirm = () => run(async () => {
    const n = await seatService.move(ids(selected, (r) => r.status === 'gui'), 'gui', 'xac_nhan');
    return `HRBP đã xác nhận ${n} dòng.`;
  });
  const returnToTa = () => run(async () => {
    const n = await seatService.move(ids(selected, (r) => r.status === 'gui'), 'gui', 'nhap');
    return `Đã trả ${n} dòng về TA để chỉnh sửa.`;
  });
  const issue = () => run(async () => {
    const issued = await seatService.issueCodes(ids(selected, (r) => r.status === 'xac_nhan'));
    const codes = issued.flatMap((r) => r.ma_ghe);
    if (!codes.length) return 'Không có dòng nào đủ điều kiện cấp mã (cần trạng thái HRBP xác nhận).';
    return `Đã cấp ${codes.length} mã ghế: ${codes[0]} → ${codes[codes.length - 1]}.`;
  });
  const exportFile = async () => {
    const list = selected.length ? selected : visible;
    if (!list.length) { setNotice({ ok: false, text: 'Không có dòng nào để xuất.' }); return; }
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    try {
      await seatService.exportXlsx(list, `TA_TRACKER_MaGhe_${stamp}.xlsx`);
      setNotice({ ok: true, text: `Đã xuất ${list.length} dòng (đúng cột tab NhapLieu).` });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    }
  };
  const setCounterValue = () => run(async () => {
    const raw = window.prompt('Mã đã cấp gần nhất (8 chữ số). Chỉ được tăng, không được lùi:', counter ? String(counter) : '');
    if (raw === null) return 'Đã hủy.';
    const v = await seatService.counterSet(Number(raw.trim()));
    setCounter(v);
    return `Bộ đếm mã đặt tại ${v}. Mã cấp tiếp theo: ${v + 1}.`;
  });

  const selMine = selected.filter((r) => r.status === 'nhap' && mine(r)).length;
  const selGui = selected.filter((r) => r.status === 'gui').length;
  const selXn = selected.filter((r) => r.status === 'xac_nhan').length;

  const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border disabled:opacity-40';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-800">Mã ghế</div>
          <div className="text-xs text-slate-500">
            Nhập ở tài khoản của bạn → gửi HRBP → HRBP xác nhận → HRSS cấp mã. Xuất file để đổ về sheet chung.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button type="button" onClick={() => setOrgAdmin(true)} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <Network className="w-3.5 h-3.5" /> Cây đơn vị
            </button>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setPosAdmin(true)} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <Briefcase className="w-3.5 h-3.5" /> Vị trí – Ranking
            </button>
          )}
          {isAdmin && (
            <button type="button" onClick={setCounterValue} disabled={busy} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <Hash className="w-3.5 h-3.5" /> Mã đã cấp gần nhất: {counter ?? '—'}
            </button>
          )}
          <button type="button" onClick={exportFile} disabled={busy || loading} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
            <Download className="w-3.5 h-3.5" /> Xuất Excel{selected.length ? ` (${selected.length})` : ''}
          </button>
          <button type="button" onClick={() => setEditing('new')} className={`${btn} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}>
            <Plus className="w-3.5 h-3.5" /> Thêm dòng
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-md px-3 py-2 text-xs border ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg p-3">
        <select className="border border-slate-300 rounded-md px-2 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | SeatStatus)}>
          <option value="all">Tất cả trạng thái ({rows.length})</option>
          {SEAT_STATUSES.map((s) => <option key={s} value={s}>{SEAT_STATUS_LABEL[s]} ({countBy[s] ?? 0})</option>)}
        </select>
        {isAdmin && (
          <select className="border border-slate-300 rounded-md px-2 py-1 text-xs" value={taFilter} onChange={(e) => setTaFilter(e.target.value)}>
            <option value="">Tất cả TA</option>
            {taList.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select className="border border-slate-300 rounded-md px-2 py-1 text-xs" value={vungFilter} onChange={(e) => setVungFilter(e.target.value)}>
          <option value="">Tất cả vùng</option>
          {SEAT_REGIONS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className="border border-slate-300 rounded-md px-2 py-1 text-xs" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="">Tất cả tháng gửi</option>
          {monthList.map((m) => <option key={m} value={m}>{m.slice(5)}/{m.slice(0, 4)}</option>)}
        </select>
        <input className="border border-slate-300 rounded-md px-2 py-1 text-xs w-44" placeholder="Tìm ban, vị trí, QL, mã ghế…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" onClick={toggleSummary} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
          <BarChart3 className="w-3.5 h-3.5" /> {summary ? 'Ẩn tổng hợp' : 'Tổng hợp'}
        </button>
        <span className="text-xs text-slate-500 mr-auto">Đang hiện {visible.length} dòng / {visibleSeats} ghế · Đã chọn: {selected.length}</span>
        {selMine > 0 && (
          <>
            <button type="button" onClick={sendToHrbp} disabled={busy} className={`${btn} border-blue-300 text-blue-700 hover:bg-blue-50`}>
              <Send className="w-3.5 h-3.5" /> Gửi HRBP ({selMine})
            </button>
            <button type="button" onClick={removeDrafts} disabled={busy} className={`${btn} border-red-200 text-red-700 hover:bg-red-50`}>
              <Trash2 className="w-3.5 h-3.5" /> Xóa nháp ({selMine})
            </button>
          </>
        )}
        {isAdmin && selGui > 0 && (
          <>
            <button type="button" onClick={hrbpConfirm} disabled={busy} className={`${btn} border-amber-300 text-amber-700 hover:bg-amber-50`}>
              <CheckCircle2 className="w-3.5 h-3.5" /> HRBP xác nhận ({selGui})
            </button>
            <button type="button" onClick={returnToTa} disabled={busy} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`}>
              <RotateCcw className="w-3.5 h-3.5" /> Trả về TA ({selGui})
            </button>
          </>
        )}
        {isAdmin && selXn > 0 && (
          <button type="button" onClick={issue} disabled={busy} className={`${btn} border-emerald-400 bg-emerald-600 text-white hover:bg-emerald-700`}>
            <Hash className="w-3.5 h-3.5" /> Cấp mã ghế ({selXn})
          </button>
        )}
      </div>

      {summary && <SeatSummaryPanel rows={summary} />}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 w-8"><input type="checkbox" aria-label="Chọn tất cả" checked={allVisiblePicked} onChange={toggleAll} /></th>
              <th className="px-2 py-2 text-left">Trạng thái</th>
              <th className="px-2 py-2 text-left">Ngày gửi</th>
              {isAdmin && <th className="px-2 py-2 text-left">Người nhập</th>}
              <th className="px-2 py-2 text-left">Ban/ Chuỗi/ Khối</th>
              <th className="px-2 py-2 text-left">Đơn vị</th>
              <th className="px-2 py-2 text-left">Miền</th>
              <th className="px-2 py-2 text-left">Rank</th>
              <th className="px-2 py-2 text-left">Ranking AP</th>
              <th className="px-2 py-2 text-left">Vị trí AP</th>
              <th className="px-2 py-2 text-right">SL</th>
              <th className="px-2 py-2 text-left">Quản lý</th>
              <th className="px-2 py-2 text-left">Mã ghế</th>
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={14} className="px-3 py-6 text-center text-slate-500">Đang tải...</td></tr>}
            {!loading && visible.length === 0 && <tr><td colSpan={14} className="px-3 py-6 text-center text-slate-500">Chưa có dòng nào.</td></tr>}
            {!loading && visible.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-2 py-1.5"><input type="checkbox" aria-label={`Chọn dòng ${r.id}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="px-2 py-1.5"><span className={`inline-block px-1.5 py-0.5 rounded ${STATUS_CLS[r.status]}`}>{SEAT_STATUS_LABEL[r.status]}</span></td>
                <td className="px-2 py-1.5 whitespace-nowrap">{formatSheetDate(r.ngay_gui)}</td>
                {isAdmin && <td className="px-2 py-1.5 whitespace-nowrap">{r.owner?.username ?? ''}</td>}
                <td className="px-2 py-1.5">{r.ban}</td>
                <td className="px-2 py-1.5">{r.don_vi}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.vung}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.nhom_chuc_danh}</td>
                <td className="px-2 py-1.5">{r.ranking_ap}</td>
                <td className="px-2 py-1.5">{r.vi_tri_ap}</td>
                <td className="px-2 py-1.5 text-right">{r.so_luong}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.quan_ly_truc_tiep}</td>
                <td className="px-2 py-1.5 font-mono" title={r.ma_ghe.join(', ')}>{r.ma_ghe.join(', ')}</td>
                <td className="px-2 py-1.5">
                  {canEdit(r) && (
                    <button type="button" onClick={() => setEditing(r)} className="text-slate-500 hover:text-blue-700" aria-label={`Sửa dòng ${r.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <SeatForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice({ ok: true, text: msg }); void reload(); }}
        />
      )}
      {orgAdmin && <SeatOrgTreeAdmin onClose={() => setOrgAdmin(false)} />}
      {posAdmin && <SeatPositionAdmin onClose={() => setPosAdmin(false)} />}
      {busy && <div className="fixed bottom-4 right-4 bg-slate-800 text-white text-xs px-3 py-2 rounded-md shadow">Đang xử lý...</div>}
    </div>
  );
};

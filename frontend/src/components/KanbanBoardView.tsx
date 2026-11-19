// Chuyển từ OLD/src/components/KanbanBoardView.tsx (M5-4). Giữ giao diện, kéo thả, xác nhận, cập nhật tại chỗ.
// Dữ liệu: RPC board_page / board_cards (0013) thay /api/board; lưu bằng Edge records-save (op move, kiểm row_version);
// lịch sử chuyển vòng: RPC stage_history (status_history) thay audit log STAGE_MOVE của sheet.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Briefcase, GripVertical, History, LoaderCircle, MapPin, Phone, RefreshCw, Search, UserRound } from 'lucide-react';
import { BOARD_COLS, BoardCol, FAIL_LABEL, FailStage, boardPosition, boxStatuses } from '../../../shared/pipelineRules.ts';
import {
  candidateService as dataService,
  type BoardCard,
  type BoardFilters,
  type CandidateRecord,
  type DropdownDataResponse,
  type StageHistoryItem,
} from '../services/candidateService.ts';
import type { UserProfile } from '../services/authService.ts';
import { CandidateDetailModal } from './CandidateDetailModal.tsx';

/**
 * Kanban view of the recruitment pipeline (Lead, R1, LU/SU, R2, OB), next to the table view of the candidate page.
 *
 * Data: the same candidate rows as the table (no copy). The server sorts candidates into boxes with the shared rule
 * (src/shared/pipelineRules.ts) and sends the first 30 cards of every box with the total; more are loaded on demand.
 * Moving: drag a card onto a later box (or pick it in the card's menu on a tablet), confirm, and the server saves it
 * through the normal profile update (permission, version check, workspace + Master, audit log with a STAGE_MOVE line).
 */

const ORDER: Record<BoardCol, number> = { lead: 0, r1: 1, lusu: 2, r2: 3, ob: 4 };
const COL_STYLE: Record<BoardCol, { bar: string; head: string; count: string; drop: string }> = {
  lead: { bar: 'bg-slate-400', head: 'bg-slate-50', count: 'bg-slate-200 text-slate-800', drop: 'bg-slate-100' },
  r1: { bar: 'bg-sky-500', head: 'bg-sky-50', count: 'bg-sky-100 text-sky-800', drop: 'bg-sky-50' },
  lusu: { bar: 'bg-indigo-500', head: 'bg-indigo-50', count: 'bg-indigo-100 text-indigo-800', drop: 'bg-indigo-50' },
  r2: { bar: 'bg-violet-500', head: 'bg-violet-50', count: 'bg-violet-100 text-violet-800', drop: 'bg-violet-50' },
  ob: { bar: 'bg-emerald-500', head: 'bg-emerald-50', count: 'bg-emerald-100 text-emerald-800', drop: 'bg-emerald-50' },
};
const STATUS_LABEL: Record<string, string> = { r1_status: 'R1 Status', r2_status: 'R2 Status', ob_status: 'OB Status' };

type Counts = Record<string, { total: number; failed: number }>;
type Columns = Record<string, BoardCard[]>;
interface PendingMove {
  card: BoardCard;
  from: BoardCol;
  to: BoardCol;
}

const colLabel = (col: string) => BOARD_COLS.find((b) => b.key === col)?.label || col;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
/** "2026-11-17T09:05:00..." -> "17/11/2026 09:05"; anything else is shown as it is. */
function fmtTime(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v || '');
  if (!m) return v || '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface Props {
  user: UserProfile;
  dropdowns: DropdownDataResponse;
  globalSearch: string;
  /** Opens the full entry form of a candidate (same as editing from the table). */
  onEditCandidate: (candidate: CandidateRecord) => void;
}

export const KanbanBoardView: React.FC<Props> = ({ user, dropdowns, globalSearch, onEditCandidate }) => {
  const isAdmin = user.role === 'admin';
  const canMove = (card: BoardCard) => isAdmin || (Boolean(user.pic_code) && card.pic === user.pic_code);

  // ---------- filters. The search text comes from the search box of the top bar (the only one on the page); it waits
  // until typing pauses, so one request per pause.
  const [pic, setPic] = useState('');
  const [position, setPosition] = useState('');
  const [region, setRegion] = useState('');
  const [q, setQ] = useState(globalSearch.trim());
  useEffect(() => {
    const t = window.setTimeout(() => setQ(globalSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [globalSearch]);
  const extra: BoardFilters = useMemo(() => ({ position, region }), [position, region]);
  const hasFilter = Boolean(pic || position || region);

  // ---------- board data
  const [counts, setCounts] = useState<Counts | null>(null);
  const [columns, setColumns] = useState<Columns>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreBusy, setMoreBusy] = useState('');
  const seq = useRef(0);

  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const msgTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(null), 7000);
  }, []);
  useEffect(() => () => window.clearTimeout(msgTimer.current), []);

  // A remembered copy of this board is on screen and the current one is being fetched (dataService.peekBoard).
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const my = ++seq.current;
    const copy = dataService.peekBoard(isAdmin ? pic : '', q, extra);
    if (copy) {
      setCounts(copy.counts);
      setColumns(copy.columns);
      setRefreshing(true);
    } else {
      setRefreshing(false);
    }
    setLoading(true);
    setError('');
    try {
      const d = await dataService.getBoard(isAdmin ? pic : '', q, extra);
      if (my !== seq.current) return;
      setCounts(d.counts);
      setColumns(d.columns);
    } catch (e) {
      if (my !== seq.current) return;
      setError(errText(e, 'Không tải được Kanban.'));
    } finally {
      if (my === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [isAdmin, pic, q, extra]);
  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async (col: BoardCol) => {
    const my = seq.current;
    setMoreBusy(col);
    try {
      const r = await dataService.getBoardCards(col, columns[col]?.length || 0, isAdmin ? pic : '', q, extra);
      if (my !== seq.current) return;
      setColumns((prev) => {
        const cur = prev[col] || [];
        const seen = new Set(cur.map((c) => c.id));
        return { ...prev, [col]: [...cur, ...r.cards.filter((c) => !seen.has(c.id))] };
      });
      setCounts((prev) => (prev ? { ...prev, [col]: { ...prev[col], total: r.total } } : prev));
    } catch (e) {
      flash('err', errText(e, 'Không tải thêm được.'));
    } finally {
      setMoreBusy('');
    }
  };

  // ---------- moving (drag & drop, or the card menu), always confirmed first
  const [drag, setDrag] = useState<{ card: BoardCard; from: BoardCol } | null>(null);
  const [over, setOver] = useState<BoardCol | ''>('');
  const [pending, setPending] = useState<PendingMove | null>(null);
  const moving = false; // hệ cũ: state không bao giờ được đặt true (lưu chạy nền, thẻ khóa bằng `saving`)
  // Cards whose move is being saved (they moved on screen at once; they cannot be moved again until it is saved).
  const [saving, setSaving] = useState<Set<number>>(() => new Set());

  const canDropOn = (to: BoardCol) => Boolean(drag) && !drag!.card.failed_at && ORDER[to] > ORDER[drag!.from];

  const requestMove = (card: BoardCard, from: BoardCol, to: BoardCol) => {
    if (to === from) return;
    if (card.failed_at) {
      const f = card.failed_at as FailStage;
      flash('err', `${card.full_name} đã rớt ở ${FAIL_LABEL[f]} nên không chuyển tiếp được. Muốn mở lại, hãy đổi trạng thái ${FAIL_LABEL[f]} trong hồ sơ.`);
      return;
    }
    if (ORDER[to] < ORDER[from]) {
      flash('err', 'Chỉ chuyển tiến lên. Muốn lùi lại, hãy sửa trạng thái trong hồ sơ.');
      return;
    }
    if (!canMove(card)) {
      flash('err', 'Bạn chỉ được chuyển ứng viên do chính mình phụ trách.');
      return;
    }
    setPending({ card, from, to });
  };

  // Moves one card between two boxes on screen (and the two totals).
  const placeCard = (card: BoardCard, from: BoardCol, to: BoardCol) => {
    setColumns((prev) => ({
      ...prev,
      [from]: (prev[from] || []).filter((c) => c.id !== card.id),
      [to]: [card, ...(prev[to] || []).filter((c) => c.id !== card.id)],
    }));
    setCounts((prev) => {
      if (!prev || from === to) return prev;
      const next = { ...prev };
      next[from] = { ...next[from], total: Math.max(0, (next[from]?.total || 0) - 1), failed: Math.max(0, (next[from]?.failed || 0) - (card.failed_at ? 1 : 0)) };
      next[to] = { ...next[to], total: (next[to]?.total || 0) + 1, failed: (next[to]?.failed || 0) + (card.failed_at ? 1 : 0) };
      return next;
    });
  };
  // Confirmed move: the card goes to its new box AT ONCE and is saved in the background. If the save fails, it goes
  // back and the board is reloaded (someone else may have changed the profile).
  const confirmMove = async () => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    placeCard(p.card, p.from, p.to);
    setSaving((prev) => new Set(prev).add(p.card.id));
    flash('ok', `Đang lưu: ${p.card.full_name} sang ${colLabel(p.to)}…`);
    try {
      // records-save trả hồ sơ đã lưu; ô thật sự tính lại bằng boardPosition (hệ cũ: server trả kèm position).
      const saved = await dataService.moveCandidate(p.card.id, p.to, p.card.row_version);
      const sp = boardPosition(saved);
      const res = { candidate: saved, position: { col: sp.col, failed_at: sp.failedAt || '' } };
      const cand = (res.candidate || {}) as unknown as Record<string, unknown>;
      const newCol = (BOARD_COLS.some((b) => b.key === res.position?.col) ? res.position.col : p.to) as BoardCol;
      const moved: BoardCard = {
        ...p.card,
        row_version: Number(cand.row_version) || p.card.row_version + 1,
        updated_at: String(cand.updated_at || p.card.updated_at),
        failed_at: (res.position?.failed_at || '') as BoardCard['failed_at'],
      };
      // The server decides the final box (e.g. a failed status): put the saved card there.
      setColumns((prev) => ({ ...prev, [p.to]: (prev[p.to] || []).filter((c) => c.id !== p.card.id) }));
      setCounts((prev) => (prev && newCol !== p.to ? { ...prev, [p.to]: { ...prev[p.to], total: Math.max(0, (prev[p.to]?.total || 0) - 1) } } : prev));
      setColumns((prev) => ({ ...prev, [newCol]: [moved, ...(prev[newCol] || []).filter((c) => c.id !== p.card.id)] }));
      setCounts((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (newCol !== p.to) next[newCol] = { ...next[newCol], total: (next[newCol]?.total || 0) + 1 };
        if (moved.failed_at) next[newCol] = { ...next[newCol], failed: (next[newCol]?.failed || 0) + 1 };
        return next;
      });
      flash('ok', `Đã chuyển ${p.card.full_name} từ ${colLabel(p.from)} sang ${colLabel(newCol)} và đã lưu. Mở hồ sơ để nhập ngày, giờ, lý do nếu cần.`);
    } catch (e) {
      placeCard(p.card, p.to, p.from);
      flash('err', errText(e, 'Không chuyển được ứng viên.') + ' Đã đưa thẻ về chỗ cũ.');
      load();
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(p.card.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !moving) setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, moving]);

  // ---------- profile popup with the stage history
  const [opening, setOpening] = useState(0);
  const [detail, setDetail] = useState<CandidateRecord | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [history, setHistory] = useState<StageHistoryItem[] | null>(null);

  const openCard = async (card: BoardCard) => {
    if (opening) return;
    setOpening(card.id);
    try {
      const c = await dataService.getCandidate(card.id);
      setDetailError('');
      setHistory(null);
      setDetail(c);
      dataService
        .getStageHistory(card.id)
        .then(
          (items) => setHistory(items),
          () => setHistory([])
        );
    } catch (e) {
      flash('err', errText(e, 'Không mở được hồ sơ.'));
    } finally {
      setOpening(0);
    }
  };

  const historyBlock = (
    <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 mb-2">
        <History className="w-3.5 h-3.5" /> Lịch sử chuyển vòng
      </h3>
      {history === null ? (
        <p className="text-[11px] text-slate-500">Đang tải...</p>
      ) : history.length === 0 ? (
        <p className="text-[11px] text-slate-500">Chưa có lần chuyển vòng nào bằng Kanban.</p>
      ) : (
        <ol className="space-y-1.5">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-700">
              <span className="font-mono-tabular text-slate-500">{fmtTime(h.created_at)}</span>
              <span className="font-semibold text-slate-900">{h.actor_username}</span>
              <span className="inline-flex items-center gap-1">
                <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200">{h.from_box ? colLabel(h.from_box) : '—'}</span>
                <ArrowRight className="w-3 h-3 text-slate-400" />
                <span className="px-1.5 py-0.5 rounded bg-white border border-slate-200 font-semibold">{h.to_box ? colLabel(h.to_box) : '—'}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );

  const totalAll = counts ? BOARD_COLS.reduce((s, b) => s + (counts[b.key]?.total || 0), 0) : 0;

  // ---------- render
  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2.5 items-end">
        {isAdmin && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">PIC phụ trách</label>
            <select value={pic} onChange={(e) => setPic(e.target.value)} className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white">
              <option value="">Tất cả PIC</option>
              {(dropdowns.lists.pic || []).map((o) => (
                <option key={o.value} value={o.value}>{o.value}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Vị trí (Position)</label>
          <select value={position} onChange={(e) => setPosition(e.target.value)} className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white">
            <option value="">Tất cả vị trí</option>
            {(dropdowns.lists.position || []).map((o) => (
              <option key={o.value} value={o.value}>{o.value}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">Khu vực (Region)</label>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white">
            <option value="">Tất cả khu vực</option>
            {(dropdowns.lists.region || []).map((o) => (
              <option key={o.value} value={o.value}>{o.value}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setPic('');
                setPosition('');
                setRegion('');
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded bg-white hover:bg-slate-50 whitespace-nowrap"
            >
              Xóa lọc
            </button>
          )}
          <button
            type="button"
            onClick={() => load()}
            title="Tải lại"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-blue-700 border border-blue-200 rounded bg-white hover:bg-blue-50 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {refreshing ? 'Đang cập nhật…' : 'Tải lại'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {counts ? <><strong className="text-slate-800" data-no-i18n>{totalAll.toLocaleString('vi-VN')}</strong> ứng viên đang theo dõi (không gồm hồ sơ đã lưu trữ).</> : ' '}
          {q && (
            <span className="inline-flex items-center gap-1">
              <Search className="w-3 h-3" /> Đang tìm: <strong className="text-slate-800" data-no-i18n>{q}</strong>
            </span>
          )}
        </span>
        <span>Kéo thẻ sang ô phía sau để chuyển vòng (chỉ tiến lên). Bấm vào thẻ để xem hồ sơ.</span>
      </div>

      {msg && (
        <div role="status" className={`px-3 py-2 text-xs rounded border ${msg.type === 'ok' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'}`}>
          {msg.text}
        </div>
      )}
      {error && (
        <div className="px-3 py-2 text-xs rounded border text-red-700 bg-red-50 border-red-200 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" className="underline" onClick={() => load()}>Thử lại</button>
        </div>
      )}

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {BOARD_COLS.map((col) => {
          const st = COL_STYLE[col.key];
          const cards = columns[col.key] || [];
          const c = counts?.[col.key];
          const hot = over === col.key && Boolean(drag);
          const ok = hot && canDropOn(col.key);
          const refused = hot && !canDropOn(col.key) && drag?.from !== col.key;
          const remaining = (c?.total || 0) - cards.length;
          return (
            <section
              key={col.key}
              aria-label={`Cột ${col.label}`}
              className={`snap-start shrink-0 w-[264px] lg:w-auto lg:flex-1 lg:min-w-[196px] flex flex-col rounded-lg border bg-white transition-colors ${
                ok ? 'border-emerald-500 ring-2 ring-emerald-200' : refused ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-200'
              }`}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = canDropOn(col.key) ? 'move' : 'none';
                if (over !== col.key) setOver(col.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === col.key ? '' : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const d = drag;
                setDrag(null);
                setOver('');
                if (d) requestMove(d.card, d.from, col.key);
              }}
            >
              <div className={`${st.bar} h-1 rounded-t-lg`} />
              <header className={`${st.head} px-3 py-2 border-b border-slate-200`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">{col.label}</h3>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${st.count}`} data-no-i18n>
                    {c ? c.total.toLocaleString('vi-VN') : '—'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600 leading-tight">{col.sub}</div>
                {c && c.failed > 0 && <div className="text-[11px] font-semibold text-red-700 mt-0.5">{c.failed} đã rớt</div>}
              </header>

              <div className={`flex-1 p-2 space-y-2 overflow-y-auto min-h-[180px] max-h-[calc(100vh-330px)] ${ok ? st.drop : ''}`}>
                {loading && !cards.length ? (
                  Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-md bg-slate-100 animate-pulse" />)
                ) : !cards.length ? (
                  <p className="text-[11px] text-slate-400 text-center py-6">Không có ứng viên</p>
                ) : (
                  cards.map((card) => {
                    const failed = card.failed_at as FailStage | '';
                    const movable = !failed && canMove(card) && !saving.has(card.id);
                    const forward = BOARD_COLS.filter((b) => ORDER[b.key] > ORDER[col.key]);
                    return (
                      <article
                        key={card.id}
                        draggable={movable && !moving}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(card.id));
                          setDrag({ card, from: col.key });
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setOver('');
                        }}
                        onClick={() => openCard(card)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openCard(card);
                        }}
                        tabIndex={0}
                        title={saving.has(card.id) ? 'Đang lưu…' : failed ? `Đã rớt ở ${FAIL_LABEL[failed]}: không chuyển được` : 'Bấm để xem hồ sơ, kéo để chuyển vòng'}
                        className={`group relative rounded-md border bg-white px-2.5 py-2 text-xs shadow-sm hover:shadow-md hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300 transition ${
                          failed ? 'border-red-200 border-l-4 border-l-red-400 opacity-80' : 'border-slate-200'
                        } ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${drag?.card.id === card.id ? 'opacity-40' : ''} ${saving.has(card.id) ? 'opacity-60 animate-pulse' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <span className="font-mono-tabular text-[11px] font-semibold text-slate-500" data-no-i18n>{card.candidate_code}</span>
                          <span className="flex items-center gap-1">
                            {failed && <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1">Rớt {FAIL_LABEL[failed]}</span>}
                            {opening === card.id && <LoaderCircle className="w-3.5 h-3.5 text-blue-600 animate-spin" />}
                            {movable && <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500" />}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[13px] font-bold text-slate-900 leading-snug break-words" data-no-i18n>{card.full_name || '—'}</div>
                        <dl className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
                          <div className="flex items-center gap-1.5" data-no-i18n>
                            <Phone className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="font-mono-tabular">{card.phone || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0" data-no-i18n>
                            <Briefcase className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="truncate">{card.position || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0" data-no-i18n>
                            <UserRound className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="truncate">{card.pic || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0" data-no-i18n>
                            <MapPin className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="truncate" title={[card.site, card.location, card.region].filter(Boolean).join(' · ')}>
                              {[card.site, card.location].filter(Boolean).join(' · ') || card.region || '—'}
                            </span>
                          </div>
                        </dl>
                        {/* Tablets and keyboards cannot drag: the same move from a menu. */}
                        {movable && forward.length > 0 && (
                          <select
                            aria-label={`Chuyển ${card.full_name} sang vòng khác`}
                            value=""
                            disabled={moving}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const to = e.target.value as BoardCol;
                              if (to) requestMove(card, col.key, to);
                            }}
                            className="mt-2 w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-slate-50 text-slate-600 hover:border-slate-300"
                          >
                            <option value="">Chuyển sang...</option>
                            {forward.map((b) => (
                              <option key={b.key} value={b.key}>{b.label}</option>
                            ))}
                          </select>
                        )}
                      </article>
                    );
                  })
                )}
                {remaining > 0 && (
                  <button
                    type="button"
                    disabled={moreBusy === col.key}
                    onClick={() => loadMore(col.key)}
                    className="w-full py-1.5 text-[11px] font-semibold text-blue-700 border border-dashed border-blue-200 rounded hover:bg-blue-50 disabled:opacity-60"
                  >
                    {moreBusy === col.key ? 'Đang tải...' : `Tải thêm (còn ${remaining.toLocaleString('vi-VN')})`}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Confirmation before a move */}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !moving) setPending(null);
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="kanban-confirm-title" className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
              <h2 id="kanban-confirm-title" className="text-sm font-bold text-slate-900">Xác nhận chuyển vòng</h2>
            </div>
            <div className="px-5 py-4 space-y-3 text-xs text-slate-700">
              <p>
                <strong className="text-slate-900" data-no-i18n>{pending.card.full_name}</strong>{' '}
                <span className="font-mono-tabular text-slate-500" data-no-i18n>({pending.card.candidate_code})</span>
              </p>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded font-semibold ${COL_STYLE[pending.from].count}`}>{colLabel(pending.from)}</span>
                <ArrowRight className="w-4 h-4 text-slate-400" />
                <span className={`px-2 py-1 rounded font-semibold ${COL_STYLE[pending.to].count}`}>{colLabel(pending.to)}</span>
              </div>
              <div>
                <p className="mb-1">Hồ sơ sẽ được cập nhật (nếu chưa đúng):</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {boxStatuses(pending.to).map(([k, v]) => (
                    <li key={k}>
                      {STATUS_LABEL[k] || k} = <strong>{v}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[11px] text-slate-500">
                Ngày, giờ và lý do không tự điền. Thao tác được ghi vào Nhật ký thay đổi (người thực hiện, thời gian, vòng trước và sau).
              </p>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                disabled={moving}
                onClick={() => setPending(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                autoFocus
                disabled={moving}
                onClick={confirmMove}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60"
              >
                {moving && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
                {moving ? 'Đang lưu...' : 'Xác nhận chuyển'}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <CandidateDetailModal
          candidate={detail}
          user={user}
          canEdit={isAdmin || (Boolean(user.pic_code) && String(detail.pic) === user.pic_code)}
          busy={detailBusy}
          error={detailError}
          extra={historyBlock}
          onClose={() => setDetail(null)}
          onEdit={() => onEditCandidate(detail)}
          onDelete={async () => {
            const restoring = Boolean(detail.is_archived);
            if (
              !restoring &&
              !window.confirm(
                `Xóa hồ sơ ${String(detail.candidate_code)} - ${String(detail.full_name)}?\n\nHồ sơ được chuyển vào mục lưu trữ và biến khỏi danh sách. Admin vẫn khôi phục được bằng cách bật "Hiện cả hồ sơ đã lưu trữ".`
              )
            )
              return;
            setDetailBusy(true);
            setDetailError('');
            try {
              await dataService.toggleArchiveCandidate(detail.id, !restoring, detail.row_version);
              setDetail(null);
              load();
            } catch (e) {
              setDetailError(errText(e, 'Không thể thực hiện thao tác.'));
            } finally {
              setDetailBusy(false);
            }
          }}
        />
      )}
    </div>
  );
};

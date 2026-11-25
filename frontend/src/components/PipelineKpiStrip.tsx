import React, { useCallback, useEffect, useState } from 'react';
import { candidateService } from '../services/candidateService.ts';
import { BOARD_SUBS, type BoardCol, FAIL_LABEL, type FailStage } from '../../../shared/pipelineRules.ts';

const ORDER: Record<string, number> = { lead: 0, r1: 1, lusu: 2, r2: 3, ob: 4 };
/** The three R2 results; clicking the R2 card lists all of them. */
export const R2_RESULTS = 'r2_passed,r2_failed,r2_canceled';

/** What is being dragged out of the list below. */
export interface DraggedCandidate {
  id: number;
  row_version: number;
  full_name: string;
  col: BoardCol;
  failedAt: FailStage | null;
}

/**
 * The six KPI cards. SU and LU are two small cards side by side (they share the place of the old "LU / SU" card).
 */
type TileKey = 'lead' | 'r1' | 'su' | 'lu' | 'r2' | 'ob';
interface Tile {
  key: TileKey;
  label: string;
  hint: string;
  cls: string;
  filter: { box?: BoardCol; sub?: string };
  drop: BoardCol | null;
  /** Màu chữ của nhãn thẻ, cùng họ màu với viền. */
  tone: string;
}
const TILES: Tile[] = [
  { key: 'lead', label: 'Lead', hint: 'Chưa Screening', cls: 'border-slate-300 bg-slate-50', tone: 'text-slate-700', filter: { box: 'lead' }, drop: 'lead' },
  { key: 'r1', label: 'R1', hint: 'Đang ở vòng 1 (Screening)', cls: 'border-sky-300 bg-sky-50', tone: 'text-sky-800', filter: { box: 'r1' }, drop: 'r1' },
  { key: 'su', label: 'SU', hint: 'Đạt R1, chưa lên lịch R2', cls: 'border-blue-300 bg-blue-50', tone: 'text-blue-800', filter: { sub: 'su' }, drop: 'lusu' },
  { key: 'lu', label: 'LU', hint: 'Đã lên lịch R2, chưa có KQ', cls: 'border-indigo-300 bg-indigo-50', tone: 'text-indigo-800', filter: { sub: 'lu' }, drop: 'r2' },
  { key: 'r2', label: 'R2', hint: 'Đã có kết quả vòng 2', cls: 'border-violet-300 bg-violet-50', tone: 'text-violet-800', filter: { sub: R2_RESULTS }, drop: null },
  { key: 'ob', label: 'OB', hint: 'Onboard', cls: 'border-emerald-300 bg-emerald-50', tone: 'text-emerald-800', filter: { box: 'ob' }, drop: 'ob' },
];
const TILE_OF_DROP: Record<string, string> = { lead: 'Lead', r1: 'R1', lusu: 'SU', r2: 'LU', ob: 'OB' };
/** Small clickable lines under a card (sub-indicators that are only a part of the card). */
const LINES: Partial<Record<TileKey, string[]>> = { r1: ['r1_wait'], ob: ['ob_wait'] };
const R2_TILES = ['r2_passed', 'r2_failed', 'r2_canceled'];

/** Text of the active filter, for the banner under the cards. */
export function kpiFilterLabel(box: string, sub: string): string {
  if (sub) {
    const t = TILES.find((x) => x.filter.sub === sub);
    if (t) return `${t.label}: ${t.hint}`;
    const s = BOARD_SUBS.find((x) => x.key === sub);
    const parent = s ? TILES.find((x) => x.filter.box === s.col || (s.col === 'r2' && x.key === 'r2')) : null;
    return s ? `${parent ? parent.label + ', ' : ''}${s.label} (${s.hint})` : sub;
  }
  const t = TILES.find((x) => x.filter.box === box);
  return t ? `${t.label}: ${t.hint}` : box;
}

interface Props {
  /** Admin: the TA picked in the list filter ('' = all). A TA always sees only their own candidates. */
  pic: string;
  /** Changes whenever the list was reloaded, so the numbers are read again. */
  refreshKey: number;
  /** The row being dragged (set by the list). */
  dragRef: React.MutableRefObject<DraggedCandidate | null>;
  onMoved: () => void;
  /** The box / sub-indicator(s) the list below is filtered to ('' = none). */
  activeBox: string;
  activeSub: string;
  /** Clicking a card or a line: show only those candidates (clicking it again shows everyone). */
  onSelectBox: (box: BoardCol) => void;
  onSelectSub: (sub: string) => void;
}

export const PipelineKpiStrip: React.FC<Props> = ({ pic, refreshKey, dragRef, onMoved, activeBox, activeSub, onSelectBox, onSelectSub }) => {
  const [counts, setCounts] = useState<Record<string, { total: number; failed: number }> | null>(() => candidateService.peekBoardCounts(pic)?.counts || null);
  const [subs, setSubs] = useState<Record<string, number> | null>(() => candidateService.peekBoardCounts(pic)?.subs || null);
  const [over, setOver] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const copy = candidateService.peekBoardCounts(pic);
    if (copy) {
      setCounts(copy.counts);
      setSubs(copy.subs || null);
    }
    try {
      const r = await candidateService.getBoardCounts(pic);
      setCounts(r.counts);
      setSubs(r.subs || null);
    } catch {
      if (!copy) {
        setCounts(null);
        setSubs(null);
      }
    }
  }, [pic]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 6000);
  };

  const canDrop = (t: Tile) => {
    const d = dragRef.current;
    return Boolean(d) && Boolean(t.drop) && !d!.failedAt && ORDER[t.drop!] > ORDER[d!.col];
  };

  const drop = async (t: Tile) => {
    const d = dragRef.current;
    dragRef.current = null;
    setOver('');
    if (!d) return;
    if (!t.drop) {
      flash('err', 'Kết quả R2 (Passed / Failed / Canceled) nhập trong hồ sơ. Kéo vào LU để hẹn phỏng vấn vòng 2.');
      return;
    }
    if (d.failedAt) {
      flash('err', `${d.full_name} đã rớt ở ${FAIL_LABEL[d.failedAt]} nên không chuyển tiếp được. Muốn mở lại, hãy đổi trạng thái ${FAIL_LABEL[d.failedAt]} trong hồ sơ.`);
      return;
    }
    if (ORDER[t.drop] === ORDER[d.col]) return;
    if (ORDER[t.drop] < ORDER[d.col]) {
      flash('err', 'Chỉ kéo tiến lên. Muốn lùi lại, hãy sửa trạng thái trong hồ sơ.');
      return;
    }
    setBusy(true);
    try {
      await candidateService.moveCandidate(d.id, t.drop, d.row_version);
      const what = t.drop === 'r2' ? ' (R2 = Pending, chờ kết quả)' : t.drop === 'lusu' ? ' (R1 = Passed)' : '';
      flash('ok', `Đã chuyển ${d.full_name} sang ${TILE_OF_DROP[t.drop]}${what}. Mở hồ sơ để nhập ngày, giờ.`);
      onMoved();
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Không chuyển được.');
      onMoved();
    } finally {
      setBusy(false);
    }
  };

  const numberOf = (t: Tile): number | null => {
    if (!counts) return null;
    if (t.key === 'su' || t.key === 'lu') return subs ? subs[t.key] ?? 0 : null;
    if (t.key === 'r2') return subs ? R2_TILES.reduce((s, k) => s + (subs[k] ?? 0), 0) : null;
    return counts[t.filter.box!]?.total ?? 0;
  };
  const isOn = (t: Tile) => (t.filter.sub ? activeSub === t.filter.sub : activeBox === t.filter.box && !activeSub);
  const click = (t: Tile) => (t.filter.sub ? onSelectSub(t.filter.sub) : onSelectBox(t.filter.box!));

  const subButton = (key: string, tile: boolean) => {
    const s = BOARD_SUBS.find((x) => x.key === key)!;
    const on = activeSub === key;
    const n = subs?.[key] ?? 0;
    const red = key === 'r2_failed' || key === 'r2_canceled';
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        title={`${s.hint}. ${on ? 'Bấm lại để hiện tất cả.' : 'Bấm để xem danh sách.'}`}
        onClick={() => onSelectSub(key)}
        className={`w-full rounded px-1.5 py-0.5 text-[11px] leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
          tile ? 'flex flex-col items-center text-center' : 'flex items-center justify-between gap-2 text-left'
        } ${on ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-white/70'}`}
      >
        <span className={tile ? 'font-semibold' : ''}>{s.label}</span>
        <span className={`font-bold tabular-nums ${on ? 'text-white' : red ? 'text-red-700' : 'text-slate-900'}`} data-no-i18n>
          {n.toLocaleString('vi-VN')}
        </span>
      </button>
    );
  };

  const card = (t: Tile) => {
    const n = numberOf(t);
    const hot = over === t.key;
    const ok = hot && canDrop(t);
    const refused = hot && dragRef.current !== null && !canDrop(t);
    const on = isOn(t);
    const failed = t.filter.box ? counts?.[t.filter.box]?.failed || 0 : 0;
    return (
      <div
        key={t.key}
        onDragOver={(e) => {
          if (!dragRef.current) return;
          e.preventDefault();
          if (over !== t.key) setOver(t.key);
        }}
        onDragLeave={() => setOver((o) => (o === t.key ? '' : o))}
        onDrop={(e) => {
          e.preventDefault();
          drop(t);
        }}
        className={`min-w-0 rounded-lg border-2 px-3 py-2.5 transition-colors hover:shadow-sm flex flex-col h-full ${t.cls} ${on ? '!border-blue-600 ring-2 ring-blue-200' : ''} ${ok ? '!border-emerald-500 ring-2 ring-emerald-200' : ''} ${refused ? '!border-red-400 ring-2 ring-red-100' : ''} ${busy ? 'opacity-60' : ''}`}
      >
        <button
          type="button"
          aria-pressed={on}
          title={on ? 'Bấm lại để hiện tất cả ứng viên' : `Bấm để chỉ xem ứng viên ${t.label} (${t.hint.toLowerCase()})`}
          onClick={() => click(t)}
          className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 rounded"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className={`text-sm font-bold whitespace-nowrap ${t.tone}`}>{t.label}</span>
            <span className="text-2xl font-extrabold tracking-tight text-slate-900 tabular-nums" data-no-i18n>
              {n === null ? '—' : n.toLocaleString('vi-VN')}
            </span>
          </span>
          <span className="block min-h-[2rem] text-[11px] text-slate-600 leading-4">{t.hint}</span>
          <span className="block min-h-[1rem] text-[11px] font-semibold text-red-700 leading-4">{failed > 0 ? `${failed} đã rớt` : ''}</span>
        </button>
        {/* Chân thẻ: luôn dính đáy, cùng chiều cao ở mọi thẻ để các dòng thẳng hàng */}
        <div className="mt-auto pt-1.5">
          <div className="min-h-[2.75rem] border-t border-black/10 pt-1.5">
            {subs && LINES[t.key] && <div className="space-y-0.5">{LINES[t.key]!.map((k) => subButton(k, false))}</div>}
            {subs && t.key === 'r2' && <div className="grid grid-cols-3 gap-1">{R2_TILES.map((k) => subButton(k, true))}</div>}
          </div>
        </div>
      </div>
    );
  };

  const tile = (k: TileKey) => TILES.find((t) => t.key === k)!;
  const filterLabel = activeSub || activeBox ? kpiFilterLabel(activeBox, activeSub) : '';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 items-stretch">
        {(['lead', 'r1', 'su', 'lu', 'r2', 'ob'] as TileKey[]).map((k) => card(tile(k)))}
      </div>
      {filterLabel ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs leading-5 rounded border border-blue-200 bg-blue-50 text-blue-900">
          <span>
            Đang xem: <strong>{filterLabel}</strong>. Kéo dòng sang thẻ khác khi ứng viên đạt yêu cầu.
          </span>
          <button
            type="button"
            onClick={() => (activeSub ? onSelectSub(activeSub) : onSelectBox(activeBox as BoardCol))}
            className="ml-auto underline"
          >
            Hiện tất cả
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs leading-5 rounded border border-slate-200 bg-slate-50 text-slate-600">
          <span>Bấm vào thẻ để chỉ xem ứng viên ở đó.</span>
          <span>
            Kéo ứng viên thả vào thẻ để chuyển bước (chỉ tiến lên): <strong>SU</strong> = đạt R1, <strong>LU</strong> = đã hẹn R2, <strong>OB</strong> = đạt R2.
          </span>
          <span>Kết quả R2 nhập trong hồ sơ.</span>
        </div>
      )}
      {msg && (
        <div className={`px-3 py-1.5 text-xs leading-5 rounded border ${msg.type === 'ok' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'}`}>{msg.text}</div>
      )}
    </div>
  );
};

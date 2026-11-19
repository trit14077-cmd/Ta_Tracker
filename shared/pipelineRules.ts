/**
 * Recruitment pipeline board (5 boxes) and the "failed" lock. One set of rules for the browser and the Apps Script server.
 *
 * Boxes, by how far a candidate has got (furthest step wins):
 *   Lead   nothing recorded for R1 yet
 *   R1     R1 has a status (Pending, KIV, ...) or a date, but is not Passed
 *   LU/SU  R1 Passed (lined up / showed up for R2), R2 has no status yet
 *   R2     R2 has a status (Pending, Passed, ...)
 *   OB     Onboard has a status or a date
 * A candidate that FAILED stays in the box where it failed, marked as failed, and every step after it is locked.
 *
 * Failed: R1 = Failed; R2 = Failed or Canceled; Onboard = Canceled or Noshow. Default rule, to be confirmed by the business.
 */
import { FIELD_CATALOG } from './fieldCatalog.ts';
import { REASON_FIELD, ReasonRound, allowedReasons } from './reasonRules.ts';

export type BoardCol = 'lead' | 'r1' | 'lusu' | 'r2' | 'ob';
export type FailStage = 'r1' | 'r2' | 'ob';

export const BOARD_COLS: { key: BoardCol; label: string; sub: string }[] = [
  { key: 'lead', label: 'Lead', sub: 'Chưa có kết quả R1' },
  { key: 'r1', label: 'R1', sub: 'Đang ở vòng 1' },
  { key: 'lusu', label: 'LU / SU', sub: 'Đạt R1, hẹn / đến phỏng vấn R2' },
  { key: 'r2', label: 'R2', sub: 'Đang ở vòng 2' },
  { key: 'ob', label: 'OB', sub: 'Onboard' },
];
const ORDER: Record<BoardCol, number> = { lead: 0, r1: 1, lusu: 2, r2: 3, ob: 4 };

const FAILED_STATUSES: Record<FailStage, string[]> = {
  r1: ['Failed'],
  r2: ['Failed', 'Canceled'],
  ob: ['Canceled', 'Noshow'],
};
/** Section that holds the round's own fields; everything in a later section is locked once the round failed. */
const STAGE_SECTION: Record<FailStage, number> = { r1: 4, r2: 5, ob: 6 };
export const FAIL_LABEL: Record<FailStage, string> = { r1: 'R1', r2: 'R2', ob: 'Onboard' };

const g = (c: Record<string, unknown>, k: string) => String(c[k] ?? '').trim();

/** The first round the candidate failed, or null. */
export function failedStage(c: Record<string, unknown>): FailStage | null {
  if (FAILED_STATUSES.r1.includes(g(c, 'r1_status'))) return 'r1';
  if (FAILED_STATUSES.r2.includes(g(c, 'r2_status'))) return 'r2';
  if (FAILED_STATUSES.ob.includes(g(c, 'ob_status'))) return 'ob';
  return null;
}

export function boardPosition(c: Record<string, unknown>): { col: BoardCol; failedAt: FailStage | null } {
  const failedAt = failedStage(c);
  if (failedAt) return { col: failedAt === 'r1' ? 'r1' : failedAt === 'r2' ? 'r2' : 'ob', failedAt };
  let col: BoardCol = 'lead';
  if (g(c, 'ob_status') || g(c, 'ob_date')) col = 'ob';
  else if (g(c, 'r2_status')) col = 'r2';
  else if (g(c, 'r1_status') === 'Passed' || g(c, 'r2_date')) col = 'lusu';
  else if (g(c, 'r1_status') || g(c, 'r1_date')) col = 'r1';
  return { col, failedAt: null };
}

/**
 * Sub-indicators of the KPI cards. Each candidate is counted in at most one of them, so the numbers never overlap.
 * Terms follow the "Báo cáo" page: Screening = round 1 (R1_STT), "lên lịch" = round 2 recorded (R2 date / R2_STT).
 * The form never saves a round's date without its status, so "scheduled but no result" means an R2_STT that is not a
 * result yet (Pending, KIV, Không liên lạc được). Results: Passed / Failed (R1, R2) + Canceled (R2); Accepted / Joined /
 * Canceled / Noshow (OB).
 *   lead_new     Lead box: no R1 date and no R1_STT (not screened yet)                  -> the whole Lead box
 *   r1_wait      R1 box, not failed: R1_STT Pending / KIV / Không liên lạc được          -> R1 box minus R1 Failed
 *   su           LU/SU box: passed R1, round 2 not scheduled yet                        -> the whole LU/SU box
 *   lu           R2 box, R2_STT not a result yet: scheduled, waiting for the result
 *   r2_passed / r2_failed / r2_canceled   R2 box by R2_STT       (lu + these three = the whole R2 box)
 *   ob_wait      OB box with OB Status empty, Pending or "Không liên lạc được"
 */
export type BoardSub = 'lead_new' | 'r1_wait' | 'su' | 'lu' | 'r2_passed' | 'r2_failed' | 'r2_canceled' | 'ob_wait';
export const BOARD_SUBS: { key: BoardSub; col: BoardCol; label: string; hint: string }[] = [
  { key: 'lead_new', col: 'lead', label: 'Chưa Screening', hint: 'Chưa có ngày và trạng thái R1' },
  { key: 'r1_wait', col: 'r1', label: 'Đã Screening, chưa có KQ', hint: 'R1_STT Pending, KIV hoặc Không liên lạc được (chưa Passed / Failed)' },
  { key: 'su', col: 'lusu', label: 'SU: chưa lên lịch', hint: 'Đạt R1, chưa có lịch R2' },
  { key: 'lu', col: 'r2', label: 'LU: đã lên lịch, chưa có KQ', hint: 'Đã có lịch R2, R2_STT Pending, KIV hoặc Không liên lạc được' },
  { key: 'r2_passed', col: 'r2', label: 'Passed', hint: 'R2_STT = Passed (chưa sang Onboard)' },
  { key: 'r2_failed', col: 'r2', label: 'Failed', hint: 'R2_STT = Failed' },
  { key: 'r2_canceled', col: 'r2', label: 'Canceled', hint: 'R2_STT = Canceled' },
  { key: 'ob_wait', col: 'ob', label: 'Chưa có kết quả', hint: 'OB Status trống, Pending hoặc Không liên lạc được' },
];
const OB_NO_RESULT = ['', 'Pending', 'Không liên lạc được'];

/** The sub-indicator a candidate belongs to, or null (R1 Failed, OB with a result). */
export function boardSub(c: Record<string, unknown>): BoardSub | null {
  const pos = boardPosition(c);
  switch (pos.col) {
    case 'lead':
      return 'lead_new';
    case 'r1':
      return pos.failedAt ? null : 'r1_wait';
    case 'lusu':
      // An R2 date without R2_STT can only come from old data (the form refuses it): scheduled, so LU.
      return g(c, 'r2_date') ? 'lu' : 'su';
    case 'r2': {
      const s = g(c, 'r2_status');
      return s === 'Passed' ? 'r2_passed' : s === 'Failed' ? 'r2_failed' : s === 'Canceled' ? 'r2_canceled' : 'lu';
    }
    case 'ob':
      return !pos.failedAt && OB_NO_RESULT.includes(g(c, 'ob_status')) ? 'ob_wait' : null;
  }
  return null;
}

/** Field keys that may not be edited because the candidate failed an earlier round. Empty when nobody failed. */
export function lockedFieldKeys(c: Record<string, unknown>): string[] {
  const f = failedStage(c);
  if (!f) return [];
  const from = STAGE_SECTION[f];
  // Computed fields (month, tenor...) follow their source and are never typed by a person, so they are not part of the lock.
  return FIELD_CATALOG.filter((x) => x.sectionId > from && x.type !== 'readonly_computed' && x.type !== 'readonly_timestamp').map((x) => x.key);
}

export interface MoveResult {
  changes: Record<string, string>;
  error?: { code: 'FAILED' | 'BACKWARD' | 'SAME' | 'INVALID'; message: string };
}

/** The status each box stands for. Dragging onto a box fills these (and the earlier rounds as Passed); dates stay as they are. */
const BOX_STATUS: Record<BoardCol, [string, string][]> = {
  lead: [],
  r1: [['r1_status', 'Pending']],
  lusu: [['r1_status', 'Passed']],
  r2: [['r1_status', 'Passed'], ['r2_status', 'Pending']],
  ob: [['r1_status', 'Passed'], ['r2_status', 'Passed'], ['ob_status', 'Pending']],
};

/** The statuses a box stands for (shown in the confirmation before a move). */
export function boxStatuses(target: BoardCol): [string, string][] {
  return BOX_STATUS[target] || [];
}

/** What changes when a candidate is dragged onto a box. Only moves forward; a failed candidate cannot be moved. */
export function moveChanges(c: Record<string, unknown>, target: BoardCol): MoveResult {
  if (!(target in ORDER)) return { changes: {}, error: { code: 'INVALID', message: 'Ô đích không hợp lệ.' } };
  const pos = boardPosition(c);
  if (pos.failedAt) {
    return { changes: {}, error: { code: 'FAILED', message: `Ứng viên đã rớt ở ${FAIL_LABEL[pos.failedAt]} nên không chuyển tiếp được. Hãy đổi trạng thái ${FAIL_LABEL[pos.failedAt]} trong hồ sơ nếu cần mở lại.` } };
  }
  if (ORDER[target] === ORDER[pos.col]) return { changes: {}, error: { code: 'SAME', message: 'Ứng viên đã ở ô này.' } };
  if (ORDER[target] < ORDER[pos.col]) {
    return { changes: {}, error: { code: 'BACKWARD', message: 'Chỉ kéo tiến lên. Muốn lùi lại, hãy sửa trạng thái trong hồ sơ.' } };
  }
  const changes: Record<string, string> = {};
  for (const [key, value] of BOX_STATUS[target]) {
    if (g(c, key) === value) continue;
    changes[key] = value;
    const round = (Object.keys(REASON_FIELD) as ReasonRound[]).find((r) => REASON_FIELD[r].status === key);
    if (round) {
      const sub = REASON_FIELD[round].sub;
      const allowed = allowedReasons(round, value);
      // A reason that belongs to the old status does not fit the new one.
      if (g(c, sub) && allowed !== null && !allowed.includes(g(c, sub))) changes[sub] = '';
    }
  }
  return { changes };
}

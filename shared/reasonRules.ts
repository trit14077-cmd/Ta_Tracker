/**
 * Status -> allowed reasons (Sub_STT) per round. Single source of truth for the form, the validation
 * (server, browser and Apps Script) and the seed lists. Draft agreed in chat; the manager may still edit it.
 * Keep docs/09_QUY_TAC_TRANG_THAI_LY_DO.md and Bang_map_trang_thai_ly_do.xlsx in sync.
 */

export type ReasonRound = 'r1' | 'r2' | 'ob';

export const REASON_FIELD: Record<ReasonRound, { status: string; sub: string; label: string }> = {
  r1: { status: 'r1_status', sub: 'r1_sub_status', label: 'R1' },
  r2: { status: 'r2_status', sub: 'r2_sub_status', label: 'R2' },
  ob: { status: 'ob_status', sub: 'ob_sub_status', label: 'Onboard' },
};

const CAND = ['Lương', 'Phụ cấp', 'Ca xoay', 'Xa nhà', 'Định hướng', 'Đổi vị trí', 'Cá nhân khác'];

/** status -> allowed reasons. A status with an empty list takes no reason. */
export const REASON_RULES: Record<ReasonRound, Record<string, string[]>> = {
  r1: {
    Passed: [],
    Failed: ['Không đạt chuyên môn', 'Độ tuổi', 'Ca xoay', 'Lương', 'Phụ cấp', 'Xa nhà', 'Định hướng', 'Đổi vị trí', 'Cá nhân khác'],
    Pending: CAND,
    KIV: CAND,
    'Không liên lạc được': [],
  },
  r2: {
    Passed: [],
    Failed: ['Không đạt chuyên môn', 'Thái độ', 'Sức khỏe', 'Đổi vị trí'],
    Canceled: ['Môi trường nóng', 'Đi lại nhiều', 'Bê vác nặng', 'Ca xoay', 'Lương', 'Phụ cấp', 'Xa nhà', 'Gia đình', 'Cá nhân khác'],
    Pending: ['Lương', 'Phụ cấp', 'Gia đình', 'Đổi vị trí', 'Cá nhân khác'],
    KIV: ['Lương', 'Phụ cấp', 'Gia đình', 'Đổi vị trí', 'Cá nhân khác'],
    'Không liên lạc được': [],
  },
  ob: {
    Accepted: [],
    Joined: [],
    Canceled: ['Lương', 'Phụ cấp', 'Chế độ', 'Ca xoay', 'Xa nhà', 'Định hướng', 'Môi trường', 'Cá nhân khác'],
    Noshow: ['Cá nhân khác', 'Xa nhà', 'Gia đình'],
    Pending: ['Cá nhân khác', 'Gia đình'],
    'Không liên lạc được': [],
  },
};

/** Statuses that should normally carry a reason (missing reason only produces a warning). */
export const REASON_EXPECTED: Record<ReasonRound, string[]> = {
  r1: ['Failed'],
  r2: ['Failed', 'Canceled'],
  ob: ['Canceled', 'Noshow'],
};

/** Old reason name (Drop-list / legacy data) -> new short name. Applied on legacy import only. */
export const REASON_RENAMES: Record<string, string> = {
  'Không đáp ứng công việc': 'Không đạt chuyên môn',
  'Xa nơi ở': 'Xa nhà',
  'Mức lương': 'Lương',
  'Xoay ca': 'Ca xoay',
  'Công việc di chuyển nhiều': 'Đi lại nhiều',
  'Công việc bê vác nhiều': 'Bê vác nặng',
  'Cá nhân': 'Cá nhân khác',
  'Vị trí phù hợp': 'Đổi vị trí',
};

/** Ordered list of every reason of one round (for the seed list). */
export function reasonUniverse(round: ReasonRound): string[] {
  const seen: string[] = [];
  for (const list of Object.values(REASON_RULES[round])) for (const r of list) if (!seen.includes(r)) seen.push(r);
  return seen;
}

/** Allowed reasons for a status, or null when the status is unknown (no rule). */
export function allowedReasons(round: ReasonRound, status: string): string[] | null {
  const rules = REASON_RULES[round];
  return Object.prototype.hasOwnProperty.call(rules, status) ? rules[status] : null;
}

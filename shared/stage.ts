/**
 * Current stage of a candidate, DERIVED from the existing R1 / R2 / Onboard statuses (nothing new is stored, so no
 * existing data or workflow changes). The mapping below is a safe default and still has to be confirmed by the
 * business (see "Passed" and "Actual" in the requirements appendix).
 *
 *   New        no R1 result yet and no interview scheduled
 *   Screening  R1 pending / R1 date set without a result
 *   Interview  passed R1, R2 not decided (waiting for or scheduled to R2)
 *   Evaluation R2 held, result pending
 *   Passed     passed R2, no onboard record yet
 *   Offer      onboard record exists (Accepted / Pending / date set)
 *   Hired      Onboard status Joined
 *   Rejected   failed R1 or R2, R2 canceled, or the candidate did not join (Noshow / Canceled)
 *   On Hold    KIV or cannot be reached at the latest round
 */
export type Stage = 'New' | 'Screening' | 'Interview' | 'Evaluation' | 'Passed' | 'Offer' | 'Hired' | 'Rejected' | 'On Hold';

export const STAGES: Stage[] = ['New', 'Screening', 'Interview', 'Evaluation', 'Passed', 'Offer', 'Hired', 'Rejected', 'On Hold'];

export const STAGE_LABELS: Record<Stage, { vi: string; en: string }> = {
  New: { vi: 'Mới', en: 'New' },
  Screening: { vi: 'Sàng lọc', en: 'Screening' },
  Interview: { vi: 'Phỏng vấn', en: 'Interview' },
  Evaluation: { vi: 'Đánh giá', en: 'Evaluation' },
  Passed: { vi: 'Đạt', en: 'Passed' },
  Offer: { vi: 'Offer', en: 'Offer' },
  Hired: { vi: 'Đã nhận việc', en: 'Hired' },
  Rejected: { vi: 'Loại', en: 'Rejected' },
  'On Hold': { vi: 'Tạm giữ', en: 'On Hold' },
};

/** Tailwind classes of the small badge (kept light so the list stays calm). */
export const STAGE_CLASSES: Record<Stage, string> = {
  New: 'bg-slate-100 text-slate-600',
  Screening: 'bg-sky-50 text-sky-700',
  Interview: 'bg-indigo-50 text-indigo-700',
  Evaluation: 'bg-violet-50 text-violet-700',
  Passed: 'bg-emerald-50 text-emerald-700',
  Offer: 'bg-amber-50 text-amber-700',
  Hired: 'bg-green-100 text-green-800',
  Rejected: 'bg-red-50 text-red-700',
  'On Hold': 'bg-orange-50 text-orange-700',
};

const HOLD = /^(KIV|Không liên lạc được)$/;

export function currentStage(c: Record<string, unknown>): Stage {
  const g = (k: string) => String(c[k] ?? '').trim();
  const r1 = g('r1_status');
  const r2 = g('r2_status');
  const ob = g('ob_status');

  if (ob === 'Joined') return 'Hired';
  if (ob === 'Noshow' || ob === 'Canceled') return 'Rejected';
  if (ob || g('ob_date')) return 'Offer';
  if (r2 === 'Passed') return 'Passed';
  if (r2 === 'Failed' || r2 === 'Canceled') return 'Rejected';
  if (HOLD.test(r2)) return 'On Hold';
  if (r2 === 'Pending') return 'Evaluation';
  if (g('r2_date')) return 'Interview';
  if (r1 === 'Failed') return 'Rejected';
  if (HOLD.test(r1)) return 'On Hold';
  if (r1 === 'Passed') return 'Interview';
  if (r1 === 'Pending' || g('r1_date')) return 'Screening';
  return 'New';
}

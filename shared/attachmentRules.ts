/**
 * Phase 3: extra documents of a candidate that can hold several files (Salary Proposal, Payslips), and the English
 * translation of free-text fields. Shared by the browser and the Apps Script backend so both apply the same rules.
 */
import { rankNumber } from './fieldCatalog.ts';

export interface AttachmentKind {
  key: string;
  label: string;
  /** Used in the Drive file name. */
  docName: string;
  /** Rank numbers above this are not allowed (a smaller number is a higher rank: 5 means "Rank 5 and above"). */
  maxRankNumber?: number;
  hint: string;
}

export const ATTACHMENT_KINDS: AttachmentKind[] = [
  { key: 'salary_proposal', label: 'Salary Proposal', docName: 'Salary Proposal', maxRankNumber: 5, hint: 'Chỉ áp dụng từ Rank 5 trở lên (5x, 4x, 3x).' },
  { key: 'payslip', label: 'Payslips', docName: 'Payslip', hint: 'Phiếu lương, có thể tải nhiều file.' },
];

export const ATTACHMENT_ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.xlsx', '.png', '.jpg', '.jpeg'];
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_KIND = 20;

export function attachmentKind(key: string): AttachmentKind | null {
  return ATTACHMENT_KINDS.find((k) => k.key === key) || null;
}

/** False only when the candidate has a known rank that is lower than the kind requires. An unknown rank allows it. */
export function attachmentKindApplicable(kind: AttachmentKind, rank: string | null | undefined): boolean {
  if (kind.maxRankNumber === undefined) return true;
  const n = rankNumber(rank);
  return Number.isNaN(n) || n <= kind.maxRankNumber;
}

/** Text fields that get a separate English version (the Vietnamese original is never overwritten). */
export const TRANSLATABLE_FIELDS = ['experience_summary'];
export const TRANSLATION_MAX = 5000;

/** Small stable fingerprint of the source text: when it changes, the saved translation is "needs update". */
export function translationHash(text: string): string {
  const s = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + s.length;
}

/**
 * Candidate documents (section 9): which ones are required for a position, and how folders / files are named.
 *
 *  - Rank 6 positions (Nhân viên Kho, Nhân viên Lái xe nâng, ...) must hand in the health certificate and the ID card.
 *  - Forklift driver positions must also hand in the forklift licence.
 *  - Folder: "<Mã nhân viên>_<Họ tên>", file: "<Mã nhân viên>_<Họ tên>_<Tên giấy tờ>.<đuôi>".
 *    "Mã nhân viên" is the Emp_ID once it exists, otherwise the candidate code (files are renamed when Emp_ID is entered).
 */

/** Positions whose holders drive a forklift. */
export function isForkliftPosition(position: string): boolean {
  return /lái xe nâng|forklift|reach\s?truck|read\s?truck/i.test(String(position || '').normalize('NFC'));
}

/** Document field keys that must be present for this position and rank (rank 6x = lowest level). */
export function requiredDocuments(position: string, rank: string): string[] {
  const out: string[] = [];
  if (/^6/.test(String(rank || '').trim())) out.push('health_check', 'id_card');
  if (isForkliftPosition(position)) {
    if (!out.length) out.push('health_check', 'id_card');
    out.push('forklift_cert');
  }
  return out;
}

/** Document fields shown for a position: the forklift licence only appears for forklift drivers. */
export function visibleDocumentKeys(position: string): string[] {
  const base = ['edu_certificate', 'health_check', 'id_card', 'resume'];
  return isForkliftPosition(position) ? [...base, 'forklift_cert'] : base;
}

/** Removes characters that file systems and Google Drive reject; keeps Vietnamese letters. */
export function safeName(s: string): string {
  return String(s || '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80);
}

export function docOwnerCode(empId: string, candidateCode: string): string {
  return safeName(empId) || safeName(candidateCode);
}

export function docFolderName(empId: string, candidateCode: string, fullName: string): string {
  return `${docOwnerCode(empId, candidateCode)}_${safeName(fullName) || 'Chua co ten'}`;
}

export function docFileName(empId: string, candidateCode: string, fullName: string, docName: string, original: string): string {
  const dot = String(original || '').lastIndexOf('.');
  const ext = dot >= 0 ? String(original).slice(dot).toLowerCase() : '';
  return `${docFolderName(empId, candidateCode, fullName)}_${safeName(docName)}${ext}`;
}

export const DOC_ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];

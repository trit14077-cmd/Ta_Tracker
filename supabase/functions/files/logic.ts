// Kiểm tra file trước khi đưa lên Drive (Edge `files`, M7-1) – không gọi mạng, test được bằng vitest.
import { DOC_ALLOWED_EXT, docFileName, docFolderName } from '../../../shared/documentRules.ts';
import {
  ATTACHMENT_ALLOWED_EXT, ATTACHMENT_KINDS, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_KIND, attachmentKind, attachmentKindApplicable,
} from '../../../shared/attachmentRules.ts';
import { FIELD_CATALOG } from '../../../shared/fieldCatalog.ts';

export const DOC_KINDS = ['edu_certificate', 'health_check', 'id_card', 'resume', 'forklift_cert'] as const;
export const ATTACH_KINDS = ATTACHMENT_KINDS.map((k) => k.key);
export const ALL_KINDS = ['cv', ...DOC_KINDS, ...ATTACH_KINDS];
/** = form (CandidateFormView): CV và giấy tờ tối đa 10 MB như hệ cũ. */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;

export interface FileCheck { ok: true; ext: string; mime: string }
export interface FileReject { ok: false; code: string; message: string }

function extOf(name: string): string {
  const i = String(name || '').lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Nội dung file phải đúng loại theo đuôi (chặn đổi đuôi .exe -> .pdf). */
export function magicMatches(ext: string, head: Uint8Array): boolean {
  const b = (...xs: number[]) => xs.every((x, i) => head[i] === x);
  switch (ext) {
    case '.pdf': return b(0x25, 0x50, 0x44, 0x46); // %PDF
    case '.png': return b(0x89, 0x50, 0x4e, 0x47);
    case '.jpg': case '.jpeg': return b(0xff, 0xd8, 0xff);
    case '.docx': case '.xlsx': return b(0x50, 0x4b, 0x03, 0x04); // zip
    case '.doc': return b(0xd0, 0xcf, 0x11, 0xe0); // OLE2
    default: return false;
  }
}

export function checkFile(kind: string, name: string, size: number, head: Uint8Array): FileCheck | FileReject {
  if (!ALL_KINDS.includes(kind)) return { ok: false, code: 'INVALID_KIND', message: 'Loại file không hợp lệ.' };
  const isAttach = ATTACH_KINDS.includes(kind);
  const allowed = isAttach ? ATTACHMENT_ALLOWED_EXT : DOC_ALLOWED_EXT;
  const max = isAttach ? ATTACHMENT_MAX_BYTES : FILE_MAX_BYTES;
  const ext = extOf(name);
  if (!allowed.includes(ext)) {
    return { ok: false, code: 'BAD_FILE_TYPE', message: isAttach ? 'Chỉ nhận file PDF, Word, Excel (.xlsx) hoặc ảnh (PNG, JPG).' : 'Chỉ nhận file PDF, Word hoặc ảnh (PNG, JPG).' };
  }
  if (!size) return { ok: false, code: 'EMPTY_FILE', message: 'File rỗng.' };
  if (size > max) return { ok: false, code: 'FILE_TOO_LARGE', message: 'File tối đa 10 MB.' };
  if (!magicMatches(ext, head)) return { ok: false, code: 'BAD_FILE_CONTENT', message: 'Nội dung file không đúng với đuôi file.' };
  return { ok: true, ext, mime: MIME[ext] };
}

/** Thư mục giấy tờ của hệ cũ (docsRoot_) và thư mục CV (cvFolder_) – nằm trong thư mục gốc của hệ thống. */
export const DOCS_ROOT = 'TA Tracker Hồ sơ';
export const CV_ROOT = 'TA Tracker CV';
/** Thư mục chung toàn hệ thống (không theo TA). */
export const LOG_ROOT = 'TA Tracker Nhật ký';

/** Thư mục chung cho mọi Intern. */
export const INTERN_ROOT = 'Intern';

/**
 * Thư mục cấp 1 theo PIC: mỗi TA một thư mục tên = mã PIC; mọi Intern (mã "Intern<số>-...") dùng chung "Intern".
 * Hồ sơ chưa có PIC => null (đặt thẳng dưới thư mục gốc như trước).
 */
export function picRoot(pic: unknown): string | null {
  const p = String(pic ?? '').trim();
  if (!p) return null;
  if (/^Intern\d+-/.test(p)) return INTERN_ROOT;
  return p.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
}
const underPic = (pic: unknown, path: string[]) => { const r = picRoot(pic); return r ? [r, ...path] : path; };

/** Tên file như người dùng tải lên, bỏ ký tự Drive không nhận (= hUploadCv_). */
export function cleanOriginalName(name: string): string {
  return String(name || '').split(/[\\/]/).pop()!.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

/**
 * Chỗ đặt file trên Drive như hệ cũ:
 *  - CV: "TA Tracker CV/<tên file gốc>" (hUploadCv_);
 *  - giấy tờ: "TA Tracker Hồ sơ/<Mã NV hoặc mã UV>_<Họ tên>/<…>_<Tên giấy tờ>.<đuôi>" (hUploadDoc_);
 *  - Salary Proposal / Payslips: cùng thư mục, tên kèm số "<…>_Payslip 3.pdf" (attDriveName_).
 */
export function drivePlacement(rec: { emp_id?: string; candidate_code?: string; full_name?: string; pic?: string }, kind: string, original: string, attId?: number | null) {
  if (kind === 'cv') return { path: underPic(rec.pic, [CV_ROOT]), file: cleanOriginalName(original) };
  const emp = String(rec.emp_id || ''), code = String(rec.candidate_code || ''), name = String(rec.full_name || '');
  const att = attachmentKind(kind);
  const docName = att ? `${att.docName} ${attId ?? ''}`.trim() : FIELD_CATALOG.find((f) => f.key === kind)?.docName ?? kind;
  return { path: underPic(rec.pic, [DOCS_ROOT, docFolderName(emp, code, name)]), file: docFileName(emp, code, name, docName, original) };
}

export interface DriveFileRow { id: number; kind: string; drive_file_id: string; file_name: string }
/**
 * Mã NV / họ tên / mã UV đổi (= syncDocFiles_ + syncAttachmentFiles_): tên mới của từng giấy tờ (ghi lại vào cột "<id>|<tên>")
 * và của từng Salary Proposal / Payslip. Chỉ trả những file có tên đổi.
 */
export function renamePlan(before: Record<string, unknown>, after: Record<string, unknown>, files: DriveFileRow[]) {
  const s = (o: Record<string, unknown>, k: string) => String(o[k] ?? '');
  const same = ['emp_id', 'candidate_code', 'full_name', 'pic'].every((k) => s(before, k) === s(after, k));
  const columns: Record<string, string> = {};
  const items: { id: number; drive_file_id: string; file_name: string }[] = [];
  if (same) return { folder: null as string[] | null, columns, items };
  const emp = s(after, 'emp_id'), code = s(after, 'candidate_code'), name = s(after, 'full_name');
  for (const f of FIELD_CATALOG.filter((x) => x.type === 'document')) {
    const v = s(after, f.key);
    if (!v.includes('|')) continue;
    const [driveId, oldName] = [v.slice(0, v.indexOf('|')), v.slice(v.indexOf('|') + 1)];
    const want = docFileName(emp, code, name, f.docName || f.label, oldName);
    if (want !== oldName) columns[f.key] = `${driveId}|${want}`;
    const row = files.find((x) => x.kind === f.key && x.drive_file_id === driveId);
    items.push({ id: row?.id ?? 0, drive_file_id: driveId, file_name: want });
  }
  for (const a of files.filter((x) => attachmentKind(x.kind))) {
    const want = docFileName(emp, code, name, `${attachmentKind(a.kind)!.docName} ${a.id}`, a.file_name);
    items.push({ id: a.id, drive_file_id: a.drive_file_id, file_name: want });
  }
  return { folder: underPic(after.pic, [DOCS_ROOT, docFolderName(emp, code, name)]), columns, items };
}

/** Các loại đính kèm (Salary Proposal, Payslips) và loại nào dùng được với Rank của hồ sơ. */
export function attachmentKinds(rank: string) {
  return ATTACHMENT_KINDS.map((k) => ({ key: k.key, label: k.label, hint: k.hint, applicable: attachmentKindApplicable(k, rank) }));
}
export const MAX_PER_KIND = ATTACHMENT_MAX_PER_KIND;

/** Content-Disposition an toàn với tên tiếng Việt. */
export function contentDisposition(name: string): string {
  const ascii = String(name || 'file').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

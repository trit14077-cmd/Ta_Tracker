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

/** Thư mục + tên file trên Drive như hệ cũ: "<Mã NV hoặc mã UV>_<Họ tên>/<…>_<Tên giấy tờ>.<đuôi>". */
export function drivePlacement(rec: { emp_id?: string; candidate_code?: string; full_name?: string }, kind: string, original: string) {
  const emp = String(rec.emp_id || ''), code = String(rec.candidate_code || ''), name = String(rec.full_name || '');
  const docName = kind === 'cv' ? 'CV'
    : attachmentKind(kind)?.docName ?? FIELD_CATALOG.find((f) => f.key === kind)?.docName ?? kind;
  return { folder: docFolderName(emp, code, name), file: docFileName(emp, code, name, docName, original) };
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

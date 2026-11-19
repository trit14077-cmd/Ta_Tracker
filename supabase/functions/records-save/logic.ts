// Edge records-save (M4-1, API_SPEC §4.1) – phần thuần, dùng chung shared/ (nguyên văn từ hệ cũ). Test bằng Vitest.
// Giữ hành vi Api.gs: hCreateCandidate_, hPatchCandidate_ (khóa bước sau vòng rớt), hMoveCandidate_, maskForeign_.
import { validateAndComputeCandidate, type DropdownConfigBundle } from '../../../shared/validation.ts';
import { FAIL_LABEL, boardPosition, failedStage, lockedFieldKeys, moveChanges, type BoardCol } from '../../../shared/pipelineRules.ts';
import { FIELD_CATALOG } from '../../../shared/fieldCatalog.ts';

export interface ApiError { status: number; code: string; message: string; fields?: Record<string, string>; details?: unknown }
export type Role = 'admin' | 'pic';
export interface Actor { id: string; role: Role; pic_code: string | null }

export type SaveRequest =
  | { op: 'create'; values: Record<string, unknown>; from_application_id?: number }
  | { op: 'patch'; id: number; expected_version: number; changes: Record<string, unknown> }
  | { op: 'move'; id: number; expected_version: number; target_box: string }
  | { op: 'archive' | 'restore'; id: number; expected_version: number }
  | { op: 'confirm_hire' | 'reopen_hire'; id: number };

const err = (status: number, code: string, message: string, extra: Partial<ApiError> = {}): ApiError => ({ status, code, message, ...extra });

export function parseRequest(body: unknown): { ok: true; req: SaveRequest } | { ok: false; error: ApiError } {
  const bad = (m: string) => ({ ok: false as const, error: err(422, 'VALIDATION_FAILED', m) });
  if (!body || typeof body !== 'object') return bad('Thiếu nội dung yêu cầu.');
  const b = body as Record<string, unknown>;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const posInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0;
  switch (b.op) {
    case 'create':
      if (!isObj(b.values)) return bad('Thiếu values.');
      if (b.from_application_id !== undefined && !posInt(b.from_application_id)) return bad('from_application_id không hợp lệ.');
      return { ok: true, req: { op: 'create', values: b.values, from_application_id: b.from_application_id as number | undefined } };
    case 'patch':
    case 'move':
    case 'archive':
    case 'restore': {
      if (!posInt(b.id)) return bad('Thiếu hoặc sai id hồ sơ.');
      if (!posInt(b.expected_version)) return bad('Thiếu expected_version (phiên bản hồ sơ đang mở).');
      if (b.op === 'patch') {
        if (!isObj(b.changes)) return bad('Thiếu changes.');
        return { ok: true, req: { op: 'patch', id: b.id as number, expected_version: b.expected_version as number, changes: b.changes } };
      }
      if (b.op === 'move') {
        if (typeof b.target_box !== 'string') return bad('Thiếu target_box.');
        return { ok: true, req: { op: 'move', id: b.id as number, expected_version: b.expected_version as number, target_box: b.target_box } };
      }
      return { ok: true, req: { op: b.op, id: b.id as number, expected_version: b.expected_version as number } };
    }
    case 'confirm_hire':
    case 'reopen_hire':
      // M6-2: như hệ cũ (POST …/hiring/confirm) không cần phiên bản hồ sơ; RPC khóa dòng trong giao dịch
      if (!posInt(b.id)) return bad('Thiếu hoặc sai id hồ sơ.');
      return { ok: true, req: { op: b.op, id: b.id as number } };
    default:
      return { ok: false, error: err(422, 'INVALID_OP', 'op phải là create, patch, move, archive, restore, confirm_hire hoặc reopen_hire.') };
  }
}

/** Cấu hình Drop-list từ DB – tương đương cfg_() của hệ cũ. list_key 'pic' lấy từ bảng pics. */
export function buildConfig(
  options: { list_key: string; value: string; active: boolean }[],
  pics: { code: string; active: boolean }[],
  subSource: { sub_source: string; source: string }[],
  hierarchy: { parent_type: string; parent_value: string; child_value: string }[],
): DropdownConfigBundle {
  const lists: DropdownConfigBundle['lists'] = {};
  for (const o of options) (lists[o.list_key] ||= []).push({ value: o.value, active: o.active });
  lists.pic = pics.map((p) => ({ value: p.code, active: p.active }));
  const subSourceMapping: Record<string, string> = {};
  for (const s of subSource) subSourceMapping[s.sub_source] = s.source;
  const regionToLocations: Record<string, string[]> = {};
  const locationToSites: Record<string, string[]> = {};
  for (const h of hierarchy) {
    const m = h.parent_type === 'region' ? regionToLocations : locationToSites;
    (m[h.parent_value] ||= []).push(h.child_value);
  }
  return { lists, subSourceMapping, regionToLocations, locationToSites };
}

/** Dòng DB (date, numeric, null) -> chuỗi như hệ cũ đọc từ sheet, để đưa vào validate làm existingValues. */
export function rowToStrings(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v === null || v === undefined ? '' : String(v);
  return out;
}

// Cột không phải text trong DB: '' từ validate phải gửi thành null (date / numeric).
const NULLABLE = new Set(
  FIELD_CATALOG.filter((f) => f.type === 'date' || f.type === 'money' || f.type === 'percentage').map((f) => f.key),
);
const NOT_STORED = new Set(['tenor', 'cv_file', 'created_at']);

/** Kết quả validate -> giá trị gửi RPC: chỉ field trong FIELD_CATALOG, bỏ field tính khi đọc, '' -> null cho date/số. */
export function toDbValues(sanitized: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of FIELD_CATALOG) {
    if (NOT_STORED.has(f.key) || !(f.key in sanitized)) continue;
    const v = sanitized[f.key];
    out[f.key] = NULLABLE.has(f.key) && (v === '' || v === undefined) ? null : v;
  }
  return out;
}

export type ValidateResult = { ok: true; values: Record<string, string>; notices: Record<string, string> } | { ok: false; error: ApiError };

/** Tạo mới: TA luôn theo PIC của mình, mã luôn do hệ thống sinh (suggestedCode chỉ để qua bước validate). */
export function validateCreate(actor: Actor, values: Record<string, unknown>, cfg: DropdownConfigBundle, suggestedCode: string): ValidateResult {
  const payload: Record<string, unknown> = { ...values };
  if (actor.role === 'pic') {
    if (payload.pic && payload.pic !== actor.pic_code) {
      return { ok: false, error: err(403, 'FORBIDDEN_PIC', `Tài khoản PIC chỉ được tạo ứng viên thuộc mã PIC của mình (${actor.pic_code}).`) };
    }
    payload.pic = actor.pic_code;
    payload.candidate_code = '';
  }
  if (!String(payload.candidate_code ?? '').trim() && payload.pic) payload.candidate_code = suggestedCode;
  const v = validateAndComputeCandidate(payload, cfg, { isCreate: true });
  if (!v.valid) return { ok: false, error: err(422, 'VALIDATION_FAILED', 'Dữ liệu chưa hợp lệ.', { fields: v.errors }) };
  return { ok: true, values: v.sanitized, notices: v.notices };
}

/** Sửa: validate trên bản hiện tại + kiểm khóa bước sau vòng rớt (STEP_LOCKED) như hệ cũ. */
export function validatePatch(actor: Actor, existing: Record<string, string>, changes: Record<string, unknown>, cfg: DropdownConfigBundle): ValidateResult {
  if (actor.role !== 'admin' && changes.pic !== undefined && changes.pic !== actor.pic_code) {
    return { ok: false, error: err(403, 'FORBIDDEN_PIC_CHANGE', 'Tài khoản PIC không được chuyển hồ sơ sang mã PIC của người khác.') };
  }
  if (actor.role !== 'admin' && changes.candidate_code !== undefined && changes.candidate_code !== existing.candidate_code) {
    return { ok: false, error: err(403, 'FORBIDDEN', 'Chỉ Admin được đổi mã ứng viên.') };
  }
  const v = validateAndComputeCandidate(changes, cfg, { existingValues: existing, isPartialPatch: true });
  if (!v.valid) return { ok: false, error: err(422, 'VALIDATION_FAILED', 'Dữ liệu chưa hợp lệ.', { fields: v.errors }) };
  const locked = lockedFieldKeys(v.sanitized);
  if (locked.length) {
    const base = validateAndComputeCandidate(existing, cfg, { lenient: true }).sanitized;
    const at = failedStage(v.sanitized)!;
    const fields: Record<string, string> = {};
    for (const k of locked) {
      if (String(v.sanitized[k] ?? '') !== String(base[k] ?? '')) {
        fields[k] = `Bước này bị khóa vì ứng viên đã rớt ở ${FAIL_LABEL[at]}. Đổi trạng thái ${FAIL_LABEL[at]} để mở lại.`;
      }
    }
    if (Object.keys(fields).length) {
      return { ok: false, error: err(422, 'STEP_LOCKED', `Ứng viên đã rớt ở ${FAIL_LABEL[at]} nên các bước sau bị khóa. Đổi trạng thái ${FAIL_LABEL[at]} để mở lại.`, { fields }) };
    }
  }
  return { ok: true, values: v.sanitized, notices: v.notices };
}

/** Kéo thả Kanban -> changes + ô cũ/ô mới (moveChanges của hệ cũ; lỗi => 409 MOVE_*). */
export function planMove(existing: Record<string, string>, target: string):
  { ok: true; changes: Record<string, string>; from: BoardCol; to: BoardCol } | { ok: false; error: ApiError } {
  const mv = moveChanges(existing, target as BoardCol);
  if (mv.error) return { ok: false, error: err(409, 'MOVE_' + mv.error.code, mv.error.message) };
  return { ok: true, changes: mv.changes, from: boardPosition(existing).col, to: target as BoardCol };
}

/** Lỗi RPC (SQLSTATE PTxxx / message = mã) -> lỗi API. */
export function mapRpcError(e: { code?: string; message?: string; details?: string | null }): ApiError {
  const status = /^PT\d{3}$/.test(e.code ?? '') ? Number(e.code!.slice(2)) : 500;
  const code = e.message || 'SERVER_ERROR';
  const messages: Record<string, string> = {
    NOT_FOUND: 'Không tìm thấy hồ sơ ứng viên.',
    VERSION_CONFLICT: 'Hồ sơ ứng viên này vừa được người dùng khác cập nhật. Vui lòng đối chiếu phiên bản hiện tại trước khi ghi đè.',
    DUPLICATE_CODE: `Mã ứng viên "${e.details ?? ''}" đã tồn tại trên hệ thống.`,
    FORBIDDEN: e.details || 'Bạn không có quyền thực hiện thao tác này.',
    INVALID_FIELD: `Trường không hợp lệ: ${e.details ?? ''}`,
  };
  if (code === 'VERSION_CONFLICT') {
    let current: unknown;
    try { current = e.details ? JSON.parse(e.details) : null; } catch { current = null; }
    return err(409, code, messages[code], { details: { current } });
  }
  if (status === 500) return err(500, 'SERVER_ERROR', 'Lỗi máy chủ khi lưu hồ sơ. Vui lòng thử lại.');
  return err(status, code, messages[code] || e.details || code);
}

/** Trùng SĐT: Admin thấy đủ; TA chỉ thấy hồ sơ của PIC mình, hồ sơ PIC khác bị che (maskForeign_ của hệ cũ). */
export function maskDuplicates(rows: { id: number; candidate_code: string; full_name: string; pic: string | null }[], actor: Actor) {
  if (actor.role === 'admin') return rows;
  return rows.map((r) => (r.pic && r.pic === actor.pic_code ? r : { id: 0, candidate_code: '(ẩn)', full_name: 'Ứng viên của PIC khác', pic: '' }));
}

// Edge admin-users (M3-2, API_SPEC §4.5) – phần kiểm tra thuần, không dùng API của Deno => test được bằng Vitest.

export const EMAIL_DOMAIN = 'ta.supra.internal'; // D-05b: username -> email giả, người dùng không thấy
export const PASSWORD_MIN = 8; // giữ như hệ cũ (Api.gs change-password)
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;

export type Role = 'admin' | 'pic';
export type AdminRequest =
  | { op: 'create'; username: string; full_name: string; role: Role; pic_code: string | null; temp_password: string }
  | { op: 'update'; id: string; role?: Role; pic_code?: string | null; active?: boolean; full_name?: string; can_view_all_targets?: boolean }
  | { op: 'reset_password'; id: string; temp_password: string };

export interface ApiError { status: number; code: string; message: string; fields?: Record<string, string> }
export type Parsed = { ok: true; req: AdminRequest } | { ok: false; error: ApiError };

export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (fields: Record<string, string>, code = 'VALIDATION_FAILED'): Parsed => ({
  ok: false,
  error: { status: 422, code, message: Object.values(fields)[0], fields },
});
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function checkPassword(p: string): string | null {
  if (p.length < PASSWORD_MIN) return `Mật khẩu tạm phải có ít nhất ${PASSWORD_MIN} ký tự.`;
  if (p.length > 72) return 'Mật khẩu tạm tối đa 72 ký tự.';
  return null;
}

/** Kiểm tra body yêu cầu. Không đụng DB: các kiểm tra cần DB (trùng username, PIC có tồn tại, tự khóa mình) ở index.ts. */
export function parseRequest(body: unknown): Parsed {
  if (!body || typeof body !== 'object') return bad({ body: 'Thiếu nội dung yêu cầu.' });
  const b = body as Record<string, unknown>;
  const op = str(b.op);

  if (op === 'create') {
    const username = str(b.username).trim();
    const role = str(b.role) as Role;
    const pic = str(b.pic_code).trim() || null;
    const pw = str(b.temp_password);
    const fields: Record<string, string> = {};
    if (!USERNAME_RE.test(username)) fields.username = 'Tên đăng nhập 3–40 ký tự, chỉ gồm chữ không dấu, số và . _ -';
    if (role !== 'admin' && role !== 'pic') fields.role = 'Vai trò phải là admin hoặc pic.';
    const pwErr = checkPassword(pw);
    if (pwErr) fields.temp_password = pwErr;
    if (Object.keys(fields).length) return bad(fields);
    if (role === 'pic' && !pic) return bad({ pic_code: 'Tài khoản TA bắt buộc có PIC.' }, 'MISSING_PIC');
    return { ok: true, req: { op, username, full_name: str(b.full_name).trim(), role, pic_code: pic, temp_password: pw } };
  }

  if (op === 'update') {
    const id = str(b.id);
    if (!UUID_RE.test(id)) return bad({ id: 'Thiếu hoặc sai id tài khoản.' });
    const req: AdminRequest = { op, id };
    if ('role' in b) {
      if (b.role !== 'admin' && b.role !== 'pic') return bad({ role: 'Vai trò phải là admin hoặc pic.' });
      req.role = b.role;
    }
    if ('pic_code' in b) req.pic_code = str(b.pic_code).trim() || null;
    if ('active' in b) {
      if (typeof b.active !== 'boolean') return bad({ active: 'active phải là true/false.' });
      req.active = b.active;
    }
    if ('full_name' in b) req.full_name = str(b.full_name).trim();
    if ('can_view_all_targets' in b) {
      if (typeof b.can_view_all_targets !== 'boolean') return bad({ can_view_all_targets: 'Phải là true/false.' });
      req.can_view_all_targets = b.can_view_all_targets;
    }
    if (Object.keys(req).length === 2) return bad({ body: 'Không có thay đổi nào.' });
    return { ok: true, req };
  }

  if (op === 'reset_password') {
    const id = str(b.id);
    if (!UUID_RE.test(id)) return bad({ id: 'Thiếu hoặc sai id tài khoản.' });
    const pwErr = checkPassword(str(b.temp_password));
    if (pwErr) return bad({ temp_password: pwErr });
    return { ok: true, req: { op, id, temp_password: str(b.temp_password) } };
  }

  return bad({ op: 'op phải là create, update hoặc reset_password.' }, 'INVALID_OP');
}

/** Sau khi áp thay đổi, tài khoản có hợp lệ không (TA phải có PIC – giống ràng buộc pic_requires_code ở DB). */
export function finalRoleCheck(role: Role, pic: string | null): ApiError | null {
  if (role === 'pic' && !pic) return { status: 422, code: 'MISSING_PIC', message: 'Tài khoản TA bắt buộc có PIC.' };
  return null;
}

/** Admin không được tự khóa / tự hạ quyền mình (tránh hệ thống mất Admin). */
export function selfLockout(callerId: string, req: AdminRequest): ApiError | null {
  if (req.op !== 'update' || req.id !== callerId) return null;
  if (req.active === false || req.role === 'pic') {
    return { status: 409, code: 'SELF_LOCKOUT', message: 'Không thể tự khóa hoặc tự hạ quyền tài khoản Admin của chính mình.' };
  }
  return null;
}

/** Ghi audit: không bao giờ chứa mật khẩu. */
export function auditChanges(req: AdminRequest): Record<string, unknown> {
  const { temp_password: _pw, ...rest } = req as AdminRequest & { temp_password?: string };
  return rest;
}

// M9-3: giới hạn kích thước body cho mọi Edge Function (checklist M9-4 "giới hạn body").
// Đếm byte thật khi đọc luồng – không tin Content-Length (có thể thiếu hoặc sai) – và ngừng GIỮ byte ngay khi vượt,
// để client không bắt function giữ cả trăm MB trong bộ nhớ trước khi bị từ chối. Phần còn lại được đọc bỏ
// (≤ DRAIN_MAX) để runtime gửi được 413 – xem discardRest.
export const BODY_MAX_JSON = 1024 * 1024; // 1 MB: lưu hồ sơ, HR Info, quản trị, file JSON op
export const BODY_MAX_IMPORT = 16 * 1024 * 1024; // 1 lô nhập ≤1.500 dòng × 89 cột
export const BODY_MAX_APPLY = 6 * 1024 * 1024; // CV ≤5 MB + các ô chữ
export const BODY_MAX_UPLOAD = 11 * 1024 * 1024; // 1 file ≤10 MB + phần bao multipart
export const TOO_LARGE_MESSAGE = 'Dữ liệu gửi lên quá lớn.';

export class BodyTooLarge extends Error {
  constructor() {
    super(TOO_LARGE_MESSAGE);
  }
}

/**
 * Đọc BỎ phần body còn lại trước khi trả 413. Edge runtime của Supabase không gửi response khi request body chưa
 * được đọc hết: client kẹt ở bước gửi, function chờ tới WallClockTime (150 s) rồi nền tảng trả 503 không thân
 * (đo trên DEV 22/11/2026: body 1,1 MB / 7 MB treo; 900 KB đọc hết thì trả ngay). Không giữ byte trong bộ nhớ.
 * Quá DRAIN_MAX thì cắt luồng (chấp nhận 503 – client hợp lệ đã chặn kích thước trước khi gửi).
 */
export const DRAIN_MAX = 32 * 1024 * 1024;

async function discardRest(reader: ReadableStreamDefaultReader<Uint8Array>, seen: number): Promise<void> {
  try {
    while (seen <= DRAIN_MAX) {
      const { done, value } = await reader.read();
      if (done) return;
      seen += value.byteLength;
    }
    await reader.cancel();
  } catch {
    // client ngắt giữa chừng – bỏ qua, vẫn trả 413
  }
}

export async function readBodyLimited(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get('Content-Length') ?? '');
  const declaredTooLarge = Number.isFinite(declared) && declared > maxBytes;
  if (!req.body) {
    if (declaredTooLarge) throw new BodyTooLarge();
    return new Uint8Array(new ArrayBuffer(0));
  }
  const reader = req.body.getReader();
  if (declaredTooLarge) {
    // biết trước là quá cỡ: không giữ gì, chỉ đọc bỏ (hoặc cắt ngay nếu khai quá DRAIN_MAX)
    if (declared > DRAIN_MAX) await reader.cancel().catch(() => undefined);
    else await discardRest(reader, 0);
    throw new BodyTooLarge();
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      parts.length = 0; // nhả phần đã giữ trước khi đọc bỏ phần còn lại
      await discardRest(reader, total);
      throw new BodyTooLarge();
    }
    parts.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** JSON có giới hạn. Ném BodyTooLarge (→413) hoặc SyntaxError (→400 BAD_JSON). */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<unknown> {
  const bytes = await readBodyLimited(req, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** multipart/form-data có giới hạn. Ném BodyTooLarge (→413). */
export async function readFormLimited(req: Request, maxBytes: number): Promise<FormData> {
  const bytes = await readBodyLimited(req, maxBytes);
  return new Response(bytes, { headers: { 'Content-Type': req.headers.get('Content-Type') ?? '' } }).formData();
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin && allowed.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

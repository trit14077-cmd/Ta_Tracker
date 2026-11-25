// Edge Function admin-users (M3-2, API_SPEC §4.5). Admin đang hoạt động gọi được; TA quản lý nhóm chỉ trong phạm vi Intern (0032/0033).
// POST {op:"create"|"update"|"reset_password", ...}. Dùng service role (secret có sẵn của Edge Function) để
// quản lý auth.users + profiles; người gọi được xác thực bằng JWT của chính họ.
// Biến môi trường: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase cấp sẵn), ALLOWED_ORIGINS (danh sách, phân cách dấu phẩy).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  auditChanges, BODY_MAX_JSON, BodyTooLarge, corsHeaders, finalRoleCheck, internManagerCheck, parseRequest, readJsonLimited, selfLockout,
  TOO_LARGE_MESSAGE, usernameToEmail, type ApiError,
} from './logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
const BAN_FOREVER = '876000h';

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), ALLOWED);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (e: ApiError) => json(e.status, { error: { code: e.code, message: e.message, fields: e.fields } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail({ status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Chỉ nhận POST.' });

  // 1) xác thực người gọi
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return fail({ status: 401, code: 'UNAUTHORIZED', message: 'Phiên đăng nhập không hợp lệ.' });
  const { data: caller } = await admin.from('profiles').select('id, username, role, active, pic_code').eq('id', who.user.id).maybeSingle();
  if (!caller || !caller.active) {
    return fail({ status: 403, code: 'FORBIDDEN', message: 'Chỉ Admin được quản lý tài khoản.' });
  }
  // TA quản lý nhóm (pic_delegations.can_create_interns) được tạo/quản lý Intern do mình tạo; còn lại chỉ Admin.
  let internManager = false;
  if (caller.role !== 'admin') {
    if (caller.role === 'pic' && caller.pic_code) {
      const { data: dg } = await admin.from('pic_delegations').select('managed_pic')
        .eq('manager_pic', caller.pic_code).eq('can_create_interns', true).limit(1);
      internManager = !!dg && dg.length > 0;
    }
    if (!internManager) return fail({ status: 403, code: 'FORBIDDEN', message: 'Chỉ Admin được quản lý tài khoản.' });
  }

  // 2) kiểm tra yêu cầu
  let body: unknown;
  try {
    body = await readJsonLimited(req, BODY_MAX_JSON);
  } catch (e) {
    if (e instanceof BodyTooLarge) return fail({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: TOO_LARGE_MESSAGE });
    return fail({ status: 400, code: 'BAD_JSON', message: 'Nội dung không phải JSON.' });
  }
  const parsed = parseRequest(body);
  if (!parsed.ok) return fail(parsed.error);
  const r = parsed.req;
  const lock = selfLockout(caller.id, r);
  if (lock) return fail(lock);

  const audit = async (action: string, targetId: string) => {
    await admin.from('audit_logs').insert({
      actor_id: caller.id, actor_username: caller.username, actor_role: caller.role,
      action, candidate_code: '', changes: { target_user: targetId, ...auditChanges(r) },
    });
  };
  const picExists = async (pic: string | null) =>
    !pic || !!(await admin.from('pics').select('code').eq('code', pic).maybeSingle()).data;

  // 3) thực hiện
  if (r.op === 'create') {
    if (internManager) {
      const denied = internManagerCheck(caller.id, r);
      if (denied) return fail(denied);
    }
    if (!(await picExists(r.pic_code))) return fail({ status: 422, code: 'VALIDATION_FAILED', message: 'PIC không có trong danh mục.', fields: { pic_code: 'PIC không có trong danh mục.' } });
    const { data: dup } = await admin.from('profiles').select('id').eq('username', r.username).maybeSingle();
    if (dup) return fail({ status: 409, code: 'USERNAME_TAKEN', message: 'Tên đăng nhập đã tồn tại.' });
    const created = await admin.auth.admin.createUser({
      email: usernameToEmail(r.username), password: r.temp_password, email_confirm: true,
      user_metadata: { username: r.username },
    });
    if (created.error || !created.data.user) {
      return fail({ status: 409, code: 'USERNAME_TAKEN', message: 'Không tạo được tài khoản (có thể đã tồn tại).' });
    }
    const uid = created.data.user.id;
    const ins = await admin.from('profiles').insert({
      id: uid, username: r.username, full_name: r.full_name, role: r.role, pic_code: r.pic_code, created_by: caller.id,
    });
    if (ins.error) {
      await admin.auth.admin.deleteUser(uid); // hoàn tác để không để lại user thiếu profile
      return fail({ status: 422, code: 'VALIDATION_FAILED', message: 'Không lưu được hồ sơ tài khoản: ' + ins.error.message });
    }
    await audit('USER_CREATE', uid);
    return json(201, { id: uid, username: r.username, role: r.role, pic_code: r.pic_code });
  }

  const { data: target } = await admin.from('profiles').select('id, role, pic_code, active, created_by').eq('id', r.id).maybeSingle();
  if (!target) return fail({ status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy tài khoản.' });
  if (internManager) {
    const denied = internManagerCheck(caller.id, r, target.created_by);
    if (denied) return fail(denied);
  }

  if (r.op === 'update') {
    const role = r.role ?? target.role;
    const pic = 'pic_code' in r ? (r.pic_code ?? null) : target.pic_code;
    const roleErr = finalRoleCheck(role, pic);
    if (roleErr) return fail(roleErr);
    if ('pic_code' in r && !(await picExists(pic))) return fail({ status: 422, code: 'VALIDATION_FAILED', message: 'PIC không có trong danh mục.' });
    const patch: Record<string, unknown> = {};
    for (const k of ['role', 'pic_code', 'active', 'full_name', 'can_view_all_targets'] as const) if (k in r) patch[k] = (r as Record<string, unknown>)[k];
    const up = await admin.from('profiles').update(patch).eq('id', r.id);
    if (up.error) return fail({ status: 422, code: 'VALIDATION_FAILED', message: up.error.message });
    if ('active' in r && r.active !== target.active) {
      // khóa: chặn đăng nhập mới và làm mới phiên; RLS (profiles.active) chặn dữ liệu ngay lập tức
      await admin.auth.admin.updateUserById(r.id, { ban_duration: r.active ? 'none' : BAN_FOREVER });
    }
    await audit('USER_UPDATE', r.id);
    return json(200, { id: r.id, ...patch });
  }

  // reset_password
  const pw = await admin.auth.admin.updateUserById(r.id, { password: r.temp_password });
  if (pw.error) return fail({ status: 422, code: 'VALIDATION_FAILED', message: 'Không đặt lại được mật khẩu.' });
  await audit('USER_RESET_PASSWORD', r.id);
  return json(200, { id: r.id });
});

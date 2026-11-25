// Edge Function hr-info-save (M6-4, API_SPEC §4.6): cửa ghi DUY NHẤT của Thông tin nhân sự.
// 1) xác thực JWT, 2) đọc hồ sơ + HR Info hiện tại (service role, tự kiểm quyền như records-save), 3) kiểm bằng
// shared/hrInfoRules (logic.ts), 4) ghi qua RPC hr_info_write (1 giao dịch, khóa dòng, nhật ký HRINFO).
// Trả {info} – trùng CCCD trình duyệt đọc lại qua RPC hr_info_get (cần JWT người dùng để che hồ sơ PIC khác).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { BODY_MAX_JSON, BodyTooLarge, corsHeaders, readJsonLimited, TOO_LARGE_MESSAGE } from '../admin-users/logic.ts';
import { mapHrRpcError, parseHrRequest, planHrSave, planHrVerify, type ApiError, type HrCurrent } from './logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), ALLOWED);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (e: ApiError) => json(e.status, { error: { code: e.code, message: e.message, fields: e.fields } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail({ status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Chỉ nhận POST.' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return fail({ status: 401, code: 'UNAUTHORIZED', message: 'Phiên đăng nhập không hợp lệ.' });
  const { data: prof } = await db.from('profiles').select('id, role, pic_code, active').eq('id', who.user.id).maybeSingle();
  if (!prof || !prof.active) return fail({ status: 403, code: 'FORBIDDEN', message: 'Tài khoản đã bị khóa hoặc chưa được cấp quyền.' });

  let body: unknown;
  try {
    body = await readJsonLimited(req, BODY_MAX_JSON) as typeof body;
  } catch (e) {
    if (e instanceof BodyTooLarge) return fail({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: TOO_LARGE_MESSAGE });
    return fail({ status: 400, code: 'BAD_JSON', message: 'Nội dung không phải JSON.' });
  }
  const parsed = parseHrRequest(body);
  if (!parsed.ok) return fail(parsed.error);
  const r = parsed.req;

  try {
    const { data: row } = await db.from('recruitment_records').select('*').eq('id', r.record_id).maybeSingle();
    const { data: dg } = prof.role === 'pic' && prof.pic_code
      ? await db.from('pic_delegations').select('managed_pic').eq('manager_pic', prof.pic_code)
      : { data: [] as { managed_pic: string }[] };
    const mine = new Set([prof.pic_code, ...(dg ?? []).map((d) => d.managed_pic)]);
    const canSee = row && (prof.role === 'admin' || (!!row.pic && mine.has(row.pic)));
    if (!canSee) return fail({ status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' });
    const { data: h } = await db.from('hr_info').select('status, data').eq('record_id', r.record_id).maybeSingle();
    const cur = (h as HrCurrent | null) ?? null;

    let args: Record<string, unknown>;
    if (r.op === 'save') {
      const p = planHrSave(row as Record<string, unknown>, cur, r.mode, r.data);
      if (!p.ok) return fail(p.error);
      args = { p_op: 'save', p_status: p.status, p_data: p.clean, p_id_number: p.idNumber, p_audit: p.audit };
    } else {
      const p = planHrVerify(cur, r.verified);
      if (!p.ok) return fail(p.error);
      args = r.verified
        ? { p_op: 'verify', p_audit: p.audit, p_expect_data: cur!.data }
        : { p_op: 'reopen', p_audit: p.audit };
    }
    const { data, error } = await db.rpc('hr_info_write', { p_actor: prof.id, p_id: r.record_id, ...args });
    if (error) return fail(mapHrRpcError(error));
    return json(200, { info: data });
  } catch (e) {
    console.error('hr-info-save', (e as Error).message);
    return fail({ status: 500, code: 'SERVER_ERROR', message: 'Lỗi máy chủ khi lưu thông tin nhân sự. Vui lòng thử lại.' });
  }
});

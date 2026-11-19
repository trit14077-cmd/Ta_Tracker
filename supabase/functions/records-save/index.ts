// Edge Function records-save (M4-1, API_SPEC §4.1): cửa ghi DUY NHẤT của hồ sơ ứng viên.
// 1) xác thực JWT người gọi, 2) nạp Drop-list, 3) validate bằng shared/ (như hệ cũ), 4) gọi RPC create_record /
// save_record bằng service role kèm p_actor (RPC tự kiểm quyền + version trong 1 giao dịch), 5) trả hồ sơ + cảnh báo + trùng SĐT.
// Biến môi trường: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase cấp sẵn), ALLOWED_ORIGINS.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  buildConfig, mapRpcError, maskDuplicates, parseRequest, planMove, rowToStrings, toDbValues, validateCreate, validatePatch,
  type Actor, type ApiError,
} from './logic.ts';
import { corsHeaders } from '../admin-users/logic.ts';
import { hiringView, planHire, type HiringRow } from './hiring.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function loadConfig() {
  const [o, p, s, h] = await Promise.all([
    db.from('dropdown_options').select('list_key, value, active').order('sort_order'),
    db.from('pics').select('code, active').order('sort_order'),
    db.from('sub_source_map').select('sub_source, source'),
    db.from('hierarchy').select('parent_type, parent_value, child_value'),
  ]);
  if (o.error || p.error || s.error || h.error) throw new Error('Không tải được cấu hình Drop-list.');
  return buildConfig(o.data!, p.data!, s.data!, h.data!);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), ALLOWED);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (e: ApiError) => json(e.status, { error: { code: e.code, message: e.message, fields: e.fields, details: e.details } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail({ status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Chỉ nhận POST.' });

  // 1) người gọi
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return fail({ status: 401, code: 'UNAUTHORIZED', message: 'Phiên đăng nhập không hợp lệ.' });
  const { data: prof } = await db.from('profiles').select('id, role, pic_code, active').eq('id', who.user.id).maybeSingle();
  if (!prof || !prof.active) return fail({ status: 403, code: 'FORBIDDEN', message: 'Tài khoản đã bị khóa hoặc chưa được cấp quyền.' });
  const actor: Actor = { id: prof.id, role: prof.role, pic_code: prof.pic_code };

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail({ status: 400, code: 'BAD_JSON', message: 'Nội dung không phải JSON.' });
  }
  const parsed = parseRequest(body);
  if (!parsed.ok) return fail(parsed.error);
  const r = parsed.req;

  const duplicates = async (phone: string | null | undefined, exceptId: number) => {
    if (!phone) return [];
    const { data } = await db.from('recruitment_records').select('id, candidate_code, full_name, pic')
      .eq('phone', phone).eq('is_archived', false).neq('id', exceptId).limit(5);
    return maskDuplicates(data ?? [], actor);
  };

  try {
    // ---------- tạo mới ----------
    if (r.op === 'create') {
      const cfg = await loadConfig();
      const pic = actor.role === 'pic' ? actor.pic_code : (r.values.pic as string | undefined) || null;
      let suggested = '';
      if (pic) {
        const { data } = await db.rpc('next_candidate_code', { p_pic: pic });
        suggested = (data as string) ?? '';
      }
      const v = validateCreate(actor, r.values, cfg, suggested);
      if (!v.ok) return fail(v.error);
      const { data, error } = await db.rpc('create_record', {
        p_actor: actor.id, p_values: toDbValues(v.values),
        p_meta: r.from_application_id ? { from_application_id: r.from_application_id } : {},
      });
      if (error) return fail(mapRpcError(error));
      const rec = data as Record<string, unknown>;
      return json(201, { record: rec, notices: v.notices, duplicates: { phone: await duplicates(rec.phone as string, rec.id as number) } });
    }

    // ---------- các thao tác trên hồ sơ có sẵn ----------
    const { data: row } = await db.from('recruitment_records').select('*').eq('id', r.id).maybeSingle();
    const canSee = row && (actor.role === 'admin' || (!!row.pic && row.pic === actor.pic_code));
    if (!canSee) return fail({ status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' });

    // ---------- M6-2: xác nhận tuyển / mở lại (Ops.gs hHireConfirm_) ----------
    if (r.op === 'confirm_hire' || r.op === 'reopen_hire') {
      const confirm = r.op === 'confirm_hire';
      const state = async (id: number) => (await db.rpc('hiring_state', { p_record_id: id })).data as HiringRow | null;
      const before = hiringView(rowToStrings(row), await state(r.id));
      const plan = planHire(actor, rowToStrings(row), before, confirm);
      if (!plan.ok) return fail(plan.error);
      const { data, error } = await db.rpc('hire_confirm', { p_actor: actor.id, p_id: r.id, p_confirm: confirm, p_manual: plan.manualKeys });
      if (error) return fail(mapRpcError(error));
      const res = data as { record: Record<string, unknown>; ob_updated: boolean };
      return json(200, {
        record: res.record, notices: {}, duplicates: { phone: [] }, ob_updated: res.ob_updated,
        hiring: hiringView(rowToStrings(res.record), await state(r.id)),
      });
    }

    if (row.row_version !== r.expected_version) {
      return fail({ status: 409, code: 'VERSION_CONFLICT', message: 'Hồ sơ ứng viên này vừa được người dùng khác cập nhật. Vui lòng đối chiếu phiên bản hiện tại trước khi ghi đè.', details: { current: row } });
    }
    const existing = rowToStrings(row);

    let changes: Record<string, unknown> = {};
    let notices: Record<string, string> = {};
    const meta: Record<string, unknown> = { op: r.op === 'patch' ? 'patch' : r.op };

    if (r.op === 'patch' || r.op === 'move') {
      let input = r.op === 'patch' ? r.changes : {};
      if (r.op === 'move') {
        const mv = planMove(existing, r.target_box);
        if (!mv.ok) return fail(mv.error);
        input = mv.changes;
        meta.from_box = mv.from;
        meta.to_box = mv.to;
      }
      const v = validatePatch(actor, existing, input, await loadConfig());
      if (!v.ok) return fail(v.error);
      changes = toDbValues(v.values);
      notices = v.notices;
    }

    const { data, error } = await db.rpc('save_record', {
      p_actor: actor.id, p_id: r.id, p_expected_version: r.expected_version, p_changes: changes, p_meta: meta,
    });
    if (error) return fail(mapRpcError(error));
    const rec = data as Record<string, unknown>;
    return json(200, { record: rec, notices, duplicates: { phone: await duplicates(rec.phone as string, rec.id as number) } });
  } catch (e) {
    console.error('records-save', (e as Error).message);
    return fail({ status: 500, code: 'SERVER_ERROR', message: 'Lỗi máy chủ khi lưu hồ sơ. Vui lòng thử lại.' });
  }
});

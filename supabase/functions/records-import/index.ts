// Edge Function records-import (M7-4, API_SPEC §4.2) – nhập Excel, chỉ Admin (như hệ cũ).
//   {op:"chunk", batch_id?, file_name, rows[≤1500], meta[]} : kiểm lại từng dòng bằng shared/ (logic.ts), ghi qua RPC
//      import_records (1 giao dịch, không ghi đè). Lần gọi đầu (chưa có batch_id) tạo lô import_batches và trả batch_id.
//   {op:"finish", batch_id, file_name, imported, invalid, duplicates, rejected} : 1 dòng nhật ký tổng (import_finish).
//   {op:"batches", limit?} : danh sách lô Excel (import_batch_list, 0028).
//   {op:"rollback", batch_id, dry_run?} : hoàn tác lô (import_rollback, 0028); mặc định chạy thử, dry_run:false mới xóa.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { BODY_MAX_IMPORT, BodyTooLarge, corsHeaders, readJsonLimited, TOO_LARGE_MESSAGE } from '../admin-users/logic.ts';
import { buildConfig, mapRpcError, type ApiError } from '../records-save/logic.ts';
import { parseImportRequest, prepareRows } from './logic.ts';

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
  const fail = (e: ApiError) => json(e.status, { error: { code: e.code, message: e.message } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail({ status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Chỉ nhận POST.' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return fail({ status: 401, code: 'UNAUTHORIZED', message: 'Phiên đăng nhập không hợp lệ.' });
  const { data: prof } = await db.from('profiles').select('id, role, active').eq('id', who.user.id).maybeSingle();
  if (!prof || !prof.active) return fail({ status: 403, code: 'FORBIDDEN', message: 'Tài khoản đã bị khóa hoặc chưa được cấp quyền.' });
  if (prof.role !== 'admin') return fail({ status: 403, code: 'FORBIDDEN', message: 'Chỉ Admin được nhập Excel.' });

  let body: unknown;
  try {
    body = await readJsonLimited(req, BODY_MAX_IMPORT);
  } catch (e) {
    if (e instanceof BodyTooLarge) return fail({ status: 413, code: 'PAYLOAD_TOO_LARGE', message: TOO_LARGE_MESSAGE });
    return fail({ status: 400, code: 'BAD_JSON', message: 'Nội dung không phải JSON.' });
  }
  const parsed = parseImportRequest(body);
  if (!parsed.ok) return fail(parsed.error);
  const r = parsed.req;

  try {
    if (r.op === 'batches') {
      const { data, error } = await db.rpc('import_batch_list', { p_actor: prof.id, p_limit: r.limit });
      if (error) return fail(mapRpcError(error));
      return json(200, { batches: data ?? [] });
    }
    if (r.op === 'rollback') {
      const { data, error } = await db.rpc('import_rollback', { p_actor: prof.id, p_batch_id: r.batch_id, p_dry_run: r.dry_run });
      if (error) {
        const m = mapRpcError(error);
        return fail(m.code === 'NOT_FOUND' ? { ...m, message: 'Không tìm thấy lô nhập.' } : m);
      }
      return json(200, data);
    }
    if (r.op === 'finish') {
      const { error } = await db.rpc('import_finish', {
        p_actor: prof.id, p_batch_id: r.batch_id, p_file: r.file_name, p_imported: r.imported, p_invalid: r.invalid,
        p_duplicates: r.duplicates, p_rejected: r.rejected,
      });
      if (error) return fail(mapRpcError(error));
      return json(200, {});
    }

    let batchId = r.batch_id;
    if (!batchId) {
      const ins = await db.from('import_batches').insert({ source: 'excel', note: `Đang nhập file "${r.file_name}"`, created_by: prof.id }).select('id').single();
      if (ins.error) throw new Error(ins.error.message);
      batchId = Number(ins.data.id);
    }
    const prep = prepareRows(r.rows, r.meta, await loadConfig());
    let imported = 0;
    let rejected = prep.rejected;
    if (prep.accepted.length) {
      const { data, error } = await db.rpc('import_records', { p_actor: prof.id, p_batch_id: batchId, p_rows: prep.accepted });
      if (error) return fail(mapRpcError(error));
      const res = data as { imported: number; rejected: { index: number; errors: Record<string, string> }[] };
      imported = res.imported;
      rejected = [...rejected, ...res.rejected].sort((a, b) => a.index - b.index);
    }
    return json(200, { imported, rejected, batch_id: batchId });
  } catch (e) {
    console.error('records-import', (e as Error).message);
    return fail({ status: 500, code: 'SERVER_ERROR', message: 'Lỗi máy chủ khi nhập dữ liệu. Vui lòng thử lại.' });
  }
});

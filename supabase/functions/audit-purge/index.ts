// Edge Function audit-purge (M6-5/M7; Q7, D-10): giữ nhật ký 12 tháng – dòng cũ hơn được XUẤT CSV lên Drive rồi mới xóa.
//   {op:"preview"} -> {before, count}        : bao nhiêu dòng cũ hơn 12 tháng
//   {op:"run"}     -> {before, exported, files, remaining}
// Mỗi lô ≤ 5.000 dòng = 1 file trong thư mục "TA Tracker Nhật ký"; tải lên xong mới xóa đúng các dòng đó (purge_audit).
// Mỗi lần gọi tối đa 10 lô; còn thì bấm lại. Chỉ Admin.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../admin-users/logic.ts';
import { DriveError, driveConfigured, ensureFolder, upload } from '../files/drive.ts';
import { auditCsv, auditFileName, type AuditRow } from './logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const BATCH = 5000;
const MAX_BATCHES = 10;

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), ALLOWED);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Chỉ nhận POST.');

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return fail(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ.');
  const { data: prof } = await db.from('profiles').select('id, role, active').eq('id', who.user.id).maybeSingle();
  if (!prof?.active || prof.role !== 'admin') return fail(403, 'FORBIDDEN', 'Chỉ Admin được dọn nhật ký.');

  try {
    const body = await req.json().catch(() => ({})) as { op?: string };
    const { data: before, error: cErr } = await db.rpc('audit_purge_cutoff');
    if (cErr) throw new Error(cErr.message);

    if (body.op === 'preview') {
      const { data, error } = await db.rpc('audit_purge_batch', { p_before: before, p_after_id: 0, p_limit: 1 });
      if (error) throw new Error(error.message);
      return json(200, { before, count: (data as { remaining: number }).remaining });
    }
    if (body.op !== 'run') return fail(422, 'INVALID_OP', 'op phải là preview hoặc run.');
    if (!driveConfigured()) return fail(503, 'DRIVE_NOT_CONFIGURED', 'Chưa cấu hình Google Drive cho hệ thống.');

    const folder = await ensureFolder('TA Tracker Nhật ký');
    const files: string[] = [];
    let exported = 0;
    let remaining = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await db.rpc('audit_purge_batch', { p_before: before, p_after_id: 0, p_limit: BATCH });
      if (error) throw new Error(error.message);
      const b = data as { rows: AuditRow[]; remaining: number };
      remaining = b.remaining;
      if (!b.rows.length) break;
      const name = auditFileName(b.rows);
      const bytes = new TextEncoder().encode(auditCsv(b.rows));
      await upload(folder, name, 'text/csv', bytes.buffer as ArrayBuffer);   // lỗi => dừng, KHÔNG xóa
      const { data: n, error: pErr } = await db.rpc('purge_audit', {
        p_actor: prof.id, p_before: before, p_max_id: b.rows[b.rows.length - 1].id, p_file: name,
      });
      if (pErr) throw new Error(pErr.message);
      exported += Number(n);
      remaining -= Number(n);
      files.push(name);
    }
    return json(200, { before, exported, files, remaining: Math.max(0, remaining) });
  } catch (e) {
    console.error('audit-purge', (e as Error).message);
    if (e instanceof DriveError) return fail(502, 'DRIVE_ERROR', 'Không kết nối được Google Drive. Chưa xóa dòng nào chưa xuất.');
    return fail(500, 'SERVER_ERROR', 'Lỗi máy chủ. Vui lòng thử lại.');
  }
});

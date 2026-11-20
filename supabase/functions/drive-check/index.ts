// Edge Function drive-check (chuẩn bị M7-1/M7-2/M7-3) – CHỈ ĐỌC, kiểm tra kết nối Google Drive qua OAuth của Gmail cá nhân:
//   1) đủ 4 secret GOOGLE_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID
//   2) đổi refresh token lấy access token (báo phạm vi quyền được cấp)
//   3) đọc tài khoản Drive (email che bớt) và thư mục gốc (tên, có tạo được file con không)
// Không tạo/sửa/xóa gì trên Drive. Không trả token hay secret ra ngoài.
// Người gọi: Admin (JWT) hoặc service_role (kiểm tra vận hành).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../admin-users/logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const SECRETS = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'GOOGLE_DRIVE_ROOT_FOLDER_ID'] as const;

interface Step { step: string; ok: boolean; detail: string; info?: string }

function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  return u && d ? `${u.slice(0, 2)}***@${d}` : '***';
}

export async function checkDrive(env: (k: string) => string | undefined, fetchFn: typeof fetch = fetch): Promise<Step[]> {
  const out: Step[] = [];
  const missing = SECRETS.filter((k) => !env(k));
  if (missing.length) {
    out.push({ step: 'secrets', ok: false, detail: 'Thiếu secret Google trên Supabase.', info: missing.join(', ') });
    return out;
  }
  out.push({ step: 'secrets', ok: true, detail: 'Đủ 4 secret Google.' });

  const tr = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID')!, client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET')!,
      refresh_token: env('GOOGLE_OAUTH_REFRESH_TOKEN')!, grant_type: 'refresh_token',
    }),
  });
  const tj = await tr.json().catch(() => ({})) as { access_token?: string; scope?: string; error?: string; error_description?: string };
  if (!tr.ok || !tj.access_token) {
    out.push({ step: 'token', ok: false, detail: 'Google từ chối refresh token.', info: [tj.error ?? String(tr.status), tj.error_description].filter(Boolean).join(' – ') });
    return out;
  }
  const scopes = (tj.scope ?? '').split(' ').filter(Boolean);
  const full = scopes.includes('https://www.googleapis.com/auth/drive');
  const fileOnly = scopes.includes('https://www.googleapis.com/auth/drive.file');
  const info = scopes.map((x) => x.replace('https://www.googleapis.com/auth/', '')).join(', ');
  out.push(full ? { step: 'token', ok: true, detail: 'Đổi token được, có toàn quyền Drive.', info }
    : fileOnly ? { step: 'token', ok: true, detail: 'Đổi token được nhưng chỉ có quyền drive.file: app chỉ thấy file do chính app tạo.', info }
    : { step: 'token', ok: false, detail: 'Đổi token được nhưng thiếu quyền Drive.', info });
  if (!full && !fileOnly) return out;

  const auth = { Authorization: `Bearer ${tj.access_token}` };
  const ab = await fetchFn('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota(limit,usage)', { headers: auth });
  const aj = await ab.json().catch(() => ({})) as { user?: { emailAddress?: string }; storageQuota?: { limit?: string; usage?: string }; error?: { message?: string } };
  if (!ab.ok) {
    out.push({ step: 'account', ok: false, detail: 'Không đọc được tài khoản Drive.', info: aj.error?.message ?? String(ab.status) });
    return out;
  }
  const gb = (v?: string) => (v ? (Number(v) / 1024 ** 3).toFixed(1) + ' GB' : '?');
  out.push({ step: 'account', ok: true, detail: 'Đọc được tài khoản Drive.', info: `${maskEmail(aj.user?.emailAddress ?? '')} · ${gb(aj.storageQuota?.usage)} / ${gb(aj.storageQuota?.limit)}` });

  const id = encodeURIComponent(env('GOOGLE_DRIVE_ROOT_FOLDER_ID')!);
  const fr = await fetchFn(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true`, { headers: auth });
  const fj = await fr.json().catch(() => ({})) as { name?: string; mimeType?: string; trashed?: boolean; capabilities?: { canAddChildren?: boolean }; error?: { message?: string } };
  if (!fr.ok) {
    out.push({ step: 'root_folder', ok: false, detail: 'Không mở được thư mục gốc.', info: (fj.error?.message ?? String(fr.status)) + (fileOnly && !full ? ' · drive.file' : '') });
    return out;
  }
  const name = fj.name ?? '';
  if (fj.mimeType !== 'application/vnd.google-apps.folder') out.push({ step: 'root_folder', ok: false, detail: 'ID thư mục gốc không phải là thư mục.', info: name });
  else if (fj.trashed) out.push({ step: 'root_folder', ok: false, detail: 'Thư mục gốc đang ở thùng rác.', info: name });
  else if (fj.capabilities?.canAddChildren !== true) out.push({ step: 'root_folder', ok: false, detail: 'Không có quyền tạo file trong thư mục gốc.', info: name });
  else out.push({ step: 'root_folder', ok: true, detail: 'Thư mục gốc dùng được, tạo được file bên trong.', info: name });
  return out;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), ALLOWED);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Chỉ nhận POST.' } });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let allowed = jwt.length > 0 && jwt === SERVICE;
  if (!allowed) {
    const { data: who } = await db.auth.getUser(jwt);
    if (who?.user) {
      const { data: prof } = await db.from('profiles').select('role, active').eq('id', who.user.id).maybeSingle();
      allowed = !!prof?.active && prof.role === 'admin';
    }
  }
  if (!allowed) return json(403, { error: { code: 'FORBIDDEN', message: 'Chỉ Admin được kiểm tra kết nối Drive.' } });

  try {
    const steps = await checkDrive((k) => Deno.env.get(k));
    return json(200, { ok: steps.every((s) => s.ok), steps });
  } catch (e) {
    console.error('drive-check', (e as Error).message);
    return json(500, { error: { code: 'SERVER_ERROR', message: 'Lỗi khi gọi Google. Vui lòng thử lại.' } });
  }
});

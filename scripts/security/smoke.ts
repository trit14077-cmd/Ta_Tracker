// M9-3: kiểm thử bảo mật trên môi trường THẬT (DEV/PROD sau deploy). Mọi yêu cầu đều PHẢI bị từ chối;
// được thiết kế để KHÔNG ghi dữ liệu kể cả khi chạy đúng (lọc id = -1, upload sai nội dung bị chặn trước Drive…).
// Nếu một mục báo CHƯA ĐẠT nghĩa là có lỗ hổng – dừng, không chạy lại nhiều lần.
//
//   npx tsx scripts/security/smoke.ts
//
// Cần frontend/.env.local (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY – khóa công khai).
// Tùy chọn trong NEW/.env (không commit):
//   SMOKE_TA_EMAIL, SMOKE_TA_PASSWORD   tài khoản TA THỬ NGHIỆM (không dùng tài khoản thật) => chạy thêm nhóm "TA"
//   SUPABASE_SERVICE_ROLE_KEY           chỉ để ĐỌC 1 id hồ sơ thuộc PIC khác (thử vượt quyền); thiếu thì bỏ qua mục đó
//   SMOKE_ALLOWED_ORIGIN                origin hợp lệ của app (vd https://ta.example.com) để kiểm CORS cho phép đúng
// Không in khóa/mật khẩu/JWT; không in dữ liệu hồ sơ.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readEnv(p: string): Record<string, string> {
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const env = { ...readEnv(resolve('frontend/.env.local')), ...readEnv(resolve('.env')) };
const URL_ = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY || '';
if (!URL_ || !ANON) {
  console.error('Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (frontend/.env.local).');
  process.exit(2);
}
const EVIL = 'https://evil.example';
const AUTH_FNS = ['records-save', 'records-import', 'files', 'hr-info-save', 'hr-form', 'admin-users', 'audit-purge', 'drive-check'];
const SENSITIVE_TABLES = ['recruitment_records', 'profiles', 'hr_info', 'applicants', 'applications', 'audit_logs', 'record_files', 'comments'];

type Result = { group: string; name: string; ok: boolean | 'skip'; detail: string };
const results: Result[] = [];
const record = (group: string, name: string, ok: boolean | 'skip', detail: string) => results.push({ group, name, ok, detail });

async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const res = await fetch(URL_ + path, { ...init, headers: { apikey: ANON, ...(init.headers ?? {}) } });
  let body: unknown;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, headers: res.headers, body };
}
const code = (b: unknown) => (b && typeof b === 'object' ? ((b as { error?: { code?: string }; code?: string }).error?.code ?? (b as { code?: string }).code ?? '') : '');
const denied = (s: number) => s === 401 || s === 403;

async function anonymousProbes() {
  const G = 'Ẩn danh';
  for (const fn of AUTH_FNS) {
    // 1) không JWT người dùng => 401 (cổng verify_jwt / getUser) hoặc 403 (drive-check: "chỉ Admin") – miễn bị chặn
    const r = await call(`/functions/v1/${fn}`, { method: 'POST', headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: '{}' });
    record(G, `${fn}: gọi không đăng nhập`, denied(r.status), `HTTP ${r.status} ${code(r.body)}`);
    // 2) CORS: origin lạ không được phản chiếu, không '*'
    const o = await call(`/functions/v1/${fn}`, { method: 'OPTIONS', headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST' } });
    const acao = o.headers.get('access-control-allow-origin') ?? '';
    record(G, `${fn}: CORS từ origin lạ`, acao !== EVIL && acao !== '*', `ACAO="${acao}"`);
  }
  if (env.SMOKE_ALLOWED_ORIGIN) {
    const o = await call('/functions/v1/records-save', { method: 'OPTIONS', headers: { Origin: env.SMOKE_ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    const acao = o.headers.get('access-control-allow-origin') ?? '';
    record(G, 'records-save: CORS origin của app được phép', acao === env.SMOKE_ALLOWED_ORIGIN, `ACAO="${acao}"`);
  }

  // 3) PostgREST bằng khóa anon: không đọc được bảng nhạy cảm
  for (const t of SENSITIVE_TABLES) {
    const r = await call(`/rest/v1/${t}?select=*&limit=1`);
    const empty = Array.isArray(r.body) && r.body.length === 0;
    record(G, `anon đọc ${t}`, denied(r.status) || empty, `HTTP ${r.status}${empty ? ' []' : ''} ${code(r.body)}`);
  }
  // 4) anon sửa/xóa: lọc id=-1 => kể cả khi (sai) có quyền cũng không đổi dòng nào; mong đợi bị từ chối quyền
  for (const method of ['PATCH', 'DELETE'] as const) {
    const r = await call('/rest/v1/recruitment_records?id=eq.-1', {
      method, headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: method === 'PATCH' ? '{"full_name":"x"}' : undefined,
    });
    record(G, `anon ${method} recruitment_records`, denied(r.status), `HTTP ${r.status} ${code(r.body)}`);
  }
  // 5) anon gọi RPC ghi (p_id=-1: không có hồ sơ => không ghi gì kể cả khi sai quyền)
  const rpc = await call('/rest/v1/rpc/save_record', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_actor: '00000000-0000-0000-0000-000000000000', p_id: -1, p_expected_version: 1, p_changes: {} }),
  });
  record(G, 'anon gọi RPC save_record', denied(rpc.status), `HTTP ${rpc.status} ${code(rpc.body)}`);

  // 6) form công khai: body quá lớn => 413 trước khi đọc hết / trước khi kiểm mã link (không ghi gì)
  const big = JSON.stringify({ op: 'info', code: 'x', pad: 'a'.repeat(7 * 1024 * 1024) });
  const a = await call('/functions/v1/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
  record(G, 'apply: body 7 MB', a.status === 413, `HTTP ${a.status} ${code(a.body)}${a.status === 401 ? ' (apply chưa deploy --no-verify-jwt?)' : ''}`);
  // 7) form công khai: mã link sai => 404 BAD_LINK (không lộ thông tin)
  const bl = await call('/functions/v1/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"op":"info","code":"khong-ton-tai"}' });
  record(G, 'apply: mã link sai', bl.status === 404 && code(bl.body) === 'BAD_LINK', `HTTP ${bl.status} ${code(bl.body)}`);
}

async function taProbes() {
  const G = 'TA thử nghiệm';
  if (!env.SMOKE_TA_EMAIL || !env.SMOKE_TA_PASSWORD) {
    record(G, '(cả nhóm)', 'skip', 'chưa có SMOKE_TA_EMAIL / SMOKE_TA_PASSWORD trong .env');
    return;
  }
  const login = await call('/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.SMOKE_TA_EMAIL, password: env.SMOKE_TA_PASSWORD }),
  });
  const jwt = (login.body as { access_token?: string })?.access_token;
  if (!jwt) {
    record(G, 'đăng nhập', false, `HTTP ${login.status}`);
    return;
  }
  const H = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };
  const me = await call('/rest/v1/profiles?select=id,role,pic_code&limit=1', { headers: H });
  const prof = Array.isArray(me.body) ? (me.body[0] as { id: string; role: string; pic_code: string } | undefined) : undefined;
  if (!prof || prof.role !== 'pic') {
    record(G, 'tài khoản là TA', false, 'SMOKE_TA_* phải là tài khoản role pic (không phải Admin)');
    return;
  }

  // chỉ Admin
  for (const [fn, body] of [['admin-users', '{"op":"update","id":"00000000-0000-0000-0000-000000000000"}'], ['records-import', '{"op":"batches"}'], ['audit-purge', '{"op":"preview"}']]) {
    const r = await call(`/functions/v1/${fn}`, { method: 'POST', headers: H, body });
    record(G, `${fn}: TA gọi chức năng Admin`, r.status === 403, `HTTP ${r.status} ${code(r.body)}`);
  }
  // RPC ghi chỉ cho service_role (Edge): TA gọi thẳng => từ chối quyền (không phải lỗi "không có hồ sơ")
  const rpc = await call('/rest/v1/rpc/save_record', {
    method: 'POST', headers: H, body: JSON.stringify({ p_actor: prof.id, p_id: -1, p_expected_version: 1, p_changes: {} }),
  });
  record(G, 'TA gọi thẳng RPC save_record', denied(rpc.status), `HTTP ${rpc.status} ${code(rpc.body)}`);
  // file sai nội dung (.pdf nhưng là EXE "MZ"): bị chặn trước khi tìm hồ sơ / lên Drive
  const fd = new FormData();
  fd.set('op', 'upload');
  fd.set('record_id', '-1');
  fd.set('kind', 'cv');
  fd.set('file', new Blob([new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])], { type: 'application/pdf' }), 'cv.pdf');
  const up = await call('/functions/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: fd });
  const upOk = (up.status === 422 && code(up.body) === 'BAD_FILE_CONTENT') || (up.status === 503 && code(up.body) === 'DRIVE_NOT_CONFIGURED');
  record(G, 'files: .exe đổi đuôi .pdf', upOk, `HTTP ${up.status} ${code(up.body)}`);
  // body quá lớn khi đã đăng nhập
  const big = await call('/functions/v1/records-save', { method: 'POST', headers: H, body: JSON.stringify({ op: 'patch', pad: 'a'.repeat(2 * 1024 * 1024) }) });
  record(G, 'records-save: body 2 MB', big.status === 413, `HTTP ${big.status} ${code(big.body)}`);

  // hồ sơ PIC khác: cần 1 id (đọc bằng service_role, CHỈ select id)
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    record(G, 'hồ sơ PIC khác', 'skip', 'thiếu SUPABASE_SERVICE_ROLE_KEY trong .env để tìm 1 id');
    return;
  }
  const pick = await fetch(`${URL_}/rest/v1/recruitment_records?select=id&pic=neq.${encodeURIComponent(prof.pic_code)}&pic=not.is.null&limit=1`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).then((r) => r.json() as Promise<{ id: number }[]>);
  const other = pick[0]?.id;
  if (!other) {
    record(G, 'hồ sơ PIC khác', 'skip', 'không có hồ sơ PIC khác');
    return;
  }
  const rd = await call(`/rest/v1/recruitment_records?select=id&id=eq.${other}`, { headers: H });
  record(G, 'TA đọc hồ sơ PIC khác (PostgREST)', Array.isArray(rd.body) ? rd.body.length === 0 : denied(rd.status), `HTTP ${rd.status}`);
  const vr = await call(`/rest/v1/v_records?select=id&id=eq.${other}`, { headers: H });
  record(G, 'TA đọc v_records PIC khác', Array.isArray(vr.body) ? vr.body.length === 0 : denied(vr.status), `HTTP ${vr.status}`);
  const hr = await call(`/rest/v1/hr_info?select=record_id&record_id=eq.${other}`, { headers: H });
  record(G, 'TA đọc HR Info PIC khác', Array.isArray(hr.body) ? hr.body.length === 0 : denied(hr.status), `HTTP ${hr.status}`);
  // ghi thẳng PostgREST: không có quyền UPDATE trên recruitment_records (đi qua Edge) – nếu sai quyền, RLS vẫn phải chặn
  const wr = await call(`/rest/v1/recruitment_records?id=eq.${other}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: '{"id":' + other + '}' });
  record(G, 'TA sửa thẳng hồ sơ PIC khác (PostgREST)', denied(wr.status) || (Array.isArray(wr.body) && wr.body.length === 0), `HTTP ${wr.status}`);
  // qua Edge: 404 (không lộ hồ sơ tồn tại), trước cả kiểm version
  const es = await call('/functions/v1/records-save', { method: 'POST', headers: H, body: JSON.stringify({ op: 'patch', id: other, expected_version: 1, changes: { full_name: 'x' } }) });
  record(G, 'records-save sửa hồ sơ PIC khác', es.status === 404, `HTTP ${es.status} ${code(es.body)}`);
  const fl = await call('/functions/v1/files', { method: 'POST', headers: H, body: JSON.stringify({ op: 'list', record_id: other }) });
  record(G, 'files liệt kê file hồ sơ PIC khác', fl.status === 404 || denied(fl.status), `HTTP ${fl.status} ${code(fl.body)}`);
}

async function main() {
  console.log(`Đích: ${new URL(URL_).host} (${env.SUPABASE_ENV || 'không ghi SUPABASE_ENV'})`);
  await anonymousProbes();
  await taProbes();
  let fail = 0;
  for (const r of results) {
    const tag = r.ok === 'skip' ? 'BỎ QUA ' : r.ok ? 'ĐẠT    ' : 'CHƯA ĐẠT';
    if (r.ok === false) fail++;
    console.log(`${tag} [${r.group}] ${r.name} – ${r.detail}`);
  }
  console.log(`\n${results.filter((r) => r.ok === true).length} đạt, ${fail} chưa đạt, ${results.filter((r) => r.ok === 'skip').length} bỏ qua`);
  process.exit(fail ? 1 : 0);
}

void main();

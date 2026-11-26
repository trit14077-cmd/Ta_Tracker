// Edge Function sheet-backup: sao lưu MỘT CHIỀU Supabase -> Google Sheet (Supabase vẫn là nguồn chính, sửa trên Sheet không ghi ngược).
//   POST {} -> {records, hr_info}    : ghi đè tab "Hồ sơ" (v_records) và "HR Info" (hr_info) trong sheet GOOGLE_BACKUP_SHEET_ID.
// Gọi bởi: GitHub Actions hằng đêm (header x-backup-token = secret BACKUP_SYNC_TOKEN) hoặc Admin đăng nhập.
// Sheet chứa dữ liệu cá nhân (gồm CCCD): phải để chế độ "Hạn chế", chỉ chia sẻ cho người cần.
// Không ghi dữ liệu ra log: chỉ trả số dòng.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { DriveError, googleConfigured, SheetAccessError, writeSheet } from '../files/drive.ts';
import { flattenHr, type HrRow, safeEqual, toMatrix } from './logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const PAGE = 1000;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });

async function fetchAll<T>(table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).order(order).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Chỉ nhận POST.');

  const token = req.headers.get('x-backup-token') ?? '';
  const expected = Deno.env.get('BACKUP_SYNC_TOKEN') ?? '';
  let allowed = safeEqual(token, expected);
  if (!allowed) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who } = await db.auth.getUser(jwt);
    if (who?.user) {
      const { data: prof } = await db.from('profiles').select('role, active').eq('id', who.user.id).maybeSingle();
      allowed = Boolean(prof?.active && prof.role === 'admin');
    }
  }
  if (!allowed) return fail(401, 'UNAUTHORIZED', 'Không có quyền sao lưu.');

  const sheetId = Deno.env.get('GOOGLE_BACKUP_SHEET_ID') ?? '';
  if (!googleConfigured() || !sheetId) return fail(503, 'BACKUP_NOT_CONFIGURED', 'Chưa cấu hình tài khoản Google hoặc GOOGLE_BACKUP_SHEET_ID.');

  try {
    const records = await fetchAll<Record<string, unknown>>('v_records', '*', 'id');
    const hr = await fetchAll<HrRow>('hr_info', 'record_id, data, status, id_number, updated_at, verified_at', 'record_id');
    const codeById = new Map<number, string>(records.map((r) => [Number(r.id), String(r.candidate_code ?? '')]));

    await writeSheet(sheetId, 'Hồ sơ', toMatrix(records, ['id', 'candidate_code', 'full_name', 'pic']));
    await writeSheet(sheetId, 'HR Info', toMatrix(flattenHr(hr, codeById), ['record_id', 'candidate_code']));
    return json(200, { records: records.length, hr_info: hr.length });
  } catch (e) {
    if (e instanceof SheetAccessError) {
      return fail(409, 'BACKUP_SHEET_NO_ACCESS', 'Không mở được sheet sao lưu. Hãy chia sẻ sheet (quyền chỉnh sửa) cho tài khoản Google của hệ thống.');
    }
    if (e instanceof DriveError) return fail(502, 'GOOGLE_ERROR', 'Google từ chối yêu cầu. Kiểm tra quyền Sheets của token OAuth.');
    return fail(500, 'BACKUP_FAILED', e instanceof Error ? e.message : 'Lỗi không xác định.');
  }
});

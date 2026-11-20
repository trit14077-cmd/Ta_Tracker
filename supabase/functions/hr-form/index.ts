// Edge Function hr-form (M6-4, API_SPEC §4.7, D-08a) – Google Form "THÔNG TIN NHÂN VIÊN" của công ty (HrForm.gs).
//   {op:"link", record_id}     : ghi hr_form_sends + nhật ký, trả link form (app_settings.hr_form – khóa nhạy cảm, TA không
//                                đọc thẳng được nên đi qua đây) và danh sách các lần gửi.
//   {op:"response", record_id} : tra câu trả lời trong sheet trả lời theo SĐT rồi CCCD (HR Info), lấy lần gửi mới nhất.
//                                Đọc sheet bằng OAuth Gmail của hệ thống (secret GOOGLE_OAUTH_*, chung với Drive – M7-1);
//                                sheet + tab lấy ở app_settings.hr_form (Admin cấu hình), mặc định như hệ cũ.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../admin-users/logic.ts';
import { hrEligible } from '../../../shared/hrInfoRules.ts';
import { HR_FORM_DEFAULT_URL, HR_SHEET_DEFAULT_ID, HR_SHEET_DEFAULT_TAB } from '../../../shared/hrFormMap.ts';
import { googleConfigured, readSheet, SheetAccessError } from '../files/drive.ts';
import { findHrAnswer } from './logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

interface ApiError { status: number; code: string; message: string }

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
  const { data: prof } = await db.from('profiles').select('id, username, role, pic_code, active').eq('id', who.user.id).maybeSingle();
  if (!prof || !prof.active) return fail({ status: 403, code: 'FORBIDDEN', message: 'Tài khoản đã bị khóa hoặc chưa được cấp quyền.' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail({ status: 400, code: 'BAD_JSON', message: 'Nội dung không phải JSON.' });
  }
  const id = Number(body?.record_id);
  if (!Number.isInteger(id) || id <= 0) return fail({ status: 422, code: 'VALIDATION_FAILED', message: 'Thiếu hoặc sai record_id.' });

  try {
    const { data: row } = await db.from('recruitment_records').select('id, candidate_code, pic, phone, r1_status, r1_date, r2_status, r2_date, ob_status, ob_date').eq('id', id).maybeSingle();
    const canSee = row && (prof.role === 'admin' || (!!row.pic && row.pic === prof.pic_code));
    if (!canSee) return fail({ status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' });

    const sends = async () => {
      const { data } = await db.from('hr_form_sends').select('id, sent_by, sent_at').eq('record_id', id).order('sent_at');
      const ids = [...new Set((data ?? []).map((s) => s.sent_by).filter(Boolean))];
      const { data: users } = ids.length ? await db.from('profiles').select('id, username').in('id', ids) : { data: [] };
      const name = new Map((users ?? []).map((u) => [u.id, u.username]));
      return (data ?? []).map((s) => ({
        id: String(s.id), candidate_id: String(id), candidate_code: row.candidate_code, pic: row.pic ?? '', phone: row.phone ?? '',
        sent_by: name.get(s.sent_by) ?? '', sent_at: s.sent_at,
      }));
    };

    if (body.op === 'link') {
      if (!hrEligible(row as Record<string, unknown>)) return fail({ status: 400, code: 'NOT_ELIGIBLE', message: 'Chỉ gửi form thông tin nhân viên cho ứng viên đã đạt vòng 2.' });
      const { data: cfg } = await db.from('app_settings').select('value').eq('key', 'hr_form').maybeSingle();
      const url = String((cfg?.value as { form_url?: string } | null)?.form_url || HR_FORM_DEFAULT_URL);
      const ins = await db.from('hr_form_sends').insert({ record_id: id, sent_by: prof.id });
      if (ins.error) throw new Error(ins.error.message);
      await db.from('audit_logs').insert({
        actor_id: prof.id, actor_username: prof.username, actor_role: prof.role, action: 'HRINFO', record_id: id,
        candidate_code: row.candidate_code, changes: { hr_form: { old: '', new: 'Gửi link form thông tin nhân viên' } },
      });
      return json(200, { url, sends: await sends() });
    }
    if (body.op === 'response') {
      if (!googleConfigured()) {
        return fail({ status: 503, code: 'HR_SHEET_NOT_CONFIGURED', message: 'Chưa cấu hình tài khoản Google để đọc sheet trả lời của form.' });
      }
      const { data: cfg } = await db.from('app_settings').select('value').eq('key', 'hr_form').maybeSingle();
      const v = (cfg?.value ?? {}) as { sheet_id?: string; sheet_tab?: string };
      const { data: hr } = await db.from('hr_info').select('id_number').eq('record_id', id).maybeSingle();
      let values: unknown[][];
      try {
        values = await readSheet(String(v.sheet_id || HR_SHEET_DEFAULT_ID), String(v.sheet_tab || HR_SHEET_DEFAULT_TAB));
      } catch (e) {
        if (e instanceof SheetAccessError) {
          return fail({ status: 409, code: 'HR_SHEET_NO_ACCESS', message: 'Không mở được sheet trả lời. Hãy chia sẻ sheet (quyền xem) cho tài khoản Google của hệ thống và kiểm tra tên tab trong cấu hình form HR.' });
        }
        throw e;
      }
      const ans = findHrAnswer(values, String(row.phone ?? ''), String(hr?.id_number ?? ''));
      return json(200, { ...ans, sends: await sends() });
    }
    return fail({ status: 422, code: 'INVALID_OP', message: 'op phải là link hoặc response.' });
  } catch (e) {
    console.error('hr-form', (e as Error).message);
    return fail({ status: 500, code: 'SERVER_ERROR', message: 'Lỗi máy chủ. Vui lòng thử lại.' });
  }
});

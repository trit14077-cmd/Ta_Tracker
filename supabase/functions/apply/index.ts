// Edge Function apply (M7-3, API_SPEC §4.3) – trang tuyển dụng công khai, KHÔNG đăng nhập (chỉ khóa anon của trang).
//   JSON {op:"info", code}          -> {valid:true, regions} | 404 BAD_LINK          (= hApplyInfo_)
//   multipart op=submit, code, full_name, phone, email, area, position (phải thuộc positions), note, consent, website (honeypot), cv (≤5 MB)
//                                   -> {received:true[, repeated:true]}               (= hApplySubmit_)
// Chống spam như hệ cũ: honeypot (giả vờ thành công), 1 lần/SĐT/10 phút (báo đã nhận, không lưu lần 2),
// tối đa APPLY_MAX_PER_HOUR (mặc định 600) hồ sơ/giờ/link; thêm APPLY_MAX_PER_IP (mặc định 60) hồ sơ/giờ/IP.
// CV lên Drive (thư mục "TA Tracker CV" trong thư mục gốc) TRƯỚC, rồi ghi DB; ghi DB lỗi thì bỏ file vào thùng rác.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  BODY_MAX_APPLY, BODY_MAX_JSON, BodyTooLarge, corsHeaders, readFormLimited, readJsonLimited, TOO_LARGE_MESSAGE,
} from '../admin-users/logic.ts';
import { driveConfigured, ensureFolder, trash, upload } from '../files/drive.ts';
import { applyCvFileName, validateApply } from './logic.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// trang tuyển dụng có thể ở tên miền khác app: thêm APPLY_ORIGINS
const ALLOWED = [Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173', Deno.env.get('APPLY_ORIGINS') ?? '']
  .join(',').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_PER_HOUR = Number(Deno.env.get('APPLY_MAX_PER_HOUR') || 600);
const MAX_PER_IP = Number(Deno.env.get('APPLY_MAX_PER_IP') || 60);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const BAD_LINK = 'Link ứng tuyển không đúng hoặc đã hết hiệu lực. Vui lòng liên hệ bộ phận tuyển dụng.';

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'), ALLOWED);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (status: number, code: string, message: string, fields?: Record<string, string>) =>
    json(status, { error: { code, message, ...(fields ? { fields } : {}) } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Chỉ nhận POST.');

  try {
    const isForm = (req.headers.get('Content-Type') ?? '').startsWith('multipart/form-data');
    const body: Record<string, string> = {};
    let file: File | null = null;
    if (isForm) {
      const fd = await readFormLimited(req, BODY_MAX_APPLY);
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string') body[k] = v;
        else if (k === 'cv') file = v;
      }
    } else {
      try {
        Object.assign(body, await readJsonLimited(req, BODY_MAX_JSON));
      } catch (e) {
        if (e instanceof BodyTooLarge) throw e;
        return fail(400, 'BAD_JSON', 'Nội dung không phải JSON.');
      }
    }

    const { data: info, error: infoErr } = await db.rpc('apply_info', { p_code: String(body.code ?? '') });
    if (infoErr) throw new Error(infoErr.message);
    const link = info as { valid: boolean; pic?: string; pic_label?: string; regions?: unknown[]; positions?: string[] };
    if (!link.valid) return fail(404, 'BAD_LINK', BAD_LINK);
    const positions = link.positions ?? [];

    if (body.op === 'info') return json(200, { valid: true, regions: link.regions ?? [], positions });
    if (body.op !== 'submit') return fail(422, 'INVALID_OP', 'op phải là info hoặc submit.');

    // Honeypot: ô người dùng không thấy, máy tự điền => giả vờ thành công
    if (String(body.website ?? '').trim()) return json(200, { received: true });

    const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
    const v = validateApply(
      {
        full_name: body.full_name ?? '', phone: body.phone ?? '', email: body.email ?? '', area: body.area ?? '',
        position: body.position ?? '', note: body.note ?? '', consent: body.consent === 'true', website: '',
      },
      file && bytes ? { name: file.name, size: bytes.byteLength, head: bytes.subarray(0, 8) } : null,
      positions,
    );
    if (!v.ok) return fail(400, 'VALIDATION_FAILED', 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.', v.fields);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    const pic = link.pic ?? '';
    const { data: gate, error: gateErr } = await db.rpc('apply_gate', {
      p_pic: pic, p_phone: v.clean.phone, p_ip: ip, p_max_per_hour: MAX_PER_HOUR, p_max_per_ip: MAX_PER_IP,
    });
    if (gateErr) throw new Error(gateErr.message);
    if (gate === 'repeated') return json(200, { received: true, repeated: true });
    if (gate === 'limited') return fail(429, 'RATE_LIMITED', 'Hệ thống đang nhận quá nhiều hồ sơ. Vui lòng thử lại sau ít phút.');

    let driveId = '';
    if (v.cv && bytes) {
      if (!driveConfigured()) return fail(503, 'BUSY', 'Hệ thống đang bận. Vui lòng thử lại sau vài giây.');
      const folder = await ensureFolder('TA Tracker CV');
      const taLabel = link.pic_label || 'Admin';
      driveId = await upload(folder, applyCvFileName(taLabel, v.clean.position, v.clean.full_name, v.cv.ext),
        v.cv.mime, bytes.buffer as ArrayBuffer);
    }
    const { error } = await db.rpc('apply_insert', {
      p_pic: pic, p_full_name: v.clean.full_name, p_phone: v.clean.phone, p_email: v.clean.email, p_area: v.clean.area,
      p_position: v.clean.position, p_note: v.clean.note, p_cv_drive_id: driveId, p_cv_name: v.cv?.name ?? '', p_ip: ip,
    });
    if (error) {
      if (driveId) await trash(driveId);
      console.error('apply insert', error.message);
      return fail(503, 'BUSY', 'Hệ thống đang có nhiều người gửi cùng lúc. Vui lòng thử lại sau vài giây.');
    }
    return json(200, { received: true });
  } catch (e) {
    // body vượt giới hạn: 413 (KHÔNG trả 503 – trang sẽ tự gửi lại mãi). Đọc dừng ngay khi vượt (M9-3).
    if (e instanceof BodyTooLarge) {
      const isForm = (req.headers.get('Content-Type') ?? '').startsWith('multipart/form-data');
      return isForm
        ? fail(413, 'PAYLOAD_TOO_LARGE', 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.', { cv: 'File CV tối đa 5 MB.' })
        : fail(413, 'PAYLOAD_TOO_LARGE', TOO_LARGE_MESSAGE);
    }
    console.error('apply', (e as Error).message);
    // lỗi Drive / DB: 503 để trang tự gửi lại (như hệ cũ)
    return fail(503, 'BUSY', 'Hệ thống đang bận. Vui lòng thử lại sau vài giây.');
  }
});

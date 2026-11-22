// Edge Function files (M7-1, API_SPEC §4.4) – file CV, 5 giấy tờ, Salary Proposal / Payslips trên Google Drive.
//   multipart: op=upload, record_id, kind, [replace_id], file  -> {file, record}
//   JSON: {op:"download", record_id, kind | file_id} -> nội dung file (application/octet-stream)
//         {op:"delete",   record_id, kind, [file_id]} -> {record}
//         {op:"list",     record_id}                 -> {kinds, attachments, max_per_kind}
//         {op:"app_cv",   application_id}            -> CV ứng viên gửi qua form ứng tuyển (M7-3)
// Quyền hồ sơ do RPC 0022 kiểm (Admin, hoặc TA có pic trùng; pic rỗng => không ai ngoài Admin).
// Edge kiểm loại, đuôi, ≤10 MB, nội dung đúng đuôi (magic bytes), Salary Proposal chỉ Rank 5 trở lên – TRƯỚC khi đưa lên Drive.
// Thư mục/tên file như hệ cũ (drivePlacement); file cũ khi xóa / thay vào thùng rác Drive (0025 trả `trash`).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  BODY_MAX_JSON, BODY_MAX_UPLOAD, BodyTooLarge, corsHeaders, readFormLimited, readJsonLimited, TOO_LARGE_MESSAGE,
} from '../admin-users/logic.ts';
import { attachmentKind, attachmentKindApplicable } from '../../../shared/attachmentRules.ts';
import { ATTACH_KINDS, MAX_PER_KIND, attachmentKinds, checkFile, contentDisposition, drivePlacement } from './logic.ts';
import { DriveError, download, driveConfigured, ensurePath, trash, upload } from './drive.ts';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

interface ApiError { status: number; code: string; message: string }

function rpcError(e: { code?: string; message?: string; details?: string | null }): ApiError {
  const status = /^PT\d{3}$/.test(e.code ?? '') ? Number(e.code!.slice(2)) : 500;
  if (status === 500) return { status: 500, code: 'SERVER_ERROR', message: 'Lỗi máy chủ. Vui lòng thử lại.' };
  return { status, code: e.message || 'ERROR', message: e.details || 'Không thực hiện được.' };
}

Deno.serve(async (req) => {
  const cors = { ...corsHeaders(req.headers.get('Origin'), ALLOWED), 'Access-Control-Expose-Headers': 'content-disposition' };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  const fail = (e: ApiError) => json(e.status, { error: { code: e.code, message: e.message } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail({ status: 405, code: 'METHOD_NOT_ALLOWED', message: 'Chỉ nhận POST.' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return fail({ status: 401, code: 'UNAUTHORIZED', message: 'Phiên đăng nhập không hợp lệ.' });
  const { data: prof } = await db.from('profiles').select('id, active').eq('id', who.user.id).maybeSingle();
  if (!prof || !prof.active) return fail({ status: 403, code: 'FORBIDDEN', message: 'Tài khoản đã bị khóa hoặc chưa được cấp quyền.' });
  if (!driveConfigured()) return fail({ status: 503, code: 'DRIVE_NOT_CONFIGURED', message: 'Chưa cấu hình Google Drive cho hệ thống.' });

  try {
    const isForm = (req.headers.get('Content-Type') ?? '').startsWith('multipart/form-data');
    let body: Record<string, unknown> = {};
    let file: File | null = null;
    if (isForm) {
      const fd = await readFormLimited(req, BODY_MAX_UPLOAD);
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string') body[k] = v;
        else if (k === 'file') file = v;
      }
    } else {
      try {
        body = await readJsonLimited(req, BODY_MAX_JSON) as Record<string, unknown>;
      } catch (e) {
        if (e instanceof BodyTooLarge) throw e;
        return fail({ status: 400, code: 'BAD_JSON', message: 'Nội dung không phải JSON.' });
      }
    }
    // CV ứng viên gửi qua form ứng tuyển online (hộp "Ứng tuyển online", M7-3)
    if (body.op === 'app_cv') {
      const { data, error } = await db.rpc('application_cv', { p_actor: prof.id, p_id: Number(body.application_id) });
      if (error) return fail(rpcError(error));
      const f = data as { drive_file_id: string; file_name: string };
      const res = await download(f.drive_file_id);
      return new Response(res.body, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Disposition': contentDisposition(f.file_name) },
      });
    }

    const recordId = Number(body.record_id);
    if (!Number.isInteger(recordId) || recordId <= 0) return fail({ status: 422, code: 'VALIDATION_FAILED', message: 'Thiếu hoặc sai record_id.' });
    const kind = String(body.kind ?? '');
    const fileId = body.file_id != null && body.file_id !== '' ? Number(body.file_id) : null;

    if (body.op === 'list') {
      const { data, error } = await db.rpc('file_list', { p_actor: prof.id, p_record_id: recordId });
      if (error) return fail(rpcError(error));
      const r = data as { rank: string; attachments: unknown[] };
      return json(200, { kinds: attachmentKinds(r.rank), attachments: r.attachments, max_per_kind: MAX_PER_KIND });
    }

    if (body.op === 'download') {
      const { data, error } = await db.rpc('file_open', { p_actor: prof.id, p_record_id: recordId, p_kind: kind, p_file_id: fileId });
      if (error) return fail(rpcError(error));
      const f = data as { drive_file_id: string; file_name: string };
      const res = await download(f.drive_file_id);
      return new Response(res.body, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Disposition': contentDisposition(f.file_name) },
      });
    }

    if (body.op === 'delete') {
      const { data, error } = await db.rpc('file_remove', { p_actor: prof.id, p_record_id: recordId, p_kind: kind, p_file_id: fileId });
      if (error) return fail(rpcError(error));
      const r = data as { record: unknown; trash: string[] };
      await Promise.all((r.trash ?? []).map(trash)); // như hệ cũ: file đã xóa vào thùng rác Drive
      return json(200, { record: r.record });
    }

    if (body.op === 'upload') {
      if (!file) return fail({ status: 422, code: 'VALIDATION_FAILED', message: 'Chưa chọn file.' });
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const chk = checkFile(kind, file.name, bytes.byteLength, bytes.subarray(0, 8));
      if (!chk.ok) return fail({ status: 422, code: chk.code, message: chk.message });

      // hồ sơ: đọc bằng service rồi để RPC kiểm quyền lần cuối; ở đây chỉ cần tên để đặt thư mục/tên file + Rank
      const { data: rec } = await db.from('recruitment_records').select('id, emp_id, candidate_code, full_name, rank').eq('id', recordId).maybeSingle();
      if (!rec) return fail({ status: 404, code: 'NOT_FOUND', message: 'Không tìm thấy hồ sơ ứng viên.' });
      // quyền trước khi đụng tới Drive (RPC file_list kiểm cùng luật, không ghi gì)
      const perm = await db.rpc('file_list', { p_actor: prof.id, p_record_id: recordId });
      if (perm.error) return fail(rpcError(perm.error));
      if (ATTACH_KINDS.includes(kind)) {
        const k = attachmentKind(kind)!;
        if (!attachmentKindApplicable(k, rec.rank)) {
          return fail({ status: 400, code: 'KIND_NOT_APPLICABLE', message: `${k.label} chỉ áp dụng cho hồ sơ từ Rank 5 trở lên (Rank hiện tại: ${rec.rank || 'chưa chọn'}).` });
        }
      }

      // Salary Proposal / Payslips: số trong tên file = id của dòng (thay => giữ số cũ), như hệ cũ
      let attId: number | null = null;
      if (ATTACH_KINDS.includes(kind)) {
        if (fileId) attId = fileId;
        else {
          const { data: rid, error: re } = await db.rpc('file_reserve_id');
          if (re) throw new Error(re.message);
          attId = Number(rid);
        }
      }
      const place = drivePlacement(rec, kind, file.name, attId);
      const folderId = await ensurePath(place.path);
      const driveId = await upload(folderId, place.file, chk.mime, buf);
      const { data, error } = await db.rpc('file_attach', {
        p_actor: prof.id, p_record_id: recordId, p_kind: kind, p_drive_id: driveId, p_name: place.file,
        p_size: bytes.byteLength, p_mime: chk.mime, p_replace_id: fileId, p_id: fileId ? null : attId,
      });
      if (error) {
        await trash(driveId);
        return fail(rpcError(error));
      }
      const r = data as { file: unknown; record: unknown; trash: string[] };
      await Promise.all((r.trash ?? []).map(trash)); // file cũ bị thay => thùng rác Drive (như hệ cũ)
      return json(200, { file: r.file, record: r.record });
    }

    return fail({ status: 422, code: 'INVALID_OP', message: 'op phải là upload, download, delete hoặc list.' });
  } catch (e) {
    // body vượt giới hạn: dừng đọc ngay, không đẩy gì lên Drive (M9-3)
    if (e instanceof BodyTooLarge) {
      const isForm = (req.headers.get('Content-Type') ?? '').startsWith('multipart/form-data');
      return fail(isForm
        ? { status: 413, code: 'FILE_TOO_LARGE', message: 'File tối đa 10 MB.' }
        : { status: 413, code: 'PAYLOAD_TOO_LARGE', message: TOO_LARGE_MESSAGE });
    }
    console.error('files', (e as Error).message);
    if (e instanceof DriveError) return fail({ status: 502, code: 'DRIVE_ERROR', message: 'Không kết nối được Google Drive. Vui lòng thử lại sau.' });
    return fail({ status: 500, code: 'SERVER_ERROR', message: 'Lỗi máy chủ. Vui lòng thử lại.' });
  }
});

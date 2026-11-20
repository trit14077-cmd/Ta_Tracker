-- 0022_files.sql – M7-1: file CV, 5 giấy tờ (mục 9), Salary Proposal / Payslips trên Google Drive (Edge `files`, API_SPEC §4.4).
-- File nằm trên Drive (OAuth Gmail cá nhân, thư mục gốc GOOGLE_DRIVE_ROOT_FOLDER_ID); DB chỉ giữ record_files.
-- Mọi hàm ở đây CHỈ service_role gọi (Edge đã kiểm loại, đuôi, dung lượng, magic bytes, Rank); hàm tự kiểm quyền hồ sơ
-- theo đúng luật save_record: Admin, hoặc TA có pic trùng (pic rỗng/null => KHÔNG thấy – AUDIT §3.2 #1).
--   giấy tờ (edu_certificate, health_check, id_card, resume, forklift_cert): 1 file/loại; cột cùng tên của hồ sơ
--     ghi "<drive id>|<tên file>" như hệ cũ (form nhận biết "có file" bằng dấu |), tăng row_version.
--   cv: 1 file; tên hiện ở v_records.cv_file.
--   salary_proposal, payslip: nhiều file, tối đa 20/loại; "Thay" = xóa mềm file cũ + thêm file mới.
-- Xóa = xóa mềm (deleted_at); file trên Drive giữ lại để dọn theo lịch (purge làm sau).
-- Nhật ký: tải lên / xóa ghi UPDATE theo trường (như sửa ô trên hệ cũ); tải xuống ghi DOWNLOAD (API_SPEC §4.4).

create or replace function app.file_doc_kinds() returns text[] language sql immutable set search_path = ''
as $$ select array['edu_certificate','health_check','id_card','resume','forklift_cert'] $$;

-- hồ sơ (khóa dòng) nếu người gọi được sửa; không thì NOT_FOUND (không lộ hồ sơ PIC khác)
create or replace function app.file_record(p_actor public.profiles, p_record_id bigint) returns public.recruitment_records
language plpgsql volatile security definer set search_path = ''
as $$
declare v public.recruitment_records;
begin
  select * into v from public.recruitment_records where id = p_record_id for update;
  if v.id is null or not (p_actor.role = 'admin' or (coalesce(v.pic, '') <> '' and v.pic = p_actor.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng viên.';
  end if;
  return v;
end $$;
revoke all on function app.file_record(public.profiles, bigint) from public, anon, authenticated;

create or replace function app.file_json(f public.record_files) returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', f.id, 'candidate_id', f.record_id, 'kind', f.kind, 'file_name', f.file_name, 'size', f.size,
                            'mime', f.mime, 'uploaded_at', f.uploaded_at,
                            'uploaded_by', coalesce((select p.username from public.profiles p where p.id = f.uploaded_by), ''))
$$;
revoke all on function app.file_json(public.record_files) from public, anon, authenticated;

create or replace function app.file_record_json(p_id bigint) returns jsonb language sql stable security definer set search_path = ''
as $$ select to_jsonb(v) from public.v_records v where v.id = p_id $$;
revoke all on function app.file_record_json(bigint) from public, anon, authenticated;

-- ============ ghi 1 file đã tải lên Drive ============
create or replace function public.file_attach(p_actor uuid, p_record_id bigint, p_kind text, p_drive_id text, p_name text,
                                              p_size bigint, p_mime text, p_replace_id bigint default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_rec public.recruitment_records;
  v_old text := '';
  v_new text;
  v_field text;
  v_file public.record_files;
  v_count int;
begin
  if p_kind not in ('cv','edu_certificate','health_check','id_card','resume','forklift_cert','salary_proposal','payslip') then
    raise exception 'INVALID_KIND' using errcode = 'PT422', detail = 'Loại file không hợp lệ.';
  end if;
  if coalesce(btrim(p_drive_id), '') = '' or coalesce(btrim(p_name), '') = '' then
    raise exception 'VALIDATION_FAILED' using errcode = 'PT422', detail = 'Thiếu thông tin file.';
  end if;
  v_rec := app.file_record(v_actor, p_record_id);

  if p_kind in ('salary_proposal','payslip') then
    v_field := p_kind;
    if p_replace_id is not null then
      update public.record_files set deleted_at = now()
       where id = p_replace_id and record_id = p_record_id and kind = p_kind and deleted_at is null
      returning file_name into v_old;
      if v_old is null then
        raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy file cần thay.';
      end if;
    end if;
    select count(*) into v_count from public.record_files where record_id = p_record_id and kind = p_kind and deleted_at is null;
    if v_count >= 20 then
      raise exception 'TOO_MANY_FILES' using errcode = 'PT409', detail = 'Đã đủ 20 file cho loại này. Xóa bớt file cũ trước khi tải thêm.';
    end if;
  else
    v_field := case when p_kind = 'cv' then 'cv_file' else p_kind end;
    v_old := case when p_kind = 'cv'
                  then coalesce((select file_name from public.record_files where record_id = p_record_id and kind = 'cv' and deleted_at is null
                                  order by uploaded_at desc, id desc limit 1), '')
                  else coalesce(to_jsonb(v_rec) ->> p_kind, '') end;
    update public.record_files set deleted_at = now()
     where record_id = p_record_id and kind = p_kind and deleted_at is null;
  end if;

  insert into public.record_files (record_id, kind, drive_file_id, file_name, size, mime, uploaded_by)
  values (p_record_id, p_kind, btrim(p_drive_id), btrim(p_name), greatest(coalesce(p_size, 0), 0), coalesce(p_mime, ''), v_actor.id)
  returning * into v_file;

  if p_kind = any (app.file_doc_kinds()) then
    v_new := v_file.drive_file_id || '|' || v_file.file_name;
    execute format('update public.recruitment_records set %I = $1, row_version = row_version + 1, updated_at = now(), updated_by = $2 where id = $3', p_kind)
      using v_new, v_actor.id, p_record_id;
  else
    v_new := v_file.file_name;
  end if;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'UPDATE', p_record_id, v_rec.candidate_code,
          jsonb_build_object(v_field, jsonb_build_object('old', coalesce(v_old, ''), 'new', v_new)));

  return jsonb_build_object('file', app.file_json(v_file), 'record', app.file_record_json(p_record_id));
end $$;
revoke all on function public.file_attach(uuid, bigint, text, text, text, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.file_attach(uuid, bigint, text, text, text, bigint, text, bigint) to service_role;

-- ============ xóa (mềm) ============
-- giấy tờ / cv: theo loại (p_file_id bỏ trống); Salary Proposal / Payslips: theo p_file_id.
create or replace function public.file_remove(p_actor uuid, p_record_id bigint, p_kind text, p_file_id bigint default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_rec public.recruitment_records;
  v_old text;
  v_field text;
begin
  v_rec := app.file_record(v_actor, p_record_id);
  if p_file_id is not null then
    select kind into p_kind from public.record_files where id = p_file_id and record_id = p_record_id;
  end if;
  if p_kind in ('salary_proposal','payslip') then
    update public.record_files set deleted_at = now()
     where id = p_file_id and record_id = p_record_id and kind = p_kind and deleted_at is null
    returning file_name into v_old;
    v_field := p_kind;
  elsif p_kind = 'cv' or p_kind = any (app.file_doc_kinds()) then
    with d as (
      update public.record_files set deleted_at = now()
       where record_id = p_record_id and kind = p_kind and deleted_at is null returning file_name, uploaded_at, id)
    select file_name into v_old from d order by uploaded_at desc, id desc limit 1;
    v_field := case when p_kind = 'cv' then 'cv_file' else p_kind end;
    if p_kind <> 'cv' then
      v_old := coalesce(to_jsonb(v_rec) ->> p_kind, v_old);
      if coalesce(v_old, '') <> '' then
        execute format('update public.recruitment_records set %I = '''', row_version = row_version + 1, updated_at = now(), updated_by = $1 where id = $2', p_kind)
          using v_actor.id, p_record_id;
      end if;
    end if;
  else
    raise exception 'INVALID_KIND' using errcode = 'PT422', detail = 'Loại file không hợp lệ.';
  end if;
  if coalesce(v_old, '') = '' then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy file.';
  end if;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'UPDATE', p_record_id, v_rec.candidate_code,
          jsonb_build_object(v_field, jsonb_build_object('old', v_old, 'new', '')));
  return jsonb_build_object('record', app.file_record_json(p_record_id));
end $$;
revoke all on function public.file_remove(uuid, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.file_remove(uuid, bigint, text, bigint) to service_role;

-- ============ tải xuống: trả drive id + ghi nhật ký DOWNLOAD ============
create or replace function public.file_open(p_actor uuid, p_record_id bigint, p_kind text, p_file_id bigint default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_rec public.recruitment_records;
  f public.record_files;
begin
  select * into v_rec from public.recruitment_records where id = p_record_id;
  if v_rec.id is null or not (v_actor.role = 'admin' or (coalesce(v_rec.pic, '') <> '' and v_rec.pic = v_actor.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng viên.';
  end if;
  select * into f from public.record_files
   where record_id = p_record_id and deleted_at is null
     and (case when p_file_id is not null then id = p_file_id else kind = p_kind end)
   order by uploaded_at desc, id desc limit 1;
  if f.id is null then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy file.';
  end if;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'DOWNLOAD', p_record_id, v_rec.candidate_code,
          jsonb_build_object(case when f.kind = 'cv' then 'cv_file' else f.kind end, jsonb_build_object('old', '', 'new', f.file_name)));
  return jsonb_build_object('drive_file_id', f.drive_file_id, 'file_name', f.file_name, 'mime', f.mime);
end $$;
revoke all on function public.file_open(uuid, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.file_open(uuid, bigint, text, bigint) to service_role;

-- ============ Salary Proposal / Payslips của 1 hồ sơ ============
create or replace function public.file_list(p_actor uuid, p_record_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_rec public.recruitment_records;
begin
  select * into v_rec from public.recruitment_records where id = p_record_id;
  if v_rec.id is null or not (v_actor.role = 'admin' or (coalesce(v_rec.pic, '') <> '' and v_rec.pic = v_actor.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng viên.';
  end if;
  return jsonb_build_object('rank', coalesce(v_rec.rank, ''), 'attachments', coalesce((
    select jsonb_agg(app.file_json(f) order by f.uploaded_at, f.id) from public.record_files f
     where f.record_id = p_record_id and f.kind in ('salary_proposal','payslip') and f.deleted_at is null), '[]'::jsonb));
end $$;
revoke all on function public.file_list(uuid, bigint) from public, anon, authenticated;
grant execute on function public.file_list(uuid, bigint) to service_role;

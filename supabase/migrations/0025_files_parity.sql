-- 0025_files_parity.sql – M7-1 cho khớp hệ cũ (Api.gs hUploadCv_/hUploadDoc_/hDeleteDoc_, Docs.gs *Attachment_):
--  - Xóa / thay file: file cũ vào THÙNG RÁC Drive ngay (như hệ cũ). Các hàm trả `trash` = drive id để Edge bỏ vào thùng rác.
--  - Salary Proposal / Payslips: id dành trước (file_reserve_id) để tên trên Drive có số như hệ cũ ("<…>_Payslip 3.pdf");
--    "Thay" giữ nguyên dòng và số (cập nhật tại chỗ). Nhật ký ATTACHMENT: "Tải lên …", "Thay bằng …", "Tải xuống …", xóa = cũ → ''.
--  - CV, 5 giấy tờ: nhật ký UPDATE theo trường như cũ; tải xuống ghi DOWNLOAD (API_SPEC §4.4, hệ cũ không ghi).
--  - file_set_names: Edge đổi tên file trên Drive khi Mã NV / họ tên đổi (syncDocFiles_) rồi ghi lại tên.

create or replace function public.file_reserve_id() returns bigint
language sql volatile security definer set search_path = ''
as $$ select nextval(pg_get_serial_sequence('public.record_files', 'id')) $$;
revoke all on function public.file_reserve_id() from public, anon, authenticated;
grant execute on function public.file_reserve_id() to service_role;

drop function if exists public.file_attach(uuid, bigint, text, text, text, bigint, text, bigint);

create or replace function public.file_attach(p_actor uuid, p_record_id bigint, p_kind text, p_drive_id text, p_name text,
                                              p_size bigint, p_mime text, p_replace_id bigint default null, p_id bigint default null)
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
  v_trash text[] := '{}';
  v_label text := case p_kind when 'salary_proposal' then 'Salary Proposal' when 'payslip' then 'Payslips' else p_kind end;
begin
  if p_kind not in ('cv','edu_certificate','health_check','id_card','resume','forklift_cert','salary_proposal','payslip') then
    raise exception 'INVALID_KIND' using errcode = 'PT422', detail = 'Loại file không hợp lệ.';
  end if;
  if coalesce(btrim(p_drive_id), '') = '' or coalesce(btrim(p_name), '') = '' then
    raise exception 'VALIDATION_FAILED' using errcode = 'PT422', detail = 'Thiếu thông tin file.';
  end if;
  v_rec := app.file_record(v_actor, p_record_id);

  if p_kind in ('salary_proposal','payslip') then
    if p_replace_id is not null then
      select * into v_file from public.record_files
       where id = p_replace_id and record_id = p_record_id and kind = p_kind and deleted_at is null for update;
      if v_file.id is null then
        raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy file.';
      end if;
      v_old := v_file.file_name;
      v_trash := array[v_file.drive_file_id];
      update public.record_files
         set drive_file_id = btrim(p_drive_id), file_name = btrim(p_name), size = greatest(coalesce(p_size, 0), 0),
             mime = coalesce(p_mime, ''), uploaded_by = v_actor.id, uploaded_at = now()
       where id = v_file.id returning * into v_file;
      v_new := 'Thay bằng ' || v_file.file_name;
    else
      select count(*) into v_count from public.record_files where record_id = p_record_id and kind = p_kind and deleted_at is null;
      if v_count >= 20 then
        raise exception 'TOO_MANY' using errcode = 'PT400', detail = 'Mỗi hồ sơ tối đa 20 file ' || v_label || '. Hãy xóa bớt file cũ.';
      end if;
      if p_id is null then
        insert into public.record_files (record_id, kind, drive_file_id, file_name, size, mime, uploaded_by)
        values (p_record_id, p_kind, btrim(p_drive_id), btrim(p_name), greatest(coalesce(p_size, 0), 0), coalesce(p_mime, ''), v_actor.id)
        returning * into v_file;
      else
        insert into public.record_files (id, record_id, kind, drive_file_id, file_name, size, mime, uploaded_by)
        overriding system value
        values (p_id, p_record_id, p_kind, btrim(p_drive_id), btrim(p_name), greatest(coalesce(p_size, 0), 0), coalesce(p_mime, ''), v_actor.id)
        returning * into v_file;
      end if;
      v_new := 'Tải lên ' || v_file.file_name;
    end if;
    insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
    values (v_actor.id, v_actor.username, v_actor.role, 'ATTACHMENT', p_record_id, v_rec.candidate_code,
            jsonb_build_object(p_kind, jsonb_build_object('old', coalesce(v_old, ''), 'new', v_new)));
  else
    v_field := case when p_kind = 'cv' then 'cv_file' else p_kind end;
    v_old := case when p_kind = 'cv'
                  then coalesce((select file_name from public.record_files where record_id = p_record_id and kind = 'cv' and deleted_at is null
                                  order by uploaded_at desc, id desc limit 1), '')
                  else coalesce(to_jsonb(v_rec) ->> p_kind, '') end;
    with d as (update public.record_files set deleted_at = now()
                where record_id = p_record_id and kind = p_kind and deleted_at is null returning drive_file_id)
    select coalesce(array_agg(drive_file_id), '{}') into v_trash from d;
    -- giấy tờ chuyển từ hệ cũ chỉ có ở cột ("<drive id>|<tên>"), chưa có dòng record_files
    if p_kind <> 'cv' and position('|' in v_old) > 0 and not (split_part(v_old, '|', 1) = any (v_trash)) then
      v_trash := v_trash || split_part(v_old, '|', 1);
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
  end if;

  return jsonb_build_object('file', app.file_json(v_file), 'record', app.file_record_json(p_record_id), 'trash', to_jsonb(v_trash));
end $$;
revoke all on function public.file_attach(uuid, bigint, text, text, text, bigint, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.file_attach(uuid, bigint, text, text, text, bigint, text, bigint, bigint) to service_role;

create or replace function public.file_remove(p_actor uuid, p_record_id bigint, p_kind text, p_file_id bigint default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_rec public.recruitment_records;
  v_old text;
  v_field text;
  v_trash text[] := '{}';
  v_action text := 'UPDATE';
begin
  v_rec := app.file_record(v_actor, p_record_id);
  if p_file_id is not null then
    select kind into p_kind from public.record_files where id = p_file_id and record_id = p_record_id;
  end if;
  if p_kind in ('salary_proposal','payslip') then
    update public.record_files set deleted_at = now()
     where id = p_file_id and record_id = p_record_id and kind = p_kind and deleted_at is null
    returning file_name, array[drive_file_id] into v_old, v_trash;
    v_field := p_kind;
    v_action := 'ATTACHMENT';
  elsif p_kind = 'cv' or p_kind = any (app.file_doc_kinds()) then
    with d as (
      update public.record_files set deleted_at = now()
       where record_id = p_record_id and kind = p_kind and deleted_at is null returning file_name, uploaded_at, id, drive_file_id)
    select (array_agg(file_name order by uploaded_at desc, id desc))[1], coalesce(array_agg(drive_file_id), '{}') into v_old, v_trash from d;
    v_field := case when p_kind = 'cv' then 'cv_file' else p_kind end;
    if p_kind <> 'cv' then
      v_old := coalesce(nullif(to_jsonb(v_rec) ->> p_kind, ''), v_old);
      if position('|' in coalesce(v_old, '')) > 0 and not (split_part(v_old, '|', 1) = any (v_trash)) then
        v_trash := v_trash || split_part(v_old, '|', 1);
      end if;
      if coalesce(to_jsonb(v_rec) ->> p_kind, '') <> '' then
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
  values (v_actor.id, v_actor.username, v_actor.role, v_action, p_record_id, v_rec.candidate_code,
          jsonb_build_object(v_field, jsonb_build_object('old', v_old, 'new', '')));
  return jsonb_build_object('record', app.file_record_json(p_record_id), 'trash', to_jsonb(coalesce(v_trash, '{}')));
end $$;

-- tải xuống: Salary Proposal / Payslips ghi ATTACHMENT "Tải xuống …" như hệ cũ; CV / giấy tờ ghi DOWNLOAD
create or replace function public.file_open(p_actor uuid, p_record_id bigint, p_kind text, p_file_id bigint default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_rec public.recruitment_records;
  f public.record_files;
  v_att boolean;
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
  v_att := f.kind in ('salary_proposal','payslip');
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, case when v_att then 'ATTACHMENT' else 'DOWNLOAD' end, p_record_id, v_rec.candidate_code,
          jsonb_build_object(case when f.kind = 'cv' then 'cv_file' else f.kind end,
                             jsonb_build_object('old', '', 'new', case when v_att then 'Tải xuống ' else '' end || f.file_name)));
  return jsonb_build_object('drive_file_id', f.drive_file_id, 'file_name', f.file_name, 'mime', f.mime);
end $$;

-- các file trên Drive của 1 hồ sơ (giấy tờ + Salary Proposal / Payslips) để Edge đổi tên theo Mã NV / họ tên
create or replace function public.file_drive_list(p_record_id bigint)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'drive_file_id', drive_file_id, 'file_name', file_name) order by id), '[]'::jsonb)
    from public.record_files where record_id = p_record_id and deleted_at is null and kind <> 'cv'
$$;
revoke all on function public.file_drive_list(bigint) from public, anon, authenticated;
grant execute on function public.file_drive_list(bigint) to service_role;

-- ghi lại tên mới (p_items: [{id, file_name}]) – không đụng hồ sơ (cột giấy tờ đã đổi trong cùng lần lưu save_record)
create or replace function public.file_set_names(p_record_id bigint, p_items jsonb)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.record_files f set file_name = i.file_name
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(id bigint, file_name text)
   where f.id = i.id and f.record_id = p_record_id and coalesce(i.file_name, '') <> ''
$$;
revoke all on function public.file_set_names(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.file_set_names(bigint, jsonb) to service_role;

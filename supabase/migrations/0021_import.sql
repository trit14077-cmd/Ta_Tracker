-- 0021_import.sql – M7-4: nhập Excel (ImportExcelView; Api2.gs hImportExisting_, hImportChunk_, hImportFinish_).
-- Trình duyệt đọc file + xem trước; Edge records-import kiểm lại từng dòng bằng shared/ rồi gọi import_records (service_role):
-- mỗi lô 1 giao dịch, KHÔNG ghi đè (mã đã có => dòng bị từ chối), gắn import_batch_id (để sau này rollback theo lô),
-- nhật ký IMPORT mỗi dòng như hệ cũ: "Nhập từ Excel (<tên> - PIC: <pic>) - sheet "…", dòng N".
-- Chỉ Admin (như hệ cũ: route { admin: true }).

alter table public.import_batches add column if not exists created_by uuid references public.profiles(id);

-- ============ mã / tên / SĐT mọi hồ sơ (= hImportExisting_) để trình duyệt phát hiện trùng ============
create or replace function public.import_existing()
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
begin
  perform app.require_admin();
  return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_array(r.candidate_code, r.full_name, r.phone) order by r.id)
                                                from public.recruitment_records r), '[]'::jsonb));
end $$;
revoke all on function public.import_existing() from public, anon;
grant execute on function public.import_existing() to authenticated;

-- ============ ghi 1 lô (chỉ service_role, từ Edge) ============
-- p_rows: [{index, values:{cột ghi được + candidate_code + pic}, created_at, sheet, row_number}] đã được Edge kiểm.
-- Trả {imported, rejected:[{index, errors}]}.
create or replace function public.import_records(p_actor uuid, p_batch_id bigint, p_rows jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  e jsonb;
  v jsonb;
  v_code text;
  v_pic text;
  v_cols text;
  v_id bigint;
  v_imported int := 0;
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được nhập Excel.';
  end if;
  if not exists (select 1 from public.import_batches where id = p_batch_id) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy lô nhập.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('import', 0));   -- 2 lô cùng lúc không chen mã của nhau

  for e in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v := coalesce(e -> 'values', '{}'::jsonb);
    v_code := btrim(coalesce(v ->> 'candidate_code', ''));
    v_pic := nullif(btrim(coalesce(v ->> 'pic', '')), '');
    if v_code = '' then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('index', e -> 'index', 'errors', jsonb_build_object('candidate_code', 'Thiếu mã ứng viên.')));
      continue;
    end if;
    if exists (select 1 from public.recruitment_records where candidate_code = v_code) then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('index', e -> 'index',
                      'errors', jsonb_build_object('candidate_code', 'Mã ứng viên "' || v_code || '" đã tồn tại (không ghi đè).')));
      continue;
    end if;
    if v_pic is not null and not exists (select 1 from public.pics where code = v_pic) then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('index', e -> 'index',
                      'errors', jsonb_build_object('pic', 'Mã PIC "' || v_pic || '" không có trong danh mục PIC.')));
      continue;
    end if;
    select string_agg(format('%I', k), ', ') into v_cols
      from jsonb_object_keys(v) k where k = any (public.rr_writable_columns());
    execute format(
      'insert into public.recruitment_records (%s candidate_code, pic, import_batch_id, created_at, created_by, updated_by)
       select %s $2, $3, $4, coalesce($5, now()), $6, $6 from jsonb_populate_record(null::public.recruitment_records, $1) returning id',
      coalesce(v_cols || ',', ''), coalesce(v_cols || ',', ''))
      into v_id using v, v_code, v_pic, p_batch_id, nullif(e ->> 'created_at', '')::timestamptz, v_actor.id;
    update public.recruitment_records set applicant_id = public.link_applicant(phone, full_name) where id = v_id;
    insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
    values (v_actor.id, v_actor.username, v_actor.role, 'IMPORT', v_id, v_code,
            jsonb_build_object('ALL', jsonb_build_object('old', '', 'new',
              'Nhập từ Excel (' || coalesce(v ->> 'full_name', '') || ' - PIC: ' || coalesce(v_pic, '') || ')'
              || case when coalesce(e ->> 'sheet', '') <> '' then ' - sheet "' || (e ->> 'sheet') || '", dòng ' || coalesce(e ->> 'row_number', '') else '' end)));
    v_imported := v_imported + 1;
  end loop;
  update public.import_batches set row_count = row_count + v_imported where id = p_batch_id;
  return jsonb_build_object('imported', v_imported, 'rejected', v_rejected);
end $$;
revoke all on function public.import_records(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.import_records(uuid, bigint, jsonb) to service_role;

-- ============ kết thúc lô (= hImportFinish_): 1 dòng nhật ký tổng ============
create or replace function public.import_finish(p_actor uuid, p_batch_id bigint, p_file text, p_imported int, p_invalid int,
                                                p_duplicates int, p_rejected int)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_note text := 'Nhập file "' || coalesce(p_file, '') || '": ' || coalesce(p_imported, 0) || ' dòng thành công, '
                 || coalesce(p_invalid, 0) || ' dòng lỗi bị bỏ qua, ' || coalesce(p_duplicates, 0) || ' dòng trùng hoàn toàn bỏ qua, '
                 || coalesce(p_rejected, 0) || ' dòng bị máy chủ từ chối.';
begin
  if v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được nhập Excel.';
  end if;
  if p_batch_id is not null then
    update public.import_batches set note = v_note where id = p_batch_id;
  end if;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'IMPORT', null, '', jsonb_build_object('BATCH', jsonb_build_object('old', '', 'new', v_note)));
end $$;
revoke all on function public.import_finish(uuid, bigint, text, int, int, int, int) from public, anon, authenticated;
grant execute on function public.import_finish(uuid, bigint, text, int, int, int, int) to service_role;

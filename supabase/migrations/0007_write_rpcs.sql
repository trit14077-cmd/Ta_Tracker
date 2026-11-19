-- 0007_write_rpcs.sql (DEV) – M2-6: RPC ghi hồ sơ (PO chốt 19/11/2026: SECURITY DEFINER, tự kiểm quyền bên trong).
-- Luồng ghi: Edge records-save xác thực JWT -> validate bằng shared/ (validateAndComputeCandidate, lockedFieldKeys,
-- moveChanges) -> gọi RPC bằng service_role, truyền p_actor = id người dùng lấy từ JWT đã xác thực.
-- create_record / save_record CHỈ service_role được EXECUTE: người dùng không gọi thẳng được qua PostgREST để bỏ qua
-- bước validate (D-02). next_candidate_code chỉ là gợi ý mã nên authenticated được gọi.
-- Mã lỗi: RAISE với SQLSTATE 'PTxxx' => PostgREST trả HTTP xxx; message = mã lỗi API_SPEC.

-- ============ cột ghi được qua RPC ============
-- Cột hồ sơ người dùng (qua Edge) được ghi. Không gồm meta (id, row_version, is_archived, created_*, updated_*,
-- applicant_id, import_batch_id, legacy_id, legacy_code) và không gồm candidate_code, pic (xử lý riêng).
create or replace function public.rr_writable_columns() returns text[]
language sql immutable set search_path = ''
as $$
  select array[
    'full_name','phone','email','position','rank','region','location','unit','dept','site','sub_source',
    'r1_date','r1_time','r1_status','r1_sub_status','r1_note','r1_cdd_fb',
    'r2_date','r2_time','r2_status','r2_sub_status','r2_note','r2_cdd_fb',
    'ob_date','ob_status','ob_sub_status','hire_type','ob_note',
    'basic_salary','meal_allowance','fmcg_allowance','attraction_allowance','nightshift_allowance',
    'probation_pct','probation_period','contract_signed_date','emp_id',
    'doc_099_250','dept_confirm','ob_mail','probation_contract_type','probation_contract','drive_upload',
    'edu_certificate','health_check','id_card','resume','doc_note',
    'emp_status','attrition_date','attrition_reason','attrition_sub_reason','attrition_note','cutoff','cutoff_mail',
    'gender','birth','ethnicity','address','cv_link','forklift_cert',
    'contract_sign_status','salary_pay_status','wd_process','wd_step','wd_status','pending_at','wd_deadline','wd_note',
    'education_level','experience_years','experience_summary','r2_interviewer','current_salary','salary_expectation',
    'source','ob_month'
  ]::text[]
$$;
-- Field tự tính không lưu (DATABASE_SCHEMA §8): bỏ qua nếu Edge gửi kèm.
create or replace function public.rr_ignored_keys() returns text[]
language sql immutable set search_path = ''
as $$ select array['tenor','cv_file','id','row_version','created_at','updated_at']::text[] $$;

-- ============ người thực hiện ============
create or replace function public.rpc_actor(p_actor uuid) returns public.profiles
language plpgsql stable security definer set search_path = ''
as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = p_actor and active;
  if v.id is null then raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Tài khoản không tồn tại hoặc đã bị khóa.'; end if;
  return v;
end $$;

-- ============ mã ứng viên (giống shared/candidateCode.ts) ============
-- Mã = tiền tố PIC (phần trước "-") + "00" + số; số = lớn nhất trong các mã của PIC đó + 1, tăng tiếp tới khi chưa ai dùng.
create or replace function public.gen_candidate_code(p_pic text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_prefix text := btrim(split_part(coalesce(p_pic, ''), '-', 1));
  v_base text;
  v_max bigint;
  v_n bigint;
  v_code text;
begin
  if v_prefix = '' then return ''; end if;
  v_base := v_prefix || '00';
  select coalesce(max(substr(candidate_code, length(v_base) + 1)::bigint), 0) into v_max
    from public.recruitment_records
   where pic = p_pic and starts_with(candidate_code, v_base)
     and substr(candidate_code, length(v_base) + 1) ~ '^[0-9]+$';
  v_n := v_max + 1;
  loop
    v_code := v_base || lpad(v_n::text, 2, '0');
    exit when not exists (select 1 from public.recruitment_records where candidate_code = v_code);
    v_n := v_n + 1;
  end loop;
  return v_code;
end $$;

-- Gợi ý mã kế tiếp (API GET /candidates/next-code). TA chỉ hỏi được cho PIC của mình.
create or replace function public.next_candidate_code(p_pic text) returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not app.is_admin() and p_pic is distinct from app.my_pic() then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'TA chỉ lấy được mã cho PIC của mình.';
  end if;
  return public.gen_candidate_code(p_pic);
end $$;

-- ============ liên kết người (D-04b) ============
-- Cùng SĐT (đã chuẩn hóa, khác rỗng) VÀ cùng tên chuẩn hóa (bỏ dấu, chữ thường, gộp khoảng trắng) => cùng applicant.
create or replace function public.link_applicant(p_phone text, p_full_name text) returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_name text := btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_full_name, ''))), '\s+', ' ', 'g'));
  v_id bigint;
begin
  if v_phone is null then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended('applicant:' || v_phone, 0));
  select id into v_id from public.applicants where phone_norm = v_phone and name_norm = v_name order by id limit 1;
  if v_id is null then
    insert into public.applicants (phone_norm, name_norm) values (v_phone, v_name) returning id into v_id;
  end if;
  return v_id;
end $$;

-- ============ tạo hồ sơ ============
-- p_values: các field đã validate (key FIELD_CATALOG). p_meta: {from_application_id?}
-- TA: pic = PIC của TA, mã luôn tự sinh (mã gõ tay bị bỏ qua). Admin: pic tùy chọn; có pic => mã tự sinh, không pic => phải có mã.
create or replace function public.create_record(p_actor uuid, p_values jsonb, p_meta jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_pic text;
  v_code text;
  v_bad text;
  v_cols text;
  v_id bigint;
  v_row public.recruitment_records;
  v_app bigint := nullif(p_meta ->> 'from_application_id', '')::bigint;
begin
  select string_agg(k, ', ') into v_bad from jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) k
   where not (k = any (public.rr_writable_columns() || public.rr_ignored_keys() || array['candidate_code','pic']));
  if v_bad is not null then raise exception 'INVALID_FIELD' using errcode = 'PT422', detail = v_bad; end if;

  if v_actor.role = 'admin' then
    v_pic := nullif(btrim(coalesce(p_values ->> 'pic', '')), '');
  else
    v_pic := v_actor.pic_code;
  end if;

  if v_pic is not null then
    perform pg_advisory_xact_lock(hashtextextended('candcode:' || v_pic, 0));  -- tạo đồng thời cùng PIC không trùng mã
    v_code := public.gen_candidate_code(v_pic);
  else
    v_code := btrim(coalesce(p_values ->> 'candidate_code', ''));
    if v_code = '' then raise exception 'VALIDATION_FAILED' using errcode = 'PT422', detail = 'candidate_code: bắt buộc khi hồ sơ chưa có PIC'; end if;
  end if;
  if exists (select 1 from public.recruitment_records where candidate_code = v_code) then
    raise exception 'DUPLICATE_CODE' using errcode = 'PT409', detail = v_code;
  end if;

  select string_agg(format('%I', k), ', ') into v_cols
    from jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) k where k = any (public.rr_writable_columns());

  if v_cols is null then
    insert into public.recruitment_records (candidate_code, pic, created_by, updated_by)
      values (v_code, v_pic, v_actor.id, v_actor.id) returning id into v_id;
  else
    execute format(
      'insert into public.recruitment_records (%s, candidate_code, pic, created_by, updated_by)
       select %s, $2, $3, $4, $4 from jsonb_populate_record(null::public.recruitment_records, $1) returning id',
      v_cols, v_cols)
      into v_id using p_values, v_code, v_pic, v_actor.id;
  end if;

  update public.recruitment_records
     set applicant_id = public.link_applicant(phone, full_name)
   where id = v_id
  returning * into v_row;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'CREATE', v_id, v_code,
          (select coalesce(jsonb_object_agg(k, jsonb_build_object('old', null, 'new', p_values -> k)), '{}'::jsonb)
             from jsonb_object_keys(coalesce(p_values, '{}'::jsonb)) k where k = any (public.rr_writable_columns())));

  if v_app is not null then
    update public.applications
       set status = 'converted', record_id = v_id, handled_by = v_actor.id, handled_at = now()
     where id = v_app and (v_actor.role = 'admin' or pic = v_actor.pic_code);
  end if;

  return to_jsonb(v_row);
end $$;

-- ============ sửa hồ sơ ============
-- p_changes: field đã validate. p_meta: {op: 'patch'|'move'|'archive'|'restore', from_box?, to_box?}
-- Quy tắc: không thấy hồ sơ => NOT_FOUND (không lộ hồ sơ PIC khác); lệch row_version => VERSION_CONFLICT (409, kèm bản
-- hiện tại); chỉ Admin đổi pic, archive, restore. Ghi status_history + 1 dòng audit_logs cho cả lần lưu.
create or replace function public.save_record(p_actor uuid, p_id bigint, p_expected_version int, p_changes jsonb,
                                              p_meta jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_op text := coalesce(p_meta ->> 'op', 'patch');
  v_cur public.recruitment_records;
  v_new public.recruitment_records;
  v_old_j jsonb;
  v_new_j jsonb;
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_bad text;
  v_set text;
  v_diff jsonb;
  k text;
begin
  if v_op not in ('patch','move','archive','restore') then
    raise exception 'INVALID_OP' using errcode = 'PT422', detail = v_op;
  end if;

  select * into v_cur from public.recruitment_records where id = p_id for update;
  if v_cur.id is null
     or not (v_actor.role = 'admin' or (v_cur.pic is not null and v_cur.pic <> '' and v_cur.pic = v_actor.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_cur.row_version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = 'PT409', detail = to_jsonb(v_cur)::text;
  end if;

  select string_agg(k2, ', ') into v_bad from jsonb_object_keys(v_changes) k2
   where not (k2 = any (public.rr_writable_columns() || public.rr_ignored_keys() || array['pic']));
  if v_bad is not null then raise exception 'INVALID_FIELD' using errcode = 'PT422', detail = v_bad; end if;

  if v_changes ? 'pic' and (v_changes ->> 'pic') is distinct from v_cur.pic and v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được đổi PIC.';
  end if;
  if v_op in ('archive','restore') and v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được lưu trữ / khôi phục hồ sơ.';
  end if;

  -- giá trị mới = bản hiện tại phủ bằng changes (đúng kiểu cột nhờ jsonb_populate_record)
  v_new := jsonb_populate_record(v_cur, v_changes - public.rr_ignored_keys());
  if v_op = 'archive' then v_new.is_archived := true; end if;
  if v_op = 'restore' then v_new.is_archived := false; end if;

  v_old_j := to_jsonb(v_cur);
  v_new_j := to_jsonb(v_new);
  select coalesce(jsonb_object_agg(c, jsonb_build_object('old', v_old_j -> c, 'new', v_new_j -> c)), '{}'::jsonb) into v_diff
    from unnest(public.rr_writable_columns() || array['pic','is_archived']) c
   where (v_old_j -> c) is distinct from (v_new_j -> c);

  if v_diff = '{}'::jsonb then
    return v_old_j;  -- không có gì đổi: không tăng version, không ghi log
  end if;

  select string_agg(format('%I = ($1).%I', c, c), ', ') into v_set from jsonb_object_keys(v_diff) c;
  execute format('update public.recruitment_records set %s, row_version = row_version + 1, updated_at = now(), updated_by = $2
                  where id = $3 returning *', v_set)
    into v_new using v_new, v_actor.id, p_id;

  -- lịch sử trạng thái
  for k in select jsonb_object_keys(v_diff) loop
    if k in ('r1_status','r2_status','ob_status') then
      insert into public.status_history (record_id, kind, field_key, from_value, to_value, actor_id)
      values (p_id, 'STATUS', k, coalesce(v_diff -> k ->> 'old', ''), coalesce(v_diff -> k ->> 'new', ''), v_actor.id);
    elsif k = 'pic' then
      insert into public.status_history (record_id, kind, field_key, from_value, to_value, actor_id)
      values (p_id, 'PIC_CHANGE', 'pic', coalesce(v_diff -> k ->> 'old', ''), coalesce(v_diff -> k ->> 'new', ''), v_actor.id);
    end if;
  end loop;
  if v_op = 'move' then
    insert into public.status_history (record_id, kind, from_box, to_box, actor_id)
    values (p_id, 'STAGE_MOVE', p_meta ->> 'from_box', p_meta ->> 'to_box', v_actor.id);
  elsif v_op in ('archive','restore') then
    insert into public.status_history (record_id, kind, field_key, from_value, to_value, actor_id)
    values (p_id, upper(v_op), 'is_archived', (not v_new.is_archived)::text, v_new.is_archived::text, v_actor.id);
  end if;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role,
          case v_op when 'move' then 'STAGE_MOVE' when 'archive' then 'ARCHIVE' when 'restore' then 'RESTORE' else 'UPDATE' end,
          p_id, v_new.candidate_code, v_diff);

  return to_jsonb(v_new);
end $$;

-- ============ quyền chạy ============
revoke all on function public.rr_writable_columns(), public.rr_ignored_keys(), public.rpc_actor(uuid),
  public.gen_candidate_code(text), public.link_applicant(text, text),
  public.create_record(uuid, jsonb, jsonb), public.save_record(uuid, bigint, int, jsonb, jsonb),
  public.next_candidate_code(text)
  from public, anon, authenticated;
grant execute on function public.create_record(uuid, jsonb, jsonb), public.save_record(uuid, bigint, int, jsonb, jsonb)
  to service_role;
grant execute on function public.next_candidate_code(text) to authenticated, service_role;

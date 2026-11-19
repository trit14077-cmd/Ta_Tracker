-- 0009_save_record_parity.sql (DEV) – M4-1, PO chốt 19/11/2026 khi đối chiếu hệ cũ (Api.gs hArchiveCandidate_, hPatchCandidate_):
--  * Lưu trữ / khôi phục: như hệ cũ – TA làm được với hồ sơ đúng PIC của mình, Admin mọi hồ sơ (0007 chỉ cho Admin).
--  * Đổi mã ứng viên khi sửa: CHỈ Admin, mã mới không được trùng (hệ cũ cho mọi người; 0007 chặn hẳn).
-- Thay thân public.save_record (cùng chữ ký, cùng quyền EXECUTE chỉ service_role). Phần còn lại giữ nguyên như 0007.
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
  v_code text;
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
   where not (k2 = any (public.rr_writable_columns() || public.rr_ignored_keys() || array['pic','candidate_code']));
  if v_bad is not null then raise exception 'INVALID_FIELD' using errcode = 'PT422', detail = v_bad; end if;

  if v_changes ? 'pic' and (v_changes ->> 'pic') is distinct from v_cur.pic and v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được đổi PIC.';
  end if;

  if v_changes ? 'candidate_code' then
    v_code := btrim(coalesce(v_changes ->> 'candidate_code', ''));
    if v_code is distinct from v_cur.candidate_code then
      if v_actor.role <> 'admin' then
        raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được đổi mã ứng viên.';
      end if;
      if v_code = '' then
        raise exception 'VALIDATION_FAILED' using errcode = 'PT422', detail = 'candidate_code: không được để trống';
      end if;
      if exists (select 1 from public.recruitment_records where candidate_code = v_code and id <> p_id) then
        raise exception 'DUPLICATE_CODE' using errcode = 'PT409', detail = v_code;
      end if;
    end if;
    v_changes := jsonb_set(v_changes, '{candidate_code}', to_jsonb(v_code));
  end if;

  v_new := jsonb_populate_record(v_cur, v_changes - public.rr_ignored_keys());
  if v_op = 'archive' then v_new.is_archived := true; end if;
  if v_op = 'restore' then v_new.is_archived := false; end if;

  v_old_j := to_jsonb(v_cur);
  v_new_j := to_jsonb(v_new);
  select coalesce(jsonb_object_agg(c, jsonb_build_object('old', v_old_j -> c, 'new', v_new_j -> c)), '{}'::jsonb) into v_diff
    from unnest(public.rr_writable_columns() || array['pic','candidate_code','is_archived']) c
   where (v_old_j -> c) is distinct from (v_new_j -> c);

  if v_diff = '{}'::jsonb then
    return v_old_j;
  end if;

  select string_agg(format('%I = ($1).%I', c, c), ', ') into v_set from jsonb_object_keys(v_diff) c;
  execute format('update public.recruitment_records set %s, row_version = row_version + 1, updated_at = now(), updated_by = $2
                  where id = $3 returning *', v_set)
    into v_new using v_new, v_actor.id, p_id;

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

revoke all on function public.save_record(uuid, bigint, int, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_record(uuid, bigint, int, jsonb, jsonb) to service_role;

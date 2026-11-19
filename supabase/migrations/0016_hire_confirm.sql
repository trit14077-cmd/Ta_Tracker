-- 0016_hire_confirm.sql – M6-2: checklist tuyển + Xác nhận tuyển / Mở lại (Ops.gs: hHireGet_, hHireConfirm_).
-- Theo API_SPEC: xác nhận đi qua Edge records-save {op:"confirm_hire" | "reopen_hire"}; Edge kiểm điều kiện bằng shared/
-- (hiring.ts: đủ điều kiện, đủ 6 mục), rồi gọi hire_confirm (service_role) để ghi trong 1 giao dịch:
--   * khóa checklist (TA không sửa được nữa – RLS hc_update 0005), ghi status_history CONFIRM_HIRE / REOPEN_HIRE + nhật ký HIRING;
--   * xác nhận: OB Status = Accepted (xóa OB sub status) nếu đang trống hoặc Pending – qua save_record (tăng phiên bản,
--     lịch sử, nhật ký như sửa thường), như hệ cũ gọi hPatchCandidate_.
-- Như hệ cũ: hồ sơ KHÔNG bị khóa sửa, chỉ checklist bị khóa; chỉ Admin mở lại.

-- ============ hiring_state: dữ liệu checklist của 1 hồ sơ (người xem được hồ sơ) ============
create or replace function public.hiring_state(p_record_id bigint)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select case when r.id is null then null else jsonb_build_object(
    'items', coalesce(h.items, '{}'::jsonb),
    'confirmed', coalesce(h.confirmed, false),
    'confirmed_by', coalesce(app.username(h.confirmed_by), ''),
    'confirmed_at', coalesce(h.confirmed_at::text, ''),
    'hr_status', coalesce(hr.status, '')) end
  from (select 1) one
  left join public.recruitment_records r on r.id = p_record_id
  left join public.hiring_checklists h on h.record_id = r.id
  left join public.hr_info hr on hr.record_id = r.id
$$;
revoke all on function public.hiring_state(bigint) from public, anon;
grant execute on function public.hiring_state(bigint) to authenticated, service_role;

-- ============ hire_confirm (chỉ service_role, gọi từ Edge records-save) ============
-- p_manual: các mục tick tay phải xong (kiểm lại trong giao dịch để không lệch với lúc Edge kiểm).
create or replace function public.hire_confirm(p_actor uuid, p_id bigint, p_confirm boolean, p_manual text[] default '{}')
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_cur public.recruitment_records;
  v_h public.hiring_checklists;
  v_rec jsonb;
  v_missing text;
  v_ob_updated boolean := false;
begin
  select * into v_cur from public.recruitment_records where id = p_id for update;
  if v_cur.id is null
     or not (v_actor.role = 'admin' or (v_cur.pic is not null and v_cur.pic <> '' and v_cur.pic = v_actor.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404';
  end if;
  if not p_confirm and v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin mới mở lại được xác nhận tuyển.';
  end if;

  insert into public.hiring_checklists (record_id, updated_by) values (p_id, v_actor.id) on conflict (record_id) do nothing;
  select * into v_h from public.hiring_checklists where record_id = p_id for update;

  if p_confirm then
    if v_h.confirmed then
      raise exception 'LOCKED' using errcode = 'PT409', detail = 'Đã xác nhận tuyển rồi.';
    end if;
    select string_agg(k, ', ') into v_missing from unnest(coalesce(p_manual, '{}')) k
     where not coalesce((v_h.items -> k ->> 'done')::boolean, false);
    if v_missing is not null then
      raise exception 'HIRING_INCOMPLETE' using errcode = 'PT400', detail = 'Chưa xác nhận tuyển được, còn thiếu: ' || v_missing || '.';
    end if;
    update public.hiring_checklists
       set confirmed = true, confirmed_by = v_actor.id, confirmed_at = now(), updated_by = v_actor.id, updated_at = now()
     where record_id = p_id;
  else
    update public.hiring_checklists
       set confirmed = false, confirmed_by = null, confirmed_at = null, updated_by = v_actor.id, updated_at = now()
     where record_id = p_id;
  end if;

  insert into public.status_history (record_id, kind, field_key, from_value, to_value, actor_id)
  values (p_id, case when p_confirm then 'CONFIRM_HIRE' else 'REOPEN_HIRE' end, 'confirmed',
          (not p_confirm)::text, p_confirm::text, v_actor.id);
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'HIRING', p_id, v_cur.candidate_code,
          jsonb_build_object('confirmed', jsonb_build_object('old', '', 'new',
            case when p_confirm then 'Xác nhận tuyển' else 'Mở lại xác nhận tuyển' end)));

  -- OB Status theo xác nhận (hệ cũ: chỉ khi trống hoặc Pending), qua đường sửa thường
  if p_confirm and btrim(coalesce(v_cur.ob_status, '')) in ('', 'Pending') then
    v_rec := public.save_record(p_actor, p_id, v_cur.row_version,
                                jsonb_build_object('ob_status', 'Accepted', 'ob_sub_status', ''), '{"op":"patch"}'::jsonb);
    v_ob_updated := true;
  else
    select to_jsonb(r) into v_rec from public.recruitment_records r where r.id = p_id;
  end if;

  return jsonb_build_object('record', v_rec, 'ob_updated', v_ob_updated);
end $$;
revoke all on function public.hire_confirm(uuid, bigint, boolean, text[]) from public, anon, authenticated;
grant execute on function public.hire_confirm(uuid, bigint, boolean, text[]) to service_role;

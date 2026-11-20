-- 0018_hr_info.sql – M6-4: Thông tin nhân sự (HrInfo.gs, HrForm.gs).
-- Ghi HR Info CHỈ qua Edge hr-info-save (validate bằng shared/hrInfoRules – API_SPEC §4.6) -> hr_info_write (service_role):
-- 1 giao dịch khóa dòng, kiểm lại trạng thái, ghi nhật ký HRINFO (chỉ tên trường, không ghi giá trị – như hệ cũ).
-- Vì vậy thu quyền INSERT/UPDATE hr_info trực tiếp của authenticated (0005 cấp + RLS) để không ai ghi vòng qua validate.
-- PO chốt 20/11/2026: giữ như hệ cũ – TA phụ trách hồ sơ và Admin đều xác nhận / mở lại được.

revoke insert, update on public.hr_info from authenticated;

-- ============ trùng CCCD (= hrDuplicates_ của hệ cũ) ============
-- Cùng số CCCD trên hồ sơ khác (không lưu trữ). Admin: mã + PIC; TA: mã hồ sơ của mình, hồ sơ PIC khác chỉ đếm.
-- SECURITY DEFINER (phải đếm cả hồ sơ PIC khác) nhưng chỉ trả khi người gọi xem được hồ sơ.
create or replace function public.hr_duplicates(p_record_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pic text;
  v_idn text;
  v_admin boolean := app.is_admin();
  v_my text := app.my_pic();
  res jsonb;
begin
  select r.pic into v_pic from public.recruitment_records r where r.id = p_record_id;
  if not found or not app.can_see_record(v_pic) then
    return jsonb_build_object('count', 0, 'own', '[]'::jsonb, 'others', 0, 'with', '[]'::jsonb);
  end if;
  select h.id_number into v_idn from public.hr_info h where h.record_id = p_record_id;
  if coalesce(v_idn, '') = '' then
    return jsonb_build_object('count', 0, 'own', '[]'::jsonb, 'others', 0, 'with', '[]'::jsonb);
  end if;
  with d as (
    select r.candidate_code, coalesce(r.pic, '') as pic
      from public.hr_info h join public.recruitment_records r on r.id = h.record_id
     where h.id_number = v_idn and h.record_id <> p_record_id and not r.is_archived
  )
  select jsonb_build_object(
    'count', (select count(*) from d),
    'own', case when v_admin then '[]'::jsonb
                else coalesce((select jsonb_agg(candidate_code order by candidate_code) from d where pic <> '' and pic = v_my), '[]'::jsonb) end,
    'others', case when v_admin then 0 else (select count(*) from d where not (pic <> '' and pic = coalesce(v_my, ''))) end,
    'with', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('code', candidate_code, 'pic', pic) order by candidate_code) from d), '[]'::jsonb)
                 else '[]'::jsonb end)
  into res;
  return res;
end $$;
revoke all on function public.hr_duplicates(bigint) from public, anon;
grant execute on function public.hr_duplicates(bigint) to authenticated, service_role;

-- ============ đọc HR Info của 1 hồ sơ (= hHrGet_, phần info + duplicates; eligible tính ở trình duyệt) ============
create or replace function public.hr_info_get(p_record_id bigint)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select case when r.id is null then null else jsonb_build_object(
    'info', case when h.record_id is null then null else jsonb_build_object(
              'data', h.data, 'status', h.status,
              'updated_by', app.username(h.updated_by), 'updated_at', h.updated_at,
              'verified_by', coalesce(app.username(h.verified_by), ''), 'verified_at', coalesce(h.verified_at::text, '')) end,
    'duplicates', public.hr_duplicates(r.id)) end
  from (select 1) one
  left join public.recruitment_records r on r.id = p_record_id
  left join public.hr_info h on h.record_id = r.id
$$;
revoke all on function public.hr_info_get(bigint) from public, anon;
grant execute on function public.hr_info_get(bigint) to authenticated, service_role;

-- ============ ghi HR Info (chỉ service_role, gọi từ Edge hr-info-save) ============
-- p_op: save (p_status draft|submitted, p_data, p_id_number) | verify | reopen. p_expect_data: dữ liệu Edge đã kiểm khi
-- xác nhận – nếu trong lúc đó người khác sửa thì báo CHANGED (không xác nhận dữ liệu chưa kiểm).
create or replace function public.hr_info_write(p_actor uuid, p_id bigint, p_op text, p_status text default null,
                                                p_data jsonb default null, p_id_number text default '', p_audit text default '',
                                                p_expect_data jsonb default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_cur public.recruitment_records;
  v_h public.hr_info;
begin
  select * into v_cur from public.recruitment_records where id = p_id for update;
  if v_cur.id is null
     or not (v_actor.role = 'admin' or (v_cur.pic is not null and v_cur.pic <> '' and v_cur.pic = v_actor.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404';
  end if;
  select * into v_h from public.hr_info where record_id = p_id for update;

  if p_op = 'save' then
    if p_status not in ('draft', 'submitted') or p_data is null then
      raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'Trạng thái / dữ liệu không hợp lệ.';
    end if;
    if v_h.status = 'verified' then raise exception 'LOCKED' using errcode = 'PT409'; end if;
    insert into public.hr_info (record_id, data, status, id_number, updated_by, updated_at, verified_by, verified_at)
    values (p_id, p_data, p_status, coalesce(p_id_number, ''), v_actor.id, now(), null, null)
    on conflict (record_id) do update
      set data = excluded.data, status = excluded.status, id_number = excluded.id_number,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at, verified_by = null, verified_at = null;
  elsif p_op = 'verify' then
    if v_h.record_id is null then raise exception 'NO_HR_INFO' using errcode = 'PT404'; end if;
    if v_h.status = 'verified' then raise exception 'LOCKED' using errcode = 'PT409', detail = 'Thông tin nhân sự đã được xác nhận.'; end if;
    if p_expect_data is distinct from v_h.data then raise exception 'CHANGED' using errcode = 'PT409'; end if;
    update public.hr_info set status = 'verified', verified_by = v_actor.id, verified_at = now(), updated_by = v_actor.id, updated_at = now()
     where record_id = p_id;
  elsif p_op = 'reopen' then
    if v_h.record_id is null then raise exception 'NO_HR_INFO' using errcode = 'PT404'; end if;
    if v_h.status <> 'verified' then raise exception 'NOT_VERIFIED' using errcode = 'PT409'; end if;
    update public.hr_info set status = 'submitted', verified_by = null, verified_at = null, updated_by = v_actor.id, updated_at = now()
     where record_id = p_id;
  else
    raise exception 'INVALID_OP' using errcode = 'PT422', detail = p_op;
  end if;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'HRINFO', p_id, v_cur.candidate_code,
          jsonb_build_object('hr_info', jsonb_build_object('old', '', 'new', coalesce(p_audit, ''))));

  select * into v_h from public.hr_info where record_id = p_id;
  return jsonb_build_object(
    'data', v_h.data, 'status', v_h.status, 'updated_by', v_actor.username, 'updated_at', v_h.updated_at,
    'verified_by', coalesce(app.username(v_h.verified_by), ''), 'verified_at', coalesce(v_h.verified_at::text, ''));
end $$;
revoke all on function public.hr_info_write(uuid, bigint, text, text, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hr_info_write(uuid, bigint, text, text, jsonb, text, text, jsonb) to service_role;

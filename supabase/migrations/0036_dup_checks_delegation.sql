-- 0036: kiểm trùng SĐT / CCCD tính cả hồ sơ của các PIC được ủy quyền (TA3 quản lý TA6, TA8, TA10).
-- Trước đây check_phone, check_cccd và hr_duplicates chỉ coi "của mình" = đúng mã PIC của người đăng nhập (app.my_pic()),
-- nên TA3 thấy hồ sơ của TA6/8/10 là "(ẩn) Ứng viên của PIC khác" dù TA3 xem được các hồ sơ đó.
-- Sửa: dùng app.can_manage_pic(pic) (mã PIC của mình + PIC được ủy quyền). Admin và TA không có ủy quyền: hành vi không đổi.

create or replace function public.check_phone(p_phone text, p_exclude_id bigint default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('duplicates', coalesce(jsonb_agg(item order by rid desc), '[]'::jsonb))
  from (
    select r.id as rid,
           case when app.is_admin() or app.can_manage_pic(r.pic)
             then jsonb_build_object('id', r.id, 'candidate_code', r.candidate_code, 'full_name', r.full_name, 'pic', r.pic,
                                     'position', r.position, 'created_at', r.created_at)
             else jsonb_build_object('id', 0, 'candidate_code', '(ẩn)', 'full_name', 'Ứng viên của PIC khác', 'pic', '',
                                     'position', '', 'created_at', '')
           end as item
      from public.recruitment_records r
     where btrim(coalesce(p_phone, '')) <> '' and r.phone = btrim(p_phone)
       and (p_exclude_id is null or r.id <> p_exclude_id) and not r.is_archived
     order by r.id desc
     limit 10
  ) x
$$;

create or replace function public.check_cccd(p_id_number text, p_exclude_id bigint default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('duplicates', coalesce(jsonb_agg(item order by rid desc), '[]'::jsonb))
  from (
    select r.id as rid,
           case when app.is_admin() or app.can_manage_pic(r.pic)
             then jsonb_build_object('id', r.id, 'candidate_code', r.candidate_code, 'full_name', r.full_name, 'pic', r.pic,
                                     'position', r.position, 'created_at', r.created_at)
             else jsonb_build_object('id', 0, 'candidate_code', '(ẩn)', 'full_name', 'Ứng viên của PIC khác', 'pic', '',
                                     'position', '', 'created_at', '')
           end as item
      from public.hr_info h join public.recruitment_records r on r.id = h.record_id
     where btrim(coalesce(p_id_number, '')) <> '' and h.id_number = btrim(p_id_number)
       and (p_exclude_id is null or r.id <> p_exclude_id) and not r.is_archived
     order by r.id desc
     limit 10
  ) x
$$;

create or replace function public.hr_duplicates(p_record_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pic text;
  v_idn text;
  v_admin boolean := app.is_admin();
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
    select r.candidate_code, coalesce(r.pic, '') as pic, app.can_manage_pic(r.pic) as mine
      from public.hr_info h join public.recruitment_records r on r.id = h.record_id
     where h.id_number = v_idn and h.record_id <> p_record_id and not r.is_archived
  )
  select jsonb_build_object(
    'count', (select count(*) from d),
    'own', case when v_admin then '[]'::jsonb
                else coalesce((select jsonb_agg(candidate_code order by candidate_code) from d where mine), '[]'::jsonb) end,
    'others', case when v_admin then 0 else (select count(*) from d where not mine) end,
    'with', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('code', candidate_code, 'pic', pic) order by candidate_code) from d), '[]'::jsonb)
                 else '[]'::jsonb end)
  into res;
  return res;
end $$;

revoke all on function public.check_phone(text, bigint), public.check_cccd(text, bigint), public.hr_duplicates(bigint) from public, anon;
grant execute on function public.check_phone(text, bigint), public.check_cccd(text, bigint), public.hr_duplicates(bigint) to authenticated, service_role;

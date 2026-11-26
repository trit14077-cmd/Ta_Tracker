-- 0037: kiểm trùng email ứng viên (giống check_phone: hồ sơ của PIC không quản lý thì ẩn thông tin).
-- So khớp không phân biệt hoa/thường, bỏ khoảng trắng đầu/cuối.

create or replace function public.check_email(p_email text, p_exclude_id bigint default null) returns jsonb
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
     where btrim(coalesce(p_email, '')) <> '' and lower(btrim(r.email)) = lower(btrim(p_email))
       and (p_exclude_id is null or r.id <> p_exclude_id) and not r.is_archived
     order by r.id desc
     limit 10
  ) x
$$;

revoke all on function public.check_email(text, bigint) from public, anon;
grant execute on function public.check_email(text, bigint) to authenticated, service_role;

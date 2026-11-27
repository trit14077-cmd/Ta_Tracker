-- Task tracking #14: kiểm trùng Mã nhân viên (Emp_ID / MSNV) khi nhập hồ sơ.
-- Giống check_email (0037): chỉ CẢNH BÁO, không chặn lưu (nhân sự nghỉ rồi vào lại có thể giữ mã cũ).
-- Hồ sơ thuộc PIC mình không quản lý: chỉ báo "Ứng viên của PIC khác", không lộ tên/mã.

create or replace function public.check_emp_id(p_emp_id text, p_exclude_id bigint default null) returns jsonb
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
     where btrim(coalesce(p_emp_id, '')) <> '' and lower(btrim(r.emp_id)) = lower(btrim(p_emp_id))
       and (p_exclude_id is null or r.id <> p_exclude_id) and not r.is_archived
     order by r.id desc
     limit 10
  ) x
$$;
revoke all on function public.check_emp_id(text, bigint) from public, anon;
grant execute on function public.check_emp_id(text, bigint) to authenticated, service_role;

-- Tra nhanh theo Emp_ID (bỏ dòng trống).
create index if not exists recruitment_records_emp_id_idx
  on public.recruitment_records (lower(btrim(emp_id))) where btrim(emp_id) <> '';

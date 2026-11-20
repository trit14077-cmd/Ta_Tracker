-- 0019_audit_list.sql – M6-5: màn Nhật ký (AuditLogView; Api2.gs hListAudit_).
-- Hệ cũ ghi MỖI TRƯỜNG ĐỔI MỘT DÒNG (field_key, old_value, new_value); hệ mới ghi mỗi thao tác 1 dòng, các trường trong
-- changes = {khóa: {old, new}}. list_audit trải changes thành từng dòng như cũ để giao diện cũ dùng nguyên văn:
--   * CREATE (create_record ghi mọi giá trị) -> 1 dòng "ALL": "Tạo mới hồ sơ ứng viên (<tên> - PIC: <pic>)" như hệ cũ;
--   * changes rỗng -> 1 dòng trường trống; giá trị không có dạng {old,new} (vd. admin-users) -> new = giá trị.
-- Quyền xem như hệ cũ: Admin tất cả; TA nhật ký hồ sơ PIC mình (RLS al_read 0005) + nhật ký do chính mình làm.

create policy al_read_own on public.audit_logs for select to authenticated
  using (actor_id = (select auth.uid()));

create or replace function public.list_audit(p_page int default 1, p_page_size int default 50, p_code text default '',
                                             p_actor text default '', p_action text default '')
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with prm as (
    select greatest(1, coalesce(p_page, 1)) as pg,
           least(200, greatest(20, coalesce(p_page_size, 50))) as sz,
           '%' || replace(replace(replace(lower(btrim(coalesce(p_code, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as code_like,
           '%' || replace(replace(replace(lower(btrim(coalesce(p_actor, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as actor_like,
           btrim(coalesce(p_code, '')) <> '' as by_code, btrim(coalesce(p_actor, '')) <> '' as by_actor,
           btrim(coalesce(p_action, '')) as act
  ), a as (
    select l.* from public.audit_logs l, prm
     where (not prm.by_code or lower(l.candidate_code) like prm.code_like)
       and (not prm.by_actor or lower(l.actor_username) like prm.actor_like)
       -- ô lọc cũ: "ARCHIVE (Lưu trữ / Khôi phục)", "USER (Tài khoản)" -> gồm RESTORE và USER_CREATE/UPDATE/RESET_PASSWORD
       and (prm.act = '' or l.action = prm.act
            or (prm.act = 'ARCHIVE' and l.action = 'RESTORE')
            or (prm.act = 'USER' and l.action like 'USER\_%'))
  ), x as (
    -- CREATE: 1 dòng tóm tắt
    select a.id, 'ALL'::text as field_key, ''::text as old_value,
           'Tạo mới hồ sơ ứng viên (' || coalesce(a.changes -> 'full_name' ->> 'new', '') || ' - PIC: '
             || coalesce(a.changes -> 'pic' ->> 'new', (select r.pic from public.recruitment_records r where r.id = a.record_id), '') || ')' as new_value
      from a where a.action = 'CREATE'
    union all
    -- thao tác khác: mỗi khóa của changes 1 dòng
    select a.id, coalesce(e.key, ''),
           case when jsonb_typeof(e.value) = 'object' and (e.value ? 'old' or e.value ? 'new') then coalesce(e.value ->> 'old', '') else '' end,
           case when jsonb_typeof(e.value) = 'object' and (e.value ? 'old' or e.value ? 'new') then coalesce(e.value ->> 'new', '')
                when jsonb_typeof(e.value) = 'string' then e.value #>> '{}'
                when e.value is null then ''
                else e.value::text end
      from a left join lateral jsonb_each(case when jsonb_typeof(a.changes) = 'object' then a.changes else '{}'::jsonb end) e on true
     where a.action <> 'CREATE'
  ), page as (
    select x.*, a.actor_username, a.actor_role, a.action, a.candidate_code, a.at
      from x join a on a.id = x.id
     order by x.id desc, x.field_key
     offset ((select pg from prm) - 1) * (select sz from prm) limit (select sz from prm)
  ), tot as (select count(*) as n from x)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'actor_username', p.actor_username, 'actor_role', p.actor_role, 'action', p.action,
        'candidate_code', p.candidate_code, 'field_key', p.field_key, 'old_value', p.old_value, 'new_value', p.new_value,
        'created_at', p.at) order by p.id desc, p.field_key) from page p), '[]'::jsonb),
    'total', (select n from tot),
    'page', (select pg from prm),
    'pageSize', (select sz from prm),
    'totalPages', greatest(1, ceil((select n from tot)::numeric / (select sz from prm))::int))
$$;
revoke all on function public.list_audit(int, int, text, text, text) from public, anon;
grant execute on function public.list_audit(int, int, text, text, text) to authenticated, service_role;

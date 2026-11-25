-- 0034_delegation_perf.sql – sửa hiệu năng của 0032: policy gọi hàm theo từng dòng làm mất index theo pic.
-- Tính một lần danh sách PIC của người dùng (mình + được ủy quyền) rồi so khớp "pic = any((select ...))" như
-- "pic = (select app.my_pic())" trước đây (InitPlan, dùng được index).

create or replace function app.my_pics() returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(x), '{}'::text[]) from (
    select app.my_pic() as x where app.my_pic() is not null
    union
    select d.managed_pic from public.pic_delegations d where d.manager_pic = app.my_pic()
  ) s
$$;
revoke all on function app.my_pics() from public, anon;
grant execute on function app.my_pics() to authenticated, service_role;

create or replace function app.can_manage_pic(p_pic text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_pic is not null and p_pic <> '' and p_pic = any (app.my_pics()) $$;

drop policy if exists rr_read on public.recruitment_records;
create policy rr_read on public.recruitment_records for select to authenticated
  using ((select app.is_admin()) or (pic is not null and pic <> '' and pic = any ((select app.my_pics()))));

drop policy if exists ap_read on public.applications;
create policy ap_read on public.applications for select to authenticated
  using ((select app.is_admin()) or (pic is not null and pic = any ((select app.my_pics()))));
drop policy if exists ap_update on public.applications;
create policy ap_update on public.applications for update to authenticated
  using ((select app.is_admin()) or (pic is not null and pic = any ((select app.my_pics()))))
  with check ((select app.is_admin()) or (pic is not null and pic = any ((select app.my_pics()))));

drop policy if exists tk_update on public.tasks;
create policy tk_update on public.tasks for update to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = tasks.record_id and r.pic = any ((select app.my_pics())))))
  with check ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = tasks.record_id and r.pic = any ((select app.my_pics())))));
drop policy if exists tk_delete on public.tasks;
create policy tk_delete on public.tasks for delete to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = tasks.record_id and r.pic = any ((select app.my_pics())))));

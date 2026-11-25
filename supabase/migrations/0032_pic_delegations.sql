-- 0032_pic_delegations.sql – TA quản lý nhóm: TA3 xem/sửa hồ sơ của TA6, TA8, TA10 và tạo tài khoản Intern.
-- Bảng pic_delegations (manager_pic -> managed_pic). Admin quản lý qua SQL/service_role; TA chỉ đọc dòng của mình.
-- Không đổi role: người quản lý vẫn là 'pic'. Chỉ mở rộng các điểm kiểm tra "pic = my_pic()".

create table if not exists public.pic_delegations (
  manager_pic text not null references public.pics(code) on update cascade on delete cascade,
  managed_pic text not null references public.pics(code) on update cascade on delete cascade,
  can_create_interns boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (manager_pic, managed_pic),
  check (manager_pic <> managed_pic)
);
alter table public.pic_delegations enable row level security;
create policy pd_read on public.pic_delegations for select to authenticated
  using ((select app.is_admin()) or manager_pic = (select app.my_pic()));
grant select on public.pic_delegations to authenticated;
grant all on public.pic_delegations to service_role;

-- p_pic có thuộc phạm vi của người quản lý p_manager không (chính họ hoặc được ủy quyền).
create or replace function app.manages(p_manager text, p_pic text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_pic is not null and p_pic <> '' and p_manager is not null and p_manager <> ''
     and (p_pic = p_manager
          or exists (select 1 from public.pic_delegations d where d.manager_pic = p_manager and d.managed_pic = p_pic))
$$;
create or replace function app.can_manage_pic(p_pic text) returns boolean
language sql stable security definer set search_path = ''
as $$ select app.manages(app.my_pic(), p_pic) $$;
revoke all on function app.manages(text, text), app.can_manage_pic(text) from public, anon;
grant execute on function app.manages(text, text), app.can_manage_pic(text) to authenticated, service_role;

create or replace function app.can_see_record(p_pic text) returns boolean language sql stable security definer set search_path = ''
  as $$ select app.is_admin() or app.can_manage_pic(p_pic) $$;
create or replace function app.can_see_app(p_pic text) returns boolean language sql stable security definer set search_path = ''
  as $$ select app.is_admin() or app.can_manage_pic(p_pic) $$;

create or replace function public.can_view_target(p_pic text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_admin()
      or app.can_manage_pic(p_pic)
      or exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.active and p.can_view_all_targets)
$$;

-- Policy
drop policy if exists rr_read on public.recruitment_records;
create policy rr_read on public.recruitment_records for select to authenticated
  using ((select app.is_admin()) or (pic is not null and pic <> '' and (select app.can_manage_pic(pic))));

drop policy if exists ap_read on public.applications;
create policy ap_read on public.applications for select to authenticated
  using ((select app.is_admin()) or (pic is not null and (select app.can_manage_pic(pic))));
drop policy if exists ap_update on public.applications;
create policy ap_update on public.applications for update to authenticated
  using ((select app.is_admin()) or (pic is not null and (select app.can_manage_pic(pic))))
  with check ((select app.is_admin()) or (pic is not null and (select app.can_manage_pic(pic))));

drop policy if exists tk_update on public.tasks;
create policy tk_update on public.tasks for update to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = tasks.record_id and (select app.can_manage_pic(r.pic)))))
  with check ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = tasks.record_id and (select app.can_manage_pic(r.pic)))));
drop policy if exists tk_delete on public.tasks;
create policy tk_delete on public.tasks for delete to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = tasks.record_id and (select app.can_manage_pic(r.pic)))));

-- save_record (ghi qua service_role, auth.uid() null): kiểm tra theo pic_code của actor.
do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'save_record';
  n := replace(d, 'v_cur.pic <> '''' and v_cur.pic = v_actor.pic_code)', 'v_cur.pic <> '''' and app.manages(v_actor.pic_code, v_cur.pic))');
  if n = d then raise exception '0032: save_record condition not found'; end if;
  execute n;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'next_candidate_code';
  n := replace(d, 'p_pic is distinct from app.my_pic()', 'not app.can_manage_pic(p_pic)');
  if n = d then raise exception '0032: next_candidate_code condition not found'; end if;
  execute n;
end $$;

-- Cấu hình ban đầu: TA3 quản lý TA6, TA8, TA10 và được tạo tài khoản Intern.
insert into public.pic_delegations (manager_pic, managed_pic, can_create_interns) values
  ('TA3-Thang', 'TA6-T.Thuong', true),
  ('TA3-Thang', 'TA8-T.Linh', true),
  ('TA3-Thang', 'TA10-T.Chung', true)
on conflict (manager_pic, managed_pic) do nothing;

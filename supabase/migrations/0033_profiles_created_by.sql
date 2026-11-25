-- 0033_profiles_created_by.sql – TA quản lý nhóm (pic_delegations.can_create_interns) tạo Intern và chỉ thấy Intern do mình tạo.
alter table public.profiles add column if not exists created_by uuid references public.profiles(id) on delete set null;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()) or created_by = (select auth.uid()));

-- 0005_ops_tables.sql (DEV) – M2-2 bảng vận hành, M2-3 RLS, M2-8 quyền xem target.
-- Theo DATABASE_SCHEMA v1.0 §3.3–3.4 và §5. Quy ước: RLS chỉ enable (không force); RPC gọi từ app ở schema public;
-- schema app chỉ chứa is_admin/my_pic/can_see_record. Ghi status_history / audit_logs chỉ qua RPC (M2-6).

-- ============ M2-8: quyền xem target ============
alter table public.profiles add column if not exists can_view_all_targets boolean not null default false;

create or replace function public.can_view_target(p_pic text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_admin()
      or (p_pic is not null and p_pic <> '' and p_pic = app.my_pic())
      or exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.active and p.can_view_all_targets)
$$;
revoke all on function public.can_view_target(text) from public, anon;
grant execute on function public.can_view_target(text) to authenticated, service_role;

-- ============ tiện ích trigger ============
create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

-- Tác giả bình luận lấy từ profiles, không tin client.
create or replace function public.tg_comment_author() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare p record;
begin
  -- service_role / migrate (không có người đăng nhập): giữ giá trị được truyền vào (comment cũ từ hệ Apps Script)
  if (select auth.uid()) is null then return new; end if;
  select id, username, role into p from public.profiles where id = (select auth.uid());
  if p.id is null then raise exception 'NO_PROFILE' using errcode = '42501'; end if;
  new.author_id := p.id; new.author_username := p.username; new.author_role := p.role;
  new.created_at := now(); new.updated_at := null;
  return new;
end $$;
revoke all on function public.tg_touch_updated_at(), public.tg_comment_author() from public, anon, authenticated;

-- ============ bảng (DATABASE_SCHEMA §3.3–3.4) ============
create table public.status_history (
  id          bigint generated always as identity primary key,
  record_id   bigint not null references public.recruitment_records(id) on delete cascade,
  kind        text not null check (kind in ('STAGE_MOVE','STATUS','PIC_CHANGE','ARCHIVE','RESTORE','CONFIRM_HIRE','REOPEN_HIRE')),
  field_key   text not null default '',
  from_value  text not null default '',
  to_value    text not null default '',
  from_box    text, to_box text,
  actor_id    uuid references public.profiles(id),
  at          timestamptz not null default now()
);
create index status_history_record_idx on public.status_history (record_id, at desc);

create table public.interview_schedules (
  id bigint generated always as identity primary key, legacy_id int unique,
  record_id bigint not null references public.recruitment_records(id) on delete cascade,
  round text not null check (round in ('R1','R2','Khác')), round_name text not null default '',
  date date, time text, interviewer text not null default '',
  result text not null default '' check (result in ('','Pending','Passed','Failed','Canceled')),
  feedback text not null default '', created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index interview_schedules_record_idx on public.interview_schedules (record_id);
create index interview_schedules_date_idx on public.interview_schedules (date);

create table public.comments (
  id bigint generated always as identity primary key, legacy_id int unique,
  record_id bigint not null references public.recruitment_records(id) on delete cascade,
  author_id uuid references public.profiles(id), author_username text not null default '',
  author_role text not null default '', body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(), updated_at timestamptz
);
create index comments_record_idx on public.comments (record_id, created_at);

create table public.tasks (
  id bigint generated always as identity primary key, legacy_id int unique,
  record_id bigint references public.recruitment_records(id) on delete cascade,
  title text not null, type text not null default 'Khác', due date, due_time text,
  priority text not null default 'Trung bình', status text not null default 'open',
  owner_id uuid references public.profiles(id) default auth.uid(), note text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(), done_at timestamptz
);
create index tasks_owner_idx on public.tasks (owner_id, status, due);
create index tasks_record_idx on public.tasks (record_id) where record_id is not null;

create table public.hiring_checklists (
  record_id bigint primary key references public.recruitment_records(id) on delete cascade,
  items jsonb not null default '{}'::jsonb,
  confirmed boolean not null default false, confirmed_by uuid references public.profiles(id), confirmed_at timestamptz,
  updated_by uuid references public.profiles(id) default auth.uid(), updated_at timestamptz not null default now()
);

create table public.targets (
  id bigint generated always as identity primary key,
  period_type text not null check (period_type in ('day','week','month','year')),
  period_key text not null, pic text references public.pics(code) on update cascade, position text not null default '', dept text not null default '',
  value int not null check (value >= 0), updated_by uuid references public.profiles(id) default auth.uid(), updated_at timestamptz not null default now(),
  unique nulls not distinct (period_type, period_key, pic, position, dept)
);

create table public.calendar_events (
  id bigint generated always as identity primary key, title text not null,
  type text not null default 'Khác', date date not null, time text, end_time text,
  record_id bigint references public.recruitment_records(id) on delete set null,
  owner_id uuid references public.profiles(id) default auth.uid(), note text not null default '', created_at timestamptz not null default now()
);
create index calendar_events_owner_idx on public.calendar_events (owner_id, date);

create table public.hr_info (
  record_id bigint primary key references public.recruitment_records(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','verified')),
  id_number text not null default '',
  updated_by uuid references public.profiles(id) default auth.uid(), updated_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id), verified_at timestamptz
);
create index hr_info_idnum_idx on public.hr_info (id_number) where id_number <> '';

create table public.hr_form_sends (
  id bigint generated always as identity primary key,
  record_id bigint not null references public.recruitment_records(id) on delete cascade,
  sent_by uuid references public.profiles(id) default auth.uid(), sent_at timestamptz not null default now()
);
create index hr_form_sends_record_idx on public.hr_form_sends (record_id);

create table public.record_files (
  id bigint generated always as identity primary key, legacy_id int unique,
  record_id bigint not null references public.recruitment_records(id) on delete cascade,
  kind text not null check (kind in ('cv','edu_certificate','health_check','id_card','resume','forklift_cert','salary_proposal','payslip')),
  drive_file_id text not null, file_name text not null, size bigint not null default 0, mime text not null default '',
  uploaded_by uuid references public.profiles(id), uploaded_at timestamptz not null default now(), deleted_at timestamptz
);
create index record_files_record_idx on public.record_files (record_id, kind) where deleted_at is null;

create table public.translations (
  id bigint generated always as identity primary key,
  record_id bigint not null references public.recruitment_records(id) on delete cascade,
  field_key text not null, source_hash text not null, en_text text not null,
  updated_by uuid references public.profiles(id) default auth.uid(), updated_at timestamptz not null default now(),
  unique (record_id, field_key)
);

create table public.applications (
  id bigint generated always as identity primary key, legacy_id int unique,
  created_at timestamptz not null default now(), pic text references public.pics(code) on update cascade,
  full_name text not null, phone text not null, email text not null default '', area text not null default '',
  note text not null default '', cv_drive_file_id text, consent_at timestamptz not null,
  status text not null default 'new' check (status in ('new','converted','ignored')),
  record_id bigint references public.recruitment_records(id), handled_by uuid references public.profiles(id), handled_at timestamptz
);
create index applications_pic_idx on public.applications (pic, status, created_at desc);

create table public.saved_views (
  id bigint generated always as identity primary key, name text not null, description text not null default '',
  config jsonb not null default '{}'::jsonb, audience text not null default 'all', user_ids uuid[] not null default '{}',
  is_active boolean not null default true, sort_order int not null default 0,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  columns jsonb not null default '{"visible":null,"order":[]}'
);
create table public.app_settings (
  key text primary key, value jsonb not null,
  sensitive boolean not null default false,  -- true: chỉ Admin đọc (DATABASE_SCHEMA §5 "khóa nhạy cảm Admin")
  updated_by uuid references public.profiles(id) default auth.uid(), updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references public.profiles(id), actor_username text not null, actor_role text not null,
  action text not null,
  record_id bigint, candidate_code text not null default '',
  changes jsonb not null default '{}'::jsonb
);
create index audit_logs_record_idx on public.audit_logs (record_id, at desc);
create index audit_logs_at_idx on public.audit_logs (at desc);

create table public.rate_limits (
  bucket text not null, key text not null, window_start timestamptz not null, hits int not null default 1,
  primary key (bucket, key, window_start)
);

alter table public.dropdown_requests alter column requested_by set default auth.uid();

-- ============ trigger ============
create trigger comments_author before insert on public.comments for each row execute function public.tg_comment_author();
create trigger comments_touch before update on public.comments for each row execute function public.tg_touch_updated_at();
create trigger interview_schedules_touch before update on public.interview_schedules for each row execute function public.tg_touch_updated_at();
create trigger hiring_checklists_touch before update on public.hiring_checklists for each row execute function public.tg_touch_updated_at();
create trigger targets_touch before update on public.targets for each row execute function public.tg_touch_updated_at();
create trigger hr_info_touch before update on public.hr_info for each row execute function public.tg_touch_updated_at();
create trigger translations_touch before update on public.translations for each row execute function public.tg_touch_updated_at();
create trigger saved_views_touch before update on public.saved_views for each row execute function public.tg_touch_updated_at();
create trigger app_settings_touch before update on public.app_settings for each row execute function public.tg_touch_updated_at();

-- ============ RLS: bật trên mọi bảng mới ============
alter table public.status_history enable row level security;
alter table public.interview_schedules enable row level security;
alter table public.comments enable row level security;
alter table public.tasks enable row level security;
alter table public.hiring_checklists enable row level security;
alter table public.targets enable row level security;
alter table public.calendar_events enable row level security;
alter table public.hr_info enable row level security;
alter table public.hr_form_sends enable row level security;
alter table public.record_files enable row level security;
alter table public.translations enable row level security;
alter table public.applications enable row level security;
alter table public.saved_views enable row level security;
alter table public.user_preferences enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limits enable row level security;

-- ============ quyền bảng ============
revoke all on public.status_history, public.interview_schedules, public.comments, public.tasks, public.hiring_checklists,
  public.targets, public.calendar_events, public.hr_info, public.hr_form_sends, public.record_files, public.translations,
  public.applications, public.saved_views, public.user_preferences, public.app_settings, public.audit_logs, public.rate_limits
  from anon, authenticated;

-- đọc
grant select on public.status_history, public.interview_schedules, public.comments, public.tasks, public.hiring_checklists,
  public.targets, public.calendar_events, public.hr_info, public.hr_form_sends, public.record_files, public.translations,
  public.applications, public.saved_views, public.user_preferences, public.app_settings, public.audit_logs,
  public.applicants, public.import_batches to authenticated;
-- ghi trực tiếp qua PostgREST (RLS lọc). status_history, audit_logs, record_files, applications(insert), rate_limits: chỉ RPC / service role.
grant insert, update, delete on public.interview_schedules, public.comments, public.tasks, public.calendar_events,
  public.targets, public.saved_views, public.user_preferences, public.app_settings, public.translations to authenticated;
grant insert, update on public.hiring_checklists, public.hr_info to authenticated;
grant insert on public.hr_form_sends to authenticated;
grant update (status, record_id, handled_by, handled_at) on public.applications to authenticated;
grant insert, update, delete on public.pics, public.dropdown_options, public.sub_source_map, public.hierarchy to authenticated;
grant insert, update on public.dropdown_requests to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- service_role: script/Edge Function (bỏ qua RLS nhưng vẫn cần quyền bảng – xem 0004)
grant select, insert, update, delete on public.status_history, public.interview_schedules, public.comments, public.tasks,
  public.hiring_checklists, public.targets, public.calendar_events, public.hr_info, public.hr_form_sends, public.record_files,
  public.translations, public.applications, public.saved_views, public.user_preferences, public.app_settings,
  public.audit_logs, public.rate_limits, public.profiles, public.dropdown_options, public.sub_source_map, public.hierarchy,
  public.dropdown_requests to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ============ policy ============
-- Danh mục: Admin ghi (đọc đã có policy ở 0001)
create policy pics_admin_write on public.pics for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy dd_admin_write on public.dropdown_options for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy ssm_admin_write on public.sub_source_map for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy hier_admin_write on public.hierarchy for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

-- profiles: tự sửa full_name của mình (cột khác: Edge admin-users bằng service role)
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- dropdown_requests: TA đề xuất, Admin duyệt
create policy ddreq_insert on public.dropdown_requests for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending');
create policy ddreq_admin_update on public.dropdown_requests for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Bảng con của hồ sơ: điều kiện "thấy hồ sơ cha" (RLS rr_read của recruitment_records tự áp dụng trong subquery)
create policy sh_read on public.status_history for select to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));

create policy is_read on public.interview_schedules for select to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy is_insert on public.interview_schedules for insert to authenticated
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy is_update on public.interview_schedules for update to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id))
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy is_delete on public.interview_schedules for delete to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));

create policy cm_read on public.comments for select to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy cm_insert on public.comments for insert to authenticated
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy cm_update on public.comments for update to authenticated
  using ((author_id = (select auth.uid()) or (select app.is_admin())) and exists (select 1 from public.recruitment_records r where r.id = record_id))
  with check ((author_id = (select auth.uid()) or (select app.is_admin())) and exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy cm_delete on public.comments for delete to authenticated
  using ((author_id = (select auth.uid()) or (select app.is_admin())) and exists (select 1 from public.recruitment_records r where r.id = record_id));

create policy hc_read on public.hiring_checklists for select to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy hc_insert on public.hiring_checklists for insert to authenticated
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id) and ((select app.is_admin()) or not confirmed));
create policy hc_update on public.hiring_checklists for update to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id) and ((select app.is_admin()) or not confirmed))
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id) and ((select app.is_admin()) or not confirmed));

create policy hr_read on public.hr_info for select to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy hr_insert on public.hr_info for insert to authenticated
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id) and ((select app.is_admin()) or status <> 'verified'));
create policy hr_update on public.hr_info for update to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id) and ((select app.is_admin()) or status <> 'verified'))
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id) and ((select app.is_admin()) or status <> 'verified'));

create policy hfs_read on public.hr_form_sends for select to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy hfs_insert on public.hr_form_sends for insert to authenticated
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id) and sent_by = (select auth.uid()));

create policy rf_read on public.record_files for select to authenticated
  using (deleted_at is null and exists (select 1 from public.recruitment_records r where r.id = record_id));

create policy tr_read on public.translations for select to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id));
create policy tr_write on public.translations for all to authenticated
  using (exists (select 1 from public.recruitment_records r where r.id = record_id))
  with check (exists (select 1 from public.recruitment_records r where r.id = record_id));

-- tasks, calendar_events: Admin tất cả; TA việc của mình hoặc gắn hồ sơ mình thấy (đọc), ghi việc của mình
create policy tk_read on public.tasks for select to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = record_id)));
create policy tk_insert on public.tasks for insert to authenticated
  with check ((select app.is_admin()) or (owner_id = (select auth.uid())
         and (record_id is null or exists (select 1 from public.recruitment_records r where r.id = record_id))));
create policy tk_update on public.tasks for update to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()))
  with check ((select app.is_admin()) or owner_id = (select auth.uid()));
create policy tk_delete on public.tasks for delete to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()));

create policy ce_read on public.calendar_events for select to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = record_id)));
create policy ce_insert on public.calendar_events for insert to authenticated
  with check ((select app.is_admin()) or (owner_id = (select auth.uid())
         and (record_id is null or exists (select 1 from public.recruitment_records r where r.id = record_id))));
create policy ce_update on public.calendar_events for update to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()))
  with check ((select app.is_admin()) or owner_id = (select auth.uid()));
create policy ce_delete on public.calendar_events for delete to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()));

-- targets (TARGET, G1)
create policy tg_read on public.targets for select to authenticated using (public.can_view_target(pic));
create policy tg_admin_write on public.targets for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

-- applications: Admin tất cả, TA chỉ của PIC mình; TA được đổi trạng thái (cột giới hạn bằng GRANT ở trên)
create policy ap_read on public.applications for select to authenticated
  using ((select app.is_admin()) or (pic is not null and pic = (select app.my_pic())));
create policy ap_update on public.applications for update to authenticated
  using ((select app.is_admin()) or (pic is not null and pic = (select app.my_pic())))
  with check ((select app.is_admin()) or (pic is not null and pic = (select app.my_pic())));

-- saved_views: đọc theo đối tượng; Admin ghi
create policy sv_read on public.saved_views for select to authenticated
  using ((select app.is_admin()) or (is_active and (audience = 'all' or (select auth.uid()) = any (user_ids))));
create policy sv_admin_write on public.saved_views for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

-- user_preferences: của chính mình
create policy up_own on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- app_settings: khóa thường mọi user đọc; khóa nhạy cảm chỉ Admin; Admin ghi
create policy as_read on public.app_settings for select to authenticated using (not sensitive or (select app.is_admin()));
create policy as_admin_write on public.app_settings for all to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

-- audit_logs: Admin; TA chỉ log của hồ sơ mình thấy. Không có policy ghi.
create policy al_read on public.audit_logs for select to authenticated
  using ((select app.is_admin()) or (record_id is not null and exists (select 1 from public.recruitment_records r where r.id = record_id)));

-- applicants, import_batches: chỉ Admin đọc (ghi bằng service role)
create policy appl_admin_read on public.applicants for select to authenticated using ((select app.is_admin()));
create policy ib_admin_read on public.import_batches for select to authenticated using ((select app.is_admin()));

-- rate_limits: không policy (chỉ service role)

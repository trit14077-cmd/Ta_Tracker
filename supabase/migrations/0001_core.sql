-- 0001_core.sql  (DEV) - nền tảng + danh mục + recruitment_records + RLS. Sinh từ docs/DATABASE_SCHEMA.md v0.1.
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create schema if not exists app;

create table public.pics (
  code        text primary key,            -- ví dụ 'TA3-Thang'
  name        text not null default '',
  active      boolean not null default true,
  sort_order  int not null default 0
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  full_name   text not null default '',
  role        text not null check (role in ('admin','pic')),
  pic_code    text references public.pics(code) on update cascade,
  active      boolean not null default true,
  legacy_id   int unique,
  created_at  timestamptz not null default now(),
  constraint pic_requires_code check (role = 'admin' or pic_code is not null)  -- sửa lỗ hổng TA thiếu PIC (AUDIT §3.2 #1)
);

create table public.dropdown_options (
  list_key    text not null,
  value       text not null,
  active      boolean not null default true,
  sort_order  int not null default 0,
  primary key (list_key, value)
);
create table public.sub_source_map (sub_source text primary key, source text not null);
create table public.hierarchy (
  parent_type text not null check (parent_type in ('region','location')),
  parent_value text not null,
  child_value  text not null,
  primary key (parent_type, parent_value, child_value)
);
create table public.dropdown_requests (
  id bigint generated always as identity primary key,
  list_key text not null, proposed_value text not null, parent_value text not null default '',
  mapped_source text not null default '', reason text not null default '',
  requested_by uuid references public.profiles(id), status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id), created_at timestamptz not null default now(), reviewed_at timestamptz
);

create table public.applicants (            -- chỉ để liên kết/phát hiện trùng; KHÔNG chứa định danh dùng chung (D-04)
  id            bigint generated always as identity primary key,
  phone_norm    text,                        -- đã chuẩn hóa; có thể null/trùng giữa nhiều applicant nếu tên khác
  name_norm     text not null default '',    -- unaccent(lower(full_name))
  first_seen_at timestamptz not null default now()
);
create index applicants_phone_idx on public.applicants (phone_norm) where phone_norm is not null;

create table public.recruitment_records (
  -- meta
  id            bigint generated always as identity primary key,
  legacy_id     int unique,                  -- id cũ (= số dòng − 1) để nối Comments/Tasks khi migrate
  applicant_id  bigint references public.applicants(id),
  row_version   int not null default 1,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),   -- field #3 "created_at" (Timestamp)
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_by    uuid references public.profiles(id),
  -- field lưu trữ (theo thứ tự FIELD_CATALOG; "#" = index, "s" = section)
  candidate_code            text NOT NULL,  -- #1 s1 (unique, xem ràng buộc cuối bảng)
  pic                       text,  -- #2 s1; null = chưa gán PIC (chỉ Admin thấy)
  full_name                 text NOT NULL DEFAULT '',  -- #4 s1
  phone                     text NOT NULL DEFAULT '',  -- #5 s1
  email                     text NOT NULL DEFAULT '',  -- #6 s1
  position                  text NOT NULL DEFAULT '',  -- #7 s2
  rank                      text NOT NULL DEFAULT '',  -- #8 s2
  region                    text NOT NULL DEFAULT '',  -- #9 s2
  location                  text NOT NULL DEFAULT '',  -- #10 s2
  unit                      text NOT NULL DEFAULT '',  -- #11 s2
  dept                      text NOT NULL DEFAULT '',  -- #12 s2
  site                      text NOT NULL DEFAULT '',  -- #13 s2
  sub_source                text NOT NULL DEFAULT '',  -- #15 s3
  r1_date                   date,  -- #16 s4
  r1_time                   text NOT NULL DEFAULT '' CHECK (r1_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR r1_time = ''),  -- #17 s4
  r1_status                 text NOT NULL DEFAULT '',  -- #18 s4
  r1_sub_status             text NOT NULL DEFAULT '',  -- #19 s4
  r1_note                   text NOT NULL DEFAULT '',  -- #20 s4
  r1_cdd_fb                 text NOT NULL DEFAULT '',  -- #21 s4 hidden
  r2_date                   date,  -- #22 s5
  r2_time                   text NOT NULL DEFAULT '' CHECK (r2_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR r2_time = ''),  -- #23 s5
  r2_status                 text NOT NULL DEFAULT '',  -- #24 s5
  r2_sub_status             text NOT NULL DEFAULT '',  -- #25 s5
  r2_note                   text NOT NULL DEFAULT '',  -- #26 s5
  r2_cdd_fb                 text NOT NULL DEFAULT '',  -- #27 s5 hidden
  ob_date                   date,  -- #28 s6
  ob_status                 text NOT NULL DEFAULT '',  -- #29 s6
  ob_sub_status             text NOT NULL DEFAULT '',  -- #30 s6
  hire_type                 text NOT NULL DEFAULT '',  -- #31 s6
  ob_note                   text NOT NULL DEFAULT '',  -- #32 s6
  basic_salary              numeric(14,0),  -- #34 s7
  meal_allowance            numeric(14,0),  -- #35 s7
  fmcg_allowance            numeric(14,0),  -- #36 s7
  attraction_allowance      numeric(14,0),  -- #37 s7
  nightshift_allowance      numeric(14,0),  -- #38 s7
  probation_pct             numeric(5,2),  -- #39 s8
  probation_period          text NOT NULL DEFAULT '',  -- #40 s8
  contract_signed_date      date,  -- #41 s8
  emp_id                    text NOT NULL DEFAULT '',  -- #42 s8
  doc_099_250               text NOT NULL DEFAULT '',  -- #43 s9 hidden
  dept_confirm              text NOT NULL DEFAULT '',  -- #44 s9 hidden
  ob_mail                   text NOT NULL DEFAULT '',  -- #45 s9 hidden
  probation_contract_type   text NOT NULL DEFAULT '',  -- #46 s9
  probation_contract        text NOT NULL DEFAULT '',  -- #47 s9
  drive_upload              text NOT NULL DEFAULT '',  -- #48 s9
  edu_certificate           text NOT NULL DEFAULT '',  -- #49 s9
  health_check              text NOT NULL DEFAULT '',  -- #50 s9
  id_card                   text NOT NULL DEFAULT '',  -- #51 s9
  resume                    text NOT NULL DEFAULT '',  -- #52 s9
  doc_note                  text NOT NULL DEFAULT '',  -- #53 s9
  emp_status                text NOT NULL DEFAULT '',  -- #54 s10
  attrition_date            date,  -- #55 s10
  attrition_reason          text NOT NULL DEFAULT '',  -- #56 s10
  attrition_sub_reason      text NOT NULL DEFAULT '',  -- #57 s10
  attrition_note            text NOT NULL DEFAULT '',  -- #58 s10
  cutoff                    text NOT NULL DEFAULT '',  -- #59 s10
  cutoff_mail               text NOT NULL DEFAULT '',  -- #60 s10
  gender                    text NOT NULL DEFAULT '',  -- #62 s1
  birth                     text NOT NULL DEFAULT '',  -- #63 s1
  ethnicity                 text NOT NULL DEFAULT '',  -- #64 s1 hidden
  address                   text NOT NULL DEFAULT '',  -- #65 s1
  cv_link                   text NOT NULL DEFAULT '',  -- #66 s1
  forklift_cert             text NOT NULL DEFAULT '',  -- #68 s9
  contract_sign_status      text NOT NULL DEFAULT '',  -- #69 s11
  salary_pay_status         text NOT NULL DEFAULT '',  -- #70 s11
  wd_process                text NOT NULL DEFAULT '',  -- #71 s11
  wd_step                   text NOT NULL DEFAULT '',  -- #72 s11
  wd_status                 text NOT NULL DEFAULT '',  -- #73 s11
  pending_at                text NOT NULL DEFAULT '',  -- #74 s11
  wd_deadline               date,  -- #75 s11
  wd_note                   text NOT NULL DEFAULT '',  -- #76 s11
  education_level           text NOT NULL DEFAULT '',  -- #77 s1
  experience_years          text NOT NULL DEFAULT '',  -- #78 s1
  experience_summary        text NOT NULL DEFAULT '',  -- #79 s1
  r2_interviewer            text NOT NULL DEFAULT '',  -- #80 s5
  current_salary            numeric(14,0),  -- #81 s7
  salary_expectation        numeric(14,0),  -- #82 s7
  source        text not null default '',    -- #14 tính từ sub_source, lưu khi ghi
  ob_month      text not null default '',    -- #33 tính từ ob_date, lưu khi ghi
  constraint candidate_code_unique unique (candidate_code),
  constraint pic_fk foreign key (pic) references public.pics(code) on update cascade
);

create index rr_pic_idx        on public.recruitment_records (pic, is_archived);
create index rr_created_idx    on public.recruitment_records (created_at desc);
create index rr_r1_status_idx  on public.recruitment_records (r1_status);
create index rr_r2_status_idx  on public.recruitment_records (r2_status);
create index rr_ob_status_idx  on public.recruitment_records (ob_status);
create index rr_r1_date_idx    on public.recruitment_records (r1_date);
create index rr_r2_date_idx    on public.recruitment_records (r2_date);
create index rr_ob_date_idx    on public.recruitment_records (ob_date);
create index rr_phone_idx      on public.recruitment_records (phone);
create index rr_geo_idx        on public.recruitment_records (region, location, site);
create index rr_position_idx   on public.recruitment_records (position);
create index rr_emp_status_idx on public.recruitment_records (emp_status);
create index rr_applicant_idx  on public.recruitment_records (applicant_id);
create index rr_name_trgm_idx  on public.recruitment_records using gin (full_name extensions.gin_trgm_ops);
create index rr_code_trgm_idx  on public.recruitment_records using gin (candidate_code extensions.gin_trgm_ops);

-- ===== RLS =====
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = ''
  as $$ select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role='admin' and p.active) $$;
create or replace function app.my_pic() returns text language sql stable security definer set search_path = ''
  as $$ select p.pic_code from public.profiles p where p.id = (select auth.uid()) and p.role='pic' and p.active $$;
create or replace function app.can_see_record(p_pic text) returns boolean language sql stable security definer set search_path = ''
  as $$ select app.is_admin() or (p_pic is not null and p_pic <> '' and p_pic = app.my_pic()) $$;

revoke all on schema app from public, anon;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated;

alter table public.pics enable row level security;
alter table public.profiles enable row level security;
alter table public.dropdown_options enable row level security;
alter table public.sub_source_map enable row level security;
alter table public.hierarchy enable row level security;
alter table public.dropdown_requests enable row level security;
alter table public.applicants enable row level security;
alter table public.recruitment_records enable row level security;

-- quyền bảng: anon không có gì; authenticated chỉ SELECT (ghi qua RPC/Edge Function - chưa dựng)
revoke all on public.pics, public.profiles, public.dropdown_options, public.sub_source_map, public.hierarchy,
  public.dropdown_requests, public.applicants, public.recruitment_records from anon, authenticated;
grant select on public.pics, public.profiles, public.dropdown_options, public.sub_source_map, public.hierarchy,
  public.dropdown_requests, public.recruitment_records to authenticated;

create policy pics_read on public.pics for select to authenticated using (true);
create policy dd_read on public.dropdown_options for select to authenticated using (true);
create policy ssm_read on public.sub_source_map for select to authenticated using (true);
create policy hier_read on public.hierarchy for select to authenticated using (true);
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app.is_admin());
create policy ddreq_read on public.dropdown_requests for select to authenticated
  using (app.is_admin() or requested_by = (select auth.uid()));
create policy rr_read on public.recruitment_records for select to authenticated
  using (app.can_see_record(pic));
-- applicants: không có policy => chỉ service role/RPC truy cập

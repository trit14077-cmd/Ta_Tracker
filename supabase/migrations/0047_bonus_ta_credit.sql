-- 0047_bonus_ta_credit.sql – TA Credit Bonus (task #10 phần 2). Dùng chung bonus_periods / bonus_lines / bonus_lock của 0045.
-- Quy tắc tính nằm ở shared/bonus/taCredit.ts: client tính, bonus_lock chỉ kiểm dữ liệu và lưu ảnh chụp.
--  - ta_bonus_profiles: hồ sơ bonus của TA theo mã PIC (Region North/South, Level, chức danh, Emp_ID, cờ onsite / freelancer).
--    Admin đọc / ghi tất cả; TA đọc được hồ sơ của chính mình (TA tự xem bonus, chốt 27/11/2026).
--  - bonus_settings 'ta_credit': bảng credit theo rank / site, khung lũy tiến, đơn giá (Intern: phần Base trả 70k như Excel).
-- Khoản tiền: bonus_lines kind 'ta_credit', part 'credit', payee_type 'ta', ta_pic = PIC (mỗi TA một khoản / kỳ).

create table public.ta_bonus_profiles (
  pic_code       text primary key references public.pics(code) on update cascade on delete cascade,
  emp_id         text not null default '' check (length(emp_id) <= 50),
  region         text not null default '' check (region in ('', 'North', 'South')),
  level          text not null default '' check (level in ('', 'Senior', 'Middle', 'Junior', 'Intern')),
  title          text not null default '' check (length(title) <= 200),
  is_freelancer  boolean not null default false,
  onsite         boolean not null default false,
  active         boolean not null default true,
  note           text not null default '' check (length(note) <= 500),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id)
);

alter table public.ta_bonus_profiles enable row level security;
create policy ta_bonus_profiles_read on public.ta_bonus_profiles for select to authenticated
  using ((select app.is_admin()) or pic_code = (select app.my_pic()));
revoke all on public.ta_bonus_profiles from anon, authenticated;
grant select on public.ta_bonus_profiles to authenticated;
grant all on public.ta_bonus_profiles to service_role;

insert into public.bonus_settings (kind, config) values
  ('ta_credit', '{
    "minDays": 7,
    "northRegion": "Miền Bắc",
    "backOfficeUnit": "Khối Văn phòng",
    "creditSites": {"DC Hưng Yên": 3, "DC Hải Phòng": 3, "TTPP Hưng Yên": 3, "TTPP Hải Phòng": 3},
    "rankCredits": {
      "North": {"6": 1.5, "5": 2, "4": 4, "3": 8, "3BO": 9, "2": 20},
      "South": {"6": 1, "5": 1.5, "4": 3, "3": 6, "3BO": 7, "2": 20}
    },
    "tiers": {
      "North": {"Senior": [15, 30, 40], "Middle": [12, 25, 40], "Junior": [10, 25, 40], "Intern": [5, 25, 40]},
      "South": {"Senior": [22, 30, 40], "Middle": [18, 25, 40], "Junior": [15, 25, 40], "Intern": [5, 25, 40]}
    },
    "rates": [0, 70000, 120000, 200000],
    "internBaseRate": 70000
  }'::jsonb)
on conflict (kind) do nothing;

-- p: {pic_code, emp_id?, region?, level?, title?, is_freelancer?, onsite?, active?, note?}; khóa thiếu = giữ giá trị cũ.
create or replace function public.ta_bonus_profile_save(p jsonb)
returns public.ta_bonus_profiles
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  o public.ta_bonus_profiles;
  n public.ta_bonus_profiles;
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'body'; end if;
  n.pic_code := btrim(coalesce(p ->> 'pic_code', ''));
  if not exists (select 1 from public.pics x where x.code = n.pic_code) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'pic_code';
  end if;
  foreach k in array array['is_freelancer', 'onsite', 'active'] loop
    if p ? k and jsonb_typeof(p -> k) <> 'boolean' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = k; end if;
  end loop;
  select * into o from public.ta_bonus_profiles where pic_code = n.pic_code for update;

  n.emp_id := btrim(coalesce(p ->> 'emp_id', o.emp_id, ''));
  n.region := btrim(coalesce(p ->> 'region', o.region, ''));
  n.level := btrim(coalesce(p ->> 'level', o.level, ''));
  n.title := btrim(coalesce(p ->> 'title', o.title, ''));
  n.note := btrim(coalesce(p ->> 'note', o.note, ''));
  n.is_freelancer := coalesce((p ->> 'is_freelancer')::boolean, o.is_freelancer, false);
  n.onsite := coalesce((p ->> 'onsite')::boolean, o.onsite, false);
  n.active := coalesce((p ->> 'active')::boolean, o.active, true);
  if n.region not in ('', 'North', 'South') then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'region'; end if;
  if n.level not in ('', 'Senior', 'Middle', 'Junior', 'Intern') then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'level'; end if;
  if length(n.emp_id) > 50 or length(n.title) > 200 or length(n.note) > 500 then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'length';
  end if;

  insert into public.ta_bonus_profiles as t (pic_code, emp_id, region, level, title, is_freelancer, onsite, active, note, updated_at, updated_by)
  values (n.pic_code, n.emp_id, n.region, n.level, n.title, n.is_freelancer, n.onsite, n.active, n.note, now(), v_actor.id)
  on conflict (pic_code) do update set
    emp_id = excluded.emp_id, region = excluded.region, level = excluded.level, title = excluded.title,
    is_freelancer = excluded.is_freelancer, onsite = excluded.onsite, active = excluded.active, note = excluded.note,
    updated_at = now(), updated_by = v_actor.id
  returning * into n;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_TA_PROFILE', null, '',
          jsonb_build_object('old', coalesce(to_jsonb(o), '{}'::jsonb) - 'updated_at' - 'updated_by',
                             'new', to_jsonb(n) - 'updated_at' - 'updated_by'));
  return n;
end $$;

revoke all on function public.ta_bonus_profile_save(jsonb) from public, anon;
grant execute on function public.ta_bonus_profile_save(jsonb) to authenticated, service_role;

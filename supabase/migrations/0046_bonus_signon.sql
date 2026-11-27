-- 0046_bonus_signon.sql – Sign-on Bonus (task #9). Dùng chung bonus_periods / bonus_lines / bonus_lock của 0045.
-- Quy tắc tính nằm ở shared/bonus/signon.ts: client tính, bonus_lock chỉ kiểm dữ liệu và lưu ảnh chụp.
--  - bonus_signon_schemes: scheme (site + ngày hiệu lực + các mốc {days, amount}; amount null = Not Applicable).
--    Seed 3 scheme của file Nov'26. Không chứa thông tin cá nhân → mọi tài khoản đọc được.
--  - bonus_signon_records: scheme chọn tay (null = tự gán theo site + ngày vào) + cờ sửa tay từng mốc
--    ('' = theo gợi ý, 'Passed' / 'Failed' / 'Hold'). Chỉ admin đọc / ghi (qua RPC).
-- Khoản tiền: bonus_lines kind 'signon', part 'm1'…'m6' (một mốc của một hồ sơ chỉ chốt một kỳ – 0045).

-- 1) Bảng -----------------------------------------------------------------------------
create table public.bonus_signon_schemes (
  code            text primary key check (length(code) between 1 and 80),
  sites           text[] not null check (cardinality(sites) between 1 and 50),
  effective_from  date not null,
  effective_to    date,
  milestones      jsonb not null check (jsonb_typeof(milestones) = 'array' and jsonb_array_length(milestones) between 1 and 6),
  active          boolean not null default true,
  note            text not null default '' check (length(note) <= 500),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  constraint bonus_signon_scheme_dates check (effective_to is null or effective_to >= effective_from)
);

create table public.bonus_signon_records (
  record_id    bigint primary key references public.recruitment_records(id) on delete cascade,
  scheme_code  text references public.bonus_signon_schemes(code) on update cascade on delete set null,
  m1_flag      text not null default '' check (m1_flag in ('', 'Passed', 'Failed', 'Hold')),
  m2_flag      text not null default '' check (m2_flag in ('', 'Passed', 'Failed', 'Hold')),
  m3_flag      text not null default '' check (m3_flag in ('', 'Passed', 'Failed', 'Hold')),
  m4_flag      text not null default '' check (m4_flag in ('', 'Passed', 'Failed', 'Hold')),
  m5_flag      text not null default '' check (m5_flag in ('', 'Passed', 'Failed', 'Hold')),
  m6_flag      text not null default '' check (m6_flag in ('', 'Passed', 'Failed', 'Hold')),
  note         text not null default '' check (length(note) <= 500),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id)
);

-- 2) RLS + quyền ------------------------------------------------------------------------
alter table public.bonus_signon_schemes enable row level security;
alter table public.bonus_signon_records enable row level security;
create policy bonus_signon_schemes_read on public.bonus_signon_schemes for select to authenticated using (true);
create policy bonus_signon_records_read on public.bonus_signon_records for select to authenticated using ((select app.is_admin()));

revoke all on public.bonus_signon_schemes, public.bonus_signon_records from anon, authenticated;
grant select on public.bonus_signon_schemes, public.bonus_signon_records to authenticated;
grant all on public.bonus_signon_schemes, public.bonus_signon_records to service_role;

-- Mốc chuẩn: Join Date + 6 / 14 / 29 / 59 ngày lịch, 500k / 500k / 1tr / 1tr.
insert into public.bonus_signon_schemes (code, sites, effective_from, milestones) values
  ('DCHP 11.05.2026', array['DC Hải Phòng'], '2026-05-11',
   '[{"days":6,"amount":null},{"days":14,"amount":null},{"days":29,"amount":1000000},{"days":59,"amount":1000000}]'::jsonb),
  ('DCHP + DCHY 01.06.2026', array['DC Hải Phòng', 'DC Hưng Yên'], '2026-06-01',
   '[{"days":6,"amount":500000},{"days":14,"amount":500000},{"days":29,"amount":1000000},{"days":59,"amount":1000000}]'::jsonb),
  ('TTPP HY + TTPPHP_13.08.2026', array['TTPP Hưng Yên', 'TTPP Hải Phòng'], '2026-08-13',
   '[{"days":6,"amount":500000},{"days":14,"amount":500000},{"days":29,"amount":1000000},{"days":59,"amount":1000000}]'::jsonb)
on conflict (code) do nothing;

-- 3) Scheme (admin) ----------------------------------------------------------------------
-- p: {code, sites[], effective_from, effective_to?, milestones[{days, amount|null}], active?, note?}. Upsert theo code.
create or replace function public.bonus_signon_scheme_save(p jsonb)
returns public.bonus_signon_schemes
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  o public.bonus_signon_schemes;
  n public.bonus_signon_schemes;
  e jsonb;
  v_ms jsonb := '[]'::jsonb;
  v_days numeric;
  v_amt numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'body'; end if;
  n.code := btrim(coalesce(p ->> 'code', ''));
  if length(n.code) not between 1 and 80 then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'code'; end if;
  select * into o from public.bonus_signon_schemes where code = n.code for update;

  if jsonb_typeof(p -> 'sites') <> 'array' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'sites'; end if;
  select coalesce(array_agg(distinct btrim(x)) filter (where btrim(x) <> ''), '{}') into n.sites
    from jsonb_array_elements_text(p -> 'sites') x;
  if cardinality(n.sites) not between 1 and 50 or exists (select 1 from unnest(n.sites) s where length(s) > 200) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'sites';
  end if;

  begin
    n.effective_from := (p ->> 'effective_from')::date;
    n.effective_to := nullif(p ->> 'effective_to', '')::date;
  exception when others then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'effective';
  end;
  if n.effective_from is null or (n.effective_to is not null and n.effective_to < n.effective_from) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'effective';
  end if;

  if jsonb_typeof(p -> 'milestones') <> 'array' or jsonb_array_length(p -> 'milestones') not between 1 and 6 then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'milestones';
  end if;
  for e in select value from jsonb_array_elements(p -> 'milestones') loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'days') is distinct from 'number'
       or coalesce(jsonb_typeof(e -> 'amount'), 'null') not in ('number', 'null') then
      raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'milestones';
    end if;
    v_days := (e ->> 'days')::numeric;
    v_amt := (e ->> 'amount')::numeric;
    if v_days <> trunc(v_days) or v_days not between 0 and 400 or (v_amt is not null and (v_amt < 0 or v_amt <> trunc(v_amt))) then
      raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'milestones';
    end if;
    v_ms := v_ms || jsonb_build_array(jsonb_build_object('days', v_days::int, 'amount', to_jsonb(v_amt)));
  end loop;
  n.milestones := v_ms;
  if p ? 'active' and jsonb_typeof(p -> 'active') <> 'boolean' then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'active';
  end if;
  n.active := coalesce((p ->> 'active')::boolean, o.active, true);
  n.note := btrim(coalesce(p ->> 'note', ''));
  if length(n.note) > 500 then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'note'; end if;

  insert into public.bonus_signon_schemes as s (code, sites, effective_from, effective_to, milestones, active, note, updated_at, updated_by)
  values (n.code, n.sites, n.effective_from, n.effective_to, n.milestones, n.active, n.note, now(), v_actor.id)
  on conflict (code) do update set
    sites = excluded.sites, effective_from = excluded.effective_from, effective_to = excluded.effective_to,
    milestones = excluded.milestones, active = excluded.active, note = excluded.note, updated_at = now(), updated_by = v_actor.id
  returning * into n;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_SIGNON_SCHEME', null, '',
          jsonb_build_object('old', coalesce(to_jsonb(o), '{}'::jsonb) - 'updated_at' - 'updated_by',
                             'new', to_jsonb(n) - 'updated_at' - 'updated_by'));
  return n;
end $$;

-- 4) Scheme chọn tay + cờ từng mốc của một hồ sơ (admin) ------------------------------------
-- p: {scheme_code? ('' = tự gán), m1_flag … m6_flag?, note?}; khóa thiếu = giữ giá trị cũ.
-- Mốc đã chốt ở một kỳ thì không đổi cờ được; hồ sơ có mốc đã chốt thì không đổi scheme (mở lại kỳ trước).
create or replace function public.bonus_signon_save(p_record_id bigint, p jsonb)
returns public.bonus_signon_records
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  r public.recruitment_records;
  o public.bonus_signon_records;
  n public.bonus_signon_records;
  v_locked text[];
  v_new jsonb;
  v_old jsonb;
  i int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'body'; end if;
  select * into r from public.recruitment_records where id = p_record_id;
  if r.id is null or r.is_archived then raise exception 'NOT_FOUND' using errcode = 'PT404'; end if;
  select * into o from public.bonus_signon_records where record_id = p_record_id for update;

  n.record_id := p_record_id;
  n.scheme_code := case when p ? 'scheme_code' then nullif(btrim(coalesce(p ->> 'scheme_code', '')), '') else o.scheme_code end;
  if n.scheme_code is not null and not exists (select 1 from public.bonus_signon_schemes s where s.code = n.scheme_code) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'scheme_code';
  end if;
  n.m1_flag := coalesce(p ->> 'm1_flag', o.m1_flag, '');
  n.m2_flag := coalesce(p ->> 'm2_flag', o.m2_flag, '');
  n.m3_flag := coalesce(p ->> 'm3_flag', o.m3_flag, '');
  n.m4_flag := coalesce(p ->> 'm4_flag', o.m4_flag, '');
  n.m5_flag := coalesce(p ->> 'm5_flag', o.m5_flag, '');
  n.m6_flag := coalesce(p ->> 'm6_flag', o.m6_flag, '');
  n.note := btrim(coalesce(p ->> 'note', o.note, ''));
  if not (array[n.m1_flag, n.m2_flag, n.m3_flag, n.m4_flag, n.m5_flag, n.m6_flag] <@ array['', 'Passed', 'Failed', 'Hold']) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'flag';
  end if;
  if length(n.note) > 500 then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'note'; end if;

  select coalesce(array_agg(distinct l.part), '{}') into v_locked
    from public.bonus_lines l where l.kind = 'signon' and l.record_id = p_record_id;
  if cardinality(v_locked) > 0 and n.scheme_code is distinct from o.scheme_code then
    raise exception 'BONUS_PART_LOCKED' using errcode = 'PT409', detail = 'scheme';
  end if;
  v_new := to_jsonb(n);
  v_old := coalesce(to_jsonb(o), '{}'::jsonb);
  for i in 1..6 loop
    if ('m' || i) = any (v_locked)
       and (v_new ->> ('m' || i || '_flag')) is distinct from coalesce(v_old ->> ('m' || i || '_flag'), '') then
      raise exception 'BONUS_PART_LOCKED' using errcode = 'PT409', detail = 'm' || i;
    end if;
  end loop;

  insert into public.bonus_signon_records as b (record_id, scheme_code, m1_flag, m2_flag, m3_flag, m4_flag, m5_flag, m6_flag, note, updated_at, updated_by)
  values (n.record_id, n.scheme_code, n.m1_flag, n.m2_flag, n.m3_flag, n.m4_flag, n.m5_flag, n.m6_flag, n.note, now(), v_actor.id)
  on conflict (record_id) do update set
    scheme_code = excluded.scheme_code, m1_flag = excluded.m1_flag, m2_flag = excluded.m2_flag, m3_flag = excluded.m3_flag,
    m4_flag = excluded.m4_flag, m5_flag = excluded.m5_flag, m6_flag = excluded.m6_flag, note = excluded.note,
    updated_at = now(), updated_by = v_actor.id
  returning * into n;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_SIGNON_SAVE', r.id, r.candidate_code,
          jsonb_build_object('old', v_old - 'updated_at' - 'updated_by', 'new', to_jsonb(n) - 'updated_at' - 'updated_by'));
  return n;
end $$;

revoke all on function public.bonus_signon_scheme_save(jsonb), public.bonus_signon_save(bigint, jsonb) from public, anon;
grant execute on function public.bonus_signon_scheme_save(jsonb), public.bonus_signon_save(bigint, jsonb) to authenticated, service_role;

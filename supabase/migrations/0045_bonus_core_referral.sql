-- 0045_bonus_core_referral.sql – Bonus hàng tháng (task #8–#10): bảng dùng chung + Referral (task #8).
-- Quy tắc tính nằm ở shared/bonus/*.ts (period.ts, referral.ts): client tính, RPC chỉ kiểm dữ liệu và lưu ảnh chụp.
--  - bonus_settings: mức tiền / bảng tra theo loại bonus (đổi mức không sửa code). Kỳ đã chốt giữ bản chụp riêng.
--  - bonus_periods : một dòng cho mỗi (loại, kỳ lương 'YYYY-MM'). 'mo' = đang mở, 'da_chot' = đã chốt.
--  - bonus_lines   : khoản tiền của kỳ ĐÃ CHỐT (mở lại kỳ = xóa khoản). Một hồ sơ + phần chỉ chốt ở một kỳ.
--  - bonus_referrals: người giới thiệu + cờ Eligible (admin nhập ở màn Bonus, không có trong form hồ sơ).
-- Đọc: bonus_lines – admin tất cả, TA chỉ khoản có ta_pic = PIC của mình (TA tự xem bonus, chốt 27/11/2026).
--      bonus_referrals – chỉ admin. bonus_settings / bonus_periods – mọi tài khoản (không có số tiền của người nào).
-- Ghi: chỉ qua RPC security definer, chỉ admin (app.require_admin).

-- 1) Bảng -----------------------------------------------------------------------------
create table public.bonus_settings (
  kind        text primary key check (kind in ('referral', 'signon', 'ta_credit', 'onsite', 'freelancer')),
  config      jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);

create table public.bonus_periods (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('referral', 'signon', 'ta_credit', 'onsite', 'freelancer')),
  period_key  text not null check (period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status      text not null default 'mo' check (status in ('mo', 'da_chot')),
  asof_date   date,
  config      jsonb not null default '{}'::jsonb,
  locked_at   timestamptz,
  locked_by   uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (kind, period_key),
  constraint bonus_period_locked check (status = 'mo' or (locked_at is not null and asof_date is not null))
);

create table public.bonus_lines (
  id          bigint generated always as identity primary key,
  period_id   bigint not null references public.bonus_periods(id) on delete cascade,
  kind        text not null,
  record_id   bigint references public.recruitment_records(id) on delete set null,
  part        text not null check (length(part) between 1 and 40),
  payee_type  text not null check (payee_type in ('candidate', 'referrer', 'employee', 'ta', 'freelancer')),
  payee_key   text not null default '' check (length(payee_key) <= 200),
  payee_name  text not null default '' check (length(payee_name) <= 200),
  emp_id      text not null default '' check (length(emp_id) <= 50),
  ta_pic      text references public.pics(code) on update cascade on delete set null,
  amount      numeric(14,0) not null check (amount >= 0),
  pit         numeric(14,0) not null default 0 check (pit >= 0),
  net         numeric(14,0) not null check (net >= 0),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  constraint bonus_line_net check (net = amount - pit)
);
create index bonus_lines_period_idx on public.bonus_lines (period_id);
create index bonus_lines_ta_idx on public.bonus_lines (ta_pic) where ta_pic is not null;
create unique index bonus_lines_once_idx on public.bonus_lines (period_id, record_id, part) where record_id is not null;
create index bonus_lines_record_idx on public.bonus_lines (kind, record_id, part) where record_id is not null;

create table public.bonus_referrals (
  record_id          bigint primary key references public.recruitment_records(id) on delete cascade,
  referrer_name      text not null default '' check (length(referrer_name) <= 200),
  referrer_emp_id    text not null default '' check (length(referrer_emp_id) <= 50),
  referrer_rank      text not null default '' check (length(referrer_rank) <= 50),
  referrer_dc        text not null default '' check (length(referrer_dc) <= 200),
  referrer_status    text not null default '' check (referrer_status in ('', 'Active', 'Resigned')),
  referrer_last_day  date,
  disciplinary       boolean not null default false,
  candidate_eligible text not null default '' check (candidate_eligible in ('', 'Yes', 'No')),
  referrer_eligible  text not null default '' check (referrer_eligible in ('', 'Yes', 'No')),
  note               text not null default '' check (length(note) <= 500),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id)
);

-- 2) RLS + quyền ------------------------------------------------------------------------
alter table public.bonus_settings enable row level security;
alter table public.bonus_periods enable row level security;
alter table public.bonus_lines enable row level security;
alter table public.bonus_referrals enable row level security;
create policy bonus_settings_read on public.bonus_settings for select to authenticated using (true);
create policy bonus_periods_read on public.bonus_periods for select to authenticated using (true);
create policy bonus_lines_read on public.bonus_lines for select to authenticated
  using ((select app.is_admin()) or (ta_pic is not null and ta_pic = (select app.my_pic())));
create policy bonus_referrals_read on public.bonus_referrals for select to authenticated using ((select app.is_admin()));

revoke all on public.bonus_settings, public.bonus_periods, public.bonus_lines, public.bonus_referrals from anon, authenticated;
grant select on public.bonus_settings, public.bonus_periods, public.bonus_lines, public.bonus_referrals to authenticated;
grant all on public.bonus_settings, public.bonus_periods, public.bonus_lines, public.bonus_referrals to service_role;
revoke all on sequence public.bonus_periods_id_seq, public.bonus_lines_id_seq from anon, authenticated;

insert into public.bonus_settings (kind, config) values
  ('referral', '{"candidate": 500000, "referrerDefault": 1000000, "referrerByDc": {"DC Hưng Yên": 1500000}}'::jsonb)
on conflict (kind) do nothing;

-- 3) Cấu hình mức tiền (admin) -----------------------------------------------------------
create or replace function public.bonus_settings_save(p_kind text, p_config jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  v_old jsonb;
begin
  if p_kind is null or p_kind not in ('referral', 'signon', 'ta_credit', 'onsite', 'freelancer') then
    raise exception 'BONUS_BAD_KIND' using errcode = 'PT422', detail = coalesce(p_kind, '');
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' or length(p_config::text) > 100000 then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'config';
  end if;
  select config into v_old from public.bonus_settings where kind = p_kind;
  insert into public.bonus_settings (kind, config, updated_at, updated_by) values (p_kind, p_config, now(), v_actor.id)
    on conflict (kind) do update set config = excluded.config, updated_at = now(), updated_by = v_actor.id;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_SETTINGS', null, '',
          jsonb_build_object('kind', p_kind, 'old', coalesce(v_old, '{}'::jsonb), 'new', p_config));
  return p_config;
end $$;

-- 4) Referral: người giới thiệu + Eligible (admin) ----------------------------------------
-- Phần đã chốt ở một kỳ thì không đổi được (mở lại kỳ trước): cờ ứng viên khi phần 'candidate' đã chốt,
-- thông tin / cờ người giới thiệu khi phần 'referrer' đã chốt.
create or replace function public.bonus_referral_save(p_record_id bigint, p jsonb)
returns public.bonus_referrals
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  r public.recruitment_records;
  o public.bonus_referrals;
  n public.bonus_referrals;
  v_cand_locked boolean;
  v_ref_locked boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'body'; end if;
  select * into r from public.recruitment_records where id = p_record_id;
  if r.id is null or r.is_archived then raise exception 'NOT_FOUND' using errcode = 'PT404'; end if;
  select * into o from public.bonus_referrals where record_id = p_record_id for update;

  n.record_id := p_record_id;
  n.referrer_name := btrim(coalesce(p ->> 'referrer_name', o.referrer_name, ''));
  n.referrer_emp_id := btrim(coalesce(p ->> 'referrer_emp_id', o.referrer_emp_id, ''));
  n.referrer_rank := btrim(coalesce(p ->> 'referrer_rank', o.referrer_rank, ''));
  n.referrer_dc := btrim(coalesce(p ->> 'referrer_dc', o.referrer_dc, ''));
  n.referrer_status := btrim(coalesce(p ->> 'referrer_status', o.referrer_status, ''));
  n.note := btrim(coalesce(p ->> 'note', o.note, ''));
  n.candidate_eligible := coalesce(p ->> 'candidate_eligible', o.candidate_eligible, '');
  n.referrer_eligible := coalesce(p ->> 'referrer_eligible', o.referrer_eligible, '');
  n.disciplinary := coalesce((p ->> 'disciplinary')::boolean, o.disciplinary, false);
  begin
    n.referrer_last_day := case when p ? 'referrer_last_day' then nullif(p ->> 'referrer_last_day', '')::date else o.referrer_last_day end;
  exception when others then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'referrer_last_day';
  end;
  if n.referrer_status not in ('', 'Active', 'Resigned') then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'referrer_status'; end if;
  if n.candidate_eligible not in ('', 'Yes', 'No') then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'candidate_eligible'; end if;
  if n.referrer_eligible not in ('', 'Yes', 'No') then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'referrer_eligible'; end if;
  if length(n.referrer_name) > 200 or length(n.referrer_emp_id) > 50 or length(n.referrer_rank) > 50
     or length(n.referrer_dc) > 200 or length(n.note) > 500 then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'length';
  end if;

  select exists (select 1 from public.bonus_lines l where l.kind = 'referral' and l.record_id = p_record_id and l.part = 'candidate'),
         exists (select 1 from public.bonus_lines l where l.kind = 'referral' and l.record_id = p_record_id and l.part = 'referrer')
    into v_cand_locked, v_ref_locked;
  if v_cand_locked and n.candidate_eligible is distinct from coalesce(o.candidate_eligible, '') then
    raise exception 'BONUS_PART_LOCKED' using errcode = 'PT409', detail = 'candidate';
  end if;
  if v_ref_locked and (n.referrer_name, n.referrer_emp_id, n.referrer_eligible)
       is distinct from (coalesce(o.referrer_name, ''), coalesce(o.referrer_emp_id, ''), coalesce(o.referrer_eligible, '')) then
    raise exception 'BONUS_PART_LOCKED' using errcode = 'PT409', detail = 'referrer';
  end if;

  insert into public.bonus_referrals as b (record_id, referrer_name, referrer_emp_id, referrer_rank, referrer_dc, referrer_status,
      referrer_last_day, disciplinary, candidate_eligible, referrer_eligible, note, updated_at, updated_by)
  values (n.record_id, n.referrer_name, n.referrer_emp_id, n.referrer_rank, n.referrer_dc, n.referrer_status,
      n.referrer_last_day, n.disciplinary, n.candidate_eligible, n.referrer_eligible, n.note, now(), v_actor.id)
  on conflict (record_id) do update set
      referrer_name = excluded.referrer_name, referrer_emp_id = excluded.referrer_emp_id, referrer_rank = excluded.referrer_rank,
      referrer_dc = excluded.referrer_dc, referrer_status = excluded.referrer_status, referrer_last_day = excluded.referrer_last_day,
      disciplinary = excluded.disciplinary, candidate_eligible = excluded.candidate_eligible,
      referrer_eligible = excluded.referrer_eligible, note = excluded.note, updated_at = now(), updated_by = v_actor.id
  returning * into n;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_REFERRAL_SAVE', r.id, r.candidate_code,
          jsonb_build_object('old', coalesce(to_jsonb(o), '{}'::jsonb) - 'updated_at' - 'updated_by',
                             'new', to_jsonb(n) - 'updated_at' - 'updated_by'));
  return n;
end $$;

-- 5) Chốt / mở lại kỳ (admin, mọi loại bonus) ---------------------------------------------
-- p_lines: mảng khoản tiền do shared/bonus tính (BonusLineInput). Kiểm: kiểu, tiền nguyên ≥ 0, net = amount − pit,
-- hồ sơ tồn tại, PIC tồn tại, không trùng (hồ sơ, phần) trong kỳ, phần chưa chốt ở kỳ khác cùng loại.
create or replace function public.bonus_lock(p_kind text, p_period text, p_asof date, p_lines jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  b public.bonus_periods;
  v_bad text;
  v_count int;
  v_total numeric;
begin
  if p_kind is null or p_kind not in ('referral', 'signon', 'ta_credit', 'onsite', 'freelancer') then
    raise exception 'BONUS_BAD_KIND' using errcode = 'PT422', detail = coalesce(p_kind, '');
  end if;
  if p_period is null or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'BONUS_BAD_PERIOD' using errcode = 'PT422', detail = coalesce(p_period, '');
  end if;
  if p_asof is null then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'asof'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'lines';
  end if;

  insert into public.bonus_periods (kind, period_key) values (p_kind, p_period) on conflict (kind, period_key) do nothing;
  select * into b from public.bonus_periods where kind = p_kind and period_key = p_period for update;
  if b.status = 'da_chot' then raise exception 'BONUS_ALREADY_LOCKED' using errcode = 'PT409'; end if;

  drop table if exists pg_temp._bl;
  create temp table _bl on commit drop as
    select t.* from jsonb_to_recordset(p_lines) as t(
      record_id bigint, part text, payee_type text, payee_key text, payee_name text, emp_id text, ta_pic text,
      amount numeric, pit numeric, net numeric, detail jsonb);

  select v into v_bad from (
    select case
      when amount is null or amount < 0 or amount <> trunc(amount) then 'amount'
      when coalesce(pit, 0) < 0 or coalesce(pit, 0) <> trunc(coalesce(pit, 0)) then 'pit'
      when net is null or net <> amount - coalesce(pit, 0) then 'net'
      when part is null or length(part) not between 1 and 40 then 'part'
      when payee_type is null or payee_type not in ('candidate', 'referrer', 'employee', 'ta', 'freelancer') then 'payee_type'
      when length(coalesce(payee_key, '')) > 200 or length(coalesce(payee_name, '')) > 200 or length(coalesce(emp_id, '')) > 50 then 'length'
      when detail is not null and jsonb_typeof(detail) <> 'object' then 'detail'
      when record_id is not null and not exists (select 1 from public.recruitment_records r where r.id = x.record_id) then 'record_id'
      when ta_pic is not null and not exists (select 1 from public.pics p where p.code = x.ta_pic) then 'ta_pic'
    end as v
    from pg_temp._bl x
  ) s where v is not null limit 1;
  if v_bad is not null then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = v_bad; end if;

  select string_agg(distinct coalesce(r.candidate_code, x.record_id::text), ', ') into v_bad
    from (select record_id, part from pg_temp._bl where record_id is not null group by 1, 2 having count(*) > 1) x
    left join public.recruitment_records r on r.id = x.record_id;
  if v_bad is not null then raise exception 'BONUS_DUPLICATE_LINE' using errcode = 'PT409', detail = v_bad; end if;

  select string_agg(distinct coalesce(r.candidate_code, x.record_id::text), ', ') into v_bad
    from pg_temp._bl x
    join public.bonus_lines l on l.kind = p_kind and l.record_id = x.record_id and l.part = x.part and l.period_id <> b.id
    left join public.recruitment_records r on r.id = x.record_id
   where x.record_id is not null;
  if v_bad is not null then raise exception 'BONUS_ALREADY_PAID' using errcode = 'PT409', detail = v_bad; end if;

  delete from public.bonus_lines where period_id = b.id;
  insert into public.bonus_lines (period_id, kind, record_id, part, payee_type, payee_key, payee_name, emp_id, ta_pic, amount, pit, net, detail)
    select b.id, p_kind, record_id, part, payee_type, coalesce(payee_key, ''), coalesce(payee_name, ''), coalesce(emp_id, ''),
           ta_pic, amount, coalesce(pit, 0), net, coalesce(detail, '{}'::jsonb)
      from pg_temp._bl;
  select count(*), coalesce(sum(amount), 0) into v_count, v_total from public.bonus_lines where period_id = b.id;

  update public.bonus_periods
     set status = 'da_chot', asof_date = p_asof, locked_at = now(), locked_by = v_actor.id,
         config = coalesce((select s.config from public.bonus_settings s where s.kind = p_kind), '{}'::jsonb)
   where id = b.id;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_LOCK', null, '',
          jsonb_build_object('kind', p_kind, 'period', p_period, 'asof', p_asof, 'count', v_count, 'total', v_total));
  return jsonb_build_object('kind', p_kind, 'period', p_period, 'count', v_count, 'total', v_total);
end $$;

create or replace function public.bonus_reopen(p_kind text, p_period text, p_reason text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  b public.bonus_periods;
  v_count int;
  v_total numeric;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'BONUS_REASON_REQUIRED' using errcode = 'PT422'; end if;
  select * into b from public.bonus_periods where kind = p_kind and period_key = p_period for update;
  if b.id is null or b.status <> 'da_chot' then raise exception 'BONUS_NOT_LOCKED' using errcode = 'PT409'; end if;
  select count(*), coalesce(sum(amount), 0) into v_count, v_total from public.bonus_lines where period_id = b.id;
  delete from public.bonus_lines where period_id = b.id;
  update public.bonus_periods set status = 'mo', locked_at = null, locked_by = null where id = b.id;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_REOPEN', null, '',
          jsonb_build_object('kind', p_kind, 'period', p_period, 'reason', left(btrim(p_reason), 500),
                             'removed_count', v_count, 'removed_total', v_total));
  return jsonb_build_object('kind', p_kind, 'period', p_period, 'status', 'mo');
end $$;

revoke all on function public.bonus_settings_save(text, jsonb), public.bonus_referral_save(bigint, jsonb),
  public.bonus_lock(text, text, date, jsonb), public.bonus_reopen(text, text, text) from public, anon;
grant execute on function public.bonus_settings_save(text, jsonb), public.bonus_referral_save(bigint, jsonb),
  public.bonus_lock(text, text, date, jsonb), public.bonus_reopen(text, text, text) to authenticated, service_role;

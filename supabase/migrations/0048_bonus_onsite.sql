-- 0048_bonus_onsite.sql – TA Onsite Allowance (task #10 phần 3). Dùng chung bonus_periods / bonus_lines / bonus_lock của 0045.
-- Quy tắc tính nằm ở shared/bonus/onsite.ts: client tính, bonus_lock chỉ kiểm dữ liệu và lưu ảnh chụp.
--  - bonus_onsite_days: ngày × TA (một dòng = TA onsite ngày đó). Admin đọc / ghi; TA đọc ngày của chính mình.
--  - bonus_settings 'onsite': đơn giá một ngày (100.000 như Excel).
-- Kỳ lương N trả ngày onsite của chính tháng N. Khoản tiền: bonus_lines kind 'onsite', part 'onsite', payee_type 'ta', ta_pic = PIC.

create table public.bonus_onsite_days (
  pic_code    text not null references public.pics(code) on update cascade on delete cascade,
  day         date not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  primary key (pic_code, day)
);
create index bonus_onsite_days_day_idx on public.bonus_onsite_days (day);

alter table public.bonus_onsite_days enable row level security;
create policy bonus_onsite_days_read on public.bonus_onsite_days for select to authenticated
  using ((select app.is_admin()) or pic_code = (select app.my_pic()));
revoke all on public.bonus_onsite_days from anon, authenticated;
grant select on public.bonus_onsite_days to authenticated;
grant all on public.bonus_onsite_days to service_role;

insert into public.bonus_settings (kind, config) values ('onsite', '{"ratePerDay": 100000}'::jsonb)
on conflict (kind) do nothing;

-- Thay toàn bộ ngày onsite của một TA trong tháng p_month ('YYYY-MM') bằng p_days. Trả số ngày sau khi lưu.
-- Kỳ onsite của tháng đó đã chốt → BONUS_PART_LOCKED (mở lại kỳ trước khi sửa).
create or replace function public.bonus_onsite_set(p_pic text, p_month text, p_days date[])
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  v_pic text := btrim(coalesce(p_pic, ''));
  v_from date;
  v_to date;
  v_old date[];
  v_new date[];
begin
  if not exists (select 1 from public.pics x where x.code = v_pic) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'pic_code';
  end if;
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'BONUS_BAD_PERIOD' using errcode = 'PT422', detail = coalesce(p_month, '');
  end if;
  v_from := (p_month || '-01')::date;
  v_to := (v_from + interval '1 month')::date - 1;
  select coalesce(array_agg(distinct d order by d), '{}') into v_new from unnest(coalesce(p_days, '{}')) d where d is not null;
  if exists (select 1 from unnest(v_new) d where d < v_from or d > v_to) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'days';
  end if;
  if exists (select 1 from public.bonus_periods b where b.kind = 'onsite' and b.period_key = p_month and b.status = 'da_chot') then
    raise exception 'BONUS_PART_LOCKED' using errcode = 'PT409', detail = 'onsite';
  end if;

  select coalesce(array_agg(o.day order by o.day), '{}') into v_old
    from public.bonus_onsite_days o where o.pic_code = v_pic and o.day between v_from and v_to;
  if v_old = v_new then return cardinality(v_new); end if;

  delete from public.bonus_onsite_days o where o.pic_code = v_pic and o.day between v_from and v_to and o.day <> all (v_new);
  insert into public.bonus_onsite_days (pic_code, day, updated_at, updated_by)
    select v_pic, d, now(), v_actor.id from unnest(v_new) d
  on conflict (pic_code, day) do nothing;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_ONSITE_SET', null, '',
          jsonb_build_object('pic_code', v_pic, 'month', p_month, 'old', to_jsonb(v_old), 'new', to_jsonb(v_new)));
  return cardinality(v_new);
end $$;

revoke all on function public.bonus_onsite_set(text, text, date[]) from public, anon;
grant execute on function public.bonus_onsite_set(text, text, date[]) to authenticated, service_role;

-- 0049_bonus_freelancer.sql – Recruitment Bonus cho Freelancer / CTV (task #10 phần 4). Dùng chung bonus_periods / bonus_lines / bonus_lock của 0045.
-- Quy tắc tính nằm ở shared/bonus/freelancer.ts: client tính, bonus_lock chỉ kiểm dữ liệu và lưu ảnh chụp.
--  - bonus_freelancers: danh sách CTV (không phải PIC, không có Emp ID). Có danh sách riêng để đếm đúng số ứng viên / CTV
--    (mức thưởng theo số ứng viên của CTV trong kỳ), tránh tên gõ tự do bị tách.
--  - bonus_freelancer_records: hồ sơ → CTV giới thiệu, cờ sửa tay ('' / Passed / Failed / Hold), ghi chú. Admin nhập ở màn Bonus.
--  - bonus_settings 'freelancer': minDays 30 (ngày lịch), khung mức theo số ứng viên (áp cả lô), PIT 10%.
-- Chỉ admin đọc / ghi (CTV không đăng nhập app). Khoản tiền: bonus_lines kind 'freelancer', part 'freelancer', payee_type 'freelancer',
-- payee_key 'FL-<id>', record_id = hồ sơ ứng viên (mỗi hồ sơ trả một lần).

create table public.bonus_freelancers (
  id          bigint generated always as identity primary key,
  name        text not null check (length(btrim(name)) between 1 and 200),
  phone       text not null default '' check (length(phone) <= 30),
  region      text not null default '' check (region in ('', 'North', 'South')),
  note        text not null default '' check (length(note) <= 500),
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);
create unique index bonus_freelancers_uniq on public.bonus_freelancers (lower(btrim(name)), phone);

create table public.bonus_freelancer_records (
  record_id      bigint primary key references public.recruitment_records(id) on delete cascade,
  freelancer_id  bigint references public.bonus_freelancers(id) on delete restrict,
  flag           text not null default '' check (flag in ('', 'Passed', 'Failed', 'Hold')),
  note           text not null default '' check (length(note) <= 500),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id)
);
create index bonus_freelancer_records_fl_idx on public.bonus_freelancer_records (freelancer_id);

alter table public.bonus_freelancers enable row level security;
alter table public.bonus_freelancer_records enable row level security;
create policy bonus_freelancers_read on public.bonus_freelancers for select to authenticated using ((select app.is_admin()));
create policy bonus_freelancer_records_read on public.bonus_freelancer_records for select to authenticated using ((select app.is_admin()));
revoke all on public.bonus_freelancers, public.bonus_freelancer_records from anon, authenticated;
grant select on public.bonus_freelancers, public.bonus_freelancer_records to authenticated;
grant all on public.bonus_freelancers, public.bonus_freelancer_records to service_role;

insert into public.bonus_settings (kind, config) values
  ('freelancer', '{
    "minDays": 30,
    "tiers": [{"max": 1, "amount": 700000}, {"max": 3, "amount": 800000}, {"max": 6, "amount": 900000}, {"max": null, "amount": 1000000}],
    "pitRate": 0.1
  }'::jsonb)
on conflict (kind) do nothing;

-- p: {id?, name?, phone?, region?, note?, active?}; không có id = tạo mới; khóa thiếu = giữ giá trị cũ.
create or replace function public.bonus_freelancer_save(p jsonb)
returns public.bonus_freelancers
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  o public.bonus_freelancers;
  n public.bonus_freelancers;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'body'; end if;
  if p ? 'active' and jsonb_typeof(p -> 'active') <> 'boolean' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'active'; end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    if jsonb_typeof(p -> 'id') <> 'number' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'id'; end if;
    select * into o from public.bonus_freelancers where id = (p ->> 'id')::bigint for update;
    if o.id is null then raise exception 'NOT_FOUND' using errcode = 'PT404'; end if;
  end if;

  n.name := btrim(coalesce(p ->> 'name', o.name, ''));
  n.phone := btrim(coalesce(p ->> 'phone', o.phone, ''));
  n.region := btrim(coalesce(p ->> 'region', o.region, ''));
  n.note := btrim(coalesce(p ->> 'note', o.note, ''));
  n.active := coalesce((p ->> 'active')::boolean, o.active, true);
  if length(n.name) not between 1 and 200 then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'name'; end if;
  if n.region not in ('', 'North', 'South') then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'region'; end if;
  if length(n.phone) > 30 or length(n.note) > 500 then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'length'; end if;
  if exists (select 1 from public.bonus_freelancers x
              where lower(btrim(x.name)) = lower(n.name) and x.phone = n.phone and x.id is distinct from o.id) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'duplicate';
  end if;

  if o.id is null then
    insert into public.bonus_freelancers (name, phone, region, note, active, updated_at, updated_by)
    values (n.name, n.phone, n.region, n.note, n.active, now(), v_actor.id) returning * into n;
  else
    update public.bonus_freelancers set name = n.name, phone = n.phone, region = n.region, note = n.note, active = n.active,
           updated_at = now(), updated_by = v_actor.id
     where id = o.id returning * into n;
  end if;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_FREELANCER', null, '',
          jsonb_build_object('old', coalesce(to_jsonb(o), '{}'::jsonb) - 'updated_at' - 'updated_by',
                             'new', to_jsonb(n) - 'updated_at' - 'updated_by'));
  return n;
end $$;

-- p: {freelancer_id? (null = bỏ gán), flag?, note?}; khóa thiếu = giữ giá trị cũ.
-- Hồ sơ đã có khoản ở kỳ Freelancer đã chốt → không đổi CTV / cờ (BONUS_PART_LOCKED); ghi chú vẫn sửa được.
create or replace function public.bonus_freelancer_record_save(p_record_id bigint, p jsonb)
returns public.bonus_freelancer_records
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.require_admin();
  r public.recruitment_records;
  o public.bonus_freelancer_records;
  n public.bonus_freelancer_records;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'body'; end if;
  select * into r from public.recruitment_records where id = p_record_id;
  if r.id is null or r.is_archived then raise exception 'NOT_FOUND' using errcode = 'PT404'; end if;
  if p ? 'freelancer_id' and jsonb_typeof(p -> 'freelancer_id') not in ('number', 'null') then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'freelancer_id';
  end if;
  select * into o from public.bonus_freelancer_records where record_id = p_record_id for update;

  n.record_id := p_record_id;
  n.freelancer_id := case when p ? 'freelancer_id' then (p ->> 'freelancer_id')::bigint else o.freelancer_id end;
  n.flag := coalesce(p ->> 'flag', o.flag, '');
  n.note := btrim(coalesce(p ->> 'note', o.note, ''));
  if n.freelancer_id is not null and not exists (select 1 from public.bonus_freelancers f where f.id = n.freelancer_id) then
    raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'freelancer_id';
  end if;
  if n.flag not in ('', 'Passed', 'Failed', 'Hold') then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'flag'; end if;
  if length(n.note) > 500 then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'note'; end if;

  if exists (select 1 from public.bonus_lines l where l.kind = 'freelancer' and l.record_id = p_record_id)
     and (n.freelancer_id is distinct from o.freelancer_id or n.flag is distinct from coalesce(o.flag, '')) then
    raise exception 'BONUS_PART_LOCKED' using errcode = 'PT409', detail = 'freelancer';
  end if;

  insert into public.bonus_freelancer_records as b (record_id, freelancer_id, flag, note, updated_at, updated_by)
  values (n.record_id, n.freelancer_id, n.flag, n.note, now(), v_actor.id)
  on conflict (record_id) do update set
    freelancer_id = excluded.freelancer_id, flag = excluded.flag, note = excluded.note, updated_at = now(), updated_by = v_actor.id
  returning * into n;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'BONUS_FREELANCER_RECORD', r.id, r.candidate_code,
          jsonb_build_object('old', coalesce(to_jsonb(o), '{}'::jsonb) - 'updated_at' - 'updated_by',
                             'new', to_jsonb(n) - 'updated_at' - 'updated_by'));
  return n;
end $$;

revoke all on function public.bonus_freelancer_save(jsonb) from public, anon;
revoke all on function public.bonus_freelancer_record_save(bigint, jsonb) from public, anon;
grant execute on function public.bonus_freelancer_save(jsonb) to authenticated, service_role;
grant execute on function public.bonus_freelancer_record_save(bigint, jsonb) to authenticated, service_role;

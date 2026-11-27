-- 0040_cnb_ob (Quy trình 2 – phối hợp CnB: chốt danh sách OB ngày 25, CnB kiểm hồ sơ)
-- Quy tắc: shared/cnbRules.ts (bản trình duyệt) – app.cnb_exclude_reasons dưới đây phải cho cùng kết quả.
--   Kỳ tháng T = 25/(T-1) → 24/T. Vào danh sách: OBD trong kỳ, "Chi lương", còn làm việc tại ngày chốt, không lưu trữ.
-- Chốt = chụp ảnh (src) hồ sơ + thông tin nhân sự vào cnb_ob_items: sau ngày chốt, sửa hồ sơ không đổi danh sách đã gửi CnB.
-- Chốt lại (sau khi mở lại) cập nhật ảnh chụp nhưng GIỮ kết quả CnB kiểm hồ sơ (cnb_check).
-- Ghi chỉ qua RPC (security definer, admin). Đọc: admin tất cả; TA chỉ item của hồ sơ mình (src có CCCD, ngân hàng).
-- Kế hoạch: docs/KE_HOACH_MA_GHE_VA_CNB.md (mục 2). Chưa áp dụng trên project nào.

-- 1) Bảng --------------------------------------------------------------------
create table public.cnb_ob_batches (
  id bigint generated always as identity primary key,
  cycle_key text not null unique check (cycle_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  from_date date not null,
  to_date date not null,
  status text not null default 'mo' check (status in ('mo', 'da_chot')),
  item_count int not null default 0,
  locked_at timestamptz,
  locked_by uuid references public.profiles(id),
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint cnb_batch_range check (from_date < to_date),
  constraint cnb_batch_locked check (status = 'mo' or locked_at is not null)
);

create table public.cnb_ob_items (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.cnb_ob_batches(id) on delete cascade,
  record_id bigint not null references public.recruitment_records(id),
  pic text,                                         -- PIC lúc chốt (RLS cho TA)
  src jsonb not null,                               -- ảnh chụp: cột hồ sơ + "hr" (hr_info.data) + "hr_status"
  added_late boolean not null default false,        -- bổ sung sau chốt
  late_reason text not null default '',
  cnb_check jsonb not null default '{}'::jsonb,     -- {bang_cap,cccd,ksk,syll,hdtv,hdld,qdnv}: '' | 'x' | 'o'
  cnb_note text not null default '' check (length(cnb_note) <= 500),
  checked_by uuid references public.profiles(id),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cnb_item_unique unique (batch_id, record_id)
);
create index cnb_ob_items_pic_idx on public.cnb_ob_items (batch_id, pic);
create index cnb_ob_items_record_idx on public.cnb_ob_items (record_id);

alter table public.cnb_ob_batches enable row level security;
alter table public.cnb_ob_items enable row level security;
create policy cnb_batch_read on public.cnb_ob_batches for select to authenticated using (true);
create policy cnb_item_read on public.cnb_ob_items for select to authenticated
  using ((select app.is_admin()) or app.can_see_record(pic));

revoke all on public.cnb_ob_batches, public.cnb_ob_items from anon, authenticated;
grant select on public.cnb_ob_batches, public.cnb_ob_items to authenticated;
grant all on public.cnb_ob_batches, public.cnb_ob_items to service_role;

-- 2) Hàm dùng chung ------------------------------------------------------------
create or replace function app.cnb_norm(p text) returns text
language sql immutable set search_path = ''
as $$ select btrim(regexp_replace(normalize(coalesce(p, ''), nfc), '\s+', ' ', 'g')) $$;

-- Khoảng ngày của kỳ 'YYYY-MM' (= cycleOf).
create or replace function app.cnb_cycle_range(p_cycle text, out from_date date, out to_date date)
language plpgsql immutable set search_path = ''
as $$
declare v_m date;
begin
  if p_cycle is null or p_cycle !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'CNB_BAD_CYCLE' using errcode = 'PT422', detail = coalesce(p_cycle, '');
  end if;
  v_m := to_date(p_cycle || '-01', 'YYYY-MM-DD');
  from_date := (v_m - interval '1 month')::date + 24;   -- ngày 25 tháng trước
  to_date := v_m + 23;                                  -- ngày 24 tháng T
end $$;

-- Lý do bị loại (= cnbEligibility.reasons). Mảng rỗng = vào danh sách.
create or replace function app.cnb_exclude_reasons(r public.recruitment_records, p_from date, p_to date, p_asof date)
returns text[]
language sql stable set search_path = ''
as $$
  select array_remove(array[
    case when r.ob_date is null or r.ob_date < p_from or r.ob_date > p_to then 'ngoai_ky' end,
    case when app.cnb_norm(r.salary_pay_status) <> 'Chi lương' then 'chua_chi_luong' end,
    case when app.cnb_norm(r.emp_status) = 'Resigned' or (r.attrition_date is not null and r.attrition_date <= p_asof) then 'da_nghi' end,
    case when r.is_archived then 'luu_tru' end
  ], null)
$$;

-- Ảnh chụp một hồ sơ (= CnbSource của shared/cnbTemplate.ts).
create or replace function app.cnb_src(r public.recruitment_records, h public.hr_info)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'record_id', r.id, 'candidate_code', r.candidate_code, 'pic', r.pic, 'emp_id', r.emp_id, 'full_name', r.full_name,
    'phone', r.phone, 'email', r.email, 'position', r.position, 'rank', r.rank, 'region', r.region, 'location', r.location,
    'unit', r.unit, 'dept', r.dept, 'site', r.site, 'hire_type', r.hire_type, 'ob_date', r.ob_date,
    'probation_period', r.probation_period, 'contract_sign_status', r.contract_sign_status,
    'salary_pay_status', r.salary_pay_status, 'drive_upload', r.drive_upload, 'edu_certificate', r.edu_certificate,
    'health_check', r.health_check, 'id_card', r.id_card, 'resume', r.resume, 'doc_note', r.doc_note,
    'emp_status', r.emp_status, 'attrition_date', r.attrition_date, 'cutoff', r.cutoff, 'is_archived', r.is_archived,
    'hr', coalesce(h.data, '{}'::jsonb), 'hr_status', coalesce(h.status, ''))
$$;

revoke all on function app.cnb_norm(text), app.cnb_cycle_range(text), app.cnb_exclude_reasons(public.recruitment_records, date, date, date),
  app.cnb_src(public.recruitment_records, public.hr_info) from public, anon;
grant execute on function app.cnb_norm(text), app.cnb_cycle_range(text), app.cnb_exclude_reasons(public.recruitment_records, date, date, date),
  app.cnb_src(public.recruitment_records, public.hr_info) to authenticated, service_role;

create or replace function app.cnb_vn_today() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;
revoke all on function app.cnb_vn_today() from public, anon;
grant execute on function app.cnb_vn_today() to authenticated, service_role;

create or replace function app.cnb_actor() returns public.profiles
language plpgsql stable security definer set search_path = ''
as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = (select auth.uid()) and active;
  if v.id is null or v.role <> 'admin' then raise exception 'CNB_ADMIN_ONLY' using errcode = '42501'; end if;
  return v;
end $$;
revoke all on function app.cnb_actor() from public, anon, authenticated;

-- 3) Xem trước (TA và admin, theo RLS hồ sơ) -----------------------------------------
-- Mọi hồ sơ (không lưu trữ) có OBD trong kỳ, kèm lý do bị loại tính tại p_asof (mặc định hôm nay theo giờ VN).
create or replace function public.cnb_ob_preview(p_cycle text, p_asof date default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  rg record;
  v_asof date := coalesce(p_asof, app.cnb_vn_today());
begin
  select * into rg from app.cnb_cycle_range(p_cycle);
  return coalesce((
    select jsonb_agg(app.cnb_src(r, h) || jsonb_build_object('reasons', to_jsonb(app.cnb_exclude_reasons(r, rg.from_date, rg.to_date, v_asof)))
                     order by r.ob_date, r.pic, r.candidate_code)
      from public.recruitment_records r
      left join public.hr_info h on h.record_id = r.id
     where not r.is_archived and r.ob_date between rg.from_date and rg.to_date
  ), '[]'::jsonb);
end $$;
revoke all on function public.cnb_ob_preview(text, date) from public, anon;
grant execute on function public.cnb_ob_preview(text, date) to authenticated, service_role;

-- 4) Chốt / mở lại / bổ sung / bỏ / kiểm hồ sơ (chỉ admin) ------------------------------
create or replace function public.cnb_ob_lock(p_cycle text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.cnb_actor();
  rg record;
  b public.cnb_ob_batches;
  v_asof date := app.cnb_vn_today();
  v_removed int;
  v_count int;
begin
  select * into rg from app.cnb_cycle_range(p_cycle);
  insert into public.cnb_ob_batches (cycle_key, from_date, to_date) values (p_cycle, rg.from_date, rg.to_date)
    on conflict (cycle_key) do nothing;
  select * into b from public.cnb_ob_batches where cycle_key = p_cycle for update;
  if b.status = 'da_chot' then raise exception 'CNB_ALREADY_LOCKED' using errcode = 'PT409'; end if;

  -- Một câu lệnh: bỏ item không còn đủ điều kiện (trừ người bổ sung), thêm / cập nhật ảnh chụp người đủ điều kiện.
  with e as (
    select r.id as record_id, r.pic, app.cnb_src(r, h) as src
      from public.recruitment_records r
      left join public.hr_info h on h.record_id = r.id
     where r.ob_date between rg.from_date and rg.to_date
       and cardinality(app.cnb_exclude_reasons(r, rg.from_date, rg.to_date, v_asof)) = 0
  ), d as (
    delete from public.cnb_ob_items i
     where i.batch_id = b.id and not i.added_late
       and not exists (select 1 from e where e.record_id = i.record_id)
    returning 1
  ), u as (
    insert into public.cnb_ob_items (batch_id, record_id, pic, src)
      select b.id, e.record_id, e.pic, e.src from e
    on conflict (batch_id, record_id) do update
      set src = excluded.src, pic = excluded.pic, updated_at = now()
    returning 1
  )
  select (select count(*) from d) into v_removed;

  select count(*) into v_count from public.cnb_ob_items where batch_id = b.id;
  update public.cnb_ob_batches
     set status = 'da_chot', locked_at = now(), locked_by = v_actor.id, item_count = v_count
   where id = b.id;

  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'CNB_LOCK', null, '',
          jsonb_build_object('cycle', p_cycle, 'count', v_count, 'removed', v_removed, 'asof', v_asof));
  return jsonb_build_object('cycle', p_cycle, 'count', v_count, 'removed', v_removed);
end $$;

create or replace function public.cnb_ob_reopen(p_cycle text, p_reason text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.cnb_actor();
  b public.cnb_ob_batches;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'CNB_REASON_REQUIRED' using errcode = 'PT422';
  end if;
  select * into b from public.cnb_ob_batches where cycle_key = p_cycle for update;
  if b.id is null or b.status <> 'da_chot' then raise exception 'CNB_NOT_LOCKED' using errcode = 'PT409'; end if;
  update public.cnb_ob_batches set status = 'mo' where id = b.id;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'CNB_REOPEN', null, '',
          jsonb_build_object('cycle', p_cycle, 'reason', left(btrim(p_reason), 500)));
  return jsonb_build_object('cycle', p_cycle, 'status', 'mo');
end $$;

-- Bổ sung người sau chốt (vd. TA cập nhật "Chi lương" muộn). Không xét điều kiện – admin quyết, có lý do.
create or replace function public.cnb_ob_add_late(p_cycle text, p_record_id bigint, p_reason text)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.cnb_actor();
  b public.cnb_ob_batches;
  r public.recruitment_records;
  h public.hr_info;
  v_id bigint;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'CNB_REASON_REQUIRED' using errcode = 'PT422'; end if;
  select * into b from public.cnb_ob_batches where cycle_key = p_cycle for update;
  if b.id is null or b.status <> 'da_chot' then raise exception 'CNB_NOT_LOCKED' using errcode = 'PT409'; end if;
  select * into r from public.recruitment_records where id = p_record_id;
  if r.id is null or r.is_archived then raise exception 'NOT_FOUND' using errcode = 'PT404'; end if;
  select * into h from public.hr_info where record_id = r.id;
  insert into public.cnb_ob_items (batch_id, record_id, pic, src, added_late, late_reason)
  values (b.id, r.id, r.pic, app.cnb_src(r, h), true, left(btrim(p_reason), 500))
  on conflict (batch_id, record_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'CNB_ITEM_EXISTS' using errcode = 'PT409'; end if;
  update public.cnb_ob_batches set item_count = item_count + 1 where id = b.id;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'CNB_ADD', r.id, r.candidate_code,
          jsonb_build_object('cycle', p_cycle, 'reason', left(btrim(p_reason), 500)));
  return v_id;
end $$;

create or replace function public.cnb_ob_remove_item(p_item_id bigint, p_reason text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.cnb_actor();
  i public.cnb_ob_items;
  b public.cnb_ob_batches;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'CNB_REASON_REQUIRED' using errcode = 'PT422'; end if;
  select * into i from public.cnb_ob_items where id = p_item_id;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'PT404'; end if;
  select * into b from public.cnb_ob_batches where id = i.batch_id for update;
  delete from public.cnb_ob_items where id = i.id;
  update public.cnb_ob_batches set item_count = greatest(item_count - 1, 0) where id = b.id;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'CNB_REMOVE', i.record_id, coalesce(i.src ->> 'candidate_code', ''),
          jsonb_build_object('cycle', b.cycle_key, 'reason', left(btrim(p_reason), 500)));
end $$;

-- CnB kiểm hồ sơ: gộp các ô gửi lên vào cnb_check (chỉ khóa / giá trị hợp lệ), ghi chú thay mới khi p_note khác null.
create or replace function public.cnb_item_check(p_item_id bigint, p_check jsonb, p_note text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := app.cnb_actor();
  i public.cnb_ob_items;
  k text;
  v text;
  v_changes jsonb := '{}'::jsonb;
begin
  select * into i from public.cnb_ob_items where id = p_item_id for update;
  if i.id is null then raise exception 'NOT_FOUND' using errcode = 'PT404'; end if;
  if p_check is null or jsonb_typeof(p_check) <> 'object' then raise exception 'INVALID_INPUT' using errcode = 'PT422'; end if;
  for k, v in select key, value from jsonb_each_text(p_check) loop
    if k not in ('bang_cap', 'cccd', 'ksk', 'syll', 'hdtv', 'hdld', 'qdnv') or coalesce(v, '') not in ('', 'x', 'o') then
      raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = k;
    end if;
    if (i.cnb_check ->> k) is distinct from v then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('old', coalesce(i.cnb_check ->> k, ''), 'new', v));
    end if;
  end loop;
  if p_note is not null and length(p_note) > 500 then raise exception 'INVALID_INPUT' using errcode = 'PT422', detail = 'note'; end if;
  if p_note is not null and p_note is distinct from i.cnb_note then
    v_changes := v_changes || jsonb_build_object('cnb_note', jsonb_build_object('old', i.cnb_note, 'new', p_note));
  end if;
  if v_changes = '{}'::jsonb then return i.cnb_check; end if;
  update public.cnb_ob_items
     set cnb_check = cnb_check || p_check, cnb_note = coalesce(p_note, cnb_note),
         checked_by = v_actor.id, checked_at = now(), updated_at = now()
   where id = i.id
   returning * into i;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'CNB_CHECK', i.record_id, coalesce(i.src ->> 'candidate_code', ''), v_changes);
  return i.cnb_check;
end $$;

revoke all on function public.cnb_ob_lock(text), public.cnb_ob_reopen(text, text), public.cnb_ob_add_late(text, bigint, text),
  public.cnb_ob_remove_item(bigint, text), public.cnb_item_check(bigint, jsonb, text) from public, anon;
grant execute on function public.cnb_ob_lock(text), public.cnb_ob_reopen(text, text), public.cnb_ob_add_late(text, bigint, text),
  public.cnb_ob_remove_item(bigint, text), public.cnb_item_check(bigint, jsonb, text) to authenticated, service_role;

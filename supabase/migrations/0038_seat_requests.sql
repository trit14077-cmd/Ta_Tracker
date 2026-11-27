-- 0038_seat_requests (Quy trình 1 – tạo mã ghế)
-- Luồng: TA nhập ở tài khoản riêng (nhap) → gửi HRBP (gui, ngày gửi = hôm nay) → HRBP xác nhận (xac_nhan, admin ghi thay)
--        → HRSS cấp mã (da_cap_ma, qua RPC seat_issue_codes). Mỗi ghế một mã 8 chữ số, số liên tiếp.
-- Quy tắc nghiệp vụ: docs/SEAT_CODE_RULES.md và shared/seatCodeRules.ts (bản frontend; DB kiểm lại các ràng buộc).
-- Ghi chú: migration này CHƯA áp dụng trên bất kỳ project nào. Cần duyệt schema trước khi chạy (IMPLEMENTATION_TASKS §nguyên tắc).

-- 1) Bảng yêu cầu ghế ---------------------------------------------------------
create table public.seat_requests (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) default auth.uid(),
  status text not null default 'nhap' check (status in ('nhap', 'gui', 'xac_nhan', 'da_cap_ma')),
  ngay_gui date,                                   -- sheet "Ngày gửi": ghi khi TA gửi HRBP (trigger)
  ban text not null check (length(btrim(ban)) > 0),                 -- Ban/ Chuỗi/ Khối
  don_vi text not null default '',                                  -- Các đơn vị thành viên
  phong text not null default '',                                   -- Phòng/ Bộ Phận/ Nhóm
  doi text not null default '',                                     -- Đội
  to_nhom text not null default '',                                 -- Tổ (PP/IB/OB/IN/GV)
  nhom_site text not null default '',                               -- Nhóm (Site)
  vung text not null check (vung in ('Miền Bắc', 'Miền Nam', 'Miền Trung')),   -- Phòng/Vùng/Miền
  nhom_chuc_danh text not null check (nhom_chuc_danh ~ '^Rank [2-6]$'),        -- Nhóm Chức Danh
  ranking_ap text not null check (ranking_ap ~ '^[2-6][A-C]$'),                -- Ranking theo AP
  ranking_offer text not null default '' check (ranking_offer = '' or ranking_offer ~ '^[2-6][A-C]$'),
  vi_tri_ap text not null check (length(btrim(vi_tri_ap)) > 0),              -- VỊ TRÍ THEO AP (JOB)
  vi_tri_offer_vi text not null default '',
  vi_tri_offer_en text not null default '',
  so_luong int not null check (so_luong between 1 and 100),
  quan_ly_truc_tiep text not null check (length(btrim(quan_ly_truc_tiep)) > 0),
  cost_center text not null default '',                             -- HRBP điền
  note text not null default '',
  ma_ghe text[] not null default '{}',                              -- HRSS cấp; số phần tử = so_luong khi đã cấp
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz,
  issued_by uuid references public.profiles(id),
  constraint seat_ngay_gui_khi_gui check (status = 'nhap' or ngay_gui is not null),
  constraint seat_ma_ghe_dung_so_luong check (cardinality(ma_ghe) in (0, so_luong)),
  constraint seat_ma_ghe_khi_cap check ((status = 'da_cap_ma') = (cardinality(ma_ghe) > 0))
);
create index seat_requests_owner_idx on public.seat_requests (owner_id, status);
create index seat_requests_status_idx on public.seat_requests (status, ngay_gui);

-- Bộ đếm mã: một dòng. Giá trị khởi tạo = mã lớn nhất thấy trong sheet (25597257). HRSS xác nhận và chỉnh bằng seat_counter_set.
create table public.seat_code_counter (
  id int primary key default 1 check (id = 1),
  last_issued bigint not null check (last_issued >= 0 and last_issued < 99999999)
);
insert into public.seat_code_counter (id, last_issued) values (1, 25597257) on conflict (id) do nothing;

-- 2) Trigger: chặn chuyển trạng thái trái phép, khóa mã đã cấp, kiểm định dạng mã --------
create or replace function public.seat_requests_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_admin boolean := app.is_admin();
  v_issuing boolean := coalesce(current_setting('app.seat_issue', true), '') = 'on';
  c text;
begin
  if old.status = 'da_cap_ma' then
    raise exception 'SEAT_ISSUED_LOCKED: mã đã cấp không được sửa' using errcode = 'P0001';
  end if;

  if new.status is distinct from old.status then
    if (old.status, new.status) = ('nhap', 'gui') then
      new.ngay_gui := (now() at time zone 'Asia/Ho_Chi_Minh')::date;  -- TA gửi HRBP (ngày theo giờ Việt Nam, không phải UTC)
    elsif (old.status, new.status) in (('gui', 'xac_nhan'), ('gui', 'nhap'), ('xac_nhan', 'da_cap_ma')) then
      if not v_admin then raise exception 'SEAT_ADMIN_ONLY' using errcode = '42501'; end if;
      if (old.status, new.status) = ('gui', 'nhap') then new.ngay_gui := null; end if;  -- HRBP/HRSS trả về TA
    else
      raise exception 'SEAT_BAD_TRANSITION: % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'da_cap_ma' and not v_issuing then
    raise exception 'SEAT_CODE_LOCKED: chỉ seat_issue_codes được cấp mã' using errcode = '42501';
  end if;
  if new.ma_ghe is distinct from old.ma_ghe or new.issued_at is distinct from old.issued_at or new.issued_by is distinct from old.issued_by then
    if not (v_admin and v_issuing) then
      raise exception 'SEAT_CODE_LOCKED: chỉ seat_issue_codes được ghi mã' using errcode = '42501';
    end if;
    foreach c in array new.ma_ghe loop
      if c !~ '^[0-9]{8}$' then raise exception 'SEAT_CODE_FORMAT: % không đủ 8 chữ số', c using errcode = 'P0001'; end if;
    end loop;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger seat_requests_guard before update on public.seat_requests
  for each row execute function public.seat_requests_guard();

-- 3) RLS: TA chỉ thấy và sửa dòng của mình; admin (HRSS) thấy tất cả -------------------
alter table public.seat_requests enable row level security;
alter table public.seat_code_counter enable row level security;   -- không có policy: chỉ hàm definer đọc/ghi

create policy seat_read on public.seat_requests for select to authenticated
  using ((select app.is_admin()) or owner_id = (select auth.uid()));
create policy seat_insert on public.seat_requests for insert to authenticated
  with check (owner_id = (select auth.uid()) and status = 'nhap' and ma_ghe = '{}'
              and ngay_gui is null and issued_at is null and issued_by is null);
create policy seat_update_owner on public.seat_requests for update to authenticated
  using (owner_id = (select auth.uid()) and status = 'nhap')
  with check (owner_id = (select auth.uid()) and status in ('nhap', 'gui'));
create policy seat_update_admin on public.seat_requests for update to authenticated
  using ((select app.is_admin()) and status <> 'da_cap_ma')
  with check ((select app.is_admin()));
create policy seat_delete on public.seat_requests for delete to authenticated
  using (status = 'nhap' and (owner_id = (select auth.uid()) or (select app.is_admin())));

-- 4) RPC: HRSS cấp mã (admin, dưới khóa advisory; số liên tiếp từ bộ đếm) -------------
create or replace function public.seat_issue_codes(p_ids bigint[])
returns setof public.seat_requests
language plpgsql security definer set search_path = '' as $$
declare
  r public.seat_requests;
  u public.seat_requests;
  i int;
  v_next bigint;
  v_codes text[];
begin
  if not app.is_admin() then
    raise exception 'SEAT_ADMIN_ONLY' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('seat_issue_codes'));
  perform set_config('app.seat_issue', 'on', true);

  for r in
    select * from public.seat_requests
    where id = any(p_ids) and status = 'xac_nhan'
    order by ngay_gui, id
    for update
  loop
    v_codes := '{}';
    for i in 1..r.so_luong loop                                     -- mỗi ghế một mã
      update public.seat_code_counter set last_issued = last_issued + 1
        where id = 1 returning last_issued into v_next;
      if v_next > 99999999 then raise exception 'SEAT_CODE_RANGE_EXHAUSTED' using errcode = 'P0001'; end if;
      v_codes := array_append(v_codes, v_next::text);
    end loop;
    update public.seat_requests
       set ma_ghe = v_codes, status = 'da_cap_ma', issued_at = now(), issued_by = auth.uid()
     where id = r.id
     returning * into u;
    return next u;
  end loop;
end $$;

-- HRSS đặt lại điểm bắt đầu (ví dụ khi sheet cũ có mã lớn hơn). Không cho lùi: lùi là cấp trùng mã.
create or replace function public.seat_counter_set(p_last bigint)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_now bigint;
begin
  if not app.is_admin() then
    raise exception 'SEAT_ADMIN_ONLY' using errcode = '42501';
  end if;
  if p_last is null or p_last < 0 or p_last >= 99999999 then
    raise exception 'SEAT_COUNTER_RANGE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('seat_issue_codes'));
  select last_issued into v_now from public.seat_code_counter where id = 1 for update;
  if p_last < v_now then
    raise exception 'SEAT_COUNTER_NO_ROLLBACK: đang ở %, không được lùi về %', v_now, p_last using errcode = 'P0001';
  end if;
  update public.seat_code_counter set last_issued = p_last where id = 1;
  return p_last;
end $$;

-- HRSS xem mã đã cấp gần nhất (chỉ admin; người khác nhận null).
create or replace function public.seat_counter_get() returns bigint
language sql stable security definer set search_path = '' as $$
  select case when app.is_admin() then (select c.last_issued from public.seat_code_counter c where c.id = 1) end
$$;

-- 5) Quyền -----------------------------------------------------------------------
revoke all on public.seat_requests, public.seat_code_counter from anon, authenticated;
grant select, insert, update, delete on public.seat_requests to authenticated, service_role;
grant usage, select on sequence public.seat_requests_id_seq to authenticated, service_role;
revoke execute on function public.seat_issue_codes(bigint[]) from public, anon;
revoke execute on function public.seat_counter_set(bigint) from public, anon;
revoke execute on function public.seat_counter_get() from public, anon;
grant execute on function public.seat_issue_codes(bigint[]) to authenticated, service_role;
grant execute on function public.seat_counter_set(bigint) to authenticated, service_role;
grant execute on function public.seat_counter_get() to authenticated, service_role;

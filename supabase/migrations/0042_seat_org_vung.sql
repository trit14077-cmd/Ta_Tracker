-- 0042_seat_org_vung (Quy trình 1 – mã ghế): Phòng/Vùng/Miền đi theo Đội, khóa cứng (PO chốt 27/11/2026).
-- Nguồn: 166 dòng NhapLieu (20/23 Đội chỉ có 1 vùng) + địa lý. Nghệ An (Kho Vinh, TTPP) = Miền Trung theo PO.
-- Chưa rõ vùng (để trống = chọn tự do): Trung Tâm Phân Phối Bình Thuận, Trung Tâm Phân Phối Suối Mơ. Admin điền sau ở màn hình Cây đơn vị.
-- Quy tắc: lấy các nhánh đang dùng khớp với phần đã chọn (tiền tố); nếu tất cả cùng 1 vùng khác rỗng thì Vùng phải đúng vùng đó.
--   Khối văn phòng (không có Đội) để trống vùng ở cây -> chọn tự do như cũ.
-- Trigger chỉ kiểm khi tạo mới hoặc đổi 1 trong 5 cột tổ chức / cột vùng (dòng cũ không bị khóa).

alter table public.seat_org_paths add column vung text not null default ''
  constraint seat_org_paths_vung_check check (vung in ('', 'Miền Bắc', 'Miền Nam', 'Miền Trung'));

update public.seat_org_paths s set vung = m.vung
from (values
  ('Kho Bắc Ninh', 'Miền Bắc'), ('Kho Hải Phòng', 'Miền Bắc'), ('Kho Phú Thọ', 'Miền Bắc'), ('Kho Yên Mỹ - Hưng Yên', 'Miền Bắc'),
  ('Kho Nhà máy Hà Nam', 'Miền Bắc'), ('Kho Nhà máy Hà Nội', 'Miền Bắc'),
  ('Trung Tâm Phân Phối Hưng Yên', 'Miền Bắc'), ('Trung Tâm Phân Phối Hải Dương', 'Miền Bắc'),
  ('Trung Tâm Phân Phối Hải Phòng', 'Miền Bắc'), ('Trung Tâm Phân Phối Quang Hanh', 'Miền Bắc'),
  ('Kho Cần Thơ', 'Miền Nam'), ('Kho Phúc Long – Bình Dương', 'Miền Nam'), ('Kho VSIP 2 Bình Dương', 'Miền Nam'),
  ('Kho VSIP 2 Bình Dương 2', 'Miền Nam'), ('Kho Nhà máy 3FF', 'Miền Nam'), ('Kho Nhà máy HCM', 'Miền Nam'),
  ('Kho Nhà máy Long An', 'Miền Nam'), ('Trung Tâm Phân Phối Hậu Giang', 'Miền Nam'), ('Trung Tâm Phân Phối Sóng Thần', 'Miền Nam'),
  ('Trung Tâm Phân Phối Tân Bình', 'Miền Nam'), ('Trung Tâm Phân Phối Đồng Nai', 'Miền Nam'), ('Trung Tâm Phân Phối Đồng Nai 2', 'Miền Nam'),
  ('Kho Khánh Hòa', 'Miền Trung'), ('Kho Đà Nẵng', 'Miền Trung'), ('Trung Tâm Phân Phối Đà Nẵng', 'Miền Trung'),
  ('Trung Tâm Phân Phối Phú Yên', 'Miền Trung'), ('Kho Vinh - Nghệ An', 'Miền Trung'), ('Trung Tâm Phân Phối Nghệ An', 'Miền Trung')
) as m(doi, vung)
where s.doi = m.doi;

-- Chặn gõ sai tên Đội ở bảng trên (28 Đội phải khớp cây 0041).
do $$
declare n int;
begin
  select count(distinct doi) into n from public.seat_org_paths where vung <> '';
  if n <> 28 then raise exception 'SEAT_VUNG_SEED: % doi (can 28)', n; end if;
end $$;

-- Vùng bắt buộc theo phần tổ chức đã chọn; null = chọn tự do.
create or replace function app.seat_vung_required(p_ban text, p_don_vi text, p_phong text, p_doi text, p_to text)
returns text language sql stable set search_path = '' as $$
  with v as (select btrim(coalesce(p_ban, '')) b, btrim(coalesce(p_don_vi, '')) d, btrim(coalesce(p_phong, '')) p,
                    btrim(coalesce(p_doi, '')) o, btrim(coalesce(p_to, '')) t),
  m as (
    select s.vung from public.seat_org_paths s, v
    where s.active and v.b <> '' and s.ban = v.b and (v.d = '' or s.don_vi = v.d) and (v.p = '' or s.phong = v.p)
      and (v.o = '' or s.doi = v.o) and (v.t = '' or s.to_nhom = v.t))
  select case when count(*) > 0 and count(distinct vung) = 1 and min(vung) <> '' then min(vung) end from m
$$;
revoke all on function app.seat_vung_required(text, text, text, text, text) from public, anon;
grant execute on function app.seat_vung_required(text, text, text, text, text) to authenticated, service_role;

-- 'SEAT_VUNG_LOCKED' khi Vùng khác vùng bắt buộc; null = hợp lệ.
create or replace function app.seat_vung_error(p_ban text, p_don_vi text, p_phong text, p_doi text, p_to text, p_vung text)
returns text language sql stable set search_path = '' as $$
  select case when r is not null and r <> btrim(coalesce(p_vung, '')) then 'SEAT_VUNG_LOCKED' end
  from (select app.seat_vung_required(p_ban, p_don_vi, p_phong, p_doi, p_to) as r) x
$$;
revoke all on function app.seat_vung_error(text, text, text, text, text, text) from public, anon;
grant execute on function app.seat_vung_error(text, text, text, text, text, text) to authenticated, service_role;

-- Trigger 0041 kiểm thêm Vùng (cùng trigger seat_requests_org_check).
create or replace function public.tg_seat_org_check() returns trigger
language plpgsql set search_path = '' as $$
declare e text;
begin
  if tg_op = 'UPDATE' and (new.ban, new.don_vi, new.phong, new.doi, new.to_nhom, new.vung)
       is not distinct from (old.ban, old.don_vi, old.phong, old.doi, old.to_nhom, old.vung) then
    return new;
  end if;
  e := coalesce(app.seat_org_error(new.ban, new.don_vi, new.phong, new.doi, new.to_nhom),
                app.seat_vung_error(new.ban, new.don_vi, new.phong, new.doi, new.to_nhom, new.vung));
  if e is not null then
    raise exception '%', e using errcode = 'P0001',
      detail = format('%s > %s > %s > %s > %s | %s', new.ban, new.don_vi, new.phong, new.doi, new.to_nhom, new.vung);
  end if;
  return new;
end $$;
revoke all on function public.tg_seat_org_check() from public, anon, authenticated;

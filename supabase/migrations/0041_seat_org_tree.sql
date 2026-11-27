-- 0041_seat_org_tree (Quy trình 1 – mã ghế): dropdown phụ thuộc Ban → Đơn vị → Phòng → Đội → Tổ như sheet mã ghế.
-- Nguồn: tab RawData của sheet "Request_Job Requisition" (107 nhánh, 27/11/2026). Mỗi dòng = 1 nhánh; cấp sau để '' khi nhánh dừng.
-- Quy tắc (giống sheet NhapLieu: 165/166 dòng mẫu khớp): 5 cột của một yêu cầu phải là TIỀN TỐ của một nhánh đang dùng
--   – được dừng ở giữa (31 dòng mẫu dừng ở giữa), không được bỏ trống cấp giữa rồi điền cấp sau.
-- Admin (HRSS) sửa danh mục trực tiếp trên bảng (thêm nhánh, tắt active). TA chỉ đọc.
-- Trigger chỉ kiểm khi tạo mới hoặc khi đổi 1 trong 5 cột: dòng cũ không bị khóa nếu danh mục đổi sau này.

create table public.seat_org_paths (
  id bigint generated always as identity primary key,
  ban text not null check (length(btrim(ban)) > 0),
  don_vi text not null default '',
  phong text not null default '',
  doi text not null default '',
  to_nhom text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint seat_org_paths_no_hole check (
    (don_vi <> '' or (phong = '' and doi = '' and to_nhom = ''))
    and (phong <> '' or (doi = '' and to_nhom = ''))
    and (doi <> '' or to_nhom = '')),
  constraint seat_org_paths_uniq unique (ban, don_vi, phong, doi, to_nhom)
);

insert into public.seat_org_paths (ban, don_vi, phong, doi, to_nhom) values
  ('An ninh, An toàn và Kiểm soát tuân thủ', 'ANCS, ATLĐ & PCCN', 'An ninh, An toàn', '', ''),
  ('An ninh, An toàn và Kiểm soát tuân thủ', 'An Ninh Nội Bộ', '', '', ''),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Bắc Ninh', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Cần Thơ', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Hải Phòng', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Hải Phòng', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Hải Phòng', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Hải Phòng', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Hải Phòng', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Hải Phòng', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Khánh Hòa', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Khánh Hòa', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Khánh Hòa', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Khánh Hòa', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Khánh Hòa', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Khánh Hòa', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phú Thọ', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phú Thọ', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phú Thọ', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phú Thọ', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phú Thọ', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phú Thọ', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phúc Long – Bình Dương', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phúc Long – Bình Dương', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phúc Long – Bình Dương', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phúc Long – Bình Dương', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phúc Long – Bình Dương', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Phúc Long – Bình Dương', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương 2', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương 2', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương 2', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương 2', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương 2', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho VSIP 2 Bình Dương 2', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Vinh - Nghệ An', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Vinh - Nghệ An', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Vinh - Nghệ An', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Vinh - Nghệ An', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Vinh - Nghệ An', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Vinh - Nghệ An', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Yên Mỹ - Hưng Yên', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Yên Mỹ - Hưng Yên', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Yên Mỹ - Hưng Yên', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Yên Mỹ - Hưng Yên', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Yên Mỹ - Hưng Yên', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Yên Mỹ - Hưng Yên', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Đà Nẵng', 'Inbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Đà Nẵng', 'Inventory'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Đà Nẵng', 'Outbound'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Đà Nẵng', 'Pick Pack'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Đà Nẵng', 'Điều phối Giao vận'),
  ('Chuỗi Cung Ứng', 'Ambient Logistics', 'Kho Ambient', 'Kho Đà Nẵng', 'Điều phối Kho vận'),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'DRP - Điều phối', '', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Bình Thuận', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Hưng Yên', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Hải Dương', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Hải Phòng', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Hậu Giang', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Nghệ An', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Phú Yên', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Quang Hanh', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Suối Mơ', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Sóng Thần', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Tân Bình', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Đà Nẵng', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Đồng Nai', ''),
  ('Chuỗi Cung Ứng', 'Ambient – MCH Logistics', 'Kho Ambient MCH', 'Trung Tâm Phân Phối Đồng Nai 2', ''),
  ('Chuỗi Cung Ứng', 'Cool Chain Logistics', 'Kho Cool Chain', 'Kho Nhà máy 3FF', ''),
  ('Chuỗi Cung Ứng', 'Cool Chain Logistics', 'Kho Cool Chain', 'Kho Nhà máy HCM', ''),
  ('Chuỗi Cung Ứng', 'Cool Chain Logistics', 'Kho Cool Chain', 'Kho Nhà máy Hà Nam', ''),
  ('Chuỗi Cung Ứng', 'Cool Chain Logistics', 'Kho Cool Chain', 'Kho Nhà máy Hà Nội', ''),
  ('Chuỗi Cung Ứng', 'Cool Chain Logistics', 'Kho Cool Chain', 'Kho Nhà máy Long An', ''),
  ('Chuỗi Cung Ứng', 'Fresh Logistics', 'Kho Fresh', '', ''),
  ('Chuỗi Cung Ứng', 'Transportation', '', '', ''),
  ('Công nghệ thông tin', 'Nhóm ứng dụng SUPRA', 'Phát triển Ứng dụng', '', ''),
  ('Công nghệ thông tin', 'Nhóm ứng dụng SUPRA', 'Sản phẩm', '', ''),
  ('MPO', '', '', '', ''),
  ('Pháp chế', 'Pháp chế The Supra', '', '', ''),
  ('Phát triển Nguồn Nhân lực', '3Pls Management', '', '', ''),
  ('Phát triển Nguồn Nhân lực', 'C&B', '', '', ''),
  ('Phát triển Nguồn Nhân lực', 'HRBP', '', '', ''),
  ('Phát triển Nguồn Nhân lực', 'Tuyển dụng', '', '', ''),
  ('Phát triển Nguồn Nhân lực', 'Đào tạo & Phát Triển Nguồn lực', '', '', ''),
  ('Transformation', 'Kế hoạch', 'Kế hoạch', '', ''),
  ('Transformation', 'Kế hoạch', 'Đặt hàng - Tồn kho', '', ''),
  ('Transformation', 'Sản phẩm & Chiến lược chuyển đổi', '', '', ''),
  ('Transformation', 'Tối ưu Vận hành', '', '', ''),
  ('Tài chính & Kế toán', 'Kế toán', '', '', ''),
  ('Tài chính & Kế toán', 'Tài chính Quản trị', 'Tài chính FMCG', '', ''),
  ('Tài chính & Kế toán', 'Tài chính Quản trị', 'Tài chính Retail', '', ''),
  ('Văn phòng Tổng Giám Đốc', '', '', '', '')
on conflict on constraint seat_org_paths_uniq do nothing;

alter table public.seat_org_paths enable row level security;
create policy seat_org_read on public.seat_org_paths for select to authenticated using (true);
create policy seat_org_admin on public.seat_org_paths for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
revoke all on public.seat_org_paths from anon, authenticated;
grant select, insert, update, delete on public.seat_org_paths to authenticated;
grant all on public.seat_org_paths to service_role;

-- Kiểm 1 bộ 5 cột: null = hợp lệ; ngược lại trả mã lỗi + cấp sai.
create or replace function app.seat_org_error(p_ban text, p_don_vi text, p_phong text, p_doi text, p_to text)
returns text language sql stable set search_path = '' as $$
  with v as (select btrim(coalesce(p_ban, '')) b, btrim(coalesce(p_don_vi, '')) d, btrim(coalesce(p_phong, '')) p,
                    btrim(coalesce(p_doi, '')) o, btrim(coalesce(p_to, '')) t)
  select case
    when v.d = '' and (v.p <> '' or v.o <> '' or v.t <> '') then 'SEAT_ORG_HOLE:don_vi'
    when v.p = '' and (v.o <> '' or v.t <> '') then 'SEAT_ORG_HOLE:phong'
    when v.o = '' and v.t <> '' then 'SEAT_ORG_HOLE:doi'
    when not exists (select 1 from public.seat_org_paths s where s.active and s.ban = v.b) then 'SEAT_ORG_INVALID:ban'
    when v.d <> '' and not exists (select 1 from public.seat_org_paths s where s.active and s.ban = v.b and s.don_vi = v.d) then 'SEAT_ORG_INVALID:don_vi'
    when v.p <> '' and not exists (select 1 from public.seat_org_paths s where s.active and s.ban = v.b and s.don_vi = v.d and s.phong = v.p) then 'SEAT_ORG_INVALID:phong'
    when v.o <> '' and not exists (select 1 from public.seat_org_paths s where s.active and s.ban = v.b and s.don_vi = v.d and s.phong = v.p and s.doi = v.o) then 'SEAT_ORG_INVALID:doi'
    when v.t <> '' and not exists (select 1 from public.seat_org_paths s where s.active and s.ban = v.b and s.don_vi = v.d and s.phong = v.p and s.doi = v.o and s.to_nhom = v.t) then 'SEAT_ORG_INVALID:to_nhom'
  end from v
$$;
revoke all on function app.seat_org_error(text, text, text, text, text) from public, anon;
grant execute on function app.seat_org_error(text, text, text, text, text) to authenticated, service_role;

create or replace function public.tg_seat_org_check() returns trigger
language plpgsql set search_path = '' as $$
declare e text;
begin
  if tg_op = 'UPDATE' and (new.ban, new.don_vi, new.phong, new.doi, new.to_nhom)
       is not distinct from (old.ban, old.don_vi, old.phong, old.doi, old.to_nhom) then
    return new;
  end if;
  e := app.seat_org_error(new.ban, new.don_vi, new.phong, new.doi, new.to_nhom);
  if e is not null then
    raise exception '%', e using errcode = 'P0001',
      detail = format('%s > %s > %s > %s > %s', new.ban, new.don_vi, new.phong, new.doi, new.to_nhom);
  end if;
  return new;
end $$;
revoke all on function public.tg_seat_org_check() from public, anon, authenticated;

create trigger seat_requests_org_check before insert or update on public.seat_requests
  for each row execute function public.tg_seat_org_check();

-- 0043_seat_positions (Quy trình 1 – mã ghế): Ranking theo AP đi theo Vị trí theo AP (JOB), khóa cứng (PO 27/11/2026).
-- 1 vị trí có thể có nhiều ranking ("mỗi vị trí có ranking khác nhau"). Mỗi dòng = 1 cặp (vị trí, ranking).
-- Nguồn: 166 dòng NhapLieu sheet "Request_Job Requisition": 56 vị trí (gộp các tên chỉ khác hoa/thường, ưu tiên tên
--   trong danh mục vị trí chuẩn shared/positionCatalog.ts), 64 cặp, 8 vị trí có 2 ranking.
-- Quy tắc: vị trí phải có trong danh mục đang dùng; Ranking AP phải thuộc vị trí đó. Vị trí mới: admin thêm (màn hình Vị trí – Ranking).
-- Trigger chỉ kiểm khi tạo mới hoặc đổi Vị trí AP / Ranking AP: dòng cũ không bị khóa nếu danh mục đổi sau.

create table public.seat_positions (
  id bigint generated always as identity primary key,
  vi_tri text not null check (length(btrim(vi_tri)) > 0),
  ranking text not null check (ranking ~ '^[2-6][ABC]$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint seat_positions_uniq unique (vi_tri, ranking)
);

insert into public.seat_positions (vi_tri, ranking) values
  ('Chuyên viên Hành chính Cấp cao', '5A'),
  ('Chuyên viên hỗ trợ vận hành', '5A'),
  ('Chuyên viên Kiểm soát Số liệu Kho vận', '5B'),
  ('Chuyên viên Kiểm soát Số liệu Kho vận', '5C'),
  ('Chuyên Viên Kiểm soát thanh quyết toán', '5A'),
  ('Chuyên viên Kế toán', '5A'),
  ('Chuyên Viên mua hàng', '5A'),
  ('Chuyên Viên Mua Hàng Cấp Cao', '5A'),
  ('Chuyên viên Pháp chế', '4C'),
  ('Chuyên viên Phân tích Dữ liệu Nhân sự', '5B'),
  ('Chuyên viên Phân tích Hiệu suất Vận tải', '5A'),
  ('Chuyên viên Quản lý Kho', '5C'),
  ('Chuyên viên Thanh quyết toán', '5B'),
  ('Chuyên viên Tiền lương và Phúc lợi', '5A'),
  ('Chuyên Viên Tối Ưu Vận Hành', '5A'),
  ('Chuyên Viên Điều Phối Giao Vận', '5B'),
  ('Chuyên viên Điều phối Kho vận', '5B'),
  ('Công nhân Kho', '6C'),
  ('Giám Sát An Toàn, Sức Khỏe Và Môi Trường', '4B'),
  ('Giám Sát Hoạch định Nguồn lực Thuê Ngoài', '4B'),
  ('Giám Sát Hoạch định Nguồn lực Thuê Ngoài', '4C'),
  ('Giám Sát Phát Triển Sản Phẩm', '4B'),
  ('Giám Sát Phân tích Dữ liệu Nhân sự', '4B'),
  ('Giám Sát Phân tích Dữ liệu Nhân sự', '4C'),
  ('Giám sát Phân tích Hiệu suất Vận tải', '4B'),
  ('Giám sát Quản trị Cơ sở Dữ liệu', '4C'),
  ('Giám sát thanh quyết toán', '4C'),
  ('Giám sát Tiền lương & Phúc lợi', '4C'),
  ('Giám sát Tài chính', '4B'),
  ('Giám sát Tài chính', '4C'),
  ('Giám sát Tối ưu Vận hành', '4B'),
  ('Giám sát Tối ưu Vận hành', '4C'),
  ('Giám sát điều phối kho vận', '4B'),
  ('Giám sát Đào tạo', '4C'),
  ('Giám đốc Vận hành Trung tâm phân phối bán lẻ', '2C'),
  ('HRBP', '4A'),
  ('Nhân viên Kho', '6A'),
  ('Nhân viên Kiểm soát Dữ liệu Kho vận', '6A'),
  ('Nhân viên Kiểm soát Số liệu Kho vận', '6A'),
  ('Nhân viên Lái xe nâng', '6A'),
  ('Nhân viên Lái xe nâng', '6B'),
  ('Nhân viên Quản lý Kho', '5C'),
  ('Nhân viên Tuyển Dụng', '5C'),
  ('Nhân viên Tuyển Dụng', '6A'),
  ('Nhân viên Vận hành Kho', '6B'),
  ('Nhân viên điều phối giao vận', '5C'),
  ('Phó phòng Tiền lương phúc lợi', '4A'),
  ('Quản trị Cơ sở Dữ liệu', '4C'),
  ('Thủ Kho', '6A'),
  ('Thực tập sinh Hoạch định Nguồn lực Thuê ngoài', '6C'),
  ('Thực tập sinh mua hàng', '6C'),
  ('Thực tập sinh Tuyển Dụng', '6C'),
  ('Thực tập sinh Tối Ưu Vận Hành', '6C'),
  ('Thực tập sinh vận hành', '6C'),
  ('Trưởng kho', '4A'),
  ('Trưởng nhóm Điều phối Giao vận', '4C'),
  ('Trưởng nhóm Điều phối Kho vận', '4C'),
  ('Trưởng nhóm Điều phối Kho vận', '5A'),
  ('Trưởng phòng An toàn Sức khỏe và Môi trường', '3B'),
  ('Trưởng phòng Kế Hoạch Kho Vận', '3C'),
  ('Trưởng phòng Pháp chế', '3C'),
  ('Trưởng phòng Phân tích Dữ liệu Nhân sự', '3C'),
  ('Trưởng phòng Quản lý Kho vận Cấp cao', '3B'),
  ('Trưởng phòng Tài chính Quản trị', '3C');

alter table public.seat_positions enable row level security;
create policy seat_pos_read on public.seat_positions for select to authenticated using (true);
create policy seat_pos_admin on public.seat_positions for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
revoke all on public.seat_positions from anon, authenticated;
grant select, insert, update, delete on public.seat_positions to authenticated;
grant all on public.seat_positions to service_role;

-- null = hợp lệ; 'SEAT_POS_UNKNOWN' (vị trí ngoài danh mục) / 'SEAT_POS_RANKING' (ranking không thuộc vị trí).
create or replace function app.seat_position_error(p_vi_tri text, p_ranking text)
returns text language sql stable set search_path = '' as $$
  with v as (select btrim(coalesce(p_vi_tri, '')) p, upper(btrim(coalesce(p_ranking, ''))) r)
  select case
    when v.p = '' then null
    when not exists (select 1 from public.seat_positions s where s.active and s.vi_tri = v.p) then 'SEAT_POS_UNKNOWN'
    when v.r <> '' and not exists (select 1 from public.seat_positions s where s.active and s.vi_tri = v.p and s.ranking = v.r)
      then 'SEAT_POS_RANKING'
  end from v
$$;
revoke all on function app.seat_position_error(text, text) from public, anon;
grant execute on function app.seat_position_error(text, text) to authenticated, service_role;

create or replace function public.tg_seat_position_check() returns trigger
language plpgsql set search_path = '' as $$
declare e text;
begin
  if tg_op = 'UPDATE' and (new.vi_tri_ap, new.ranking_ap) is not distinct from (old.vi_tri_ap, old.ranking_ap) then
    return new;
  end if;
  e := app.seat_position_error(new.vi_tri_ap, new.ranking_ap);
  if e is not null then
    raise exception '%', e using errcode = 'P0001', detail = format('%s | %s', new.vi_tri_ap, new.ranking_ap);
  end if;
  return new;
end $$;
revoke all on function public.tg_seat_position_check() from public, anon, authenticated;

create trigger seat_requests_position_check before insert or update on public.seat_requests
  for each row execute function public.tg_seat_position_check();

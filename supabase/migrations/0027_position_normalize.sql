-- 0027_position_normalize.sql – chuẩn hóa danh mục vị trí theo file Việt–Anh 18.11 (PO duyệt 20/11/2026; shared/positionCatalog.ts).
-- 25 tên đổi (20 tên tiếng Anh -> tên Việt, 5 chỉ khác hoa/thường): đổi trong danh mục, hồ sơ (tăng row_version để form đang mở
-- báo xung đột thay vì ghi đè tên cũ) và target; 15 vị trí mới trong file được thêm vào danh mục. Mỗi tên đổi ghi 1 dòng nhật ký
-- DROPDOWN (người thực hiện 'system'). Chạy lại không đổi gì thêm.
-- Gói trong 1 khối DO: SQL Editor của Supabase có thể chạy từng câu trên kết nối khác nhau nên bảng tạm ngoài khối
-- không còn ở câu sau (42P01). Trong khối DO, tất cả là 1 lệnh, lỗi ở đâu thì hoàn tác toàn bộ.

do $$
begin
drop table if exists _pos_ren;
create temporary table _pos_ren (old text primary key, new text not null) on commit drop;
insert into _pos_ren values
  ('HRIS & HRSS Executive', 'Chuyên viên Tiền lương & Phúc lợi'),
  ('Workforce Business Intelligence Supervisor', 'Giám Sát Phân tích Dữ liệu Nhân sự'),
  ('Data Platform Administrator', 'Giám sát Quản trị Cơ sở Dữ liệu'),
  ('Legal Manager', 'Trưởng phòng Pháp chế'),
  ('Operational Excellence Manager', 'Trưởng phòng Tối ưu Vận hành'),
  ('Payment Control Executive', 'Chuyên Viên Kiểm soát thanh quyết toán'),
  ('Talent Acquisition Executive', 'Chuyên viên Tuyển dụng'),
  ('Workforce Management Supervisor', 'Giám Sát Hoạch định Nguồn lực Thuê Ngoài'),
  ('Planning Supervisor', 'Giám sát kế hoạch kho vận'),
  ('HSE Supervisor', 'Giám Sát An Toàn Sức Khỏe Và Môi Trường'),
  ('Inventory Supervisor', 'Giám sát kho vận'),
  ('Accounting Executive', 'Chuyên viên Kế toán'),
  ('Finance Manager', 'Trưởng phòng Tài chính'),
  ('Legal Executive', 'Chuyên viên Pháp chế'),
  ('Transport Performance Analyst', 'Chuyên viên Phân tích Hiệu suất Vận tải'),
  ('MPO Intern', 'Thực tập sinh mua hàng'),
  ('FMCG Intern', 'Thực tập sinh vận hành'),
  ('Senior Product Manager', 'Trưởng phòng Phát triển Sản phẩm'),
  ('Security Executive', 'Chuyên viên An Ninh'),
  ('WFM Contractor', 'Cộng tác viên nhân sự'),
  ('Trưởng Kho', 'Trưởng kho'),
  ('Giám sát kho', 'Giám Sát kho'),
  ('Chuyên viên Tối ưu Vận hành', 'Chuyên Viên Tối Ưu Vận Hành'),
  ('Phó phòng Phân tích Hiệu suất Kho vận', 'Phó Phòng Phân tích Hiệu suất Kho vận'),
  ('Nhân Viên Kiểm Soát Số Liệu Kho Vận', 'Nhân viên Kiểm soát Số liệu Kho vận');

-- nhật ký trước khi đổi (chỉ tên còn tồn tại)
insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
select null, 'system', 'admin', 'DROPDOWN', null, '',
       jsonb_build_object('position', jsonb_build_object('old', r.old, 'new', r.new || ' (chuẩn hóa theo danh sách vị trí Việt–Anh 18.11; '
         || (select count(*) from public.recruitment_records x where x.position = r.old) || ' hồ sơ)'))
  from _pos_ren r where exists (select 1 from public.dropdown_options o where o.list_key = 'position' and o.value = r.old);

update public.recruitment_records x set position = r.new, row_version = x.row_version + 1, updated_at = now()
  from _pos_ren r where x.position = r.old;
update public.targets t set position = r.new from _pos_ren r where t.position = r.old;
-- danh mục: tên mới đã có thì bỏ tên cũ, chưa có thì đổi tên tại chỗ (giữ thứ tự)
delete from public.dropdown_options o using _pos_ren r
 where o.list_key = 'position' and o.value = r.old
   and exists (select 1 from public.dropdown_options n where n.list_key = 'position' and n.value = r.new);
update public.dropdown_options o set value = r.new from _pos_ren r where o.list_key = 'position' and o.value = r.old;

-- vị trí mới (cuối danh sách)
insert into public.dropdown_options (list_key, value, active, sort_order)
select 'position', v.value, true, (select coalesce(max(sort_order), 0) from public.dropdown_options where list_key = 'position') + v.n
  from (values
    ('Chuyên viên Điều phối Kho vận', 1),
    ('Chuyên viên Điều phối Giao vận', 2),
    ('Chuyên viên Kiểm Soát Dữ Liệu Kho Vận Cấp Cao', 3),
    ('Giám Sát Phát Triển Sản Phẩm', 4),
    ('Trưởng phòng An toàn Sức khỏe và Môi trường', 5),
    ('Giám sát mua hàng', 6),
    ('Chuyên Viên mua hàng', 7),
    ('Chuyên viên hành chính', 8),
    ('Giám sát Tiền lương & Phúc lợi', 9),
    ('Phó phòng Tiền lương & Phúc lợi', 10),
    ('Chuyên Viên Đối tác Nhân sự', 11),
    ('Chuyên Viên Đào tạo', 12),
    ('Chuyên viên Truyền thông Nội bộ', 13),
    ('Trưởng Phòng Đào tạo và Phát triển Tổ chức', 14),
    ('Trưởng phòng Kế Hoạch Kho Vận', 15)
  ) as v(value, n)
on conflict (list_key, value) do nothing;

drop table _pos_ren;
end $$;

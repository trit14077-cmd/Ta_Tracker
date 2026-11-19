-- 0008_rr_read_policy.sql (DEV) – M2-7 (PO duyệt 19/11/2026): viết lại policy đọc recruitment_records cho nhanh.
-- Lý do: policy cũ "app.can_see_record(pic)" gọi hàm SECURITY DEFINER trên TỪNG dòng (Postgres không inline được),
-- trên 20.000 dòng: đếm/tìm/báo cáo mất 350–1000 ms. Viết dạng dưới, quyền người hỏi được tính 1 lần (initPlan)
-- và dùng được index theo pic: < 14 ms (job CI perf, 19/11/2026).
-- Ý nghĩa KHÔNG đổi, giống hệt app.can_see_record: Admin thấy tất cả; TA thấy hồ sơ có pic = PIC của mình (pic khác
-- null/rỗng); hồ sơ chưa gán PIC chỉ Admin thấy. app.can_see_record giữ nguyên (Edge files dùng để kiểm 1 hồ sơ).
alter policy rr_read on public.recruitment_records
  using ((select app.is_admin()) or (pic is not null and pic <> '' and pic = (select app.my_pic())));

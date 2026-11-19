-- 0004_service_role_grants.sql (DEV) - cấp quyền cho service_role (script ETL/nạp dữ liệu, Edge Function sau này).
-- Lý do: 0001/0002 chỉ revoke anon/authenticated; project không có default privileges cho service_role
-- nên service_role không đọc/ghi được bảng và không gọi được report_totals(). service_role vẫn bypass RLS.
-- Đã duyệt 19/11/2026 (bản hẹp: chỉ các bảng/hàm hiện có, không đặt default privileges).
grant usage on schema public to service_role;
grant select, insert, update, delete on public.pics, public.recruitment_records,
  public.import_batches, public.applicants to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.report_totals(date,date) to service_role;

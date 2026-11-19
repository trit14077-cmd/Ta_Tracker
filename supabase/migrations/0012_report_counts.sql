-- 0012_report_counts.sql – M5-3: số hồ sơ cho dòng "x / y ứng viên" của trang Báo cáo
-- (hệ cũ: rows.length / all.length sau khi tải dòng thô; nay không tải dòng thô nên đếm ở server).
-- all = số hồ sơ (không lưu trữ) người dùng được xem; filtered = số đó sau bộ lọc (cùng rr_filter_sql của 0011).
create or replace function public.report_counts(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  n_all bigint;
  n_f bigint;
begin
  select count(*) into n_all from public.v_report_rows;
  execute format('select count(*) from public.v_report_rows q where %s', public.rr_filter_sql(p_filters)) into n_f;
  return jsonb_build_object('all', n_all, 'filtered', n_f);
end $$;

revoke all on function public.report_counts(jsonb) from public, anon;
grant execute on function public.report_counts(jsonb) to authenticated, service_role;

-- 0014_board_counts_fast.sql – sửa tốc độ board_counts (0010; thẻ KPI trên danh sách ứng viên + PipelineKpiStrip).
-- Đo trên DEV 19/11/2026: ~1.000 ms/lần với 9.829 hồ sơ vì mỗi dòng gọi rr_board_col + rr_board_sub (hàm sau lại gọi
-- hàm trước) – hàm có SET search_path nên Postgres không gộp được vào truy vấn. Viết lại: biểu thức ô lấy từ
-- rr_board_col_sql() (0013, = rr_board_col), chỉ số phụ tính từ ô bằng CASE (= rr_board_sub), chạy bằng SQL động.
-- Ý nghĩa, tham số và kết quả KHÔNG đổi (candidate_list_test, board_test so board_counts với board_page/boardPosition).
create or replace function public.board_counts(p_pic text default '') returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  res jsonb;
  w text := 'not r.is_archived';
begin
  -- như 0010: lọc pic chỉ có tác dụng với Admin
  if coalesce(p_pic, '') <> '' and (select app.is_admin()) then
    w := w || format(' and r.pic = %L', p_pic);
  end if;
  execute format($q$
    with c as (
      select %1$s as col, r.r1_status, r.r2_status, r.r2_date, r.ob_status
        from public.recruitment_records r
       where %2$s
    ), b as materialized (
      select c.col,
             (btrim(c.r1_status) = 'Failed' or btrim(c.r2_status) in ('Failed', 'Canceled')
              or btrim(c.ob_status) in ('Canceled', 'Noshow')) as failed,
             case c.col
               when 'lead' then 'lead_new'
               when 'r1' then case when btrim(c.r1_status) = 'Failed' then null else 'r1_wait' end
               when 'lusu' then case when c.r2_date is not null then 'lu' else 'su' end
               when 'r2' then case btrim(c.r2_status)
                                when 'Passed' then 'r2_passed' when 'Failed' then 'r2_failed' when 'Canceled' then 'r2_canceled'
                                else 'lu' end
               when 'ob' then case
                                when btrim(c.r1_status) = 'Failed' or btrim(c.r2_status) in ('Failed', 'Canceled')
                                  or btrim(c.ob_status) in ('Canceled', 'Noshow') then null
                                when btrim(c.ob_status) in ('', 'Pending', 'Không liên lạc được') then 'ob_wait'
                                else null end
             end as sub
        from c
    ), cnt as (
      select col, count(*) as total, count(*) filter (where failed) as failed from b group by col
    ), sc as (
      select sub, count(*) as n from b where sub is not null group by sub
    )
    select jsonb_build_object(
      'counts', (select jsonb_object_agg(k, jsonb_build_object('total', coalesce(n.total, 0), 'failed', coalesce(n.failed, 0)))
                   from unnest(array['lead','r1','lusu','r2','ob']) k left join cnt n on n.col = k),
      'subs',   (select jsonb_object_agg(s, coalesce(x.n, 0))
                   from unnest(array['lead_new','r1_wait','su','lu','r2_passed','r2_failed','r2_canceled','ob_wait']) s
                   left join sc x on x.sub = s))
  $q$, public.rr_board_col_sql(), w) into res;
  return res;
end $$;

revoke all on function public.board_counts(text) from public, anon;
grant execute on function public.board_counts(text) to authenticated, service_role;

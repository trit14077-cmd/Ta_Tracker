-- M2-7: đo thời gian truy vấn (EXPLAIN ANALYZE, gồm planning) trên 20.000 hồ sơ, dưới quyền Admin và TA (có RLS).
-- Mỗi truy vấn: 1 lần làm nóng + 5 lần đo. Ngưỡng: lần chậm nhất < 200 ms (IMPLEMENTATION_TASKS M2-7).
-- Variant A = policy hiện hành (migrations, từ 0008 đã là dạng tối ưu). Variant B = áp lại dạng tối ưu (ROLLBACK) –
-- giữ để phát hiện nếu migration sau làm policy chậm lại (A lệch xa B). Chỉ A bị kiểm ngưỡng. Chạy sau perf_seed.sql.
\set ON_ERROR_STOP 1
begin;

create temp table perf_results (variant text, label text, who text, ms numeric[]);
grant all on perf_results to public;

create function pg_temp.measure(p_variant text) returns void language plpgsql as $f$
declare
  q record; i int; j json; t numeric; arr numeric[];
  v_admin uuid := '00000000-0000-4000-8000-0000000003a0';
  v_ta    uuid := '00000000-0000-4000-8000-0000000003b1';
  v_rec bigint := (select min(c.record_id) from public.comments c join public.recruitment_records r on r.id = c.record_id
                    where r.pic = 'TA3-Thang');
  v_phone text := (select phone from public.recruitment_records where pic = 'TA3-Thang' and phone <> '' order by id limit 1);
  cols text := 'id, candidate_code, full_name, phone, position, pic, site, r1_status, r2_status, ob_status, created_at';
begin
  if v_rec is null or v_phone is null then
    raise exception 'Dữ liệu perf_seed thiếu: hồ sơ TA3 có bình luận = %, SĐT TA3 = %', v_rec, v_phone;
  end if;
  for q in
    select * from (values
      ('L1 danh sách trang 1',            'admin', format('select %s from public.recruitment_records where not is_archived order by created_at desc limit 50', cols)),
      ('L2 danh sách trang 1',            'ta',    format('select %s from public.recruitment_records where not is_archived order by created_at desc limit 50', cols)),
      ('L3 danh sách trang 20',           'ta',    format('select %s from public.recruitment_records where not is_archived order by created_at desc limit 50 offset 950', cols)),
      ('F1 lọc PIC + R1 + khoảng ngày',   'admin', format('select %s from public.recruitment_records where pic = %L and r1_status = %L and r1_date between %L and %L order by r1_date desc limit 50', cols, 'TA3-Thang', 'Passed', '2025-06-01', '2026-06-30')),
      ('F2 lọc OB Joined + vùng',         'ta',    format('select %s from public.recruitment_records where ob_status = %L and region = %L order by ob_date desc limit 50', cols, 'Joined', 'Miền Nam')),
      ('C1 đếm tổng (phân trang)',        'ta',    'select count(*) from public.recruitment_records where not is_archived'),
      ('C2 đếm theo bộ lọc',              'admin', 'select count(*) from public.recruitment_records where region = ''Miền Nam'' and ob_status = ''Joined'''),
      ('S1 tìm theo tên',                 'admin', format('select %s from public.recruitment_records where full_name ilike %L order by created_at desc limit 50', cols, '%Văn Bình%')),
      ('S2 tìm theo tên',                 'ta',    format('select %s from public.recruitment_records where full_name ilike %L order by created_at desc limit 50', cols, '%Thị Lan%')),
      ('S3 tìm theo mã',                  'admin', format('select %s from public.recruitment_records where candidate_code ilike %L limit 50', cols, '%P0123%')),
      ('S4 tìm theo SĐT',                 'ta',    format('select %s from public.recruitment_records where phone = %L', cols, v_phone)),
      ('K1 report_totals()',              'admin', 'select * from public.report_totals()'),
      ('K2 report_totals()',              'ta',    'select * from public.report_totals()'),
      -- M5-1: RPC báo cáo (trang Báo cáo gọi ~6 hàm này song song)
      ('R1 report_totals YTD',            'admin', 'select public.report_totals(''2026-01-01'', ''2026-11-19'', ''{}'', ''none'', ''2026-11-19'')'),
      ('R2 report_totals YTD',            'ta',    'select public.report_totals(''2026-01-01'', ''2026-11-19'', ''{}'', ''none'', ''2026-11-19'')'),
      ('R3 report_totals theo PIC',       'admin', 'select public.report_totals(''2025-01-01'', ''2026-11-19'', ''{}'', ''pic'', ''2026-11-19'')'),
      ('R4 report_series 12 tháng',       'admin', 'select public.report_series((select jsonb_agg(jsonb_build_array(d::date, (d + interval ''1 month - 1 day'')::date)) from generate_series(''2025-12-01''::timestamp, ''2026-11-01'', ''1 month'') d), ''{}'', ''2026-11-19'')'),
      ('R5 report_sources 12 tuần',       'admin', 'select public.report_sources((select jsonb_agg(jsonb_build_array(d::date, (d + interval ''6 day'')::date)) from generate_series(''2026-08-31''::timestamp, ''2026-11-16'', ''7 day'') d), ''{}'', ''2026-11-19'')'),
      ('R6 report_trend 2 năm',           'ta',    'select public.report_trend(''2025-01-01'', ''2026-11-19'', ''{}'')'),
      ('R7 report_reasons YTD',           'admin', 'select public.report_reasons(''2026-01-01'', ''2026-11-19'', ''{}'')'),
      ('R8 report_meta',                  'admin', 'select public.report_meta(''2026-11-19'')'),
      -- M5-4: Kanban
      ('B0 board_counts (thẻ KPI)',      'admin', 'select public.board_counts('''')'),
      ('B1 board_page',                   'admin', 'select public.board_page(''{}'', '''')'),
      ('B2 board_page',                   'ta',    'select public.board_page(''{}'', '''')'),
      ('B3 board_page tìm tên',           'admin', 'select public.board_page(''{}'', ''văn'')'),
      ('B4 board_cards ô R1 trang 5',     'admin', 'select public.board_cards(''r1'', 120, ''{}'', '''')'),
      -- M6-1: lịch (gộp ngày R1/R2/OB của mọi hồ sơ trong tháng), công việc
      ('O1 calendar_range 1 tháng',       'admin', 'select public.calendar_range(''2026-10-01'', ''2026-10-31'', '''')'),
      ('O2 calendar_range 1 tháng',       'ta',    'select public.calendar_range(''2026-10-01'', ''2026-10-31'', '''')'),
      ('O3 list_tasks tất cả',            'admin', 'select public.list_tasks(''all'', null, ''2026-11-19'')'),
      -- M6-3: chuông (gọi mỗi 5 phút / mỗi người)
      ('A1 alerts',                       'admin', 'select public.alerts(''2026-11-19'')'),
      ('A2 alerts',                       'ta',    'select public.alerts(''2026-11-19'')'),
      ('CH bình luận của 1 hồ sơ',        'ta',    format('select * from public.comments where record_id = %s order by created_at', v_rec))
    ) v(label, who, sql)
  loop
    arr := '{}';
    for i in 0..5 loop
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims',
        json_build_object('sub', case q.who when 'admin' then v_admin else v_ta end, 'role', 'authenticated')::text, true);
      execute 'explain (analyze, format json) ' || q.sql into j;
      execute 'reset role';
      t := round(((j -> 0 ->> 'Execution Time')::numeric + (j -> 0 ->> 'Planning Time')::numeric), 2);
      if i > 0 then arr := arr || t; end if;
    end loop;
    insert into perf_results values (p_variant, q.label, q.who, arr);
  end loop;
end $f$;

select pg_temp.measure('A');

-- Variant B: cùng ý nghĩa với app.can_see_record(pic) nhưng viết dạng planner tối ưu được (initPlan + index theo pic).
alter policy rr_read on public.recruitment_records
  using ((select app.is_admin()) or (pic is not null and pic <> '' and pic = (select app.my_pic())));
select pg_temp.measure('B');

-- Bảng kết quả (ms): max ~ P95 của 5 lần đo
\pset format aligned
select a.label, a.who,
       (select percentile_cont(0.5) within group (order by x) from unnest(a.ms) x)::numeric(10,2) as "A trung vị",
       (select max(x) from unnest(a.ms) x) as "A max",
       (select percentile_cont(0.5) within group (order by x) from unnest(b.ms) x)::numeric(10,2) as "B trung vị",
       (select max(x) from unnest(b.ms) x) as "B max",
       case when (select max(x) from unnest(a.ms) x) < 200 then 'OK' else 'CHẬM' end as "A < 200ms"
from perf_results a join perf_results b on b.label = a.label and b.variant = 'B'
where a.variant = 'A'
order by a.label;

-- Bản markdown cho GitHub step summary
\o perf_summary.md
\pset format unaligned
\pset tuples_only on
\pset fieldsep ' | '
select '| Truy vấn | Vai | A trung vị (ms) | A max (ms) | B trung vị (ms) | B max (ms) |';
select '|---|---|---:|---:|---:|---:|';
select '| ' || a.label, a.who,
       (select percentile_cont(0.5) within group (order by x) from unnest(a.ms) x)::numeric(10,2),
       (select max(x) from unnest(a.ms) x),
       (select percentile_cont(0.5) within group (order by x) from unnest(b.ms) x)::numeric(10,2),
       (select max(x) from unnest(b.ms) x) || ' |'
from perf_results a join perf_results b on b.label = a.label and b.variant = 'B'
where a.variant = 'A' order by a.label;
\o
\pset tuples_only off
\pset format aligned

do $$
declare v_slow text;
begin
  select string_agg(label || ' (' || who || '): ' || (select max(x) from unnest(ms) x) || ' ms', '; ') into v_slow
    from perf_results where variant = 'A' and (select max(x) from unnest(ms) x) >= 200;
  if v_slow is not null then raise exception 'PERF_FAIL: %', v_slow; end if;
  raise notice 'PERF_OK: mọi truy vấn (policy hiện hành) < 200 ms trên 20.000 hồ sơ';
end $$;

rollback;

-- M2-7: đo thời gian truy vấn (EXPLAIN ANALYZE, gồm planning) trên 20.000 hồ sơ, dưới quyền Admin và TA (có RLS).
-- Mỗi truy vấn: 1 lần làm nóng + 5 lần đo. Ngưỡng: lần chậm nhất < 200 ms (IMPLEMENTATION_TASKS M2-7).
-- Variant A = policy hiện hành (migrations). Variant B = rr_read viết lại cho planner dùng được index (chỉ đo để so sánh,
-- ROLLBACK). Chỉ A bị kiểm ngưỡng. Chạy sau perf_seed.sql.
\set ON_ERROR_STOP 1
begin;

create temp table perf_results (variant text, label text, who text, ms numeric[]);
grant all on perf_results to public;

create function pg_temp.measure(p_variant text) returns void language plpgsql as $f$
declare
  q record; i int; j json; t numeric; arr numeric[];
  v_admin uuid := '00000000-0000-4000-8000-0000000003a0';
  v_ta    uuid := '00000000-0000-4000-8000-0000000003b1';
  v_rec bigint := (select min(id) from public.recruitment_records where pic = 'TA3-Thang' and id % 4 = 0);
  v_phone text := (select phone from public.recruitment_records where pic = 'TA3-Thang' and phone <> '' order by id limit 1);
  cols text := 'id, candidate_code, full_name, phone, position, pic, site, r1_status, r2_status, ob_status, created_at';
begin
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

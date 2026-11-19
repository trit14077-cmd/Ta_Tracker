-- M4-3: đối chiếu hàm SQL (0010) với logic của hệ cũ trên golden fixture (tests/golden/fixture.json, sinh từ shared/).
--   rr_board_col  = boardPosition().col     rr_board_sub = boardSub()     rr_tenor = computeTenor()
-- Chạy từ thư mục gốc repo:  psql -v ON_ERROR_STOP=1 -f supabase/tests/sql_parity_test.sql
-- Fixture (~270 KB) được psql tự đọc bằng \set + backtick (không truyền qua dòng lệnh: Linux giới hạn 128 KB/tham số).
-- Chỉ đọc (không ghi bảng).
\set fx `cat tests/golden/fixture.json`
select set_config('parity.fx', :'fx', false);
do $$
declare
  fx jsonb := current_setting('parity.fx')::jsonb;
  today date := (fx -> 'outputs' ->> 'today')::date;
  n int := jsonb_array_length(fx -> 'records');
  bad text;
  c int := 0;
begin
  assert n = jsonb_array_length(fx -> 'outputs' -> 'perRecord'), 'fixture lệch số dòng records/perRecord';

  with rec as (
    select r.ord, r.v as rec, p.v as out
      from jsonb_array_elements(fx -> 'records') with ordinality r(v, ord)
      join jsonb_array_elements(fx -> 'outputs' -> 'perRecord') with ordinality p(v, ord) using (ord)
  ), calc as (
    select ord, out,
           public.rr_board_col(rec ->> 'r1_status', nullif(rec ->> 'r1_date', '')::date, rec ->> 'r2_status',
                               nullif(rec ->> 'r2_date', '')::date, rec ->> 'ob_status', nullif(rec ->> 'ob_date', '')::date) as col,
           public.rr_board_sub(rec ->> 'r1_status', nullif(rec ->> 'r1_date', '')::date, rec ->> 'r2_status',
                               nullif(rec ->> 'r2_date', '')::date, rec ->> 'ob_status', nullif(rec ->> 'ob_date', '')::date) as sub,
           public.rr_tenor(nullif(rec ->> 'ob_date', '')::date, rec ->> 'emp_status', nullif(rec ->> 'attrition_date', '')::date, today) as tenor
      from rec
  )
  select string_agg(format('%s: col %s/%s sub %s/%s tenor %s/%s', out ->> 'code', col, out -> 'board' ->> 'col',
                           coalesce(sub, 'null'), coalesce(out ->> 'sub', 'null'), tenor, out ->> 'tenor'), '; ')
    into bad
    from calc
   where col is distinct from out -> 'board' ->> 'col'
      or sub is distinct from out ->> 'sub'
      or tenor is distinct from out ->> 'tenor';
  assert bad is null, 'Lệch với shared/: ' || left(coalesce(bad, ''), 800);
  c := c + n;

  -- ca biên của thâm niên (fixture ít ca ngắn ngày) – giá trị lấy từ test cũ run.mjs:105-111 và computeTenor
  assert public.rr_tenor('2026-11-05', 'Resigned', '2026-11-05', today) = '<1D', 'nghỉ cùng ngày = <1D'; c := c + 1;
  assert public.rr_tenor('2026-11-05', 'Resigned', '2026-11-07', today) = '<3D', '2 ngày = <3D'; c := c + 1;
  assert public.rr_tenor('2026-11-05', 'Resigned', '2026-11-08', today) = '<7D', '3 ngày = <7D'; c := c + 1;
  assert public.rr_tenor('2026-11-05', 'Resigned', '2026-11-12', today) = '<15D', '7 ngày = <15D'; c := c + 1;
  assert public.rr_tenor('2026-11-05', 'Resigned', '2026-12-05', today) = '>30D', '30 ngày = >30D'; c := c + 1;
  assert public.rr_tenor('2026-11-05', 'Active', '2026-11-06', '2026-11-19') = '<15D', 'Active tính tới hôm nay'; c := c + 1;
  assert public.rr_tenor('2026-11-05', 'Resigned', null, '2026-11-19') = '<15D', 'Resigned thiếu ngày nghỉ: tính tới hôm nay'; c := c + 1;
  assert public.rr_tenor(null, 'Active', null, '2026-11-19') = '', 'chưa có ngày OB = rỗng'; c := c + 1;
  -- trạng thái có khoảng trắng thừa (hệ cũ trim)
  assert public.rr_board_col(' Failed ', null, '', null, '', null) = 'r1', 'trạng thái được trim như hệ cũ'; c := c + 1;

  raise notice 'SQL_PARITY_TEST_PASSED: % check đạt (% hồ sơ golden)', c, n;
end $$;

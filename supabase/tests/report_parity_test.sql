-- M5-1: đối chiếu RPC báo cáo (0011) với shared/dashboardCalc.ts trên golden fixture (tests/golden/fixture.json).
--   report_totals = totals / groupTotals   report_reasons = donuts().reasons   report_trend = trend
--   report_series = periodSeries           report_sources = sourceSeries       report_meta.min_date = MIN_DATE
-- Chạy từ thư mục gốc repo:  psql -v ON_ERROR_STOP=1 -f supabase/tests/report_parity_test.sql
-- Nạp 400 hồ sơ giả vào bảng trong 1 giao dịch (hồ sơ có sẵn tạm cho lưu trữ để không lẫn), ROLLBACK ở cuối.
-- Khi bằng nhau về thứ tự (cùng OB/Leads, cùng số lượng lý do) hệ cũ theo thứ tự dòng sheet, SQL theo tên:
-- so tập phần tử + dãy giá trị dùng để xếp (không so thứ tự trong nhóm bằng nhau).
\set fx `cat tests/golden/fixture.json`
select set_config('parity.fx', :'fx', false);
begin;
set local timezone = 'UTC';  -- như Supabase: ngày tạo phải được quy về giờ VN trong hàm, không dựa vào timezone phiên

create function pg_temp.sorted(a jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb) from jsonb_array_elements(a) e
$$;
-- dãy giá trị theo thứ tự mảng: path = đường dẫn tới giá trị dùng để xếp trong từng phần tử
create function pg_temp.seq(a jsonb, path text[]) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(e #> path order by o), '[]'::jsonb) from jsonb_array_elements(a) with ordinality x(e, o)
$$;
create function pg_temp.same_ranked(ours jsonb, gold jsonb, path text[]) returns boolean language sql immutable as $$
  select pg_temp.sorted(ours) = pg_temp.sorted(gold) and pg_temp.seq(ours, path) = pg_temp.seq(gold, path)
$$;

do $$
declare
  fx jsonb := current_setting('parity.fx')::jsonb;
  o jsonb := fx -> 'outputs';
  today date := (o ->> 'today')::date;
  af date := (o #>> '{byRange,all,from}')::date;
  at date := (o #>> '{byRange,all,to}')::date;
  k text; v jsonb; ours jsonb; gold jsonb; lu jsonb; per jsonb; i int;
  c int := 0;
  ta uuid := '00000000-0000-4000-8000-0000000005a1';
begin
  -- ---------- nạp fixture ----------
  update public.recruitment_records set is_archived = true where not is_archived;
  insert into public.pics (code, name)
    select distinct e ->> 'pic', e ->> 'pic' from jsonb_array_elements(fx -> 'records') e where e ->> 'pic' <> ''
  on conflict (code) do nothing;
  insert into public.recruitment_records (candidate_code, pic, site, region, dept, position, source, sub_source, created_at,
      r1_date, r1_status, r1_sub_status, r2_date, r2_status, r2_sub_status,
      ob_date, ob_status, ob_sub_status, emp_status, attrition_date)
  select e ->> 'candidate_code', nullif(e ->> 'pic', ''), e ->> 'site', e ->> 'region', e ->> 'dept', e ->> 'position',
         e ->> 'source', e ->> 'sub_source',
         ((e ->> 'lead_date') || ' 00:30:00+07')::timestamptz,   -- 00:30 giờ VN = 17:30 UTC hôm trước: kiểm ngày tạo tính theo giờ VN
         nullif(e ->> 'r1_date', '')::date, e ->> 'r1_status', e ->> 'r1_sub_status',
         nullif(e ->> 'r2_date', '')::date, e ->> 'r2_status', e ->> 'r2_sub_status',
         nullif(e ->> 'ob_date', '')::date, e ->> 'ob_status', e ->> 'ob_sub_status', e ->> 'emp_status',
         nullif(e ->> 'attrition_date', '')::date
    from jsonb_array_elements(fx -> 'records') e;
  -- 1 hồ sơ lưu trữ: không được tính
  insert into public.recruitment_records (candidate_code, pic, r1_date, r1_status, is_archived)
    values ('GARCH1', 'PIC-A', '2026-10-10', 'Passed', true);

  -- ---------- 1. totals theo 4 khoảng ----------
  for k, v in select * from jsonb_each(o -> 'byRange') loop
    ours := public.report_totals((v ->> 'from')::date, (v ->> 'to')::date, '{}', 'none', today);
    assert ours = v -> 'totals', format('totals %s: %s <> %s', k, ours, v -> 'totals'); c := c + 1;
  end loop;

  -- ---------- 2. groupTotals ----------
  ours := public.report_totals(af, at, '{}', 'pic', today);
  assert pg_temp.same_ranked(ours, o -> 'byPic', '{1,ob}') and pg_temp.same_ranked(ours, o -> 'byPic', '{1,leads}'),
    format('byPic: %s <> %s', ours, o -> 'byPic'); c := c + 1;
  for k, v in select * from jsonb_each(o -> 'groupsOct') loop
    ours := public.report_totals((o #>> '{byRange,oct,from}')::date, (o #>> '{byRange,oct,to}')::date, '{}', k, today);
    assert pg_temp.same_ranked(ours, v, '{1,ob}') and pg_temp.same_ranked(ours, v, '{1,leads}'),
      format('groupsOct %s: %s <> %s', k, ours, v); c := c + 1;
  end loop;

  -- ---------- 3. lý do rớt (donuts) ----------
  for k, v in select * from jsonb_each(o -> 'reasons') loop
    ours := public.report_reasons((o -> 'byRange' -> k ->> 'from')::date, (o -> 'byRange' -> k ->> 'to')::date, '{}');
    lu := case when (ours ->> 'lu_no')::int > 0
               then jsonb_build_array(jsonb_build_array('Đậu R1, chưa có lịch R2', (ours ->> 'lu_no')::int)) || (ours -> 'r1_fail')
               else ours -> 'r1_fail' end;
    assert pg_temp.same_ranked(ours -> 'r1_fail', v -> 0 -> 'reasons', '{1}'), format('reasons %s r1: %s <> %s', k, ours -> 'r1_fail', v -> 0 -> 'reasons');
    assert pg_temp.same_ranked(lu, v -> 1 -> 'reasons', '{1}'), format('reasons %s lu: %s <> %s', k, lu, v -> 1 -> 'reasons');
    assert pg_temp.same_ranked(ours -> 'no_show', v -> 2 -> 'reasons', '{1}'), format('reasons %s su: %s <> %s', k, ours -> 'no_show', v -> 2 -> 'reasons');
    assert pg_temp.same_ranked(ours -> 'r2_fail', v -> 3 -> 'reasons', '{1}'), format('reasons %s r2: %s <> %s', k, ours -> 'r2_fail', v -> 3 -> 'reasons');
    assert pg_temp.same_ranked(ours -> 'ob_no', v -> 4 -> 'reasons', '{1}'), format('reasons %s ob: %s <> %s', k, ours -> 'ob_no', v -> 4 -> 'reasons');
    c := c + 5;
  end loop;

  -- ---------- 4. xu hướng tháng ----------
  ours := public.report_trend(af, at, '{}');
  assert ours = o -> 'trend', format('trend: %s <> %s', ours, o -> 'trend'); c := c + 1;
  ours := public.report_trend((o #>> '{byRange,q3,from}')::date, (o #>> '{byRange,q3,to}')::date, '{}');
  assert ours = o -> 'trendQ3', format('trendQ3: %s <> %s', ours, o -> 'trendQ3'); c := c + 1;

  -- ---------- 5. theo kỳ (periodSeries) và theo nguồn (sourceSeries) ----------
  for k in select unnest(array['month', 'week']) loop
    per := (select jsonb_agg(jsonb_build_array(p ->> 'from', p ->> 'to') order by n) from jsonb_array_elements(o -> 'periods' -> k) with ordinality x(p, n));
    ours := public.report_series(per, '{}', today);
    gold := (select jsonb_agg(s -> 't' order by n) from jsonb_array_elements(o -> 'periodSeries' -> k) with ordinality x(s, n));
    assert ours = gold, format('periodSeries %s: %s <> %s', k, ours, gold); c := c + 1;

    ours := public.report_sources(per, '{}', today);
    assert jsonb_array_length(ours) = jsonb_array_length(o -> 'sourceSeries' -> k), 'sourceSeries ' || k || ': số kỳ lệch';
    for i in 0 .. jsonb_array_length(ours) - 1 loop
      gold := o -> 'sourceSeries' -> k -> i;
      assert (ours -> i) - 'bySource' = gold - 'p' - 'bySource',
        format('sourceSeries %s[%s]: %s <> %s', k, i, (ours -> i) - 'bySource', gold - 'p' - 'bySource');
      assert pg_temp.same_ranked(ours -> i -> 'bySource', gold -> 'bySource', '{ob}'),
        format('sourceSeries %s[%s].bySource: %s <> %s', k, i, ours -> i -> 'bySource', gold -> 'bySource');
      c := c + 2;
    end loop;
  end loop;

  -- ---------- 6. có lọc (pic, site, source, sub_source) ----------
  for k, v in select * from jsonb_each(o -> 'filtered') loop
    ours := public.report_totals(af, at, v -> 'filter', 'none', today);
    assert ours = v -> 'totals', format('filtered %s totals: %s <> %s', k, ours, v -> 'totals');
    ours := public.report_trend((o #>> '{byRange,oct,from}')::date, (o #>> '{byRange,oct,to}')::date, v -> 'filter');
    assert ours = v -> 'trend', format('filtered %s trend: %s <> %s', k, ours, v -> 'trend');
    c := c + 2;
  end loop;

  -- ---------- 7. meta, kỳ rỗng, tham số sai ----------
  ours := public.report_meta(today);
  assert ours ->> 'min_date' = o ->> 'minDate', format('min_date %s <> %s', ours ->> 'min_date', o ->> 'minDate'); c := c + 1;
  assert pg_temp.sorted(ours #> '{options,pic}') = '["PIC-A", "PIC-B", "PIC-C", "PIC-D"]', 'options.pic: ' || (ours #> '{options,pic}')::text; c := c + 1;
  assert public.report_totals('2020-01-01', '2020-01-31', '{}', 'none', today) = public.rr_blank_totals(), 'kỳ rỗng = blank'; c := c + 1;
  assert public.report_totals('2020-01-01', '2020-01-31', '{}', 'pic', today) = '[]', 'nhóm kỳ rỗng = []'; c := c + 1;
  assert public.report_series('[["2020-01-01","2020-01-31"],["2026-10-01","2026-10-31"]]', '{}', today) -> 0 = public.rr_blank_totals()
     and public.report_series('[["2020-01-01","2020-01-31"],["2026-10-01","2026-10-31"]]', '{}', today) -> 1 = o #> '{byRange,oct,totals}',
    'report_series giữ đúng vị trí kỳ rỗng'; c := c + 1;
  begin
    perform public.report_totals(af, at, '{}', 'phone', today);
    assert false, 'group_by lạ phải bị từ chối';
  exception when invalid_parameter_value then c := c + 1;
  end;
  -- bộ lọc: giá trị có dấu nháy không chèn được SQL; khóa lạ / giá trị rỗng bị bỏ qua
  assert (public.report_totals(af, at, jsonb_build_object('site', 'x'' or ''1''=''1'), 'none', today) ->> 'leads')::int = 0,
    'giá trị lọc có dấu nháy phải được escape'; c := c + 1;
  assert public.report_totals(af, at, '{"phone":"1","site":"","bogus":"x"}', 'none', today) = o #> '{byRange,all,totals}',
    'khóa lạ / rỗng bị bỏ qua'; c := c + 1;
  assert public.rr_filter_sql('{"site":"Kho 1","position":"Vị trí 1"}') = 'q."position" = ''Vị trí 1'' and q.site = ''Kho 1''',
    'rr_filter_sql: ' || public.rr_filter_sql('{"site":"Kho 1","position":"Vị trí 1"}'); c := c + 1;
  begin
    perform public.report_series('[["2026-02-01","2026-01-01"]]', '{}', today);
    assert false, 'kỳ from > to phải bị từ chối';
  exception when invalid_parameter_value then c := c + 1;
  end;
  assert not has_function_privilege('anon', 'public.report_totals(date,date,jsonb,text,date)', 'execute'), 'anon không được gọi'; c := c + 1;
  assert not has_function_privilege('anon', 'public.report_meta(date)', 'execute'), 'anon không được gọi report_meta'; c := c + 1;

  -- ---------- 8. RLS: TA chỉ thấy hồ sơ của mình ----------
  gold := public.report_totals(af, at, '{"pic":"PIC-A"}', 'none', today);
  insert into auth.users (id) values (ta);
  insert into public.profiles (id, username, role, pic_code, active) values (ta, 'report_ta', 'pic', 'PIC-A', true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', ta::text, true);
  assert public.report_totals(af, at, '{}', 'none', today) = gold, 'TA: totals = chỉ hồ sơ PIC-A'; c := c + 1;
  assert (public.report_totals(af, at, '{"pic":"PIC-B"}', 'none', today) ->> 'leads')::int = 0, 'TA lọc PIC khác = 0'; c := c + 1;
  assert public.report_meta(today) #> '{options,pic}' = '["PIC-A"]', 'TA: options.pic chỉ PIC-A'; c := c + 1;
  assert jsonb_array_length(public.report_totals(af, at, '{}', 'pic', today)) = 1, 'TA: groupTotals theo PIC chỉ 1 nhóm'; c := c + 1;
  execute 'reset role';

  raise notice 'REPORT_PARITY_TEST_PASSED: % check đạt (% hồ sơ golden)', c, jsonb_array_length(fx -> 'records');
end $$;
rollback;

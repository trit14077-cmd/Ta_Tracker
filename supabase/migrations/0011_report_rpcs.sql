-- 0011_report_rpcs.sql – M5-1: RPC báo cáo (trang "Báo cáo": OverviewDashboard + TaCharts) tính trên DB.
-- Thay cho /api/reports/rows (tải dòng thô về trình duyệt rồi tính bằng shared/dashboardCalc.ts).
-- Quy tắc tính GIỐNG HỆT dashboardCalc.ts (totals, groupTotals, donuts, trend, periodSeries, sourceSeries, MIN_DATE),
-- đối chiếu 0 sai lệch trên golden fixture: supabase/tests/report_parity_test.sql.
-- Dòng đầu vào giống hReportRows_ (Api.gs) của hệ cũ: hồ sơ KHÔNG lưu trữ, trong phạm vi người dùng (RLS rr_read),
--   lead = R1 date, không có thì ngày tạo hồ sơ (giờ Việt Nam).
-- Mọi hàm SECURITY INVOKER (RLS áp như list_candidates). "Hôm nay" (ER30/ER60) = ngày ở Asia/Ho_Chi_Minh.
-- Giữ nguyên report_totals(date,date) của 0003 (dùng đối chiếu nạp dữ liệu); bản đủ là overload 5 tham số.
-- Thứ tự khi bằng nhau (cùng số OB/Leads, cùng số lượng lý do): hệ cũ theo thứ tự dòng trong sheet; ở đây theo tên (ổn định).
-- Hiệu năng: bộ lọc được dựng thành điều kiện SQL cố định (rr_filter_sql, giá trị escape bằng %L) rồi EXECUTE, để
--   Postgres lập kế hoạch với hằng số thật; các kỳ được đổi thành "lịch" ngày -> kỳ và nối theo ngày của từng bước
--   (không nhân số dòng × số kỳ). Đo trong job CI perf (20.000 hồ sơ).

-- ============ hôm nay (giờ VN) ============
create or replace function public.rr_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- ============ dòng báo cáo (= ReportRow của dashboardCalc) ============
-- security_invoker: RLS rr_read áp như đọc bảng (Admin: tất cả; TA: hồ sơ PIC mình).
create view public.v_report_rows with (security_invoker = true) as
  select coalesce(r.pic, '') as pic, r.site, r.region, r.dept, r.position, r.source, r.sub_source, r.rank, r.location,
         coalesce(r.r1_date, (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date) as lead,
         r.r1_date as r1d, r.r1_status as r1s, r.r1_sub_status as r1r,
         r.r2_date as r2d, r.r2_status as r2s, r.r2_sub_status as r2r,
         r.ob_date as obd, r.ob_status as obs, r.ob_sub_status as obr, r.emp_status as emp, r.attrition_date as attd
    from public.recruitment_records r
   where not r.is_archived;

-- ============ bộ lọc -> điều kiện SQL (alias q = v_report_rows) ============
-- p_filters: {pic, site, source, sub_source, region, dept, position, rank, location}; so khớp đúng; rỗng/thiếu = bỏ qua;
-- khóa lạ bị bỏ qua. Tên cột lấy từ danh sách cố định (%I), giá trị escape bằng %L => không chèn được SQL.
create or replace function public.rr_filter_sql(p_filters jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(string_agg(format('q.%I = %L', m.k, p_filters ->> m.k), ' and ' order by m.k), 'true')
    from unnest(array['pic', 'site', 'source', 'sub_source', 'region', 'dept', 'position', 'rank', 'location']) as m(k)
   where jsonb_typeof(p_filters) = 'object' and coalesce(p_filters ->> m.k, '') <> ''
$$;

-- ============ kiểm tham số kỳ ============
-- [[from, to], ...], tối đa 60 kỳ, from <= to, tổng số ngày <= 20.000.
create or replace function public.rr_check_periods(p_periods jsonb)
returns void
language plpgsql immutable set search_path = ''
as $$
declare
  e jsonb;
  days bigint := 0;
begin
  if jsonb_typeof(p_periods) is distinct from 'array' then
    raise exception 'p_periods phải là mảng [[from, to], ...]' using errcode = '22023';
  end if;
  if jsonb_array_length(p_periods) > 60 then
    raise exception 'Tối đa 60 kỳ' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_periods) loop
    if jsonb_typeof(e) is distinct from 'array' or (e ->> 0) is null or (e ->> 1) is null
       or (e ->> 0)::date > (e ->> 1)::date then
      raise exception 'Kỳ không hợp lệ: %', e using errcode = '22023';
    end if;
    days := days + ((e ->> 1)::date - (e ->> 0)::date) + 1;
  end loop;
  if days > 20000 then
    raise exception 'Khoảng ngày quá dài' using errcode = '22023';
  end if;
end $$;

-- Totals rỗng (= blank() của dashboardCalc)
create or replace function public.rr_blank_totals()
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('leads', 0, 'r1Total', 0, 'r1', 0, 'lu', 0, 'su', 0, 'r2', 0, 'ob', 0, 'ns', 0, 'cc', 0,
                            'er', 0, 'att', 0, 'att30', 0, 'er30n', 0, 'er30d', 0, 'er60n', 0, 'er60d', 0)
$$;

-- ============ lõi: totals() theo nhiều kỳ × nhóm ============
-- p_periods đã kiểm (rr_check_periods); p_group: '' | pic | site | source | sub_source | position | region | dept.
-- Trả 1 dòng cho mỗi (kỳ, nhóm) CÓ dữ liệu; kỳ/nhóm không có thì không trả (hàm gọi tự bù blank).
-- Cách tính: lịch cal(ngày -> kỳ); với TỪNG bước (lead | R1 date | R2 date | OB date) nối dòng với lịch theo đúng ngày
-- của bước đó và đếm theo (kỳ, nhóm). Kỳ chồng nhau vẫn đúng. Điều kiện từng chỉ số = totals() trong dashboardCalc.ts.
create or replace function public.rr_totals_by(p_periods jsonb, p_filters jsonb, p_group text, p_today date)
returns table (idx int, grp text, t jsonb)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  g text := case when p_group in ('pic', 'site', 'source', 'sub_source', 'position', 'region', 'dept')
                 then format('q.%I', p_group) else '''''' end;
begin
  return query execute format($q$
    with cal as materialized (
      select (x.ord - 1)::int as idx, s.d::date as d
        from jsonb_array_elements($1) with ordinality as x(e, ord)
        cross join lateral generate_series((x.e ->> 0)::date, (x.e ->> 1)::date, interval '1 day') as s(d)
    ), r as not materialized (
      select %1$s as g, q.lead, q.r1d, q.r1s, q.r2d, q.r2s, q.obd, q.obs, q.emp, q.attd
        from public.v_report_rows q where %2$s
    ), part as (
      select c.idx, r.g, count(*) as leads, 0::bigint as r1t, 0::bigint as r1, 0::bigint as lu, 0::bigint as su,
             0::bigint as r2, 0::bigint as ob, 0::bigint as ns, 0::bigint as cc, 0::bigint as er, 0::bigint as att,
             0::bigint as att30, 0::bigint as e30d, 0::bigint as e30n, 0::bigint as e60d, 0::bigint as e60n
        from r join cal c on c.d = r.lead group by c.idx, r.g
      union all
      select c.idx, r.g, 0, count(*), count(*) filter (where r.r1s = 'Passed'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        from r join cal c on c.d = r.r1d group by c.idx, r.g
      union all
      select c.idx, r.g, 0, 0, 0, count(*), count(*) filter (where r.r2s in ('Passed', 'Failed')),
             count(*) filter (where r.r2s = 'Passed'), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        from r join cal c on c.d = r.r2d group by c.idx, r.g
      union all
      select c.idx, r.g, 0, 0, 0, 0, 0, 0,
             count(*) filter (where r.obs = 'Joined'),
             count(*) filter (where r.obs = 'Noshow'),
             count(*) filter (where r.obs = 'Canceled'),
             count(*) filter (where r.obs = 'Joined' and r.emp = 'Active'),
             count(*) filter (where r.obs = 'Joined' and r.emp = 'Resigned'),
             count(*) filter (where r.obs = 'Joined' and r.emp = 'Resigned' and r.attd - r.obd <= 30),
             count(*) filter (where r.obs = 'Joined' and $2 - r.obd >= 30),
             count(*) filter (where r.obs = 'Joined' and $2 - r.obd >= 30
                                and (r.emp <> 'Resigned' or r.attd is null or r.attd - r.obd > 30)),
             count(*) filter (where r.obs = 'Joined' and $2 - r.obd >= 60),
             count(*) filter (where r.obs = 'Joined' and $2 - r.obd >= 60
                                and (r.emp <> 'Resigned' or r.attd is null or r.attd - r.obd > 60))
        from r join cal c on c.d = r.obd where r.obs in ('Joined', 'Noshow', 'Canceled') group by c.idx, r.g
    )
    select part.idx, coalesce(nullif(part.g, ''), '(Trống)'),
           jsonb_build_object(
             'leads', sum(part.leads), 'r1Total', sum(part.r1t), 'r1', sum(part.r1), 'lu', sum(part.lu),
             'su', sum(part.su), 'r2', sum(part.r2), 'ob', sum(part.ob), 'ns', sum(part.ns), 'cc', sum(part.cc),
             'er', sum(part.er), 'att', sum(part.att), 'att30', sum(part.att30),
             'er30n', sum(part.e30n), 'er30d', sum(part.e30d), 'er60n', sum(part.e60n), 'er60d', sum(part.e60d))
      from part
     group by part.idx, 2
  $q$, g, public.rr_filter_sql(p_filters)) using p_periods, p_today;
end $$;

-- ============ report_totals: Totals của 1 khoảng, hoặc groupTotals ============
-- p_group_by: none | pic | site | source | sub_source | position | region | dept
--   none  -> Totals {leads, r1Total, r1, lu, su, r2, ob, ns, cc, er, att, att30, er30n, er30d, er60n, er60d}
--   khác  -> [[tên nhóm, Totals], ...] chỉ nhóm có leads/ob/r1/lu, xếp OB giảm dần rồi Leads giảm dần (= groupTotals)
create or replace function public.report_totals(p_from date, p_to date, p_filters jsonb, p_group_by text,
                                                p_today date default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  g text := coalesce(nullif(p_group_by, ''), 'none');
  td date := coalesce(p_today, public.rr_today());
  per jsonb := jsonb_build_array(jsonb_build_array(p_from, p_to));
  res jsonb;
begin
  if g not in ('none', 'pic', 'site', 'source', 'sub_source', 'position', 'region', 'dept') then
    raise exception 'group_by không hợp lệ: %', g using errcode = '22023';
  end if;
  perform public.rr_check_periods(per);
  if g = 'none' then
    select x.t into res from public.rr_totals_by(per, p_filters, '', td) x;
    return coalesce(res, public.rr_blank_totals());
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(x.grp, x.t)
                            order by (x.t ->> 'ob')::int desc, (x.t ->> 'leads')::int desc, x.grp), '[]'::jsonb)
    into res
    from public.rr_totals_by(per, p_filters, g, td) x
   where (x.t ->> 'leads')::int + (x.t ->> 'ob')::int + (x.t ->> 'r1')::int + (x.t ->> 'lu')::int > 0;
  return res;
end $$;

-- ============ report_series: totals() cho từng kỳ (= periodSeries) ============
-- p_periods: [[from, to], ...] (client tạo bằng periodsOf) -> [Totals, ...] cùng thứ tự
create or replace function public.report_series(p_periods jsonb, p_filters jsonb default '{}'::jsonb,
                                                p_today date default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  res jsonb;
begin
  perform public.rr_check_periods(p_periods);
  select coalesce(jsonb_agg(coalesce(x.t, public.rr_blank_totals()) order by i.idx), '[]'::jsonb)
    into res
    from generate_series(0, jsonb_array_length(p_periods) - 1) as i(idx)
    left join public.rr_totals_by(p_periods, p_filters, '', coalesce(p_today, public.rr_today())) x on x.idx = i.idx;
  return res;
end $$;

-- ============ report_reasons: dữ liệu lý do cho 5 biểu đồ tròn (= donuts) ============
-- Trả {r1_fail, lu_no, no_show, r2_fail, ob_no}: mỗi danh sách là [[lý do, số], ...] xếp số giảm dần.
--   r1_fail : R1 date trong kỳ, R1 = Failed, theo R1 reason ('(Chưa ghi lý do)' nếu trống)
--   lu_no   : số người R1 date trong kỳ, R1 = Passed, chưa có R2 date
--   no_show : R2 date trong kỳ, R2 không phải Passed/Failed, theo R2 reason
--   r2_fail : R2 date trong kỳ, R2 = Failed, theo R2 reason
--   ob_no   : OB date trong kỳ, OB = Noshow/Canceled, theo "OB Status · OB reason"
create or replace function public.report_reasons(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  res jsonb;
begin
  perform public.rr_check_periods(jsonb_build_array(jsonb_build_array(p_from, p_to)));
  execute format($q$
    with r as not materialized (select q.* from public.v_report_rows q where %s),
    lst as (
      select 'r1_fail' as k, coalesce(nullif(r1r, ''), '(Chưa ghi lý do)') as reason
        from r where r1d between $1 and $2 and r1s = 'Failed'
      union all
      select 'no_show', coalesce(nullif(r2r, ''), '(Chưa ghi lý do)')
        from r where r2d between $1 and $2 and r2s not in ('Passed', 'Failed')
      union all
      select 'r2_fail', coalesce(nullif(r2r, ''), '(Chưa ghi lý do)')
        from r where r2d between $1 and $2 and r2s = 'Failed'
      union all
      select 'ob_no', obs || case when obr <> '' then ' · ' || obr else '' end
        from r where obd between $1 and $2 and obs in ('Noshow', 'Canceled')
    ), cnt as (
      select k, reason, count(*)::int as n from lst group by k, reason
    ), agg as (
      select k, jsonb_agg(jsonb_build_array(reason, n) order by n desc, reason) as v from cnt group by k
    )
    select jsonb_build_object(
      'r1_fail', coalesce((select v from agg where k = 'r1_fail'), '[]'::jsonb),
      'lu_no',   (select count(*)::int from r where r1d between $1 and $2 and r1s = 'Passed' and r2d is null),
      'no_show', coalesce((select v from agg where k = 'no_show'), '[]'::jsonb),
      'r2_fail', coalesce((select v from agg where k = 'r2_fail'), '[]'::jsonb),
      'ob_no',   coalesce((select v from agg where k = 'ob_no'), '[]'::jsonb)
    )
  $q$, public.rr_filter_sql(p_filters)) into res using p_from, p_to;
  return res;
end $$;

-- ============ report_trend: xu hướng theo tháng (= trend) ============
-- Mỗi tháng chạm [p_from, p_to]: ob = Joined có OB trong tháng; start = Joined có OB trước tháng và chưa nghỉ trước
-- ngày đầu tháng; att = Joined nghỉ trong tháng; churn = att / (start + ob) (null nếu mẫu số 0).
create or replace function public.report_trend(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  res jsonb;
begin
  perform public.rr_check_periods(jsonb_build_array(jsonb_build_array(p_from, p_to)));
  execute format($q$
    with m as materialized (
      select d::date as f, (d + interval '1 month' - interval '1 day')::date as l
        from generate_series(date_trunc('month', $1::timestamp), date_trunc('month', $2::timestamp), interval '1 month') as s(d)
    ), r as materialized (
      select q.obd, q.attd from public.v_report_rows q where q.obs = 'Joined' and q.obd is not null and %s
    ), c as (
      select m.f,
             count(r.obd) filter (where r.obd between m.f and m.l) as ob,
             count(r.obd) filter (where r.attd between m.f and m.l) as att,
             count(r.obd) filter (where r.obd < m.f and (r.attd is null or r.attd >= m.f)) as start
        from m left join r on true
       group by m.f
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'month', to_char(f, 'YYYY-MM'), 'ob', ob, 'att', att, 'start', start,
             'churn', case when start + ob > 0 then att::float8 / (start + ob) end) order by f), '[]'::jsonb)
      from c
  $q$, public.rr_filter_sql(p_filters)) into res using p_from, p_to;
  return res;
end $$;

-- ============ report_sources: Performance × Source theo kỳ (= sourceSeries, không kèm p) ============
-- p_periods như report_series. Mỗi kỳ: {ob, churn, er, er30, er60, n:{er, ob, s30, e30, s60, e60}, bySource:[{name, ob, churn}]}
--   churn = số người Joined nghỉ trong kỳ (bất kể OB khi nào); bySource chỉ nguồn có ob/churn, xếp ob giảm dần.
create or replace function public.report_sources(p_periods jsonb, p_filters jsonb default '{}'::jsonb,
                                                 p_today date default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  tots jsonb := public.report_series(p_periods, p_filters, p_today);  -- kiểm tham số + totals từng kỳ
  res jsonb;
begin
  execute format($q$
    with cal as materialized (
      select (x.ord - 1)::int as idx, s.d::date as d
        from jsonb_array_elements($1) with ordinality as x(e, ord)
        cross join lateral generate_series((x.e ->> 0)::date, (x.e ->> 1)::date, interval '1 day') as s(d)
    ), r as not materialized (
      select coalesce(nullif(q.source, ''), '(Trống)') as src, q.obd, q.attd
        from public.v_report_rows q where q.obs = 'Joined' and %s
    ), bs as (
      select u.idx, u.src, sum(u.ob)::int as ob, sum(u.churn)::int as churn
        from (select c.idx, r.src, count(*) as ob, 0::bigint as churn from r join cal c on c.d = r.obd group by c.idx, r.src
              union all
              select c.idx, r.src, 0, count(*) from r join cal c on c.d = r.attd group by c.idx, r.src) u
       group by u.idx, u.src
    ), per as (
      select i.idx,
             coalesce(sum(bs.churn), 0)::int as churn,
             coalesce(jsonb_agg(jsonb_build_object('name', bs.src, 'ob', bs.ob, 'churn', bs.churn)
                                order by bs.ob desc, bs.src) filter (where bs.ob > 0 or bs.churn > 0), '[]'::jsonb) as by_source
        from generate_series(0, jsonb_array_length($1) - 1) as i(idx) left join bs on bs.idx = i.idx
       group by i.idx
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'ob', (t ->> 'ob')::int,
             'churn', per.churn,
             'er',   case when (t ->> 'ob')::int > 0 then (t ->> 'er')::float8 / (t ->> 'ob')::int end,
             'er30', case when (t ->> 'er30d')::int > 0 then (t ->> 'er30n')::float8 / (t ->> 'er30d')::int end,
             'er60', case when (t ->> 'er60d')::int > 0 then (t ->> 'er60n')::float8 / (t ->> 'er60d')::int end,
             'n', jsonb_build_object('er', t -> 'er', 'ob', t -> 'ob', 's30', t -> 'er30n', 'e30', t -> 'er30d',
                                     's60', t -> 'er60n', 'e60', t -> 'er60d'),
             'bySource', per.by_source) order by per.idx), '[]'::jsonb)
      from per cross join lateral (select $2 -> per.idx as t) tt
  $q$, public.rr_filter_sql(p_filters)) into res using p_periods, tots;
  return res;
end $$;

-- ============ report_meta: hôm nay, ngày nhỏ nhất (= MIN_DATE), giá trị cho các ô lọc ============
-- Tính trên toàn bộ hồ sơ người dùng được xem (không lọc), như `all` của OverviewDashboard. 1 lần quét (grouping sets).
create or replace function public.report_meta(p_today date default null)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with r as materialized (
    select pic, site, source, sub_source, region, dept, "position", min(least(lead, r1d, r2d, obd)) as md
      from public.v_report_rows
     group by grouping sets ((pic), (site), (source), (sub_source), (region), (dept), ("position"))
  )
  select jsonb_build_object(
    'today', coalesce(p_today, public.rr_today()),
    'min_date', (select min(md) from r),
    'options', jsonb_build_object(
      'pic',        (select coalesce(jsonb_agg(pic order by pic), '[]') from r where pic <> ''),
      'site',       (select coalesce(jsonb_agg(site order by site), '[]') from r where site <> ''),
      'source',     (select coalesce(jsonb_agg(source order by source), '[]') from r where source <> ''),
      'sub_source', (select coalesce(jsonb_agg(sub_source order by sub_source), '[]') from r where sub_source <> ''),
      'region',     (select coalesce(jsonb_agg(region order by region), '[]') from r where region <> ''),
      'dept',       (select coalesce(jsonb_agg(dept order by dept), '[]') from r where dept <> ''),
      'position',   (select coalesce(jsonb_agg("position" order by "position"), '[]') from r where "position" <> '')
    )
  )
$$;

-- ============ quyền ============
do $$
declare s text;
begin
  foreach s in array array[
    'public.rr_today()', 'public.rr_filter_sql(jsonb)', 'public.rr_check_periods(jsonb)', 'public.rr_blank_totals()',
    'public.rr_totals_by(jsonb, jsonb, text, date)', 'public.report_totals(date, date, jsonb, text, date)',
    'public.report_series(jsonb, jsonb, date)', 'public.report_reasons(date, date, jsonb)',
    'public.report_trend(date, date, jsonb)', 'public.report_sources(jsonb, jsonb, date)', 'public.report_meta(date)'
  ] loop
    execute format('revoke all on function %s from public, anon', s);
    execute format('grant execute on function %s to authenticated, service_role', s);
  end loop;
end $$;
revoke all on public.v_report_rows from public, anon;
grant select on public.v_report_rows to authenticated, service_role;

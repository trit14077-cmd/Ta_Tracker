-- M5-2/M5-4: board_page, board_cards, stage_history (0013) – đối chiếu boardPosition() (golden fixture) và hành vi
-- của Pipeline.gs (lọc pic chỉ Admin, tìm mã/tên/SĐT, 30 thẻ/lần, xếp updated_at rồi id giảm dần).
-- Chạy từ thư mục gốc repo:  psql -v ON_ERROR_STOP=1 -f supabase/tests/board_test.sql   (ROLLBACK ở cuối)
\set fx `cat tests/golden/fixture.json`
select set_config('parity.fx', :'fx', false);
begin;
do $$
declare
  fx jsonb := current_setting('parity.fx')::jsonb;
  c int := 0;
  pg jsonb; nx jsonb; kk text; exp_total int; exp_failed int; n int; bad text;
  ta uuid := '00000000-0000-4000-8000-0000000006a1';
  ad uuid := '00000000-0000-4000-8000-0000000006a0';
  rid bigint;
begin
  -- ---------- nạp fixture (hồ sơ có sẵn tạm lưu trữ để không lẫn) ----------
  update public.recruitment_records set is_archived = true where not is_archived;
  insert into public.pics (code, name)
    select distinct e ->> 'pic', e ->> 'pic' from jsonb_array_elements(fx -> 'records') e where e ->> 'pic' <> ''
  on conflict (code) do nothing;
  insert into public.recruitment_records (candidate_code, pic, site, region, dept, position, source, sub_source,
      full_name, phone,
      r1_date, r1_status, r1_sub_status, r2_date, r2_status, r2_sub_status,
      ob_date, ob_status, ob_sub_status, emp_status, attrition_date)
  select e ->> 'candidate_code', nullif(e ->> 'pic', ''), e ->> 'site', e ->> 'region', e ->> 'dept', e ->> 'position',
         e ->> 'source', e ->> 'sub_source',
         'Ứng viên ' || (e ->> 'candidate_code'), '9' || lpad(o::text, 8, '0'),
         nullif(e ->> 'r1_date', '')::date, e ->> 'r1_status', e ->> 'r1_sub_status',
         nullif(e ->> 'r2_date', '')::date, e ->> 'r2_status', e ->> 'r2_sub_status',
         nullif(e ->> 'ob_date', '')::date, e ->> 'ob_status', e ->> 'ob_sub_status', e ->> 'emp_status',
         nullif(e ->> 'attrition_date', '')::date
    from jsonb_array_elements(fx -> 'records') with ordinality x(e, o);
  insert into public.recruitment_records (candidate_code, pic, r1_status, is_archived) values ('GARCH2', 'PIC-A', 'Failed', true);

  -- ---------- 1. số thẻ từng ô = boardPosition() ----------
  pg := public.board_page('{}', '');
  for kk in select unnest(array['lead','r1','lusu','r2','ob']) loop
    select count(*) filter (where p -> 'board' ->> 'col' = kk),
           count(*) filter (where p -> 'board' ->> 'col' = kk and coalesce(p -> 'board' ->> 'failedAt', '') <> '')
      into exp_total, exp_failed
      from jsonb_array_elements(fx -> 'outputs' -> 'perRecord') p;
    assert (pg -> 'counts' -> kk ->> 'total')::int = exp_total and (pg -> 'counts' -> kk ->> 'failed')::int = exp_failed,
      format('ô %s: %s <> total %s failed %s', kk, pg -> 'counts' -> kk, exp_total, exp_failed); c := c + 1;
    assert jsonb_array_length(pg -> 'columns' -> kk) = least(30, exp_total), format('ô %s: số thẻ trang đầu', kk); c := c + 1;
  end loop;
  assert (pg ->> 'page_size')::int = 30, 'page_size'; c := c + 1;
  -- board_page khớp board_counts (0010)
  assert (select bool_and((pg -> 'counts' -> k ->> 'total') = (public.board_counts('') -> 'counts' -> k ->> 'total')))
          from unnest(array['lead','r1','lusu','r2','ob']) k, 'board_page khớp board_counts'; c := c + 1;

  -- board_counts.subs = boardSub() trên golden (0014 viết lại board_counts cho nhanh, kết quả phải giữ nguyên)
  select string_agg(format('%s: %s/%s', s, public.board_counts('') -> 'subs' ->> s,
                           (select count(*) from jsonb_array_elements(fx -> 'outputs' -> 'perRecord') p where p ->> 'sub' = s)), '; ')
    into bad
    from unnest(array['lead_new','r1_wait','su','lu','r2_passed','r2_failed','r2_canceled','ob_wait']) s
   where (public.board_counts('') -> 'subs' ->> s)::int
         <> (select count(*) from jsonb_array_elements(fx -> 'outputs' -> 'perRecord') p where p ->> 'sub' = s);
  assert bad is null, 'board_counts.subs lệch boardSub: ' || coalesce(bad, ''); c := c + 1;

  -- ---------- 2. failed_at của thẻ = boardPosition().failedAt ----------
  select string_agg(format('%s: %s/%s', card ->> 'candidate_code', card ->> 'failed_at', coalesce(p -> 'board' ->> 'failedAt', '')), '; ')
    into bad
    from unnest(array['lead','r1','lusu','r2','ob']) k
    cross join lateral jsonb_array_elements(pg -> 'columns' -> k) card
    join jsonb_array_elements(fx -> 'outputs' -> 'perRecord') p on p ->> 'code' = card ->> 'candidate_code'
   where card ->> 'failed_at' is distinct from coalesce(p -> 'board' ->> 'failedAt', '')
      or k is distinct from p -> 'board' ->> 'col';
  assert bad is null, 'thẻ lệch boardPosition: ' || left(coalesce(bad, ''), 500); c := c + 1;

  -- ---------- 3. thứ tự + tải thêm ----------
  -- cùng updated_at (cùng giao dịch) => id giảm dần; trang 2 nối tiếp trang 1, không trùng
  assert (select bool_and(a.id > b.id) from
            (select (e ->> 'id')::bigint id, o from jsonb_array_elements(pg -> 'columns' -> 'r1') with ordinality x(e, o)) a
            join (select (e ->> 'id')::bigint id, o from jsonb_array_elements(pg -> 'columns' -> 'r1') with ordinality x(e, o)) b
              on b.o = a.o + 1), 'thẻ r1 xếp id giảm dần'; c := c + 1;
  nx := public.board_cards('r1', 30, '{}', '');
  assert (nx ->> 'total')::int = (pg -> 'counts' -> 'r1' ->> 'total')::int, 'board_cards total = counts'; c := c + 1;
  assert (nx -> 'cards' -> 0 ->> 'id')::bigint < (pg -> 'columns' -> 'r1' -> 29 ->> 'id')::bigint, 'trang 2 nối tiếp trang 1'; c := c + 1;
  assert jsonb_array_length(public.board_cards('r1', 0, '{}', '') -> 'cards') = 30
     and public.board_cards('r1', 0, '{}', '') -> 'cards' = pg -> 'columns' -> 'r1', 'board_cards offset 0 = trang đầu'; c := c + 1;
  begin
    perform public.board_cards('xyz', 0, '{}', '');
    assert false, 'ô lạ phải bị từ chối';
  exception when invalid_parameter_value then c := c + 1;
  end;

  -- ---------- 4. lọc + tìm ----------
  n := (select sum((v ->> 'total')::int) from jsonb_each(public.board_page('{"position":"Vị trí 1","region":"Vùng Bắc"}', '') -> 'counts') x(kx, v));
  assert n = (select count(*) from jsonb_array_elements(fx -> 'records') e where e ->> 'position' = 'Vị trí 1' and e ->> 'region' = 'Vùng Bắc'),
    'lọc position + region: ' || n; c := c + 1;
  n := (select sum((v ->> 'total')::int) from jsonb_each(public.board_page('{}', 'g00007') -> 'counts') x(kx, v));
  assert n = 1, 'tìm theo mã (không phân biệt hoa thường): ' || n; c := c + 1;
  n := (select sum((v ->> 'total')::int) from jsonb_each(public.board_page('{}', 'viên G0000') -> 'counts') x(kx, v));
  assert n = 9, 'tìm theo tên (chữ hoa/thường phần mã): ' || n; c := c + 1;
  n := (select sum((v ->> 'total')::int) from jsonb_each(public.board_page('{}', '090 000 0012') -> 'counts') x(kx, v));
  assert n = 1, 'tìm theo SĐT có số 0 và khoảng trắng: ' || n; c := c + 1;
  n := (select sum((v ->> 'total')::int) from jsonb_each(public.board_page('{}', '%') -> 'counts') x(kx, v));
  assert n = 0, '% là ký tự thường: ' || n; c := c + 1;

  -- ---------- 5. quyền: Admin lọc pic; TA chỉ thấy mình, bộ lọc pic bị bỏ qua ----------
  insert into auth.users (id) values (ta), (ad);
  insert into public.profiles (id, username, role, pic_code, active) values
    (ta, 'board_ta', 'pic', 'PIC-A', true), (ad, 'board_admin', 'admin', null, true);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', ad::text, true);
  n := (select sum((v ->> 'total')::int) from jsonb_each(public.board_page('{"pic":"PIC-B"}', '') -> 'counts') x(kx, v));
  assert n = (select count(*) from jsonb_array_elements(fx -> 'records') e where e ->> 'pic' = 'PIC-B'), 'Admin lọc PIC-B: ' || n; c := c + 1;
  perform set_config('request.jwt.claim.sub', ta::text, true);
  n := (select sum((v ->> 'total')::int) from jsonb_each(public.board_page('{"pic":"PIC-B"}', '') -> 'counts') x(kx, v));
  assert n = (select count(*) from jsonb_array_elements(fx -> 'records') e where e ->> 'pic' = 'PIC-A'),
    'TA: bỏ qua lọc PIC, chỉ thấy PIC-A: ' || n; c := c + 1;
  assert (select bool_and(e ->> 'pic' = 'PIC-A') from jsonb_array_elements(public.board_cards('r1', 0, '{}', '') -> 'cards') e),
    'TA: thẻ chỉ của PIC-A'; c := c + 1;
  execute 'reset role';

  -- ---------- 6. lịch sử chuyển vòng ----------
  select id into rid from public.recruitment_records where candidate_code = 'G00001';
  insert into public.status_history (record_id, kind, from_box, to_box, actor_id) values (rid, 'STAGE_MOVE', 'r1', 'lusu', ta);
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code)
    values (ta, 'board_ta', 'pic', 'STAGE_MOVE', rid, 'G00001');
  insert into public.status_history (record_id, kind, field_key, from_value, to_value) values (rid, 'STATUS', 'r1_status', '', 'Passed');
  pg := public.stage_history(rid);
  assert jsonb_array_length(pg) = 1 and pg -> 0 ->> 'from_box' = 'r1' and pg -> 0 ->> 'to_box' = 'lusu'
     and pg -> 0 ->> 'actor_username' = 'board_ta', 'stage_history: ' || pg::text; c := c + 1;

  assert not has_function_privilege('anon', 'public.board_page(jsonb,text)', 'execute'), 'anon không gọi board_page'; c := c + 1;
  assert not has_function_privilege('anon', 'public.board_cards(text,int,jsonb,text,int)', 'execute'), 'anon không gọi board_cards'; c := c + 1;
  assert not has_function_privilege('anon', 'public.stage_history(bigint)', 'execute'), 'anon không gọi stage_history'; c := c + 1;

  raise notice 'BOARD_TEST_PASSED: % check đạt', c;
end $$;
rollback;

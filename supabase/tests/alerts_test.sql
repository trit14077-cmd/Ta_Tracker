-- M6-3: chuông nhắc việc (0017 alerts) – rr_stage_sql = currentStage() trên golden fixture + hành vi như Ops.gs hAlerts_.
-- Chạy từ thư mục gốc repo:  psql -v ON_ERROR_STOP=1 -f supabase/tests/alerts_test.sql   (ROLLBACK ở cuối)
\set fx `cat tests/golden/fixture.json`
select set_config('parity.fx', :'fx', false);
begin;
do $$
declare
  fx jsonb := current_setting('parity.fx')::jsonb;
  c int := 0;
  bad text;
  j jsonb;
  td date := '2026-11-20';
  a  uuid := '00000000-0000-4000-8000-0000000008a0';
  t1 uuid := '00000000-0000-4000-8000-0000000008b1';
  t2 uuid := '00000000-0000-4000-8000-0000000008b2';
  ra bigint; rb bigint; rc bigint; rd bigint; re bigint; rf bigint; rg bigint;
begin
  -- ---------- 1. giai đoạn = currentStage() trên 410 hồ sơ golden ----------
  update public.recruitment_records set is_archived = true where not is_archived;
  insert into public.pics (code, name)
    select distinct e ->> 'pic', e ->> 'pic' from jsonb_array_elements(fx -> 'records') e where e ->> 'pic' <> ''
  on conflict (code) do nothing;
  insert into public.recruitment_records (candidate_code, pic, r1_date, r1_status, r2_date, r2_status, ob_date, ob_status, emp_status, attrition_date)
  select e ->> 'candidate_code', nullif(e ->> 'pic', ''),
         nullif(e ->> 'r1_date', '')::date, e ->> 'r1_status', nullif(e ->> 'r2_date', '')::date, e ->> 'r2_status',
         nullif(e ->> 'ob_date', '')::date, e ->> 'ob_status', e ->> 'emp_status', nullif(e ->> 'attrition_date', '')::date
    from jsonb_array_elements(fx -> 'records') e;
  execute format($q$
    select string_agg(format('%%s: %%s/%%s', r.candidate_code, %s, p ->> 'stage'), '; ')
      from public.recruitment_records r
      join jsonb_array_elements($1 -> 'outputs' -> 'perRecord') p on p ->> 'code' = r.candidate_code
     where %s is distinct from p ->> 'stage'
  $q$, public.rr_stage_sql(), public.rr_stage_sql()) into bad using fx;
  assert bad is null, 'giai đoạn lệch currentStage(): ' || left(coalesce(bad, ''), 600); c := c + 1;
  -- các ca ít gặp: tạm giữ, khoảng trắng thừa, chỉ có ngày
  execute format('select to_jsonb(array_agg(%s order by o)) from (values
      (1, %L, %L, %L, null::date, null::date, null::date), (2, %L, %L, %L, null, null, null), (3, %L, %L, %L, null, null, null),
      (4, %L, %L, %L, null, %L::date, null), (5, %L, %L, %L, %L::date, null, null), (6, %L, %L, %L, null, null, %L::date)
    ) as r(o, r1_status, r2_status, ob_status, r1_date, r2_date, ob_date)', public.rr_stage_sql(),
    'Passed', 'KIV', '', 'Không liên lạc được', '', '', ' Passed ', ' Passed ', '',
    'Passed', '', '', '2026-11-01', '', '', '', '2026-11-01', '', '', '', '2026-11-01') into j;
  assert j = '["On Hold", "On Hold", "Passed", "Interview", "Screening", "Offer"]', 'ca ít gặp: ' || j::text; c := c + 1;

  -- ---------- 2. chuông ----------
  update public.recruitment_records set is_archived = true where not is_archived;
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('ALR-P1', 'ALR-P1'), ('ALR-P2', 'ALR-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'alr_admin', 'admin', null, true), (t1, 'alr_t1', 'pic', 'ALR-P1', true), (t2, 'alr_t2', 'pic', 'ALR-P2', true);
  -- A: đạt R2, chưa có HR Info
  insert into public.recruitment_records (candidate_code, full_name, pic, r2_status) values ('ALRA', 'Ứng viên A', 'ALR-P1', 'Passed') returning id into ra;
  -- B: Offer, rank 6, thiếu Health check; chưa có HR Info
  insert into public.recruitment_records (candidate_code, full_name, pic, r2_status, ob_status, rank, id_card)
    values ('ALRB', 'Ứng viên B', 'ALR-P1', 'Passed', 'Accepted', '6A', 'cccd.pdf') returning id into rb;
  -- C: Offer, HR Info đã xác nhận, rank 5 không phải lái xe nâng => không có cảnh báo
  insert into public.recruitment_records (candidate_code, full_name, pic, r2_status, ob_status, rank, position)
    values ('ALRC', 'Ứng viên C', 'ALR-P1', 'Passed', 'Pending', '5', 'Nhân viên Kho') returning id into rc;
  insert into public.hr_info (record_id, status) values (rc, 'verified');
  -- D: Offer (chỉ có ngày OB), lái xe nâng, thiếu cả 3 giấy tờ; HR Info mới nháp
  insert into public.recruitment_records (candidate_code, full_name, pic, ob_date, position, rank)
    values ('ALRD', 'Ứng viên D', 'ALR-P1', '2026-12-01', 'Nhân viên Lái xe nâng', '') returning id into rd;
  insert into public.hr_info (record_id, status) values (rd, 'draft');
  -- E: PIC khác; F: lưu trữ; G: đã Joined => không có trong chuông của t1
  insert into public.recruitment_records (candidate_code, full_name, pic, r2_status) values ('ALRE', 'Ứng viên E', 'ALR-P2', 'Passed') returning id into re;
  insert into public.recruitment_records (candidate_code, full_name, pic, r2_status, is_archived) values ('ALRF', 'Ứng viên F', 'ALR-P1', 'Passed', true) returning id into rf;
  insert into public.recruitment_records (candidate_code, full_name, pic, r2_status, ob_status) values ('ALRG', 'Ứng viên G', 'ALR-P1', 'Passed', 'Joined') returning id into rg;
  -- công việc của t1: quá hạn, hôm nay, ngày mai, ngày kia (không), đã xong quá hạn (không); việc của t2 trên hồ sơ P1
  insert into public.tasks (record_id, title, due, owner_id, created_by) values
    (ra, 'Quá hạn', td - 1, t1, t1), (null, 'Hôm nay', td, t1, t1), (null, 'Ngày mai', td + 1, t1, t1),
    (null, 'Ngày kia', td + 2, t1, t1), (null, 'Xong rồi', td - 3, t1, t1), (ra, 'Việc của t2', td - 2, t2, a);
  update public.tasks set status = 'done' where title = 'Xong rồi';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.alerts(td);
  assert j -> 'counts' = '{"overdue": 1, "due_soon": 2, "passed_no_hr": 3, "missing_docs": 2}', 'đếm (TA) – ' || (j -> 'counts')::text; c := c + 1;
  assert j -> 'overdue' -> 0 ->> 'title' = 'Quá hạn' and j -> 'overdue' -> 0 ->> 'candidate_code' = 'ALRA'
     and j -> 'overdue' -> 0 ->> 'owner' = 'alr_t1', 'quá hạn: chỉ việc TA phụ trách, kèm hồ sơ'; c := c + 1;
  assert (select string_agg(e ->> 'title', ',' order by o) from jsonb_array_elements(j -> 'due_soon') with ordinality x(e, o)) = 'Hôm nay,Ngày mai',
    'sắp đến hạn: hôm nay + ngày mai'; c := c + 1;
  assert (select string_agg(e ->> 'candidate_code', ',' order by o) from jsonb_array_elements(j -> 'passed_no_hr') with ordinality x(e, o)) = 'ALRA,ALRB,ALRD',
    'đạt R2 chưa có HR Info: A, B (Offer), D (HR nháp); không C (đã xác nhận), E, F, G – ' || (j -> 'passed_no_hr')::text; c := c + 1;
  assert (select jsonb_object_agg(e ->> 'candidate_code', e ->> 'detail') from jsonb_array_elements(j -> 'missing_docs') e)
         = '{"ALRB": "Health check", "ALRD": "Health check, ID Card, Chứng chỉ lái xe nâng"}', 'thiếu giấy tờ – ' || (j -> 'missing_docs')::text; c := c + 1;
  assert j ->> 'today' = '2026-11-20', 'today'; c := c + 1;

  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.alerts(td);
  assert j -> 'counts' = '{"overdue": 2, "due_soon": 2, "passed_no_hr": 4, "missing_docs": 2}', 'đếm (Admin: mọi việc, mọi hồ sơ) – ' || (j -> 'counts')::text; c := c + 1;
  assert j -> 'overdue' -> 0 ->> 'title' = 'Việc của t2', 'quá hạn xếp theo hạn'; c := c + 1;
  execute 'reset role';

  -- tối đa 20 mục mỗi danh sách, đếm vẫn đủ
  insert into public.tasks (title, due, owner_id, created_by) select 'Nhiều ' || g, td - 5, t1, t1 from generate_series(1, 25) g;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.alerts(td);
  assert (j -> 'counts' ->> 'overdue')::int = 26 and jsonb_array_length(j -> 'overdue') = 20, 'tối đa 20 mục'; c := c + 1;
  execute 'reset role';

  assert not has_function_privilege('anon', 'public.alerts(date)', 'execute'), 'anon không gọi alerts'; c := c + 1;
  raise notice 'ALERTS_TEST_PASSED: % check đạt', c;
end $$;
rollback;

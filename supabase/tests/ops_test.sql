-- M6-1: list_tasks, list_interviews, calendar_range, target_list (0015) – hành vi như Ops.gs của hệ cũ.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/ops_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000007a0';
  t1 uuid := '00000000-0000-4000-8000-0000000007b1';
  t2 uuid := '00000000-0000-4000-8000-0000000007b2';
  r1 bigint; r2 bigint; r3 bigint; r4 bigint;
  k1 bigint; k2 bigint; k3 bigint;
  j jsonb; n int;
  td date := '2026-11-19';
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('OPS-P1', 'OPS-P1'), ('OPS-P2', 'OPS-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'ops_admin', 'admin', null, true), (t1, 'ops_t1', 'pic', 'OPS-P1', true), (t2, 'ops_t2', 'pic', 'OPS-P2', true);

  insert into public.recruitment_records (candidate_code, full_name, pic, position, dept, r1_date, r1_time, r1_status, r2_date, r2_status, r2_interviewer)
    values ('OPS01', 'Ứng viên Một', 'OPS-P1', 'Vị trí A', 'Phòng X', '2026-11-10', '09:00', 'Passed', '2026-11-12', 'Pending', 'Anh B') returning id into r1;
  insert into public.recruitment_records (candidate_code, full_name, pic, position, dept, ob_date, ob_status)
    values ('OPS02', 'Ứng viên Hai', 'OPS-P2', 'Vị trí A', 'Phòng X', '2026-11-11', 'Joined') returning id into r2;
  insert into public.recruitment_records (candidate_code, full_name, pic, ob_date, ob_status, is_archived)
    values ('OPS03', 'Ứng viên Ba', 'OPS-P1', '2026-11-13', 'Joined', true) returning id into r3;
  insert into public.recruitment_records (candidate_code, full_name, pic, position, dept, ob_date, ob_status)
    values ('OPS04', 'Ứng viên Bốn', 'OPS-P1', 'Vị trí B', 'Phòng X', '2026-11-14', 'Joined') returning id into r4;

  -- ---------- công việc ----------
  insert into public.tasks (record_id, title, type, due, due_time, owner_id, created_by)
    values (r1, 'Gọi ứng viên', 'Gọi điện', '2026-11-18', '10:00', t1, t1) returning id into k1;   -- quá hạn, của t1
  insert into public.tasks (record_id, title, type, due, owner_id, created_by)
    values (r1, 'Việc Admin giao t2 trên hồ sơ P1', 'Khác', '2026-11-20', t2, a) returning id into k2;
  insert into public.tasks (title, type, due, owner_id, created_by)
    values ('Việc riêng của t2', 'Khác', '2026-11-12', t2, t2) returning id into k3;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.list_tasks('mine', null, td);
  assert jsonb_array_length(j -> 'tasks') = 1 and (j -> 'tasks' -> 0 ->> 'id')::bigint = k1, 'mine: chỉ việc của t1 – ' || j::text; c := c + 1;
  assert j -> 'tasks' -> 0 ->> 'owner' = 'ops_t1' and j -> 'tasks' -> 0 ->> 'candidate_code' = 'OPS01'
     and j -> 'tasks' -> 0 ->> 'pic' = 'OPS-P1' and j ->> 'today' = '2026-11-19', 'TaskItem: owner, hồ sơ, today'; c := c + 1;
  j := public.list_tasks('all', null, td);
  assert jsonb_array_length(j -> 'tasks') = 2, 'all (TA): việc của mình + việc gắn hồ sơ mình, không thấy việc riêng t2 – ' || j::text; c := c + 1;
  assert (select string_agg(e ->> 'owner', ',' order by o) from jsonb_array_elements(j -> 'tasks') with ordinality x(e, o)) = 'ops_t1,ops_t2',
    'TA thấy tên người phụ trách khác (app.username)'; c := c + 1;
  assert jsonb_array_length(public.list_tasks('overdue', null, td) -> 'tasks') = 1, 'overdue'; c := c + 1;
  assert jsonb_array_length(public.list_tasks('upcoming', null, td) -> 'tasks') = 1, 'upcoming'; c := c + 1;
  assert jsonb_array_length(public.list_tasks('mine', r1, td) -> 'tasks') = 2, 'theo hồ sơ: mọi việc của hồ sơ'; c := c + 1;
  -- như hệ cũ: TA sửa được việc người khác gắn hồ sơ PIC mình; không sửa / xóa được việc riêng của người khác
  update public.tasks set title = 'Việc Admin giao t2 (t1 sửa)' where id = k2;
  get diagnostics n = row_count;
  assert n = 1, 'TA sửa được việc gắn hồ sơ PIC mình'; c := c + 1;
  update public.tasks set title = 'chen' where id = k3;
  get diagnostics n = row_count;
  assert n = 0, 'TA không sửa việc riêng của người khác'; c := c + 1;
  delete from public.tasks where id = k3;
  get diagnostics n = row_count;
  assert n = 0, 'TA không xóa việc riêng của người khác'; c := c + 1;
  -- done_at tự động
  update public.tasks set status = 'done' where id = k1;
  assert (select done_at is not null from public.tasks where id = k1), 'done -> done_at'; c := c + 1;
  assert jsonb_array_length(public.list_tasks('done', null, td) -> 'tasks') = 1, 'view done'; c := c + 1;
  update public.tasks set status = 'open' where id = k1;
  assert (select done_at is null from public.tasks where id = k1), 'open -> xóa done_at'; c := c + 1;
  begin
    update public.tasks set status = 'xyz' where id = k1;
    assert false, 'trạng thái lạ phải bị từ chối';
  exception when check_violation then c := c + 1;
  end;

  -- ---------- phỏng vấn ----------
  insert into public.interview_schedules (record_id, round, date, time, interviewer, result)
    values (r1, 'R1', '2026-11-10', '09:30', 'Chị C', 'Passed');
  j := public.list_interviews(r1);
  assert jsonb_array_length(j -> 'interviews') = 1 and j -> 'interviews' -> 0 ->> 'created_by' = 'ops_t1'
     and j -> 'interviews' -> 0 ->> 'source' = 'history', 'list_interviews: lịch sử – ' || j::text; c := c + 1;
  assert jsonb_array_length(j -> 'profile') = 2 and j -> 'profile' -> 1 ->> 'interviewer' = 'Anh B'
     and j -> 'profile' -> 0 ->> 'time' = '09:00', 'list_interviews: R1/R2 trên hồ sơ'; c := c + 1;
  assert public.list_interviews(r2) is null, 'hồ sơ PIC khác: null'; c := c + 1;
  -- chỉ người tạo hoặc Admin xóa buổi phỏng vấn
  execute 'reset role';
  insert into public.interview_schedules (record_id, round, round_name, date, created_by) values (r1, 'Khác', 'Thử việc', '2026-11-16', a);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  delete from public.interview_schedules where record_id = r1 and created_by = a;
  get diagnostics n = row_count;
  assert n = 0, 'TA không xóa buổi phỏng vấn người khác tạo'; c := c + 1;
  execute 'reset role';
  delete from public.interview_schedules where record_id = r1 and created_by = a;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);

  -- ---------- lịch ----------
  insert into public.calendar_events (title, type, date, time, owner_id) values ('Họp team', 'Họp', '2026-11-15', '14:00', t1);
  j := public.calendar_range('2026-11-01', '2026-11-30', '');
  assert (select string_agg(e ->> 'id', ',' order by o) from jsonb_array_elements(j -> 'events') with ordinality x(e, o))
         = format('iv-%s,r2-%s,ob-%s,ev-%s,task-%s,task-%s',
                  (select id from public.interview_schedules where record_id = r1), r1, r4,
                  (select id from public.calendar_events where title = 'Họp team'), k1, k2),
    'lịch TA: phỏng vấn (thay R1 trên hồ sơ cùng ngày), R2, OB P1 (không lưu trữ), sự kiện, 2 việc – ' || (j -> 'events')::text; c := c + 1;
  assert j -> 'events' -> 0 ->> 'title' = 'Phỏng vấn R1' and (j -> 'events' -> 0 ->> 'done')::boolean
     and j -> 'events' -> 1 ->> 'note' = 'Anh B' and not (j -> 'events' -> 1 ->> 'done')::boolean, 'nội dung mục lịch'; c := c + 1;
  assert j -> 'events' -> 3 ->> 'owner' = 'ops_t1' and not (j -> 'events' -> 0 ? 'owner'), 'owner chỉ có ở sự kiện riêng'; c := c + 1;
  assert (j -> 'people_per_pic' ->> 'OPS-P1')::int = 2 and (j ->> 'people_total')::int = 2, 'people_per_pic – ' || (j -> 'people_per_pic')::text; c := c + 1;
  begin
    perform public.calendar_range('2026-01-01', '2026-11-30', '');
    assert false, 'quá 62 ngày phải bị từ chối';
  exception when invalid_parameter_value then c := c + 1;
  end;
  -- TA truyền p_pic: bị bỏ qua
  assert jsonb_array_length(public.calendar_range('2026-11-01', '2026-11-30', 'OPS-P2') -> 'events') = 6, 'TA: p_pic bị bỏ qua'; c := c + 1;

  -- Admin lọc PIC P2: mục của hồ sơ P2 + việc không gắn hồ sơ của người có PIC P2
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.calendar_range('2026-11-01', '2026-11-30', 'OPS-P2');
  assert (select string_agg(e ->> 'id', ',' order by o) from jsonb_array_elements(j -> 'events') with ordinality x(e, o))
         = format('ob-%s,task-%s', r2, k3), 'Admin lọc P2 – ' || (j -> 'events')::text; c := c + 1;
  assert (j -> 'people_per_pic' ->> 'OPS-P2')::int = 1 and (j -> 'people_per_pic' ->> 'OPS-P1')::int = 2, 'people_per_pic đếm trước khi lọc'; c := c + 1;

  -- ---------- target ----------
  insert into public.targets (period_type, period_key, pic, position, dept, value) values
    ('month', '2026-11', 'OPS-P1', '', '', 4),
    ('month', '2026-11', null, 'Vị trí A', '', 3),
    ('month', '2026-11', 'OPS-P2', '', '', 2);
  j := public.target_list('month', '2026-11', '2026-11-01', '2026-11-30');
  assert jsonb_array_length(j -> 'targets') = 3, 'Admin thấy 3 target'; c := c + 1;
  assert (select (e ->> 'actual')::int = 1 and (e ->> 'pct')::numeric = 25 from jsonb_array_elements(j -> 'targets') e where e ->> 'pic' = 'OPS-P1'),
    'thực tế P1 = 1 (OPS04; OPS03 lưu trữ không tính), 25%'; c := c + 1;
  assert (select (e ->> 'actual')::int = 1 and (e ->> 'pct')::numeric = 33.3 from jsonb_array_elements(j -> 'targets') e where e ->> 'position' = 'Vị trí A'),
    'target cả team theo vị trí A: 1/3 = 33,3%'; c := c + 1;
  assert j -> 'targets' -> 0 ->> 'pic' = 'OPS-P1' and j -> 'targets' -> 2 ->> 'position' = 'Vị trí A',
    'xếp theo chuỗi pic+position+dept như hệ cũ (so mã ký tự)'; c := c + 1;

  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.target_list('month', '2026-11', '2026-11-01', '2026-11-30');
  assert jsonb_array_length(j -> 'targets') = 1 and j -> 'targets' -> 0 ->> 'pic' = 'OPS-P1', 'TA chỉ thấy target PIC mình (G1)'; c := c + 1;
  begin
    perform public.rr_target_actual('OPS-P2', '', '', '2026-11-01', '2026-11-30');
    assert false, 'TA không đếm được target PIC khác';
  exception when insufficient_privilege then c := c + 1;
  end;
  execute 'reset role';
  update public.profiles set can_view_all_targets = true where id = t1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.target_list('month', '2026-11', '2026-11-01', '2026-11-30');
  assert jsonb_array_length(j -> 'targets') = 3, 'TA được cấp quyền xem thêm: thấy 3 target'; c := c + 1;
  assert (select (e ->> 'actual')::int from jsonb_array_elements(j -> 'targets') e where e ->> 'pic' = 'OPS-P2') = 1,
    'thực tế đếm trên toàn bộ hồ sơ (như hệ cũ), không chỉ hồ sơ TA thấy'; c := c + 1;
  execute 'reset role';

  -- nhật ký như hệ cũ
  assert exists (select 1 from public.audit_logs where action = 'TASK' and record_id = r1 and actor_username = 'ops_t1'
                  and changes -> 'task' ->> 'new' = 'Xong: Gọi ứng viên'), 'audit TASK: Xong'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'TASK' and actor_username = 'ops_t1'
                  and changes -> 'task' ->> 'new' = 'Cập nhật việc: Việc Admin giao t2 (t1 sửa)'), 'audit TASK: cập nhật'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'INTERVIEW' and record_id = r1 and candidate_code = 'OPS01'
                  and changes -> 'interview' ->> 'new' = 'Thêm phỏng vấn R1 ngày 2026-11-10 (Passed)'), 'audit INTERVIEW: thêm'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'INTERVIEW' and changes -> 'interview' ->> 'old' = 'Khác 2026-11-16'),
    'audit INTERVIEW: xóa'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'TARGET' and actor_username = 'ops_admin'
                  and changes -> 'month 2026-11' ->> 'new' = '3 (Tất cả TA / Vị trí A / mọi phòng ban)'), 'audit TARGET'; c := c + 1;
  assert not has_function_privilege('authenticated', 'public.tg_ops_audit()', 'execute'), 'không gọi thẳng hàm nhật ký'; c := c + 1;

  assert not has_function_privilege('anon', 'public.list_tasks(text,bigint,date)', 'execute'), 'anon list_tasks'; c := c + 1;
  assert not has_function_privilege('anon', 'public.calendar_range(date,date,text)', 'execute'), 'anon calendar_range'; c := c + 1;
  assert not has_function_privilege('anon', 'public.target_list(text,text,date,date)', 'execute'), 'anon target_list'; c := c + 1;
  assert not has_function_privilege('anon', 'app.username(uuid)', 'execute'), 'anon app.username'; c := c + 1;

  raise notice 'OPS_TEST_PASSED: % check đạt', c;
end $$;
rollback;

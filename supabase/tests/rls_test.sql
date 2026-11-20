-- M2-4: bộ test RLS (DATABASE_SCHEMA §5). 1 Admin + 3 TA (+1 TA bị khóa) + anon; hồ sơ của PIC mình, PIC khác, pic = null.
-- Chạy sau khi áp migrations:  psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Toàn bộ chạy trong 1 giao dịch và ROLLBACK ở cuối: không để lại dữ liệu. Đặt rlstest.raise_at_end=on để kết thúc
-- bằng exception (dùng khi công cụ chạy SQL không cho rollback tường minh).
begin;
do $$
declare
  c int := 0;                 -- số check đã đạt
  n int;
  v text;
  a   uuid := '00000000-0000-4000-8000-0000000000a0';   -- admin
  t1  uuid := '00000000-0000-4000-8000-0000000000b1';   -- TA PIC RLS1-A
  t2  uuid := '00000000-0000-4000-8000-0000000000b2';   -- TA PIC RLS2-B
  t3  uuid := '00000000-0000-4000-8000-0000000000b3';   -- TA PIC RLS3-C, được xem mọi target
  tx  uuid := '00000000-0000-4000-8000-0000000000bf';   -- TA PIC RLS1-A nhưng bị khóa
  r1 bigint; r2 bigint; r3 bigint; r0 bigint; recs bigint[];
  cm_t2 bigint; cm_a bigint; cm_mine bigint;
begin
  -- ---------- dữ liệu giả (quyền chủ DB) ----------
  insert into auth.users (id) values (a), (t1), (t2), (t3), (tx);
  insert into public.pics (code, name) values ('RLS1-A','RLS1-A'), ('RLS2-B','RLS2-B'), ('RLS3-C','RLS3-C');
  insert into public.profiles (id, username, role, pic_code, active, can_view_all_targets) values
    (a,  'rls_admin', 'admin', null,     true,  false),
    (t1, 'rls_t1',    'pic',   'RLS1-A', true,  false),
    (t2, 'rls_t2',    'pic',   'RLS2-B', true,  false),
    (t3, 'rls_t3',    'pic',   'RLS3-C', true,  true),
    (tx, 'rls_tx',    'pic',   'RLS1-A', false, false);
  insert into public.recruitment_records (candidate_code, pic) values ('RLSTEST1', 'RLS1-A') returning id into r1;
  insert into public.recruitment_records (candidate_code, pic) values ('RLSTEST2', 'RLS2-B') returning id into r2;
  insert into public.recruitment_records (candidate_code, pic) values ('RLSTEST3', 'RLS3-C') returning id into r3;
  insert into public.recruitment_records (candidate_code, pic) values ('RLSTEST0', null)     returning id into r0;
  recs := array[r1, r2, r3, r0];

  insert into public.comments (record_id, author_id, author_username, author_role, body) values (r1, a, 'rls_admin', 'admin', 'c-admin-r1') returning id into cm_a;
  insert into public.comments (record_id, author_id, author_username, author_role, body) values (r2, t2, 'rls_t2', 'pic', 'c-t2-r2') returning id into cm_t2;
  insert into public.comments (record_id, author_id, author_username, author_role, body) values (r0, a, 'rls_admin', 'admin', 'c-admin-r0');
  insert into public.interview_schedules (record_id, round, created_by) values (r1, 'R1', a), (r2, 'R2', a);
  insert into public.status_history (record_id, kind) values (r1, 'STATUS'), (r2, 'STATUS');
  insert into public.audit_logs (actor_username, actor_role, action, record_id) values ('rls_admin','admin','UPDATE', r1), ('rls_admin','admin','UPDATE', r2);
  insert into public.hiring_checklists (record_id, confirmed) values (r1, true);
  insert into public.hr_info (record_id, status, id_number) values (r1, 'verified', '000000000001'), (r2, 'draft', '000000000002');
  insert into public.record_files (record_id, kind, drive_file_id, file_name) values (r1, 'cv', 'f1', 'cv1.pdf'), (r2, 'cv', 'f2', 'cv2.pdf');
  insert into public.record_files (record_id, kind, drive_file_id, file_name, deleted_at) values (r1, 'id_card', 'f3', 'old.pdf', now());
  insert into public.tasks (title, owner_id, created_by) values ('rls-task-t2', t2, t2);
  insert into public.targets (period_type, period_key, pic, value) values
    ('month','2099-01','RLS1-A',1), ('month','2099-01','RLS2-B',2), ('month','2099-01',null,3);
  insert into public.app_settings (key, value, sensitive) values ('rls_public', '1', false), ('rls_secret', '2', true);
  insert into public.applications (pic, full_name, phone, consent_at) values ('RLS1-A','x','0',now()), ('RLS2-B','y','0',now());
  insert into public.saved_views (name, audience, user_ids) values ('rls_all','all','{}'), ('rls_t2only','custom', array[t2]);
  insert into public.import_batches (source) values ('rls_test');

  -- ================= TA1 =================
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);

  select count(*) into n from public.recruitment_records where id = any(recs);
  assert n = 1, 'T1 chỉ thấy hồ sơ của PIC mình (không thấy PIC khác, không thấy pic=null)'; c := c + 1;
  begin
    update public.recruitment_records set full_name = 'x' where id = r1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không được UPDATE trực tiếp recruitment_records (chỉ qua RPC)';
  end; c := c + 1;
  begin
    insert into public.recruitment_records (candidate_code, pic) values ('RLSHACK', 'RLS1-A');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không được INSERT trực tiếp recruitment_records';
  end; c := c + 1;

  -- comments
  select count(*) into n from public.comments where record_id = any(recs);
  assert n = 1, 'T1 chỉ thấy bình luận của hồ sơ mình'; c := c + 1;
  insert into public.comments (record_id, body, author_username, author_role) values (r1, 'cua t1', 'gia-mao', 'admin') returning id into cm_mine;
  select author_username into v from public.comments where id = cm_mine;
  assert v = 'rls_t1', 'Tác giả bình luận lấy từ profiles, không tin giá trị client gửi'; c := c + 1;
  begin
    insert into public.comments (record_id, body) values (r2, 'chen vao PIC khac');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không được bình luận vào hồ sơ PIC khác';
  end; c := c + 1;
  update public.comments set body = 'sua' where id = cm_mine; get diagnostics n = row_count;
  assert n = 1, 'T1 sửa được bình luận của mình'; c := c + 1;
  update public.comments set body = 'sua' where id = cm_a; get diagnostics n = row_count;
  assert n = 0, 'T1 không sửa được bình luận của người khác trên hồ sơ mình'; c := c + 1;
  delete from public.comments where id = cm_t2; get diagnostics n = row_count;
  assert n = 0, 'T1 không xóa được bình luận ở hồ sơ PIC khác'; c := c + 1;

  -- interview_schedules / status_history / audit_logs
  select count(*) into n from public.interview_schedules where record_id = any(recs);
  assert n = 1, 'T1 chỉ thấy lịch phỏng vấn của hồ sơ mình'; c := c + 1;
  insert into public.interview_schedules (record_id, round) values (r1, 'R2'); c := c + 1;
  begin
    insert into public.interview_schedules (record_id, round) values (r0, 'R1');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không thêm lịch phỏng vấn cho hồ sơ chưa gán PIC';
  end; c := c + 1;
  select count(*) into n from public.status_history where record_id = any(recs);
  assert n = 1, 'T1 chỉ thấy lịch sử trạng thái của hồ sơ mình'; c := c + 1;
  begin
    insert into public.status_history (record_id, kind) values (r1, 'STATUS');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không ghi trực tiếp status_history';
  end; c := c + 1;
  select count(*) into n from public.audit_logs where record_id = any(recs) and action = 'UPDATE';  -- trigger 0015 ghi thêm dòng TASK/INTERVIEW
  assert n = 1, 'T1 chỉ thấy audit của hồ sơ mình'; c := c + 1;
  assert not exists (select 1 from public.audit_logs where record_id is not null and record_id <> all(recs[1:1]) and record_id = any(recs)), 'T1 không thấy nhật ký (kể cả do trigger) của hồ sơ người khác'; c := c + 1;
  begin
    insert into public.audit_logs (actor_username, actor_role, action) values ('x','admin','FAKE');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không ghi được audit_logs';
  end; c := c + 1;

  -- hiring_checklists / hr_info / record_files
  update public.hiring_checklists set items = '{"x":true}' where record_id = r1; get diagnostics n = row_count;
  assert n = 0, 'T1 không sửa checklist đã xác nhận tuyển (chỉ Admin)'; c := c + 1;
  begin
    insert into public.hiring_checklists (record_id) values (r2);
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không tạo checklist cho hồ sơ PIC khác';
  end; c := c + 1;
  select count(*) into n from public.hr_info where record_id = any(recs);
  assert n = 1, 'T1 chỉ thấy HR Info (CCCD…) của hồ sơ mình'; c := c + 1;
  -- 0018: HR Info chỉ ghi qua Edge hr-info-save (validate + nhật ký) – người dùng không ghi trực tiếp được
  begin
    update public.hr_info set data = '{"a":1}' where record_id = r1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không sửa trực tiếp HR Info';
  end; c := c + 1;
  begin
    insert into public.hr_info (record_id) values (r1);
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không tạo trực tiếp HR Info';
  end; c := c + 1;
  select count(*) into n from public.record_files where record_id = any(recs);
  assert n = 1, 'T1 chỉ thấy file của hồ sơ mình và không thấy file đã xóa'; c := c + 1;
  begin
    insert into public.record_files (record_id, kind, drive_file_id, file_name) values (r1, 'cv', 'x', 'x');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không ghi trực tiếp record_files (chỉ Edge files)';
  end; c := c + 1;

  -- tasks
  select count(*) into n from public.tasks where title like 'rls-task%';
  assert n = 0, 'T1 không thấy việc riêng của TA khác'; c := c + 1;
  insert into public.tasks (title) values ('rls-task-t1'); c := c + 1;
  begin
    insert into public.tasks (title, owner_id) values ('rls-task-giao', t2);
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không giao việc cho TA khác (chỉ Admin)';
  end; c := c + 1;
  begin
    insert into public.tasks (title, record_id) values ('rls-task-r2', r2);
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không tạo việc gắn hồ sơ PIC khác';
  end; c := c + 1;

  -- targets (TARGET, G1)
  select count(*) into n from public.targets where period_key = '2099-01';
  assert n = 1, 'T1 chỉ thấy target của mình (không thấy TA khác, không thấy target chung)'; c := c + 1;
  begin
    insert into public.targets (period_type, period_key, pic, value) values ('month','2099-02','RLS1-A',9);
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không đặt target (chỉ Admin)';
  end; c := c + 1;

  -- app_settings
  select count(*) into n from public.app_settings where key like 'rls_%';
  assert n = 1, 'T1 không đọc được khóa cấu hình nhạy cảm'; c := c + 1;
  update public.app_settings set value = '9' where key = 'rls_public'; get diagnostics n = row_count;
  assert n = 0, 'T1 không sửa cấu hình'; c := c + 1;

  -- applications
  select count(*) into n from public.applications where full_name in ('x','y');
  assert n = 1, 'T1 chỉ thấy đơn ứng tuyển của PIC mình'; c := c + 1;
  update public.applications set status = 'ignored' where pic = 'RLS1-A' and full_name = 'x'; get diagnostics n = row_count;
  assert n = 1, 'T1 đổi được trạng thái đơn của PIC mình'; c := c + 1;
  begin
    update public.applications set full_name = 'sua' where pic = 'RLS1-A';
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không sửa nội dung đơn ứng tuyển (chỉ cột trạng thái)';
  end; c := c + 1;

  -- saved_views / user_preferences
  select count(*) into n from public.saved_views where name like 'rls_%';
  assert n = 1, 'T1 chỉ thấy View dành cho mọi người'; c := c + 1;
  insert into public.user_preferences (columns) values ('{"visible":["a"],"order":[]}'); c := c + 1;
  begin
    insert into public.user_preferences (user_id) values (t2);
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không ghi tùy chỉnh cột của người khác';
  end; c := c + 1;

  -- profiles / danh mục / đề xuất
  select count(*) into n from public.profiles where username like 'rls_%';
  assert n = 1, 'T1 chỉ thấy profile của chính mình'; c := c + 1;
  update public.profiles set full_name = 'TA mot' where id = t1; get diagnostics n = row_count;
  assert n = 1, 'T1 sửa được tên hiển thị của mình'; c := c + 1;
  begin
    update public.profiles set role = 'admin' where id = t1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không tự nâng quyền lên admin';
  end; c := c + 1;
  begin
    update public.profiles set can_view_all_targets = true where id = t1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không tự bật quyền xem mọi target';
  end; c := c + 1;
  update public.profiles set full_name = 'x' where id = t2; get diagnostics n = row_count;
  assert n = 0, 'T1 không sửa profile người khác'; c := c + 1;
  begin
    insert into public.pics (code) values ('RLSHACK');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không sửa danh mục PIC';
  end; c := c + 1;
  insert into public.dropdown_requests (list_key, proposed_value) values ('site', 'RLS kho moi'); c := c + 1;
  begin
    insert into public.dropdown_requests (list_key, proposed_value, status) values ('site', 'RLS tu duyet', 'approved');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'T1 không tự duyệt đề xuất Drop-list';
  end; c := c + 1;
  select count(*) into n from public.applicants; assert n = 0, 'T1 không đọc applicants'; c := c + 1;
  select count(*) into n from public.import_batches; assert n = 0, 'T1 không đọc import_batches'; c := c + 1;

  -- ================= TA2 / TA3 / TA bị khóa =================
  perform set_config('request.jwt.claims', json_build_object('sub', t2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.recruitment_records where id = any(recs);
  assert n = 1, 'T2 chỉ thấy hồ sơ của PIC mình'; c := c + 1;
  select count(*) into n from public.saved_views where name like 'rls_%';
  assert n = 2, 'T2 thấy View chung và View chỉ định cho mình'; c := c + 1;
  select count(*) into n from public.tasks where title like 'rls-task%';
  assert n = 1, 'T2 thấy việc của mình, không thấy việc riêng của T1'; c := c + 1;
  select count(*) into n from public.comments where id = cm_mine;
  assert n = 0, 'T2 không thấy bình luận ở hồ sơ của T1'; c := c + 1;
  select count(*) into n from public.user_preferences;
  assert n = 0, 'T2 không thấy tùy chỉnh cột của T1'; c := c + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', t3, 'role', 'authenticated')::text, true);
  select count(*) into n from public.targets where period_key = '2099-01';
  assert n = 3, 'T3 (được Admin bật quyền) thấy mọi target'; c := c + 1;
  select count(*) into n from public.recruitment_records where id = any(recs);
  assert n = 1, 'Quyền xem target không mở rộng quyền xem hồ sơ'; c := c + 1;

  perform set_config('request.jwt.claims', json_build_object('sub', tx, 'role', 'authenticated')::text, true);
  select count(*) into n from public.recruitment_records where id = any(recs);
  assert n = 0, 'TA bị khóa (active=false) không thấy hồ sơ nào'; c := c + 1;

  -- ================= Admin =================
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.recruitment_records where id = any(recs);
  assert n = 4, 'Admin thấy mọi hồ sơ, kể cả pic=null'; c := c + 1;
  select count(*) into n from public.targets where period_key = '2099-01';
  assert n = 3, 'Admin thấy mọi target'; c := c + 1;
  select count(*) into n from public.app_settings where key like 'rls_%';
  assert n = 2, 'Admin đọc được khóa nhạy cảm'; c := c + 1;
  update public.hiring_checklists set items = '{"x":true}' where record_id = r1; get diagnostics n = row_count;
  assert n = 1, 'Admin sửa được checklist đã xác nhận'; c := c + 1;
  insert into public.targets (period_type, period_key, pic, value) values ('month','2099-02','RLS1-A',9); c := c + 1;
  insert into public.pics (code, name) values ('RLS9-Z','RLS9-Z'); c := c + 1;
  select count(*) into n from public.import_batches where source = 'rls_test';
  assert n = 1, 'Admin đọc import_batches'; c := c + 1;
  begin
    update public.recruitment_records set full_name = 'x' where id = r1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'Admin cũng không UPDATE trực tiếp recruitment_records (chỉ qua RPC)';
  end; c := c + 1;

  -- ================= anon =================
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    perform 1 from public.recruitment_records limit 1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'anon không đọc recruitment_records';
  end; c := c + 1;
  begin
    perform 1 from public.comments limit 1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'anon không đọc comments';
  end; c := c + 1;
  begin
    perform 1 from public.app_settings limit 1;
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'anon không đọc app_settings';
  end; c := c + 1;
  begin
    perform public.report_totals();
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'anon không gọi được report_totals';
  end; c := c + 1;
  execute 'reset role';

  if current_setting('rlstest.raise_at_end', true) = 'on' then
    raise exception 'RLS_TEST_PASSED: % check đạt (đã rollback)', c;
  end if;
  raise notice 'RLS_TEST_PASSED: % check đạt', c;
end $$;
rollback;

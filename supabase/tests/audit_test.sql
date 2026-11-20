-- M6-5: list_audit (0019) – trải changes thành từng dòng như hệ cũ, lọc, phân trang, quyền xem.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/audit_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000aa0';
  t1 uuid := '00000000-0000-4000-8000-000000000ab1';
  t2 uuid := '00000000-0000-4000-8000-000000000ab2';
  r1 bigint; r2 bigint;
  j jsonb;
begin
  delete from public.audit_logs;
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('AU-P1', 'AU-P1'), ('AU-P2', 'AU-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'au_admin', 'admin', null, true), (t1, 'au_t1', 'pic', 'AU-P1', true), (t2, 'au_t2', 'pic', 'AU-P2', true);
  insert into public.recruitment_records (candidate_code, full_name, pic) values ('AUC01', 'Ứng viên Một', 'AU-P1') returning id into r1;
  insert into public.recruitment_records (candidate_code, full_name, pic) values ('AUC02', 'Ứng viên Hai', 'AU-P2') returning id into r2;
  delete from public.audit_logs;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes, at) values
    (t1, 'au_t1', 'pic', 'CREATE', r1, 'AUC01', '{"full_name":{"old":null,"new":"Ứng viên Một"},"phone":{"old":null,"new":"901234567"}}', now() - interval '3 min'),
    (t1, 'au_t1', 'pic', 'UPDATE', r1, 'AUC01', '{"r1_status":{"old":"","new":"Passed"},"r1_date":{"old":null,"new":"2026-11-20"}}', now() - interval '2 min'),
    (t2, 'au_t2', 'pic', 'UPDATE', r2, 'AUC02', '{"r1_status":{"old":"","new":"Failed"}}', now() - interval '1 min'),
    (t1, 'au_t1', 'pic', 'TASK', null, '', '{"task":{"old":"","new":"Tạo việc: Gọi lại (hạn 2026-11-21, au_t1)"}}', now()),
    (a, 'au_admin', 'admin', 'USER', null, '', '{"target_user":"x-1","role":"pic"}', now()),
    (a, 'au_admin', 'admin', 'ARCHIVE', r1, 'AUC01', '{}', now()),
    (a, 'au_admin', 'admin', 'RESTORE', r1, 'AUC01', '{"is_archived":{"old":true,"new":false}}', now()),
    (a, 'au_admin', 'admin', 'USER_CREATE', null, '', '{"target_user":"x-2"}', now());

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.list_audit(1, 50, '', '', '');
  assert (j ->> 'total')::int = 10, 'Admin: 10 dòng (CREATE 1 + UPDATE 2 + 1 + TASK 1 + USER 2 + ARCHIVE 1 + RESTORE 1 + USER_CREATE 1) – ' || (j ->> 'total'); c := c + 1;
  assert (select e ->> 'new_value' from jsonb_array_elements(j -> 'items') e where e ->> 'action' = 'CREATE')
         = 'Tạo mới hồ sơ ứng viên (Ứng viên Một - PIC: AU-P1)', 'CREATE: 1 dòng tóm tắt như hệ cũ'; c := c + 1;
  assert (select e ->> 'field_key' from jsonb_array_elements(j -> 'items') e where e ->> 'action' = 'CREATE') = 'ALL', 'CREATE field ALL'; c := c + 1;
  assert exists (select 1 from jsonb_array_elements(j -> 'items') e where e ->> 'field_key' = 'r1_date' and e ->> 'old_value' = '' and e ->> 'new_value' = '2026-11-20'),
    'UPDATE: mỗi trường 1 dòng, null -> rỗng'; c := c + 1;
  assert exists (select 1 from jsonb_array_elements(j -> 'items') e where e ->> 'action' = 'USER' and e ->> 'field_key' = 'role' and e ->> 'new_value' = 'pic'),
    'giá trị không dạng {old,new}: new = giá trị'; c := c + 1;
  assert exists (select 1 from jsonb_array_elements(j -> 'items') e where e ->> 'action' = 'ARCHIVE' and e ->> 'field_key' = ''),
    'changes rỗng: 1 dòng trường trống'; c := c + 1;
  assert (j -> 'items' -> 0 ->> 'id')::bigint >= (j -> 'items' -> 9 ->> 'id')::bigint, 'mới nhất trước'; c := c + 1;
  -- lọc
  assert (public.list_audit(1, 50, 'auc0', '', '') ->> 'total')::int = 6, 'lọc mã (chuỗi con, không phân biệt hoa thường)'; c := c + 1;
  assert (public.list_audit(1, 50, '', 'AU_T', '') ->> 'total')::int = 5, 'lọc người làm không phân biệt hoa thường (au_t1: 4 dòng, au_t2: 1)'; c := c + 1;
  assert (public.list_audit(1, 50, '', '_dmin', '') ->> 'total')::int = 0, '"_" là ký tự thường, không phải ký tự đại diện (sẽ khớp "admin")'; c := c + 1;
  assert (public.list_audit(1, 50, '', 'T2', '') ->> 'total')::int = 1, 'lọc người làm'; c := c + 1;
  assert (public.list_audit(1, 50, '', '', 'UPDATE') ->> 'total')::int = 3, 'lọc hành động'; c := c + 1;
  assert (public.list_audit(1, 50, '', '', 'ARCHIVE') ->> 'total')::int = 2, 'ARCHIVE gồm cả RESTORE (ô lọc cũ "Lưu trữ / Khôi phục")'; c := c + 1;
  assert (public.list_audit(1, 50, '', '', 'USER') ->> 'total')::int = 3, 'USER gồm USER_CREATE… (admin-users)'; c := c + 1;
  -- phân trang (tối thiểu 20/trang như hệ cũ)
  j := public.list_audit(2, 5, '', '', '');
  assert (j ->> 'pageSize')::int = 20 and (j ->> 'totalPages')::int = 1 and jsonb_array_length(j -> 'items') = 0, 'pageSize ≥ 20'; c := c + 1;

  -- TA: nhật ký hồ sơ PIC mình + việc mình làm; không thấy hồ sơ PIC khác, không thấy USER của Admin
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.list_audit(1, 50, '', '', '');
  assert (j ->> 'total')::int = 6, 'TA t1: CREATE 1 + UPDATE 2 + TASK 1 + ARCHIVE/RESTORE (Admin, hồ sơ t1) 2 – ' || (j ->> 'total'); c := c + 1;
  assert not exists (select 1 from jsonb_array_elements(j -> 'items') e where e ->> 'candidate_code' = 'AUC02' or e ->> 'action' like 'USER%'),
    'TA không thấy hồ sơ PIC khác / nhật ký quản trị'; c := c + 1;
  assert exists (select 1 from jsonb_array_elements(j -> 'items') e where e ->> 'action' = 'TASK'), 'TA thấy việc mình làm không gắn hồ sơ (al_read_own)'; c := c + 1;
  execute 'reset role';

  assert not has_function_privilege('anon', 'public.list_audit(int,int,text,text,text)', 'execute'), 'anon list_audit'; c := c + 1;
  raise notice 'AUDIT_TEST_PASSED: % check đạt', c;
end $$;
rollback;

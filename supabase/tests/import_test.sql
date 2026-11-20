-- M7-4: nhập Excel (0021) – import_existing, import_records, import_finish như Api2.gs (chỉ Admin, không ghi đè).
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/import_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000ca0';
  t1 uuid := '00000000-0000-4000-8000-000000000cb1';
  b bigint;
  j jsonb;
begin
  insert into auth.users (id) values (a), (t1);
  insert into public.pics (code, name) values ('IM-P1', 'IM-P1') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'im_admin', 'admin', null, true), (t1, 'im_t1', 'pic', 'IM-P1', true);
  insert into public.recruitment_records (candidate_code, full_name, phone, pic) values ('IMOLD1', 'Người Cũ', '901111111', 'IM-P1');

  -- ---------- import_existing: chỉ Admin ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.import_existing();
    assert false, 'TA phải bị từ chối';
  exception when others then assert sqlstate = 'PT403', 'TA import_existing: ' || sqlstate; c := c + 1;
  end;
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.import_existing();
  assert exists (select 1 from jsonb_array_elements(j -> 'rows') e where e = '["IMOLD1", "Người Cũ", "901111111"]'), 'existing: [mã, tên, SĐT]'; c := c + 1;
  execute 'reset role';

  -- ---------- import_records ----------
  insert into public.import_batches (source, note, created_by) values ('excel', 'test', a) returning id into b;
  j := public.import_records(a, b, jsonb_build_array(
    jsonb_build_object('index', 0, 'values', jsonb_build_object('candidate_code', 'IMNEW1', 'full_name', 'Người Mới', 'phone', '902222222', 'pic', 'IM-P1', 'position', 'Vị trí X', 'r1_date', '2025-03-04'),
                       'created_at', '2025-03-01T08:30:00+07:00', 'sheet', 'T3', 'row_number', 5),
    jsonb_build_object('index', 1, 'values', jsonb_build_object('candidate_code', 'IMOLD1', 'full_name', 'Người Cũ')),
    jsonb_build_object('index', 2, 'values', jsonb_build_object('candidate_code', 'IMNEW2', 'pic', 'KHONG-CO')),
    jsonb_build_object('index', 3, 'values', jsonb_build_object('candidate_code', '', 'full_name', 'Không mã')),
    jsonb_build_object('index', 4, 'values', jsonb_build_object('candidate_code', 'IMNEW3', 'full_name', 'Chưa PIC'))));
  assert (j ->> 'imported')::int = 2, 'ghi 2 dòng (IMNEW1, IMNEW3) – ' || j::text; c := c + 1;
  assert (select string_agg(e ->> 'index', ',' order by (e ->> 'index')::int) from jsonb_array_elements(j -> 'rejected') e) = '1,2,3', 'từ chối: trùng mã, PIC lạ, thiếu mã'; c := c + 1;
  assert (select e -> 'errors' ->> 'candidate_code' from jsonb_array_elements(j -> 'rejected') e where (e ->> 'index')::int = 1)
         = 'Mã ứng viên "IMOLD1" đã tồn tại (không ghi đè).', 'câu báo trùng mã như hệ cũ'; c := c + 1;
  assert (select full_name from public.recruitment_records where candidate_code = 'IMOLD1') = 'Người Cũ', 'không ghi đè hồ sơ cũ'; c := c + 1;
  assert (select pic = 'IM-P1' and position = 'Vị trí X' and r1_date = '2025-03-04' and import_batch_id = b
                 and created_at = '2025-03-01T08:30:00+07:00'::timestamptz and applicant_id is not null
            from public.recruitment_records where candidate_code = 'IMNEW1'), 'giá trị, lô, ngày tạo theo file, liên kết applicant'; c := c + 1;
  assert (select pic is null from public.recruitment_records where candidate_code = 'IMNEW3'), 'hồ sơ chưa PIC (chỉ Admin thấy)'; c := c + 1;
  assert (select row_count from public.import_batches where id = b) = 2, 'đếm dòng của lô'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'IMPORT' and candidate_code = 'IMNEW1'
                  and changes -> 'ALL' ->> 'new' = 'Nhập từ Excel (Người Mới - PIC: IM-P1) - sheet "T3", dòng 5'), 'nhật ký từng dòng như hệ cũ'; c := c + 1;
  begin
    perform public.import_records(t1, b, '[]');
    assert false, 'TA phải bị từ chối';
  exception when others then assert sqlstate = 'PT403', 'TA import_records: ' || sqlstate; c := c + 1;
  end;

  -- ---------- import_finish ----------
  perform public.import_finish(a, b, 'Data T3.xlsx', 2, 1, 4, 3);
  assert (select note from public.import_batches where id = b)
         = 'Nhập file "Data T3.xlsx": 2 dòng thành công, 1 dòng lỗi bị bỏ qua, 4 dòng trùng hoàn toàn bỏ qua, 3 dòng bị máy chủ từ chối.', 'ghi chú lô'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'IMPORT' and changes ? 'BATCH'), 'nhật ký tổng BATCH'; c := c + 1;

  assert not has_function_privilege('authenticated', 'public.import_records(uuid,bigint,jsonb)', 'execute'), 'người dùng không gọi thẳng import_records'; c := c + 1;
  assert not has_function_privilege('anon', 'public.import_existing()', 'execute'), 'anon import_existing'; c := c + 1;
  raise notice 'IMPORT_TEST_PASSED: % check đạt', c;
end $$;
rollback;

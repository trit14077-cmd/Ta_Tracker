-- M7-4: nhập Excel (0021) – import_existing, import_records, import_finish như Api2.gs (chỉ Admin, không ghi đè).
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/import_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000ca0';
  t1 uuid := '00000000-0000-4000-8000-000000000cb1';
  b bigint;
  b2 bigint; b_etl bigint;
  v_a bigint; v_app_a bigint; v_app_bd bigint;
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

  -- ---------- 0028: hoàn tác theo lô ----------
  insert into public.import_batches (source, note, created_by) values ('excel', 'lô 2', a) returning id into b2;
  j := public.import_records(a, b2, jsonb_build_array(
    jsonb_build_object('index', 0, 'values', jsonb_build_object('candidate_code', 'RBA', 'full_name', 'Gỡ Được', 'phone', '903333331', 'pic', 'IM-P1')),
    jsonb_build_object('index', 1, 'values', jsonb_build_object('candidate_code', 'RBB', 'full_name', 'Đã Sửa', 'phone', '903333332', 'pic', 'IM-P1')),
    jsonb_build_object('index', 2, 'values', jsonb_build_object('candidate_code', 'RBC', 'full_name', 'Có Bình Luận', 'phone', '903333333', 'pic', 'IM-P1')),
    jsonb_build_object('index', 3, 'values', jsonb_build_object('candidate_code', 'RBD', 'full_name', 'Đã Sửa', 'phone', '903333332', 'pic', 'IM-P1'))));
  assert (j ->> 'imported')::int = 4, 'lô 2 ghi 4 dòng'; c := c + 1;
  select id, applicant_id into v_a, v_app_a from public.recruitment_records where candidate_code = 'RBA';
  v_app_bd := (select applicant_id from public.recruitment_records where candidate_code = 'RBB');
  assert v_app_bd = (select applicant_id from public.recruitment_records where candidate_code = 'RBD'), 'RBB, RBD chung applicant'; c := c + 1;
  -- RBB bị sửa sau khi nhập; RBC có bình luận; RBD chưa đụng (nhưng chung applicant với RBB)
  update public.recruitment_records set r1_note = 'đã gọi', row_version = row_version + 1 where candidate_code = 'RBB';
  insert into public.comments (record_id, author_id, author_username, author_role, body)
    select id, a, 'im_admin', 'admin', 'ghi chú' from public.recruitment_records where candidate_code = 'RBC';

  -- quyền / loại lô
  begin
    perform public.import_rollback(t1, b2, false);
    assert false, 'TA phải bị từ chối';
  exception when others then assert sqlstate = 'PT403', 'TA import_rollback: ' || sqlstate; c := c + 1;
  end;
  insert into public.import_batches (source, note) values ('etl:test', 'lô ETL') returning id into b_etl;
  begin
    perform public.import_rollback(a, b_etl, false);
    assert false, 'lô ETL phải bị từ chối';
  exception when others then assert sqlstate = 'PT422', 'lô ETL: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.import_rollback(a, -1, false);
    assert false, 'lô không có phải báo 404';
  exception when others then assert sqlstate = 'PT404', 'lô không có: ' || sqlstate; c := c + 1;
  end;

  -- danh sách lô: chỉ lô Excel, đếm còn lại / gỡ được
  j := public.import_batch_list(a, 50);
  assert not exists (select 1 from jsonb_array_elements(j) e where (e ->> 'id')::bigint = b_etl), 'danh sách không có lô ETL'; c := c + 1;
  assert (select (e ->> 'remaining')::int = 4 and (e ->> 'removable')::int = 2 and e ->> 'created_by' = 'im_admin'
            from jsonb_array_elements(j) e where (e ->> 'id')::bigint = b2), 'lô 2: còn 4, gỡ được 2 – ' || j::text; c := c + 1;

  -- chạy thử: không xóa gì
  j := public.import_rollback(a, b2, true);
  assert (j ->> 'removed')::int = 2 and (j ->> 'kept_count')::int = 2 and (j ->> 'dry_run')::boolean, 'chạy thử: ' || j::text; c := c + 1;
  assert (select count(*) from public.recruitment_records where import_batch_id = b2) = 4, 'chạy thử không xóa'; c := c + 1;
  assert (select rolled_back_at is null from public.import_batches where id = b2), 'chạy thử không đánh dấu lô'; c := c + 1;

  -- gỡ thật
  j := public.import_rollback(a, b2, false);
  assert (j ->> 'removed')::int = 2 and (j ->> 'kept_count')::int = 2, 'gỡ thật: ' || j::text; c := c + 1;
  assert (select string_agg(e ->> 'candidate_code' || ':' || (e ->> 'reason'), ',' order by e ->> 'candidate_code')
            from jsonb_array_elements(j -> 'kept') e) = 'RBB:EDITED,RBC:HAS_DATA', 'lý do giữ lại: ' || (j -> 'kept')::text; c := c + 1;
  assert (select string_agg(candidate_code, ',' order by candidate_code) from public.recruitment_records where import_batch_id = b2) = 'RBB,RBC',
    'còn lại đúng RBB, RBC'; c := c + 1;
  assert (select r1_note from public.recruitment_records where candidate_code = 'RBB') = 'đã gọi', 'hồ sơ đã sửa giữ nguyên dữ liệu'; c := c + 1;
  assert not exists (select 1 from public.applicants where id = v_app_a), 'applicant riêng của hồ sơ đã gỡ bị xóa'; c := c + 1;
  assert exists (select 1 from public.applicants where id = v_app_bd), 'applicant dùng chung với hồ sơ còn lại được giữ'; c := c + 1;
  assert (select changes -> 'ALL' -> 'old' ->> 'full_name' = 'Gỡ Được' and changes -> 'ALL' ->> 'new' = 'Hoàn tác lô nhập #' || b2
            from public.audit_logs where action = 'IMPORT_ROLLBACK' and record_id = v_a), 'nhật ký có bản chụp hồ sơ đã gỡ'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'IMPORT_ROLLBACK' and changes ? 'BATCH'), 'nhật ký tổng của lần hoàn tác'; c := c + 1;
  assert (select rolled_back_at is not null and rolled_back_by = a and note like 'lô 2 | Hoàn tác lô nhập #%: gỡ 2 hồ sơ, giữ lại 2 %'
            from public.import_batches where id = b2), 'lô được đánh dấu đã hoàn tác'; c := c + 1;
  assert (select count(*) from public.recruitment_records where candidate_code in ('IMOLD1', 'IMNEW1', 'IMNEW3')) = 3, 'lô khác không bị đụng'; c := c + 1;
  -- chạy lại: không còn gì để gỡ
  j := public.import_rollback(a, b2, false);
  assert (j ->> 'removed')::int = 0 and (j ->> 'kept_count')::int = 2, 'chạy lại: ' || j::text; c := c + 1;
  -- mã đã gỡ được nhập lại (sửa file rồi nhập lại)
  j := public.import_records(a, b, jsonb_build_array(jsonb_build_object('index', 0, 'values', jsonb_build_object('candidate_code', 'RBA', 'full_name', 'Nhập Lại'))));
  assert (j ->> 'imported')::int = 1, 'mã đã gỡ nhập lại được'; c := c + 1;

  assert not has_function_privilege('authenticated', 'public.import_rollback(uuid,bigint,boolean)', 'execute'), 'người dùng không gọi thẳng import_rollback'; c := c + 1;
  assert not has_function_privilege('authenticated', 'public.import_batch_list(uuid,integer)', 'execute'), 'người dùng không gọi thẳng import_batch_list'; c := c + 1;
  assert not has_function_privilege('authenticated', 'app.import_keep_reason(bigint,integer)', 'execute'), 'người dùng không gọi app.import_keep_reason'; c := c + 1;

  assert not has_function_privilege('authenticated', 'public.import_records(uuid,bigint,jsonb)', 'execute'), 'người dùng không gọi thẳng import_records'; c := c + 1;
  assert not has_function_privilege('anon', 'public.import_existing()', 'execute'), 'anon import_existing'; c := c + 1;
  raise notice 'IMPORT_TEST_PASSED: % check đạt', c;
end $$;
rollback;

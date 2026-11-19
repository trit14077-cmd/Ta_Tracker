-- M2-6: test RPC ghi hồ sơ (0007). Chạy sau migrations:  psql -v ON_ERROR_STOP=1 -f supabase/tests/rpc_test.sql
-- Toàn bộ trong 1 giao dịch, ROLLBACK ở cuối. Dùng PIC có sẵn từ 0006 (TA1-Phat, TA2-Hien, TA10-T.Chung).
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000001a0';
  t1 uuid := '00000000-0000-4000-8000-0000000001b1';
  t2 uuid := '00000000-0000-4000-8000-0000000001b2';
  tx uuid := '00000000-0000-4000-8000-0000000001bf';
  j jsonb; j2 jsonb; id1 bigint; v_app bigint; n int; s text;
  ap1 bigint; ap2 bigint;
begin
  insert into auth.users (id) values (a), (t1), (t2), (tx);
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'rpc_admin', 'admin', null, true), (t1, 'rpc_t1', 'pic', 'TA1-Phat', true),
    (t2, 'rpc_t2', 'pic', 'TA2-Hien', true), (tx, 'rpc_tx', 'pic', 'TA1-Phat', false);
  -- bỏ hồ sơ sẵn có của các PIC test để số thứ tự mã đoán trước được (chỉ trong giao dịch này)
  delete from public.recruitment_records where pic in ('TA1-Phat','TA10-T.Chung') or candidate_code in ('X1');
  insert into public.applications (pic, full_name, phone, consent_at) values ('TA1-Phat', 'don', '0', now()) returning id into v_app;

  execute 'set local role service_role';

  -- ---------- create_record ----------
  j := public.create_record(t1, '{"full_name":"Nguyễn Văn A","phone":"900000001","pic":"TA2-Hien","candidate_code":"HACK1"}', jsonb_build_object('from_application_id', v_app));
  assert j ->> 'pic' = 'TA1-Phat', 'TA tạo hồ sơ: pic bị ép về PIC của TA'; c := c + 1;
  assert j ->> 'candidate_code' = 'TA10001', 'TA tạo hồ sơ: mã tự sinh TA1 + 00 + 01, mã gõ tay bị bỏ qua'; c := c + 1;
  assert (j ->> 'row_version')::int = 1, 'Hồ sơ mới có row_version 1'; c := c + 1;
  id1 := (j ->> 'id')::bigint;
  select status into s from public.applications where id = v_app;
  assert s = 'converted', 'Tạo từ đơn ứng tuyển: đơn chuyển sang converted'; c := c + 1;
  select count(*) into n from public.audit_logs where record_id = id1 and action = 'CREATE';
  assert n = 1, 'Tạo hồ sơ ghi 1 dòng audit CREATE'; c := c + 1;

  j := public.create_record(t1, '{"full_name":"nguyen  van a","phone":"900000001"}');
  assert j ->> 'candidate_code' = 'TA10002', 'Mã tiếp theo tăng 1'; c := c + 1;
  select applicant_id into ap1 from public.recruitment_records where id = id1;
  assert (j ->> 'applicant_id')::bigint = ap1, 'D-04: cùng SĐT + cùng tên (bỏ dấu, gộp khoảng trắng) => cùng applicant'; c := c + 1;
  j := public.create_record(t1, '{"full_name":"Tran Thi B","phone":"900000001"}');
  assert (j ->> 'applicant_id')::bigint <> ap1, 'D-04: cùng SĐT nhưng khác tên => applicant khác (không tự gộp)'; c := c + 1;
  j := public.create_record(t1, '{"full_name":"Khong SDT","phone":""}');
  assert j ->> 'applicant_id' is null, 'Không có SĐT => chưa liên kết applicant'; c := c + 1;

  j := public.create_record(a, '{"full_name":"Cua TA10","pic":"TA10-T.Chung"}');
  assert j ->> 'candidate_code' = 'TA100001', 'Admin chọn PIC TA10 => mã TA10 + 00 + 01'; c := c + 1;
  j := public.create_record(t1, '{"full_name":"Sau TA10"}');
  assert j ->> 'candidate_code' = 'TA10005', 'Mã của TA10 (TA1000…) không làm lệch số thứ tự của TA1 (TA100…)'; c := c + 1;

  begin
    perform public.create_record(a, '{"full_name":"Khong PIC khong ma"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT422', 'Admin tạo hồ sơ không PIC thì phải có mã (422)'; end; c := c + 1;
  j := public.create_record(a, '{"full_name":"Khong PIC","candidate_code":"X1"}');
  assert j ->> 'pic' is null and j ->> 'candidate_code' = 'X1', 'Admin tạo hồ sơ chưa gán PIC với mã tự nhập'; c := c + 1;
  begin
    perform public.create_record(a, '{"full_name":"Trung ma","candidate_code":"X1"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT409', 'Trùng mã => DUPLICATE_CODE (409)'; end; c := c + 1;
  begin
    perform public.create_record(t1, '{"full_name":"x","row_hack":"1"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT422', 'Key lạ => INVALID_FIELD (422)'; end; c := c + 1;
  begin
    perform public.create_record(tx, '{"full_name":"x"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT403', 'Tài khoản bị khóa không tạo được hồ sơ (403)'; end; c := c + 1;

  -- ---------- save_record ----------
  j := public.save_record(t1, id1, 1, '{"r1_status":"Passed","r1_date":"2026-11-19","tenor":"<1D"}');
  assert (j ->> 'row_version')::int = 2, 'Sửa hồ sơ: row_version tăng 1'; c := c + 1;
  assert j ->> 'r1_date' = '2026-11-19', 'Sửa hồ sơ: ngày lưu đúng kiểu date'; c := c + 1;
  select count(*) into n from public.status_history where record_id = id1 and kind = 'STATUS' and field_key = 'r1_status' and to_value = 'Passed';
  assert n = 1, 'Đổi r1_status ghi 1 dòng status_history'; c := c + 1;
  select changes into j2 from public.audit_logs where record_id = id1 and action = 'UPDATE' order by id desc limit 1;
  assert j2 ? 'r1_status' and j2 ? 'r1_date' and not (j2 ? 'tenor'), '1 dòng audit cho cả lần lưu, chỉ field thật sự đổi'; c := c + 1;

  begin
    perform public.save_record(t1, id1, 1, '{"r1_note":"cu"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT409' and sqlerrm = 'VERSION_CONFLICT', 'Lệch row_version => VERSION_CONFLICT (409)'; end; c := c + 1;
  begin
    perform public.save_record(t2, id1, 2, '{"r1_note":"chen"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT404', 'TA khác PIC sửa hồ sơ => NOT_FOUND (không lộ hồ sơ)'; end; c := c + 1;
  begin
    perform public.save_record(t1, id1, 2, '{"pic":"TA2-Hien"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT403', 'TA không đổi được PIC (403)'; end; c := c + 1;
  begin
    perform public.save_record(t1, id1, 2, '{"candidate_code":"DOI"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT403', 'TA không đổi được mã ứng viên (0009: chỉ Admin)'; end; c := c + 1;
  j := public.save_record(t1, id1, 2, '{"candidate_code":"TA10001","r1_note":"giu ma"}');
  assert j ->> 'candidate_code' = 'TA10001' and (j ->> 'row_version')::int = 3, 'TA gửi lại đúng mã cũ thì không bị chặn'; c := c + 1;
  j := public.save_record(t1, id1, 3, '{"r1_note":""}');   -- version 4

  j := public.save_record(t1, id1, 4, '{"r1_status":"Passed"}');
  assert (j ->> 'row_version')::int = 4, 'Lưu không đổi gì: không tăng version'; c := c + 1;

  j := public.save_record(t1, id1, 4, '{"r2_status":"Pending"}', '{"op":"move","from_box":"lusu","to_box":"r2"}');
  assert (j ->> 'row_version')::int = 5, 'Kéo Kanban tăng version'; c := c + 1;
  select count(*) into n from public.status_history where record_id = id1 and kind = 'STAGE_MOVE' and from_box = 'lusu' and to_box = 'r2';
  assert n = 1, 'Kéo Kanban ghi STAGE_MOVE với ô cũ/ô mới'; c := c + 1;
  select count(*) into n from public.audit_logs where record_id = id1 and action = 'STAGE_MOVE';
  assert n = 1, 'Kéo Kanban ghi audit STAGE_MOVE'; c := c + 1;

  j := public.save_record(t1, id1, 5, '{}', '{"op":"archive"}');
  assert (j ->> 'is_archived')::boolean and (j ->> 'row_version')::int = 6, 'TA lưu trữ được hồ sơ của mình (0009, như hệ cũ)'; c := c + 1;
  j := public.save_record(t1, id1, 6, '{}', '{"op":"restore"}');
  assert not (j ->> 'is_archived')::boolean, 'TA khôi phục được hồ sơ của mình'; c := c + 1;
  begin
    perform public.save_record(a, id1, 7, '{"candidate_code":"X1"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT409', 'Admin đổi sang mã đã có => DUPLICATE_CODE (409)'; end; c := c + 1;
  j := public.save_record(a, id1, 7, '{"candidate_code":"TA1MOI"}');
  assert j ->> 'candidate_code' = 'TA1MOI', 'Admin đổi được mã ứng viên'; c := c + 1;
  select count(*) into n from public.audit_logs where record_id = id1 and changes ? 'candidate_code';
  assert n = 1, 'Đổi mã ghi vào audit'; c := c + 1;
  j := public.save_record(a, id1, 8, '{"pic":"TA2-Hien"}');
  assert j ->> 'pic' = 'TA2-Hien', 'Admin đổi được PIC'; c := c + 1;
  select count(*) into n from public.status_history where record_id = id1 and kind = 'PIC_CHANGE' and from_value = 'TA1-Phat' and to_value = 'TA2-Hien';
  assert n = 1, 'Đổi PIC ghi PIC_CHANGE'; c := c + 1;
  begin
    perform public.save_record(t1, id1, 9, '{"r1_note":"sau khi chuyen"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT404', 'Sau khi đổi PIC, TA cũ mất quyền sửa (Q6)'; end; c := c + 1;
  j := public.save_record(a, id1, 9, '{}', '{"op":"archive"}');
  assert (j ->> 'is_archived')::boolean, 'Admin lưu trữ hồ sơ'; c := c + 1;
  begin
    perform public.save_record(a, id1, 10, '{}', '{"op":"xoa"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT422', 'Thao tác lạ bị từ chối'; end; c := c + 1;

  -- ---------- quyền gọi RPC ----------
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  begin
    perform public.save_record(t1, id1, 10, '{"r1_note":"goi thang"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = '42501', 'Người dùng không gọi thẳng save_record được (bỏ qua validate của Edge)'; end; c := c + 1;
  begin
    perform public.create_record(t1, '{"full_name":"goi thang"}');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = '42501', 'Người dùng không gọi thẳng create_record được'; end; c := c + 1;
  assert public.next_candidate_code('TA1-Phat') like 'TA100%', 'TA lấy được mã gợi ý cho PIC mình'; c := c + 1;
  begin
    perform public.next_candidate_code('TA2-Hien');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = 'PT403', 'TA không lấy mã gợi ý cho PIC khác'; end; c := c + 1;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  assert public.next_candidate_code('TA2-Hien') like 'TA200%', 'Admin lấy mã gợi ý cho PIC bất kỳ'; c := c + 1;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.next_candidate_code('TA1-Phat');
    raise exception 'EXPECTED_ERR';
  exception when others then
    assert sqlstate = '42501', 'anon không gọi được RPC nào'; end; c := c + 1;
  execute 'reset role';

  if current_setting('rpctest.raise_at_end', true) = 'on' then
    raise exception 'RPC_TEST_PASSED: % check đạt (đã rollback)', c;
  end if;
  raise notice 'RPC_TEST_PASSED: % check đạt', c;
end $$;
rollback;

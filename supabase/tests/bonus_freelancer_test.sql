-- Freelancer bonus (0049): danh sách CTV, gán CTV cho hồ sơ, khóa khi đã chốt, chỉ admin đọc. Dùng bonus_lock của 0045.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/bonus_freelancer_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000049a0';
  t1 uuid := '00000000-0000-4000-8000-0000000049b1';
  r1 bigint;
  r2 bigint;
  r_arch bigint;
  f public.bonus_freelancers;
  f2 public.bonus_freelancers;
  fr public.bonus_freelancer_records;
  j jsonb;
  n int;
begin
  insert into auth.users (id) values (a), (t1);
  insert into public.pics (code, name) values ('FL-P1', 'FL-P1') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'fl_admin', 'admin', null, true), (t1, 'fl_t1', 'pic', 'FL-P1', true);
  insert into public.recruitment_records (candidate_code, pic, full_name, emp_id, site, sub_source, ob_date, ob_status)
    values ('FLR01', 'FL-P1', 'Nhân viên 1', '7200001', 'DC Bình Dương 1', 'Freelancer', '2026-10-01', 'Joined') returning id into r1;
  insert into public.recruitment_records (candidate_code, pic, full_name, sub_source, ob_date, ob_status)
    values ('FLR02', 'FL-P1', 'Nhân viên 2', 'Freelancer', '2026-10-05', 'Joined') returning id into r2;
  insert into public.recruitment_records (candidate_code, pic, ob_date, is_archived)
    values ('FLR03', 'FL-P1', '2026-10-01', true) returning id into r_arch;
  delete from public.bonus_periods;

  select config into j from public.bonus_settings where kind = 'freelancer';
  assert (j ->> 'minDays')::int = 30 and (j ->> 'pitRate')::numeric = 0.1 and jsonb_array_length(j -> 'tiers') = 4
     and (j -> 'tiers' -> 3 -> 'max') = 'null'::jsonb, 'cấu hình mặc định: ' || coalesce(j::text, 'null'); c := c + 1;

  -- ---------- TA ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.bonus_freelancer_save('{"name":"CTV A"}');
    assert false, 'TA không được thêm CTV';
  exception when others then assert sqlerrm = 'FORBIDDEN', 'TA thêm CTV: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- admin ----------
  perform set_config('request.jwt.claim.sub', a::text, true);
  f := public.bonus_freelancer_save('{"name":"  CTV A ","phone":"0900000001","region":"South"}');
  assert f.id is not null and f.name = 'CTV A' and f.active, 'tạo CTV'; c := c + 1;
  f := public.bonus_freelancer_save(jsonb_build_object('id', f.id, 'note', 'ghi chú'));
  assert f.name = 'CTV A' and f.phone = '0900000001' and f.note = 'ghi chú', 'sửa một phần giữ giá trị cũ'; c := c + 1;
  f2 := public.bonus_freelancer_save('{"name":"CTV A","phone":"0900000002"}');
  assert f2.id <> f.id, 'trùng tên khác SĐT vẫn tạo được'; c := c + 1;
  begin
    perform public.bonus_freelancer_save('{"name":"ctv a","phone":"0900000001"}');
    assert false, 'trùng tên + SĐT';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'trùng: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_freelancer_save('{"name":"  "}');
    assert false, 'tên trống';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'tên trống: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_freelancer_save('{"name":"CTV B","region":"East"}');
    assert false, 'region lạ';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'region lạ: ' || sqlerrm; c := c + 1;
  end;

  fr := public.bonus_freelancer_record_save(r1, jsonb_build_object('freelancer_id', f.id));
  assert fr.freelancer_id = f.id and fr.flag = '', 'gán CTV'; c := c + 1;
  fr := public.bonus_freelancer_record_save(r2, jsonb_build_object('freelancer_id', f.id, 'flag', 'Hold'));
  fr := public.bonus_freelancer_record_save(r2, '{"note":"chờ CnB"}');
  assert fr.freelancer_id = f.id and fr.flag = 'Hold' and fr.note = 'chờ CnB', 'sửa ghi chú giữ CTV + cờ'; c := c + 1;
  begin
    perform public.bonus_freelancer_record_save(r1, '{"flag":"Maybe"}');
    assert false, 'cờ lạ';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'cờ lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_freelancer_record_save(r1, '{"freelancer_id":999999999}');
    assert false, 'CTV không tồn tại';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'CTV lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_freelancer_record_save(r_arch, jsonb_build_object('freelancer_id', f.id));
    assert false, 'hồ sơ đã lưu trữ';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'lưu trữ: ' || sqlerrm; c := c + 1;
  end;

  j := public.bonus_lock('freelancer', '2026-11', '2026-11-26', jsonb_build_array(
    jsonb_build_object('record_id', r1, 'part', 'freelancer', 'payee_type', 'freelancer', 'payee_key', 'FL-' || f.id,
                       'amount', 700000, 'pit', 70000, 'net', 630000, 'detail', '{"count":1}'::jsonb)));
  assert (j ->> 'count')::int = 1 and (j ->> 'total')::numeric = 700000, 'chốt: ' || j::text; c := c + 1;
  assert (select (config ->> 'pitRate')::numeric from public.bonus_periods where kind = 'freelancer' and period_key = '2026-11') = 0.1,
    'ảnh chụp cấu hình'; c := c + 1;
  begin
    perform public.bonus_freelancer_record_save(r1, jsonb_build_object('freelancer_id', f2.id));
    assert false, 'đổi CTV khi đã chốt';
  exception when others then assert sqlerrm = 'BONUS_PART_LOCKED', 'đổi CTV đã chốt: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_freelancer_record_save(r1, '{"flag":"Failed"}');
    assert false, 'đổi cờ khi đã chốt';
  exception when others then assert sqlerrm = 'BONUS_PART_LOCKED', 'đổi cờ đã chốt: ' || sqlerrm; c := c + 1;
  end;
  fr := public.bonus_freelancer_record_save(r1, '{"note":"đã trả"}');
  assert fr.note = 'đã trả', 'ghi chú vẫn sửa được sau khi chốt'; c := c + 1;
  begin
    j := public.bonus_lock('freelancer', '2026-12', '2026-12-26', jsonb_build_array(
      jsonb_build_object('record_id', r1, 'part', 'freelancer', 'payee_type', 'freelancer', 'amount', 700000, 'pit', 70000, 'net', 630000)));
    assert false, 'trả lại hồ sơ đã trả';
  exception when others then assert sqlerrm = 'BONUS_ALREADY_PAID', 'trả hai lần: ' || sqlerrm; c := c + 1;
  end;
  perform public.bonus_reopen('freelancer', '2026-11', 'sửa CTV');
  fr := public.bonus_freelancer_record_save(r1, jsonb_build_object('freelancer_id', f2.id));
  assert fr.freelancer_id = f2.id, 'mở lại kỳ thì đổi được CTV'; c := c + 1;

  -- ---------- RLS: chỉ admin đọc ----------
  perform set_config('request.jwt.claim.sub', t1::text, true);
  select count(*) into n from public.bonus_freelancers;
  assert n = 0, 'TA không thấy danh sách CTV: ' || n; c := c + 1;
  select count(*) into n from public.bonus_freelancer_records;
  assert n = 0, 'TA không thấy hồ sơ CTV: ' || n; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.bonus_freelancer_records where record_id in (r1, r2);
  assert n = 2, 'admin thấy hồ sơ CTV: ' || n; c := c + 1;

  execute 'reset role';
  assert (select count(*) from public.audit_logs where action = 'BONUS_FREELANCER') >= 3
     and (select count(*) from public.audit_logs where action = 'BONUS_FREELANCER_RECORD') >= 4, 'nhật ký'; c := c + 1;
  raise notice 'BONUS_FREELANCER_TEST_PASSED: % check đạt', c;
end $$;
rollback;

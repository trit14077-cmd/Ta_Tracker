-- Sign-on bonus (0046): scheme, cờ từng mốc, khóa phần đã chốt, RLS. Dùng bonus_lock / bonus_reopen của 0045.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/bonus_signon_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000046a0';
  t1 uuid := '00000000-0000-4000-8000-0000000046b1';
  r1 bigint; r_arch bigint;
  j jsonb;
  n int;
  sr public.bonus_signon_records;
  ss public.bonus_signon_schemes;
  lines jsonb;
begin
  insert into auth.users (id) values (a), (t1);
  insert into public.pics (code, name) values ('SGN-P1', 'SGN-P1') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'sgn_admin', 'admin', null, true), (t1, 'sgn_t1', 'pic', 'SGN-P1', true);
  delete from public.bonus_periods;

  insert into public.recruitment_records (candidate_code, pic, full_name, emp_id, rank, site, ob_date, ob_status)
    values ('SGN01', 'SGN-P1', 'Nhân viên 1', '7100001', '6A', 'DC Hưng Yên', '2026-10-01', 'Joined') returning id into r1;
  insert into public.recruitment_records (candidate_code, pic, ob_date, is_archived)
    values ('SGN02', 'SGN-P1', '2026-10-01', true) returning id into r_arch;

  -- seed 3 scheme
  assert (select count(*) from public.bonus_signon_schemes) = 3, 'seed 3 scheme'; c := c + 1;
  assert (select milestones -> 0 -> 'amount' from public.bonus_signon_schemes where code = 'DCHP 11.05.2026') = 'null'::jsonb,
    'DCHP 11.05: mốc 1 Not Applicable'; c := c + 1;

  -- ---------- TA ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.bonus_signon_save(r1, '{"m1_flag":"Passed"}');
    assert false, 'TA không được sửa cờ';
  exception when others then assert sqlerrm = 'FORBIDDEN', 'TA sửa cờ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_scheme_save('{"code":"X","sites":["A"],"effective_from":"2026-01-01","milestones":[{"days":1,"amount":1}]}');
    assert false, 'TA không được sửa scheme';
  exception when others then assert sqlerrm = 'FORBIDDEN', 'TA sửa scheme: ' || sqlerrm; c := c + 1;
  end;
  select count(*) into n from public.bonus_signon_schemes;
  assert n = 3, 'TA đọc được scheme: ' || n; c := c + 1;

  -- ---------- admin: scheme ----------
  perform set_config('request.jwt.claim.sub', a::text, true);
  ss := public.bonus_signon_scheme_save('{"code":"TEST 01.12.2026","sites":["DC Test"," DC Test ",""],"effective_from":"2026-12-01","milestones":[{"days":6,"amount":null},{"days":29,"amount":2000000}]}');
  assert ss.sites = array['DC Test'] and ss.active and (ss.milestones -> 1 ->> 'amount')::int = 2000000, 'tạo scheme: ' || to_jsonb(ss)::text; c := c + 1;
  ss := public.bonus_signon_scheme_save('{"code":"TEST 01.12.2026","sites":["DC Test"],"effective_from":"2026-12-01","milestones":[{"days":6,"amount":500000}],"active":false}');
  assert not ss.active and jsonb_array_length(ss.milestones) = 1, 'sửa scheme'; c := c + 1;
  begin
    perform public.bonus_signon_scheme_save('{"code":"BAD","sites":["A"],"effective_from":"2026-01-01","milestones":[{"days":1.5,"amount":1}]}');
    assert false, 'ngày lẻ';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'ngày lẻ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_scheme_save('{"code":"BAD","sites":["A"],"effective_from":"2026-01-01","milestones":[{"days":1,"amount":-5}]}');
    assert false, 'tiền âm';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'tiền âm: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_scheme_save('{"code":"BAD","sites":[],"effective_from":"2026-01-01","milestones":[{"days":1,"amount":1}]}');
    assert false, 'không có site';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'site: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_scheme_save('{"code":"BAD","sites":["A"],"effective_from":"2026-02-01","effective_to":"2026-01-01","milestones":[{"days":1,"amount":1}]}');
    assert false, 'hết hạn trước hiệu lực';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'hiệu lực: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- admin: hồ sơ ----------
  sr := public.bonus_signon_save(r1, '{"m2_flag":"Hold","note":"chờ chấm công"}');
  assert sr.scheme_code is null and sr.m2_flag = 'Hold' and sr.m1_flag = '', 'lưu cờ'; c := c + 1;
  sr := public.bonus_signon_save(r1, '{"scheme_code":"DCHP + DCHY 01.06.2026"}');
  assert sr.scheme_code = 'DCHP + DCHY 01.06.2026' and sr.m2_flag = 'Hold' and sr.note = 'chờ chấm công', 'lưu một phần giữ giá trị cũ'; c := c + 1;
  sr := public.bonus_signon_save(r1, '{"scheme_code":""}');
  assert sr.scheme_code is null, 'scheme rỗng = tự gán'; c := c + 1;
  begin
    perform public.bonus_signon_save(r1, '{"m1_flag":"Yes"}');
    assert false, 'cờ lạ';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'cờ lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_save(r1, '{"scheme_code":"KHÔNG CÓ"}');
    assert false, 'scheme không tồn tại';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'scheme lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_save(r_arch, '{"m1_flag":"Passed"}');
    assert false, 'hồ sơ lưu trữ';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'lưu trữ: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- chốt kỳ 2026-11: m1 500k, m3 1tr (m2 Hold) ----------
  lines := jsonb_build_array(
    jsonb_build_object('record_id', r1, 'part', 'm1', 'payee_type', 'employee', 'payee_key', '7100001', 'emp_id', '7100001', 'amount', 500000, 'net', 500000, 'detail', '{"date":"2026-10-07"}'::jsonb),
    jsonb_build_object('record_id', r1, 'part', 'm3', 'payee_type', 'employee', 'payee_key', '7100001', 'emp_id', '7100001', 'amount', 1000000, 'net', 1000000));
  j := public.bonus_lock('signon', '2026-11', '2026-11-25', lines);
  assert (j ->> 'count')::int = 2 and (j ->> 'total')::numeric = 1500000, 'chốt: ' || j::text; c := c + 1;
  begin
    perform public.bonus_lock('signon', '2026-12', '2026-12-25', jsonb_build_array(lines -> 0));
    assert false, 'trả mốc hai kỳ';
  exception when others then assert sqlerrm = 'BONUS_ALREADY_PAID', 'trả hai kỳ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_save(r1, '{"m1_flag":"Failed"}');
    assert false, 'đổi cờ mốc đã chốt';
  exception when others then assert sqlerrm = 'BONUS_PART_LOCKED', 'mốc đã chốt: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_signon_save(r1, '{"scheme_code":"DCHP 11.05.2026"}');
    assert false, 'đổi scheme khi có mốc đã chốt';
  exception when others then assert sqlerrm = 'BONUS_PART_LOCKED', 'scheme đã chốt: ' || sqlerrm; c := c + 1;
  end;
  sr := public.bonus_signon_save(r1, '{"m2_flag":"Passed"}');
  assert sr.m2_flag = 'Passed', 'mốc chưa chốt vẫn sửa được'; c := c + 1;
  -- kỳ sau: m2 (trễ) + m4
  j := public.bonus_lock('signon', '2026-12', '2026-12-25', jsonb_build_array(
    jsonb_build_object('record_id', r1, 'part', 'm2', 'payee_type', 'employee', 'payee_key', '7100001', 'amount', 500000, 'net', 500000),
    jsonb_build_object('record_id', r1, 'part', 'm4', 'payee_type', 'employee', 'payee_key', '7100001', 'amount', 1000000, 'net', 1000000)));
  assert (j ->> 'count')::int = 2, 'chốt kỳ sau'; c := c + 1;

  -- ---------- RLS đọc ----------
  perform set_config('request.jwt.claim.sub', t1::text, true);
  select count(*) into n from public.bonus_signon_records;
  assert n = 0, 'TA không đọc cờ Sign-on: ' || n; c := c + 1;
  select count(*) into n from public.bonus_lines where kind = 'signon';
  assert n = 0, 'TA không thấy khoản Sign-on của nhân viên (ta_pic null): ' || n; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.bonus_lines where kind = 'signon';
  assert n = 4, 'admin thấy khoản: ' || n; c := c + 1;

  -- ---------- mở lại → sửa được ----------
  j := public.bonus_reopen('signon', '2026-12', 'sai mốc');
  j := public.bonus_reopen('signon', '2026-11', 'sai mốc');
  sr := public.bonus_signon_save(r1, '{"m1_flag":"Failed","scheme_code":"DCHP 11.05.2026"}');
  assert sr.m1_flag = 'Failed' and sr.scheme_code = 'DCHP 11.05.2026', 'sửa sau khi mở lại'; c := c + 1;

  execute 'reset role';
  assert (select count(*) from public.audit_logs where action in ('BONUS_SIGNON_SAVE', 'BONUS_SIGNON_SCHEME')) >= 6, 'nhật ký'; c := c + 1;
  raise notice 'BONUS_SIGNON_TEST_PASSED: % check đạt', c;
end $$;
rollback;

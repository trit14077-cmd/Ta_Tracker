-- TA Credit bonus (0047): hồ sơ bonus TA, cấu hình, RLS (TA thấy hồ sơ + khoản của mình). Dùng bonus_lock của 0045.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/bonus_ta_credit_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000047a0';
  t1 uuid := '00000000-0000-4000-8000-0000000047b1';
  t2 uuid := '00000000-0000-4000-8000-0000000047b2';
  j jsonb;
  n int;
  tp public.ta_bonus_profiles;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('TC-P1', 'TC-P1'), ('TC-P2', 'TC-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'tc_admin', 'admin', null, true), (t1, 'tc_t1', 'pic', 'TC-P1', true), (t2, 'tc_t2', 'pic', 'TC-P2', true);
  delete from public.bonus_periods;

  select config into j from public.bonus_settings where kind = 'ta_credit';
  assert (j ->> 'internBaseRate')::int = 70000 and (j -> 'rankCredits' -> 'North' ->> '3BO')::numeric = 9
     and (j -> 'tiers' -> 'South' -> 'Senior' ->> 0)::int = 22, 'cấu hình mặc định: ' || coalesce(j::text, 'null'); c := c + 1;

  -- ---------- TA ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.ta_bonus_profile_save('{"pic_code":"TC-P1","level":"Senior"}');
    assert false, 'TA không được sửa hồ sơ bonus';
  exception when others then assert sqlerrm = 'FORBIDDEN', 'TA sửa: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- admin ----------
  perform set_config('request.jwt.claim.sub', a::text, true);
  tp := public.ta_bonus_profile_save('{"pic_code":"TC-P1","region":"North","level":"Intern","title":"Recruitment Intern","emp_id":"6000001"}');
  assert tp.level = 'Intern' and tp.active and not tp.onsite, 'tạo hồ sơ'; c := c + 1;
  tp := public.ta_bonus_profile_save('{"pic_code":"TC-P1","onsite":true}');
  assert tp.onsite and tp.level = 'Intern' and tp.emp_id = '6000001', 'lưu một phần giữ giá trị cũ'; c := c + 1;
  perform public.ta_bonus_profile_save('{"pic_code":"TC-P2","region":"South","level":"Senior"}');
  begin
    perform public.ta_bonus_profile_save('{"pic_code":"TC-P1","level":"Lead"}');
    assert false, 'level lạ';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'level lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.ta_bonus_profile_save('{"pic_code":"TC-P1","region":"East"}');
    assert false, 'region lạ';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'region lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.ta_bonus_profile_save('{"pic_code":"KHÔNG-CÓ","level":"Senior"}');
    assert false, 'PIC không tồn tại';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'PIC lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.ta_bonus_profile_save('{"pic_code":"TC-P1","active":"yes"}');
    assert false, 'cờ không phải boolean';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'boolean: ' || sqlerrm; c := c + 1;
  end;

  j := public.bonus_lock('ta_credit', '2026-11', '2026-11-26', jsonb_build_array(
    jsonb_build_object('part', 'credit', 'payee_type', 'ta', 'payee_key', 'TC-P1', 'ta_pic', 'TC-P1', 'amount', 210000, 'net', 210000, 'detail', '{"credits":3}'::jsonb),
    jsonb_build_object('part', 'credit', 'payee_type', 'ta', 'payee_key', 'TC-P2', 'ta_pic', 'TC-P2', 'amount', 0, 'net', 0)));
  assert (j ->> 'count')::int = 2 and (j ->> 'total')::numeric = 210000, 'chốt: ' || j::text; c := c + 1;
  assert (select (config ->> 'internBaseRate')::int from public.bonus_periods where kind = 'ta_credit' and period_key = '2026-11') = 70000,
    'ảnh chụp cấu hình'; c := c + 1;

  -- ---------- RLS ----------
  perform set_config('request.jwt.claim.sub', t1::text, true);
  select count(*) into n from public.ta_bonus_profiles;
  assert n = 1, 'TA1 chỉ thấy hồ sơ của mình: ' || n; c := c + 1;
  select count(*) into n from public.bonus_lines where kind = 'ta_credit' and ta_pic = 'TC-P1';
  assert n = 1, 'TA1 thấy khoản của mình'; c := c + 1;
  select count(*) into n from public.bonus_lines where kind = 'ta_credit';
  assert n = 1, 'TA1 không thấy khoản của TA2: ' || n; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.ta_bonus_profiles where pic_code like 'TC-%';
  assert n = 2, 'admin thấy tất cả hồ sơ: ' || n; c := c + 1;

  execute 'reset role';
  assert (select count(*) from public.audit_logs where action = 'BONUS_TA_PROFILE') >= 3, 'nhật ký'; c := c + 1;
  raise notice 'BONUS_TA_CREDIT_TEST_PASSED: % check đạt', c;
end $$;
rollback;

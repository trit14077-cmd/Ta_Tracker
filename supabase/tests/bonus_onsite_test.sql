-- TA Onsite Allowance (0048): ngày onsite × TA, cấu hình, khóa khi kỳ đã chốt, RLS (TA thấy ngày + khoản của mình).
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/bonus_onsite_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000048a0';
  t1 uuid := '00000000-0000-4000-8000-0000000048b1';
  t2 uuid := '00000000-0000-4000-8000-0000000048b2';
  j jsonb;
  n int;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('OS-P1', 'OS-P1'), ('OS-P2', 'OS-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'os_admin', 'admin', null, true), (t1, 'os_t1', 'pic', 'OS-P1', true), (t2, 'os_t2', 'pic', 'OS-P2', true);
  delete from public.bonus_periods;

  select config into j from public.bonus_settings where kind = 'onsite';
  assert (j ->> 'ratePerDay')::int = 100000, 'cấu hình mặc định: ' || coalesce(j::text, 'null'); c := c + 1;

  -- ---------- TA ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.bonus_onsite_set('OS-P1', '2026-11', array['2026-11-02']::date[]);
    assert false, 'TA không được sửa ngày onsite';
  exception when others then assert sqlerrm = 'FORBIDDEN', 'TA sửa: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- admin ----------
  perform set_config('request.jwt.claim.sub', a::text, true);
  n := public.bonus_onsite_set('OS-P1', '2026-11', array['2026-11-02', '2026-11-03', '2026-11-03', '2026-11-04']::date[]);
  assert n = 3, 'lưu 3 ngày (bỏ trùng): ' || n; c := c + 1;
  n := public.bonus_onsite_set('OS-P1', '2026-11', array['2026-11-03', '2026-11-05']::date[]);
  assert n = 2 and (select array_agg(day order by day) from public.bonus_onsite_days where pic_code = 'OS-P1')
    = array['2026-11-03', '2026-11-05']::date[], 'thay toàn bộ ngày của tháng'; c := c + 1;
  perform public.bonus_onsite_set('OS-P1', '2026-10', array['2026-10-30']::date[]);
  perform public.bonus_onsite_set('OS-P1', '2026-11', '{}');
  assert (select count(*) from public.bonus_onsite_days where pic_code = 'OS-P1') = 1
     and exists (select 1 from public.bonus_onsite_days where pic_code = 'OS-P1' and day = '2026-10-30'), 'xóa tháng 11 không đụng tháng 10'; c := c + 1;
  perform public.bonus_onsite_set('OS-P1', '2026-11', array['2026-11-02', '2026-11-03']::date[]);
  perform public.bonus_onsite_set('OS-P2', '2026-11', array['2026-11-02']::date[]);
  begin
    perform public.bonus_onsite_set('OS-P1', '2026-11', array['2026-12-01']::date[]);
    assert false, 'ngày ngoài tháng';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'ngày ngoài tháng: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_onsite_set('KHÔNG-CÓ', '2026-11', array['2026-11-02']::date[]);
    assert false, 'PIC không tồn tại';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'PIC lạ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_onsite_set('OS-P1', '2026-13', '{}');
    assert false, 'tháng sai';
  exception when others then assert sqlerrm = 'BONUS_BAD_PERIOD', 'tháng sai: ' || sqlerrm; c := c + 1;
  end;

  j := public.bonus_lock('onsite', '2026-11', '2026-11-26', jsonb_build_array(
    jsonb_build_object('part', 'onsite', 'payee_type', 'ta', 'payee_key', 'OS-P1', 'ta_pic', 'OS-P1', 'amount', 200000, 'net', 200000, 'detail', '{"count":2}'::jsonb),
    jsonb_build_object('part', 'onsite', 'payee_type', 'ta', 'payee_key', 'OS-P2', 'ta_pic', 'OS-P2', 'amount', 100000, 'net', 100000)));
  assert (j ->> 'count')::int = 2 and (j ->> 'total')::numeric = 300000, 'chốt: ' || j::text; c := c + 1;
  assert (select (config ->> 'ratePerDay')::int from public.bonus_periods where kind = 'onsite' and period_key = '2026-11') = 100000,
    'ảnh chụp cấu hình'; c := c + 1;
  begin
    perform public.bonus_onsite_set('OS-P1', '2026-11', array['2026-11-09']::date[]);
    assert false, 'kỳ đã chốt';
  exception when others then assert sqlerrm = 'BONUS_PART_LOCKED', 'kỳ đã chốt: ' || sqlerrm; c := c + 1;
  end;
  n := public.bonus_onsite_set('OS-P1', '2026-10', array['2026-10-29', '2026-10-30']::date[]);
  assert n = 2, 'tháng khác vẫn sửa được'; c := c + 1;
  perform public.bonus_reopen('onsite', '2026-11', 'sửa ngày');
  n := public.bonus_onsite_set('OS-P1', '2026-11', array['2026-11-09']::date[]);
  assert n = 1, 'mở lại kỳ thì sửa được'; c := c + 1;

  -- ---------- RLS ----------
  perform set_config('request.jwt.claim.sub', t1::text, true);
  select count(*) into n from public.bonus_onsite_days;
  assert n = 3, 'TA1 chỉ thấy ngày của mình: ' || n; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.bonus_onsite_days where pic_code like 'OS-%';
  assert n = 4, 'admin thấy tất cả: ' || n; c := c + 1;

  execute 'reset role';
  assert (select count(*) from public.audit_logs where action = 'BONUS_ONSITE_SET') >= 6, 'nhật ký'; c := c + 1;
  raise notice 'BONUS_ONSITE_TEST_PASSED: % check đạt', c;
end $$;
rollback;

-- Bonus hàng tháng (0045): RLS (TA chỉ thấy khoản của mình), cấu hình, Referral, chốt / mở lại, chống trả hai lần.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/bonus_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000045a0';
  t1 uuid := '00000000-0000-4000-8000-0000000045b1';
  t2 uuid := '00000000-0000-4000-8000-0000000045b2';
  r1 bigint; r2 bigint; r_arch bigint;
  j jsonb;
  n int;
  br public.bonus_referrals;
  lines jsonb;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('BON-P1', 'BON-P1'), ('BON-P2', 'BON-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'bon_admin', 'admin', null, true), (t1, 'bon_t1', 'pic', 'BON-P1', true), (t2, 'bon_t2', 'pic', 'BON-P2', true);
  delete from public.bonus_periods;

  insert into public.recruitment_records (candidate_code, pic, full_name, emp_id, site, sub_source, ob_date, ob_status)
    values ('BON01', 'BON-P1', 'Ứng viên 1', '7000001', 'DC Hưng Yên', 'Referrals', '2026-10-07', 'Joined') returning id into r1;
  insert into public.recruitment_records (candidate_code, pic, full_name, emp_id, site, sub_source, ob_date, ob_status)
    values ('BON02', 'BON-P2', 'Ứng viên 2', '7000002', 'DC Bình Dương 1', 'Referrals', '2026-10-08', 'Joined') returning id into r2;
  insert into public.recruitment_records (candidate_code, pic, sub_source, ob_date, is_archived)
    values ('BON03', 'BON-P1', 'Referrals', '2026-10-09', true) returning id into r_arch;

  -- cấu hình mặc định
  select config into j from public.bonus_settings where kind = 'referral';
  assert (j ->> 'candidate')::int = 500000 and (j -> 'referrerByDc' ->> 'DC Hưng Yên')::int = 1500000, 'mức mặc định: ' || j::text; c := c + 1;

  -- ---------- TA ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.bonus_referral_save(r1, '{"referrer_name":"X"}');
    assert false, 'TA không được nhập người giới thiệu';
  exception when others then assert sqlerrm = 'FORBIDDEN', 'TA nhập: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_lock('referral', '2026-11', '2026-11-26', '[]');
    assert false, 'TA không được chốt';
  exception when others then assert sqlerrm = 'FORBIDDEN', 'TA chốt: ' || sqlerrm; c := c + 1;
  end;
  begin
    insert into public.bonus_lines (period_id, kind, part, payee_type, amount, net) values (1, 'referral', 'x', 'ta', 1, 1);
    assert false, 'TA không được ghi thẳng bảng';
  exception when others then assert sqlstate = '42501', 'ghi thẳng: ' || sqlstate; c := c + 1;
  end;

  -- ---------- admin: người giới thiệu + Eligible ----------
  perform set_config('request.jwt.claim.sub', a::text, true);
  br := public.bonus_referral_save(r1, '{"referrer_name":"Người GT 1","referrer_emp_id":"8000001","referrer_status":"Active","candidate_eligible":"Yes","referrer_eligible":"Yes"}');
  assert br.referrer_emp_id = '8000001' and br.candidate_eligible = 'Yes', 'lưu người giới thiệu'; c := c + 1;
  br := public.bonus_referral_save(r1, '{"note":"ghi chú"}');
  assert br.referrer_name = 'Người GT 1' and br.note = 'ghi chú', 'lưu một phần giữ giá trị cũ'; c := c + 1;
  perform public.bonus_referral_save(r2, '{"referrer_name":"Người GT 2","candidate_eligible":"Yes","referrer_eligible":"No"}');
  begin
    perform public.bonus_referral_save(r1, '{"candidate_eligible":"Có"}');
    assert false, 'giá trị Eligible lạ';
  exception when others then assert sqlstate = 'PT422', 'Eligible lạ: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.bonus_referral_save(r_arch, '{"referrer_name":"X"}');
    assert false, 'hồ sơ lưu trữ';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'lưu trữ: ' || sqlerrm; c := c + 1;
  end;
  j := public.bonus_settings_save('referral', '{"candidate":600000,"referrerDefault":1000000,"referrerByDc":{}}');
  assert (select (config ->> 'candidate')::int from public.bonus_settings where kind = 'referral') = 600000, 'đổi mức'; c := c + 1;
  begin
    perform public.bonus_settings_save('abc', '{}');
    assert false, 'loại lạ';
  exception when others then assert sqlerrm = 'BONUS_BAD_KIND', 'loại lạ: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- chốt ----------
  lines := jsonb_build_array(
    jsonb_build_object('record_id', r1, 'part', 'candidate', 'payee_type', 'candidate', 'payee_key', '7000001', 'payee_name', 'Ứng viên 1', 'emp_id', '7000001', 'amount', 500000, 'pit', 0, 'net', 500000, 'detail', '{}'::jsonb),
    jsonb_build_object('record_id', r1, 'part', 'referrer', 'payee_type', 'referrer', 'payee_key', '8000001', 'payee_name', 'Người GT 1', 'emp_id', '8000001', 'amount', 1500000, 'pit', 0, 'net', 1500000),
    jsonb_build_object('record_id', r2, 'part', 'candidate', 'payee_type', 'candidate', 'payee_key', '7000002', 'amount', 500000, 'net', 500000),
    jsonb_build_object('record_id', r2, 'part', 'referrer', 'payee_type', 'referrer', 'payee_key', 'name:Người GT 2', 'amount', 0, 'net', 0),
    -- khoản của TA (giả lập loại TA để kiểm RLS "TA tự xem bonus")
    jsonb_build_object('record_id', null, 'part', 'test', 'payee_type', 'ta', 'payee_key', 'BON-P1', 'ta_pic', 'BON-P1', 'amount', 70000, 'net', 70000));
  begin
    perform public.bonus_lock('referral', '2026-11', '2026-11-26', jsonb_build_array(jsonb_build_object('part', 'x', 'payee_type', 'ta', 'amount', 100, 'pit', 10, 'net', 100)));
    assert false, 'net sai';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'net sai: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_lock('referral', '2026-11', '2026-11-26', jsonb_build_array(jsonb_build_object('part', 'x', 'payee_type', 'ta', 'amount', -1, 'net', -1)));
    assert false, 'tiền âm';
  exception when others then assert sqlerrm = 'INVALID_INPUT', 'tiền âm: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_lock('referral', '2026-11', '2026-11-26', lines || jsonb_build_array(lines -> 0));
    assert false, 'trùng phần trong kỳ';
  exception when others then assert sqlerrm = 'BONUS_DUPLICATE_LINE', 'trùng: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_lock('referral', '2026-13', '2026-11-26', '[]');
    assert false, 'kỳ sai';
  exception when others then assert sqlerrm = 'BONUS_BAD_PERIOD', 'kỳ sai: ' || sqlerrm; c := c + 1;
  end;

  j := public.bonus_lock('referral', '2026-11', '2026-11-26', lines);
  assert (j ->> 'count')::int = 5 and (j ->> 'total')::numeric = 2570000, 'chốt: ' || j::text; c := c + 1;
  assert (select status from public.bonus_periods where kind = 'referral' and period_key = '2026-11') = 'da_chot', 'trạng thái đã chốt'; c := c + 1;
  assert (select (config ->> 'candidate')::int from public.bonus_periods where kind = 'referral' and period_key = '2026-11') = 600000, 'ảnh chụp mức'; c := c + 1;
  begin
    perform public.bonus_lock('referral', '2026-11', '2026-11-26', '[]');
    assert false, 'chốt hai lần';
  exception when others then assert sqlerrm = 'BONUS_ALREADY_LOCKED', 'chốt lại: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_lock('referral', '2026-12', '2026-12-26', jsonb_build_array(lines -> 0));
    assert false, 'trả hai kỳ';
  exception when others then assert sqlerrm = 'BONUS_ALREADY_PAID', 'trả hai kỳ: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.bonus_referral_save(r1, '{"candidate_eligible":"No"}');
    assert false, 'đổi Eligible phần đã chốt';
  exception when others then assert sqlerrm = 'BONUS_PART_LOCKED', 'phần đã chốt: ' || sqlerrm; c := c + 1;
  end;
  perform public.bonus_referral_save(r1, '{"note":"đổi ghi chú vẫn được"}'); c := c + 1;

  -- ---------- RLS đọc ----------
  perform set_config('request.jwt.claim.sub', t1::text, true);
  select count(*) into n from public.bonus_lines;
  assert n = 1, 'TA1 chỉ thấy khoản của mình: ' || n; c := c + 1;
  select count(*) into n from public.bonus_referrals;
  assert n = 0, 'TA không đọc bonus_referrals: ' || n; c := c + 1;
  select count(*) into n from public.bonus_periods;
  assert n >= 1, 'TA đọc được trạng thái kỳ'; c := c + 1;
  perform set_config('request.jwt.claim.sub', t2::text, true);
  select count(*) into n from public.bonus_lines;
  assert n = 0, 'TA2 không thấy khoản của TA1: ' || n; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.bonus_lines;
  assert n = 5, 'admin thấy tất cả: ' || n; c := c + 1;

  -- ---------- mở lại ----------
  begin
    perform public.bonus_reopen('referral', '2026-11', ' ');
    assert false, 'mở lại cần lý do';
  exception when others then assert sqlerrm = 'BONUS_REASON_REQUIRED', 'lý do: ' || sqlerrm; c := c + 1;
  end;
  j := public.bonus_reopen('referral', '2026-11', 'sửa Eligible');
  assert (select count(*) from public.bonus_lines) = 0, 'mở lại xóa khoản'; c := c + 1;
  perform public.bonus_referral_save(r1, '{"candidate_eligible":"No"}'); c := c + 1;
  j := public.bonus_lock('referral', '2026-11', '2026-11-27', jsonb_build_array(lines -> 2));
  assert (j ->> 'count')::int = 1, 'chốt lại sau khi mở'; c := c + 1;

  execute 'reset role';
  assert (select count(*) from public.audit_logs where action in ('BONUS_LOCK', 'BONUS_REOPEN', 'BONUS_REFERRAL_SAVE', 'BONUS_SETTINGS')) >= 6, 'nhật ký'; c := c + 1;
  raise notice 'BONUS_TEST_PASSED: % check đạt', c;
end $$;
rollback;

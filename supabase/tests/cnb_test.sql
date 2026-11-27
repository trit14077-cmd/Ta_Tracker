-- Quy trình 2 – chốt OB CnB (0040): kỳ 25→24, điều kiện (khớp shared/cnbRules.ts), RLS, chốt / mở lại / bổ sung / kiểm hồ sơ.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/cnb_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000040a0';
  t1 uuid := '00000000-0000-4000-8000-0000000040b1';
  t2 uuid := '00000000-0000-4000-8000-0000000040b2';
  r_ok1 bigint; r_ok2 bigint; r_unpaid bigint; r_quit bigint; r_quit_later bigint; r_out bigint; r_t2 bigint;
  rg record;
  j jsonb;
  n int;
  v_item bigint;
  v_late bigint;
  rr public.recruitment_records;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('CNB-P1', 'CNB-P1'), ('CNB-P2', 'CNB-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'cnb_admin', 'admin', null, true), (t1, 'cnb_t1', 'pic', 'CNB-P1', true), (t2, 'cnb_t2', 'pic', 'CNB-P2', true);
  delete from public.audit_logs where action like 'CNB_%';
  delete from public.cnb_ob_batches;

  -- ---------- kỳ ----------
  select * into rg from app.cnb_cycle_range('2026-11');
  assert rg.from_date = '2026-10-25' and rg.to_date = '2026-11-24', 'kỳ T11: ' || rg::text; c := c + 1;
  select * into rg from app.cnb_cycle_range('2027-01');
  assert rg.from_date = '2026-12-25' and rg.to_date = '2027-01-24', 'kỳ T1 qua năm: ' || rg::text; c := c + 1;
  select * into rg from app.cnb_cycle_range('2026-03');
  assert rg.from_date = '2026-02-25' and rg.to_date = '2026-03-24', 'kỳ T3 (tháng 2 ngắn): ' || rg::text; c := c + 1;
  begin
    perform app.cnb_cycle_range('2026-13');
    assert false, 'kỳ sai phải bị từ chối';
  exception when others then assert sqlerrm = 'CNB_BAD_CYCLE', 'kỳ sai: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- hồ sơ ----------
  insert into public.recruitment_records (candidate_code, pic, full_name, emp_id, rank, position, ob_date, salary_pay_status, emp_status, health_check)
    values ('CNB01', 'CNB-P1', 'Ứng viên 1', '6000001', '6A', 'Nhân viên kho', '2026-10-25', 'Chi lương', 'Active', '1') returning id into r_ok1;
  insert into public.recruitment_records (candidate_code, pic, full_name, emp_id, ob_date, salary_pay_status, emp_status)
    values ('CNB02', 'CNB-P1', 'Ứng viên 2', '6000002', '2026-11-24', 'Chi lương', '') returning id into r_ok2;
  insert into public.recruitment_records (candidate_code, pic, ob_date, salary_pay_status, emp_status)
    values ('CNB03', 'CNB-P1', '2026-11-10', 'Không chi lương', 'Active') returning id into r_unpaid;
  insert into public.recruitment_records (candidate_code, pic, ob_date, salary_pay_status, emp_status, attrition_date)
    values ('CNB04', 'CNB-P1', '2026-11-03', 'Chi lương', 'Active', '2026-11-20') returning id into r_quit;
  insert into public.recruitment_records (candidate_code, pic, ob_date, salary_pay_status, emp_status, attrition_date)
    values ('CNB05', 'CNB-P1', '2026-11-03', 'Chi lương', 'Active', '2099-01-01') returning id into r_quit_later;
  insert into public.recruitment_records (candidate_code, pic, ob_date, salary_pay_status, emp_status)
    values ('CNB06', 'CNB-P1', '2026-11-25', 'Chi lương', 'Active') returning id into r_out;   -- ngày 25 → kỳ T12
  insert into public.recruitment_records (candidate_code, pic, ob_date, salary_pay_status, emp_status)
    values ('CNB07', 'CNB-P2', '2026-11-01', 'Chi lương', 'Active') returning id into r_t2;
  insert into public.hr_info (record_id, data, status, id_number)
    values (r_ok1, '{"id_number":"079200001234","bank_account":"0123"}', 'submitted', '079200001234');

  -- lý do bị loại (cùng ca với tests/shared/cnbRules.test.ts)
  select * into rr from public.recruitment_records where id = r_unpaid;
  assert app.cnb_exclude_reasons(rr, '2026-10-25', '2026-11-24', '2026-11-25') = array['chua_chi_luong'], 'chưa chi lương'; c := c + 1;
  select * into rr from public.recruitment_records where id = r_quit;
  assert app.cnb_exclude_reasons(rr, '2026-10-25', '2026-11-24', '2026-11-25') = array['da_nghi'], 'đã nghỉ'; c := c + 1;
  assert app.cnb_exclude_reasons(rr, '2026-10-25', '2026-11-24', '2026-11-19') = '{}', 'nghỉ sau ngày xét vẫn vào'; c := c + 1;
  select * into rr from public.recruitment_records where id = r_out;
  assert app.cnb_exclude_reasons(rr, '2026-10-25', '2026-11-24', '2026-11-25') = array['ngoai_ky'], 'ngày 25 ngoài kỳ T11'; c := c + 1;
  rr.salary_pay_status := ' Chi  lương ';
  rr.ob_date := '2026-11-01';
  assert app.cnb_exclude_reasons(rr, '2026-10-25', '2026-11-24', '2026-11-25') = '{}', 'chuẩn hoá khoảng trắng'; c := c + 1;

  -- ---------- xem trước theo quyền ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.cnb_ob_preview('2026-11');
  assert jsonb_array_length(j) = 5, 'TA1 thấy 5 hồ sơ của mình trong kỳ, thấy ' || jsonb_array_length(j); c := c + 1;
  assert (select count(*) from jsonb_array_elements(j) x where x -> 'reasons' = '[]'::jsonb) = 3, 'TA1: 3 đủ điều kiện'; c := c + 1;
  assert (select x -> 'hr' ->> 'id_number' from jsonb_array_elements(j) x where (x ->> 'record_id')::bigint = r_ok1) = '079200001234', 'xem trước kèm thông tin nhân sự'; c := c + 1;
  begin
    perform public.cnb_ob_lock('2026-11');
    assert false, 'TA không được chốt';
  exception when others then assert sqlstate = '42501', 'TA chốt: ' || sqlstate; c := c + 1;
  end;

  perform set_config('request.jwt.claim.sub', a::text, true);
  assert jsonb_array_length(public.cnb_ob_preview('2026-11')) = 6, 'admin thấy cả 2 TA'; c := c + 1;

  -- ---------- chốt ----------
  j := public.cnb_ob_lock('2026-11');
  assert (j ->> 'count')::int = 4, 'chốt 4 người (ok1, ok2, nghỉ sau, TA2): ' || j::text; c := c + 1;
  assert (select status = 'da_chot' and item_count = 4 and locked_by = a from public.cnb_ob_batches where cycle_key = '2026-11'), 'đợt đã khóa'; c := c + 1;
  begin
    perform public.cnb_ob_lock('2026-11');
    assert false, 'chốt hai lần phải bị chặn';
  exception when others then assert sqlerrm = 'CNB_ALREADY_LOCKED', 'chốt lại: ' || sqlerrm; c := c + 1;
  end;
  select id into v_item from public.cnb_ob_items where record_id = r_ok1;
  assert (select src -> 'hr' ->> 'bank_account' from public.cnb_ob_items where id = v_item) = '0123', 'ảnh chụp có thông tin nhân sự'; c := c + 1;

  -- ---------- RLS item ----------
  perform set_config('request.jwt.claim.sub', t2::text, true);
  select count(*) into n from public.cnb_ob_items;
  assert n = 1, 'TA2 chỉ đọc item của mình, đọc được ' || n; c := c + 1;
  begin
    update public.cnb_ob_items set cnb_note = 'x' where id = v_item;
    assert false, 'TA không được ghi thẳng bảng';
  exception when others then assert sqlstate = '42501', 'ghi thẳng: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.cnb_item_check(v_item, '{"cccd":"x"}');
    assert false, 'TA không được kiểm hồ sơ';
  exception when others then assert sqlstate = '42501', 'TA kiểm: ' || sqlstate; c := c + 1;
  end;

  -- ---------- kiểm hồ sơ ----------
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.cnb_item_check(v_item, '{"cccd":"x","ksk":"o"}', 'thiếu KSK');
  assert j = '{"cccd":"x","ksk":"o"}'::jsonb, 'kiểm hồ sơ: ' || j::text; c := c + 1;
  begin
    perform public.cnb_item_check(v_item, '{"abc":"x"}');
    assert false, 'ô lạ phải bị từ chối';
  exception when others then assert sqlstate = 'PT422', 'ô lạ: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.cnb_item_check(v_item, '{"cccd":"có"}');
    assert false, 'giá trị lạ phải bị từ chối';
  exception when others then assert sqlstate = 'PT422', 'giá trị lạ: ' || sqlstate; c := c + 1;
  end;

  -- ---------- bổ sung sau chốt ----------
  begin
    perform public.cnb_ob_add_late('2026-11', r_unpaid, '');
    assert false, 'bổ sung cần lý do';
  exception when others then assert sqlerrm = 'CNB_REASON_REQUIRED', 'thiếu lý do: ' || sqlerrm; c := c + 1;
  end;
  v_late := public.cnb_ob_add_late('2026-11', r_unpaid, 'CnB xác nhận chi lương muộn');
  assert (select added_late from public.cnb_ob_items where id = v_late), 'item bổ sung'; c := c + 1;
  begin
    perform public.cnb_ob_add_late('2026-11', r_unpaid, 'lần 2');
    assert false, 'bổ sung trùng phải bị chặn';
  exception when others then assert sqlerrm = 'CNB_ITEM_EXISTS', 'trùng: ' || sqlerrm; c := c + 1;
  end;

  -- ---------- mở lại, sửa hồ sơ, chốt lại ----------
  begin
    perform public.cnb_ob_reopen('2026-11', ' ');
    assert false, 'mở lại cần lý do';
  exception when others then assert sqlerrm = 'CNB_REASON_REQUIRED', 'mở lại thiếu lý do: ' || sqlerrm; c := c + 1;
  end;
  perform public.cnb_ob_reopen('2026-11', 'TA sửa chi lương');
  execute 'reset role';
  update public.recruitment_records set salary_pay_status = 'Không chi lương' where id = r_ok2;
  update public.recruitment_records set emp_id = '6999999' where id = r_ok1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.cnb_ob_lock('2026-11');
  assert (j ->> 'count')::int = 4 and (j ->> 'removed')::int = 1, 'chốt lại: bỏ ok2, giữ người bổ sung: ' || j::text; c := c + 1;
  assert (select cnb_check = '{"cccd":"x","ksk":"o"}' and cnb_note = 'thiếu KSK' and src ->> 'emp_id' = '6999999'
            from public.cnb_ob_items where record_id = r_ok1), 'chốt lại giữ kết quả kiểm, cập nhật ảnh chụp'; c := c + 1;
  assert exists (select 1 from public.cnb_ob_items where id = v_late), 'người bổ sung vẫn còn'; c := c + 1;

  -- ảnh chụp không đổi khi hồ sơ sửa sau chốt
  execute 'reset role';
  update public.recruitment_records set emp_id = '6111111' where id = r_ok1;
  assert (select src ->> 'emp_id' from public.cnb_ob_items where record_id = r_ok1) = '6999999', 'ảnh chụp giữ nguyên sau chốt'; c := c + 1;

  -- ---------- bỏ item ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.cnb_ob_remove_item(v_late, 'bổ sung nhầm');
  assert (select item_count from public.cnb_ob_batches where cycle_key = '2026-11') = 3, 'đếm sau khi bỏ'; c := c + 1;

  -- ---------- nhật ký ----------
  execute 'reset role';
  assert (select count(*) from public.audit_logs where action = 'CNB_LOCK') = 2, 'log chốt'; c := c + 1;
  assert (select count(*) from public.audit_logs where action = 'CNB_REOPEN') = 1, 'log mở lại'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'CNB_ADD' and record_id = r_unpaid and candidate_code = 'CNB03'), 'log bổ sung'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'CNB_REMOVE' and record_id = r_unpaid), 'log bỏ'; c := c + 1;
  assert (select count(*) from public.audit_logs where action = 'CNB_CHECK') = 1, 'log kiểm hồ sơ (lần lỗi không ghi)'; c := c + 1;
  assert not exists (select 1 from public.audit_logs where action like 'CNB_%' and changes::text like '%079200001234%'), 'log không chứa CCCD'; c := c + 1;

  raise notice 'CNB_TEST_PASSED: % check đạt', c;
end $$;
rollback;

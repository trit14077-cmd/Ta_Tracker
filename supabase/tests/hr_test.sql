-- M6-4: HR Info (0018) – hr_info_write (Edge gọi bằng service_role), hr_info_get, hr_duplicates như HrInfo.gs.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/hr_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000009a0';
  t1 uuid := '00000000-0000-4000-8000-0000000009b1';
  t2 uuid := '00000000-0000-4000-8000-0000000009b2';
  r1 bigint; r2 bigint; r3 bigint; r4 bigint;
  j jsonb;
  d jsonb := '{"id_number":"079200001234","full_name":"Nguyễn Văn A"}';
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('HR-P1', 'HR-P1'), ('HR-P2', 'HR-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'hr_admin', 'admin', null, true), (t1, 'hr_t1', 'pic', 'HR-P1', true), (t2, 'hr_t2', 'pic', 'HR-P2', true);
  insert into public.recruitment_records (candidate_code, pic, r2_status) values ('HR01', 'HR-P1', 'Passed') returning id into r1;
  insert into public.recruitment_records (candidate_code, pic, r2_status) values ('HR02', 'HR-P1', 'Passed') returning id into r2;
  insert into public.recruitment_records (candidate_code, pic, r2_status) values ('HR03', 'HR-P2', 'Passed') returning id into r3;
  insert into public.recruitment_records (candidate_code, pic, r2_status, is_archived) values ('HR04', 'HR-P2', 'Passed', true) returning id into r4;

  -- ---------- ghi (như Edge hr-info-save gọi) ----------
  j := public.hr_info_write(t1, r1, 'save', 'draft', d, '079200001234', 'Lưu nháp: Số CCCD, Họ tên');
  assert j ->> 'status' = 'draft' and j ->> 'updated_by' = 'hr_t1' and j -> 'data' = d, 'lưu nháp – ' || j::text; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'HRINFO' and record_id = r1
                  and changes -> 'hr_info' ->> 'new' = 'Lưu nháp: Số CCCD, Họ tên'), 'nhật ký chỉ ghi tên trường'; c := c + 1;
  begin
    perform public.hr_info_write(t2, r1, 'save', 'draft', d, '', '');
    assert false, 'TA PIC khác phải bị từ chối';
  exception when others then assert sqlstate = 'PT404', 'TA PIC khác: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.hr_info_write(t1, r1, 'reopen', null, null, '', '');
    assert false, 'mở lại khi chưa xác nhận phải bị từ chối';
  exception when others then assert sqlstate = 'PT409' and sqlerrm = 'NOT_VERIFIED', 'reopen chưa xác nhận: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.hr_info_write(t1, r2, 'verify', null, null, '', '', '{}');
    assert false, 'xác nhận khi chưa có HR Info phải bị từ chối';
  exception when others then assert sqlstate = 'PT404' and sqlerrm = 'NO_HR_INFO', 'verify không có: ' || sqlerrm; c := c + 1;
  end;
  -- xác nhận với dữ liệu đã đổi so với lúc Edge kiểm => CHANGED
  begin
    perform public.hr_info_write(t1, r1, 'verify', null, null, '', '', '{"id_number":"khac"}');
    assert false, 'dữ liệu đổi phải bị từ chối';
  exception when others then assert sqlstate = 'PT409' and sqlerrm = 'CHANGED', 'CHANGED: ' || sqlerrm; c := c + 1;
  end;
  -- PO chốt: TA phụ trách xác nhận được (như hệ cũ)
  j := public.hr_info_write(t1, r1, 'verify', null, null, '', 'Xác nhận thông tin nhân sự', d);
  assert j ->> 'status' = 'verified' and j ->> 'verified_by' = 'hr_t1' and j ->> 'verified_at' <> '', 'TA xác nhận'; c := c + 1;
  begin
    perform public.hr_info_write(t1, r1, 'save', 'draft', d, '', '');
    assert false, 'sửa khi đã xác nhận phải bị từ chối';
  exception when others then assert sqlstate = 'PT409' and sqlerrm = 'LOCKED', 'LOCKED: ' || sqlerrm; c := c + 1;
  end;
  j := public.hr_info_write(t1, r1, 'reopen', null, null, '', 'Mở lại thông tin nhân sự để sửa');
  assert j ->> 'status' = 'submitted' and j ->> 'verified_by' = '', 'TA mở lại => submitted'; c := c + 1;
  j := public.hr_info_write(t1, r1, 'save', 'submitted', d, '079200001234', 'Nhập đủ (không đổi)');
  assert j ->> 'status' = 'submitted', 'gửi đủ'; c := c + 1;

  -- ---------- trùng CCCD (cùng số trên hồ sơ khác, không lưu trữ) ----------
  perform public.hr_info_write(t1, r2, 'save', 'draft', d, '079200001234', '');
  perform public.hr_info_write(t2, r3, 'save', 'draft', d, '079200001234', '');
  perform public.hr_info_write(a, r4, 'save', 'draft', d, '079200001234', '');   -- hồ sơ lưu trữ: không tính

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.hr_duplicates(r1);
  assert j = '{"count": 2, "own": ["HR02"], "others": 1, "with": []}', 'TA: mã hồ sơ mình, PIC khác chỉ đếm – ' || j::text; c := c + 1;
  j := public.hr_info_get(r1);
  assert j -> 'info' ->> 'status' = 'submitted' and j -> 'info' ->> 'updated_by' = 'hr_t1' and (j -> 'duplicates' ->> 'count')::int = 2,
    'hr_info_get – ' || j::text; c := c + 1;
  assert public.hr_info_get(r3) is null, 'hr_info_get hồ sơ PIC khác: null'; c := c + 1;
  assert (public.hr_duplicates(r3) ->> 'count')::int = 0, 'hr_duplicates hồ sơ PIC khác: rỗng (không lộ)'; c := c + 1;
  assert not has_function_privilege('authenticated', 'public.hr_info_write(uuid,bigint,text,text,jsonb,text,text,jsonb)', 'execute'),
    'người dùng không gọi thẳng hr_info_write'; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.hr_duplicates(r1);
  assert j = '{"count": 2, "own": [], "others": 0, "with": [{"code": "HR02", "pic": "HR-P1"}, {"code": "HR03", "pic": "HR-P2"}]}',
    'Admin: mã + PIC – ' || j::text; c := c + 1;
  execute 'reset role';

  assert not has_function_privilege('anon', 'public.hr_info_get(bigint)', 'execute'), 'anon hr_info_get'; c := c + 1;
  assert not has_function_privilege('anon', 'public.hr_duplicates(bigint)', 'execute'), 'anon hr_duplicates'; c := c + 1;
  raise notice 'HR_TEST_PASSED: % check đạt', c;
end $$;
rollback;

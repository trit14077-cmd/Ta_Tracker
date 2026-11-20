-- M7-2: bản tiếng Anh (0023) – translation_list / translation_save như Docs.gs: quyền hồ sơ, cần bản gốc, rỗng = xóa, nhật ký TRANSLATION.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/translations_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000da0';
  t1 uuid := '00000000-0000-4000-8000-000000000db1';
  t2 uuid := '00000000-0000-4000-8000-000000000db2';
  r bigint;
  r0 bigint;
  j jsonb;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('TR-P1', 'TR-P1'), ('TR-P2', 'TR-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'tr_admin', 'admin', null, true), (t1, 'tr_t1', 'pic', 'TR-P1', true), (t2, 'tr_t2', 'pic', 'TR-P2', true);
  insert into public.recruitment_records (candidate_code, full_name, pic, experience_summary) values ('TR001', 'A', 'TR-P1', '3 năm kho') returning id into r;
  insert into public.recruitment_records (candidate_code, full_name, pic, experience_summary) values ('TR002', 'B', 'TR-P1', '') returning id into r0;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);

  j := public.translation_list(r);
  assert jsonb_array_length(j) = 1 and j -> 0 ->> 'field_key' = 'experience_summary' and j -> 0 ->> 'source_text' = '3 năm kho'
         and j -> 0 ->> 'en_text' = '', 'chưa dịch: 1 trường, có bản gốc'; c := c + 1;

  perform public.translation_save(r, 'experience_summary', E'  3 years in a warehouse\r\n ', 'h1:9');
  j := public.translation_list(r);
  assert j -> 0 ->> 'en_text' = '3 years in a warehouse' and j -> 0 ->> 'source_hash' = 'h1:9' and j -> 0 ->> 'updated_by' = 'tr_t1', 'lưu, cắt khoảng trắng, người sửa'; c := c + 1;
  perform public.translation_save(r, 'experience_summary', 'Three years', 'h2:9');
  assert (select count(*) from public.translations where record_id = r) = 1, 'ghi đè 1 dòng/trường'; c := c + 1;

  begin
    perform public.translation_save(r0, 'experience_summary', 'x', 'h');
    assert false, 'chưa có bản gốc';
  exception when others then assert sqlstate = 'PT400', 'NO_SOURCE: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.translation_save(r, 'full_name', 'x', 'h');
    assert false, 'trường không dịch được';
  exception when others then assert sqlstate = 'PT404', 'trường lạ: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.translation_save(r, 'experience_summary', repeat('x', 5001), 'h');
    assert false, 'quá 5000 ký tự';
  exception when others then assert sqlstate = 'PT400', 'quá dài: ' || sqlstate; c := c + 1;
  end;
  begin
    insert into public.translations (record_id, field_key, source_hash, en_text) values (r, 'experience_summary', 'h', 'x');
    assert false, 'không ghi thẳng bảng';
  exception when others then assert sqlstate = '42501', 'ghi thẳng: ' || sqlstate; c := c + 1;
  end;

  perform set_config('request.jwt.claim.sub', t2::text, true);
  begin
    perform public.translation_list(r);
    assert false, 'TA khác PIC';
  exception when others then assert sqlstate = 'PT404', 'TA khác list: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.translation_save(r, 'experience_summary', 'hack', 'h');
    assert false, 'TA khác PIC ghi';
  exception when others then assert sqlstate = 'PT404', 'TA khác save: ' || sqlstate; c := c + 1;
  end;

  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.translation_save(r, 'experience_summary', '', '');
  assert jsonb_array_length(public.translation_list(r)) = 1 and public.translation_list(r) -> 0 ->> 'en_text' = '', 'rỗng = xóa (Admin)'; c := c + 1;
  execute 'reset role';

  assert (select count(*) from public.translations where record_id = r) = 0, 'đã xóa dòng'; c := c + 1;
  assert (select count(*) from public.audit_logs where record_id = r and action = 'TRANSLATION') = 3, '3 lần ghi nhật ký TRANSLATION'; c := c + 1;
  assert exists (select 1 from public.audit_logs where record_id = r and action = 'TRANSLATION' and actor_username = 'tr_admin'
                  and changes -> 'experience_summary' = '{"old":"Three years","new":""}'::jsonb), 'nhật ký cũ/mới'; c := c + 1;
  assert not has_function_privilege('anon', 'public.translation_save(bigint,text,text,text)', 'execute'), 'anon'; c := c + 1;
  raise notice 'TRANSLATIONS_TEST_PASSED: % check đạt', c;
end $$;
rollback;

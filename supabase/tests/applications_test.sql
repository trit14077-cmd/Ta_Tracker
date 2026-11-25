-- M7-3: ứng tuyển online (0024) như Apply.gs – link theo TA, chống spam, hộp thư theo quyền, tạo hồ sơ + gắn CV, nhật ký.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/applications_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000ea0';
  t1 uuid := '00000000-0000-4000-8000-000000000eb1';
  t2 uuid := '00000000-0000-4000-8000-000000000eb2';
  code1 text; code0 text;
  j jsonb;
  id1 bigint; id2 bigint; id0 bigint;
  r bigint;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('AP-P1', 'AP-P1'), ('AP-P2', 'AP-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'ap_admin', 'admin', null, true), (t1, 'ap_t1', 'pic', 'AP-P1', true), (t2, 'ap_t2', 'pic', 'AP-P2', true);
  insert into public.dropdown_options (list_key, value, active, sort_order) values
    ('region', 'AP Miền Nam', true, 1), ('region', 'AP Miền Tắt', false, 2),
    ('location', 'AP Bình Dương', true, 1), ('location', 'AP Đồng Nai', true, 2), ('location', 'AP Tắt', false, 3)
    on conflict do nothing;
  insert into public.hierarchy (parent_type, parent_value, child_value) values
    ('region', 'AP Miền Nam', 'AP Đồng Nai'), ('region', 'AP Miền Nam', 'AP Bình Dương'), ('region', 'AP Miền Nam', 'AP Tắt'),
    ('region', 'AP Miền Tắt', 'AP Bình Dương') on conflict do nothing;
  insert into public.recruitment_records (candidate_code, full_name, phone, pic) values ('APOLD1', 'Cũ', '901111111', 'AP-P2') returning id into r;

  -- ---------- link ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.apply_link('AP-P2');   -- TA xin link người khác => vẫn chỉ ra link của mình
  assert j ->> 'pic' = 'AP-P1' and j ->> 'code' ~ '^[A-Za-z0-9]{20}$', 'TA chỉ có link của mình'; c := c + 1;
  code1 := j ->> 'code';
  assert public.apply_link('') ->> 'code' = code1, 'mã ổn định'; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  code0 := public.apply_link('') ->> 'code';
  assert code0 <> code1 and public.apply_link('AP-P1') ->> 'code' = code1, 'Admin: link chung + link của TA'; c := c + 1;
  begin
    perform public.apply_link('KHONG-CO');
    assert false, 'PIC lạ';
  exception when others then assert sqlstate = 'PT400', 'BAD_PIC: ' || sqlstate; c := c + 1;
  end;
  perform public.apply_set_page_url('https://tuyendung.example.vn/');
  assert public.apply_link('') ->> 'page_url' = 'https://tuyendung.example.vn/', 'địa chỉ trang công ty'; c := c + 1;
  begin
    perform public.apply_set_page_url('http://khong-an-toan.vn');
    assert false, 'phải https';
  exception when others then assert sqlstate = 'PT400', 'BAD_URL: ' || sqlstate; c := c + 1;
  end;
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.apply_set_page_url('');
    assert false, 'TA không đổi trang';
  exception when others then assert sqlstate = 'PT403', 'TA page url: ' || sqlstate; c := c + 1;
  end;
  execute 'reset role';

  -- ---------- công khai: info ----------
  j := public.apply_info(code1);
  assert j ->> 'valid' = 'true' and j ->> 'pic' = 'AP-P1', 'mã TA hợp lệ'; c := c + 1;
  assert (select e -> 'locations' from jsonb_array_elements(j -> 'regions') e where e ->> 'region' = 'AP Miền Nam') = '["AP Bình Dương", "AP Đồng Nai"]'::jsonb,
         'khu vực đang bật, tỉnh đang bật theo thứ tự'; c := c + 1;
  assert not exists (select 1 from jsonb_array_elements(j -> 'regions') e where e ->> 'region' = 'AP Miền Tắt'), 'bỏ khu vực đã tắt'; c := c + 1;
  assert public.apply_info('') ->> 'pic' = '' and public.apply_info(code0) ->> 'pic' = '', 'không mã / mã chung = link chung'; c := c + 1;
  assert public.apply_info('abcdefghijklmnop') ->> 'valid' = 'false' and public.apply_info('x;drop') ->> 'valid' = 'false', 'mã sai'; c := c + 1;
  update public.pics set active = false where code = 'AP-P1';
  assert public.apply_info(code1) ->> 'valid' = 'false', 'PIC đã tắt => link hết hiệu lực'; c := c + 1;
  update public.pics set active = true where code = 'AP-P1';

  -- ---------- công khai: chống spam + lưu ----------
  assert public.apply_gate('AP-P1', '902222222', '1.2.3.4', 600, 60) = 'ok', 'lần đầu'; c := c + 1;
  id1 := public.apply_insert('AP-P1', 'Ứng Viên Một', '902222222', 'a@b.vn', 'Bình Dương', 'Kế toán', 'note', 'DRV1', 'cv.pdf', '1.2.3.4');
  assert (select position = 'Kế toán' from public.applications where id = id1), 'lưu vị trí ứng tuyển'; c := c + 1;
  assert public.apply_gate('AP-P1', '902222222', '1.2.3.4', 600, 60) = 'repeated', 'cùng SĐT trong 10 phút'; c := c + 1;
  assert public.apply_gate('AP-P1', '903333333', '1.2.3.4', 1, 60) = 'limited', 'quá N/giờ/link'; c := c + 1;
  assert public.apply_gate('AP-P2', '903333333', '1.2.3.4', 600, 1) = 'limited', 'quá N/giờ/IP'; c := c + 1;
  id2 := public.apply_insert('AP-P2', 'Ứng Viên Hai', '901111111', '', '', '', '', '', '', '');
  id0 := public.apply_insert('', 'Không TA', '904444444', '', '', '', '', '', '', '');
  assert (select pic is null and cv_drive_file_id is null from public.applications where id = id0), 'link chung: chưa gán TA'; c := c + 1;

  -- ---------- hộp thư ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.applications_list('new', '', false);
  assert jsonb_array_length(j -> 'items') = 1 and j -> 'items' -> 0 ->> 'id' = id1::text and j -> 'counts' ->> 'all' = '1', 'TA chỉ thấy hồ sơ của mình'; c := c + 1;
  assert j -> 'items' -> 0 ->> 'cv_name' = 'cv.pdf' and j ? 'page_url' and j -> 'page_url' = 'null'::jsonb, 'cv_name; TA không thấy page_url'; c := c + 1;
  perform set_config('request.jwt.claim.sub', t2::text, true);
  j := public.applications_list('new', '', false);
  assert j -> 'items' -> 0 -> 'dup' = '{"count": 1, "codes": ["APOLD1"]}'::jsonb, 'trùng SĐT: TA thấy mã hồ sơ của mình'; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  j := public.applications_list('all', '', false);
  assert (j -> 'counts' ->> 'all')::int >= 3 and j ->> 'page_url' = 'https://tuyendung.example.vn/', 'Admin thấy tất cả'; c := c + 1;
  assert (select e -> 'dup' from jsonb_array_elements(j -> 'items') e where (e ->> 'id')::bigint = id2) = '{"count": 1, "codes": ["APOLD1 (AP-P2)"]}'::jsonb, 'Admin thấy mã (PIC)'; c := c + 1;
  assert jsonb_array_length(public.applications_list('new', 'AP-P2', false) -> 'items') = 1, 'Admin lọc theo TA'; c := c + 1;
  assert public.applications_list('new', '', true) ? 'counts' and not (public.applications_list('new', '', true) ? 'items'), 'chỉ đếm'; c := c + 1;

  -- bỏ qua / đưa lại
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.application_set_status(id2, 'skipped');
    assert false, 'TA khác không sửa được';
  exception when others then assert sqlstate = 'PT404', 'set_status TA khác: ' || sqlstate; c := c + 1;
  end;
  j := public.application_set_status(id1, 'skipped');
  assert j ->> 'status' = 'skipped' and j ->> 'handled_by' = 'ap_t1', 'bỏ qua'; c := c + 1;
  j := public.application_set_status(id1, 'new');
  assert j ->> 'status' = 'new' and j ->> 'handled_by' = '', 'đưa lại vào Mới'; c := c + 1;

  -- tạo hồ sơ từ hồ sơ ứng tuyển: gắn CV
  execute 'reset role';
  insert into public.recruitment_records (candidate_code, full_name, phone, pic) values ('APNEW1', 'Ứng Viên Một', '902222222', 'AP-P1') returning id into r;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  j := public.application_convert(id1, r);
  assert j ->> 'cv_attached' = 'true' and j -> 'application' ->> 'status' = 'done' and j -> 'application' ->> 'candidate_code' = 'APNEW1', 'đã tạo hồ sơ + gắn CV'; c := c + 1;
  execute 'reset role';
  assert (select drive_file_id = 'DRV1' and file_name = 'cv.pdf' from public.record_files where record_id = r and kind = 'cv' and deleted_at is null), 'CV vào record_files'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'APPLICATION' and candidate_code = 'APNEW1'
                  and changes -> ('application#' || id1) ->> 'new' = 'Tạo hồ sơ từ form ứng tuyển online (kèm CV)'), 'nhật ký như hệ cũ'; c := c + 1;
  j := public.application_cv(t1, id1);
  assert j ->> 'drive_file_id' = 'DRV1', 'tải CV ứng tuyển'; c := c + 1;
  begin
    perform public.application_cv(t1, id2);
    assert false, 'CV hồ sơ TA khác';
  exception when others then assert sqlstate = 'PT404', 'application_cv TA khác: ' || sqlstate; c := c + 1;
  end;

  assert not has_function_privilege('anon', 'public.apply_insert(text,text,text,text,text,text,text,text,text,text)', 'execute')
     and not has_function_privilege('authenticated', 'public.apply_insert(text,text,text,text,text,text,text,text,text,text)', 'execute'), 'apply_insert chỉ Edge'; c := c + 1;
  assert not has_function_privilege('anon', 'public.applications_list(text,text,boolean)', 'execute'), 'anon hộp thư'; c := c + 1;
  assert not has_table_privilege('authenticated', 'public.apply_links', 'select'), 'không đọc thẳng mã link'; c := c + 1;
  raise notice 'APPLICATIONS_TEST_PASSED: % check đạt', c;
end $$;
rollback;

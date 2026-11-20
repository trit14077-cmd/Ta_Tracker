-- M7-6: quản trị Drop-list / đề xuất / View (0020) – hành vi như Api2.gs, chỉ Admin.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/admin_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000ba0';
  t1 uuid := '00000000-0000-4000-8000-000000000bb1';
  r1 bigint; r2 bigint; rq bigint; v1 bigint;
  j jsonb;
begin
  insert into auth.users (id) values (a), (t1);
  insert into public.pics (code, name) values ('AD-P1', 'AD-P1') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'ad_admin', 'admin', null, true), (t1, 'ad_t1', 'pic', 'AD-P1', true);
  insert into public.dropdown_options (list_key, value, sort_order) values ('position', 'Thủ kho ADM', 1), ('sub_source', 'Kênh ADM', 1), ('site', 'Kho ADM', 1)
    on conflict do nothing;
  insert into public.sub_source_map values ('Kênh ADM', 'Nguồn cũ ADM') on conflict (sub_source) do update set source = excluded.source;
  insert into public.hierarchy values ('location', 'Tỉnh ADM', 'Kho ADM') on conflict do nothing;
  insert into public.recruitment_records (candidate_code, pic, position, sub_source, source, site)
    values ('ADR01', 'AD-P1', 'Thủ kho ADM', 'Kênh ADM', 'Nguồn cũ ADM', 'Kho ADM') returning id into r1;
  insert into public.recruitment_records (candidate_code, pic, position) values ('ADR02', 'AD-P1', 'Khác ADM') returning id into r2;

  execute 'set local role authenticated';
  -- ---------- chỉ Admin ----------
  perform set_config('request.jwt.claim.sub', t1::text, true);
  begin
    perform public.dd_add_option('position', 'TA thêm');
    assert false, 'TA phải bị từ chối';
  exception when others then assert sqlstate = 'PT403', 'TA thêm giá trị: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.view_delete(1);
    assert false, 'TA phải bị từ chối';
  exception when others then assert sqlstate = 'PT403', 'TA xóa view: ' || sqlstate; c := c + 1;
  end;

  perform set_config('request.jwt.claim.sub', a::text, true);
  -- ---------- thêm giá trị ----------
  perform public.dd_add_option('site', '  Kho mới ADM ', '', 'Tỉnh ADM');
  assert exists (select 1 from public.dropdown_options where list_key = 'site' and value = 'Kho mới ADM' and active), 'thêm Site (đã trim)'; c := c + 1;
  assert exists (select 1 from public.hierarchy where parent_type = 'location' and parent_value = 'Tỉnh ADM' and child_value = 'Kho mới ADM'), 'thêm Site kèm Location cha'; c := c + 1;
  perform public.dd_add_option('pic', 'AD-P9');
  assert exists (select 1 from public.pics where code = 'AD-P9' and active), 'thêm PIC vào bảng pics'; c := c + 1;
  begin
    perform public.dd_add_option('position', '   ');
    assert false, 'giá trị rỗng phải bị từ chối';
  exception when others then assert sqlstate = 'PT400', 'rỗng: ' || sqlstate; c := c + 1;
  end;

  -- ---------- đổi tên: lan sang hồ sơ, ánh xạ, phân cấp ----------
  j := public.dd_update_option('position', 'Thủ kho ADM', 'Thủ kho chính ADM', null, array['position']);
  assert (j ->> 'records_updated')::int = 1, 'đổi tên vị trí: 1 hồ sơ – ' || j::text; c := c + 1;
  execute 'reset role';
  assert (select position = 'Thủ kho chính ADM' and row_version = 2 from public.recruitment_records where id = r1), 'hồ sơ đổi theo, tăng phiên bản'; c := c + 1;
  assert (select position from public.recruitment_records where id = r2) = 'Khác ADM', 'hồ sơ khác giữ nguyên'; c := c + 1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.dd_update_option('site', 'Kho ADM', 'Kho A ADM', null, array['site']);
  assert exists (select 1 from public.hierarchy where parent_type = 'location' and child_value = 'Kho A ADM')
     and not exists (select 1 from public.hierarchy where child_value = 'Kho ADM'), 'đổi tên Site trong phân cấp'; c := c + 1;
  perform public.dd_update_option('sub_source', 'Kênh ADM', 'Kênh mới ADM', null, array['sub_source']);
  assert exists (select 1 from public.sub_source_map where sub_source = 'Kênh mới ADM'), 'đổi tên Sub_Source trong ánh xạ'; c := c + 1;
  begin
    perform public.dd_update_option('position', 'Khác', 'x', null, array['phone; drop table x']);
    assert false, 'cột lạ phải bị từ chối';
  exception when others then assert sqlstate in ('PT422'), 'cột lạ: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.dd_update_option('position', 'Thủ kho chính ADM', 'Kho mới ADM', null, array['position']);
    perform public.dd_update_option('site', 'Kho mới ADM', 'Kho A ADM', null, array['site']);
    assert false, 'trùng giá trị phải bị từ chối';
  exception when others then assert sqlstate = 'PT409', 'trùng: ' || sqlstate; c := c + 1;
  end;
  -- PIC: FK cascade sang hồ sơ + tài khoản
  perform public.dd_update_option('pic', 'AD-P1', 'AD-P1X', null, '{}');
  execute 'reset role';
  assert (select pic from public.recruitment_records where id = r1) = 'AD-P1X' and (select pic_code from public.profiles where id = t1) = 'AD-P1X',
    'đổi mã PIC lan sang hồ sơ và tài khoản'; c := c + 1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  -- ngừng sử dụng
  perform public.dd_update_option('site', 'Kho A ADM', null, false);
  assert exists (select 1 from public.dropdown_options where list_key = 'site' and value = 'Kho A ADM' and not active), 'ngừng sử dụng'; c := c + 1;
  perform public.dd_update_option('site', 'Kho A ADM', null, true);
  assert exists (select 1 from public.dropdown_options where list_key = 'site' and value = 'Kho A ADM' and active), 'kích hoạt lại'; c := c + 1;

  -- ---------- ánh xạ Sub_Source -> Source: tính lại Source của hồ sơ ----------
  j := public.dd_set_sub_source_map('{"Kênh mới ADM": "Nguồn mới ADM"}');
  assert (j ->> 'records_updated')::int = 1, 'tính lại Source'; c := c + 1;
  execute 'reset role';
  assert (select source from public.recruitment_records where id = r1) = 'Nguồn mới ADM', 'Source của hồ sơ đổi theo ánh xạ'; c := c + 1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);

  -- ---------- phân cấp: thay toàn bộ loại được gửi ----------
  perform public.dd_set_hierarchy(null, '{"Tỉnh ADM": ["Kho A ADM", " ", "Kho B ADM"]}');
  assert (select count(*) from public.hierarchy where parent_type = 'location') = 2
     and (select count(*) from public.hierarchy where parent_type = 'location' and child_value = 'Kho B ADM') = 1, 'thay phân cấp location (bỏ ô trống)'; c := c + 1;

  -- ---------- duyệt đề xuất ----------
  execute 'reset role';
  insert into public.dropdown_requests (list_key, proposed_value, mapped_source, requested_by) values ('sub_source', 'Kênh đề xuất ADM', 'Nguồn ADM', t1) returning id into rq;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.dd_review_request(rq, 'approved');
  assert exists (select 1 from public.dropdown_options where list_key = 'sub_source' and value = 'Kênh đề xuất ADM')
     and exists (select 1 from public.sub_source_map where sub_source = 'Kênh đề xuất ADM' and source = 'Nguồn ADM')
     and (select status = 'approved' and reviewed_by = a from public.dropdown_requests where id = rq), 'duyệt đề xuất: thêm giá trị + ánh xạ'; c := c + 1;

  -- ---------- View ----------
  j := public.view_save(null, '{"name":"View ADM","config":{"filters":{"pic":"AD-P1X"}},"audience":"users","user_ids":["00000000-0000-4000-8000-000000000bb1"]}');
  v1 := (j ->> 'id')::bigint;
  assert j ->> 'created_by' = 'ad_admin' and j ->> 'audience' = 'users', 'tạo view'; c := c + 1;
  begin
    perform public.view_save(null, '{"name":"View ADM"}');
    assert false, 'trùng tên phải bị từ chối';
  exception when others then assert sqlstate = 'PT400' and sqlerrm = 'DUPLICATE_VIEW', 'trùng tên view: ' || sqlerrm; c := c + 1;
  end;
  begin
    perform public.view_save(v1, '{"user_ids":[]}');
    assert false, 'audience users mà không có người phải bị từ chối';
  exception when others then assert sqlstate = 'PT400', 'users rỗng: ' || sqlstate; c := c + 1;
  end;
  j := public.view_save(v1, '{"name":"View ADM 2","is_active":false}');
  assert j ->> 'name' = 'View ADM 2' and not (j ->> 'is_active')::boolean and j -> 'config' -> 'filters' ->> 'pic' = 'AD-P1X', 'sửa view (giữ phần không gửi)'; c := c + 1;
  -- TA thấy view gán cho mình chỉ khi đang dùng
  perform set_config('request.jwt.claim.sub', t1::text, true);
  assert not exists (select 1 from public.saved_views where id = v1), 'TA không thấy view đã tắt'; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform public.view_save(v1, '{"is_active":true}');
  perform set_config('request.jwt.claim.sub', t1::text, true);
  assert exists (select 1 from public.saved_views where id = v1), 'TA thấy view gán cho mình'; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  execute 'reset role';
  delete from public.saved_views where id <> v1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  begin
    perform public.view_delete(v1);
    assert false, 'xóa view cuối phải bị từ chối';
  exception when others then assert sqlstate = 'PT400' and sqlerrm = 'LAST_VIEW', 'view cuối: ' || sqlerrm; c := c + 1;
  end;
  execute 'reset role';

  -- ---------- nhật ký như hệ cũ ----------
  assert exists (select 1 from public.audit_logs where action = 'DROPDOWN' and changes -> 'position' ->> 'new' = 'Đổi tên thành "Thủ kho chính ADM"'), 'nhật ký đổi tên'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'DROPDOWN' and changes -> 'sub_source' ->> 'new' = 'Đã phê duyệt đề xuất'), 'nhật ký duyệt'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'VIEW' and changes -> 'saved_view' ->> 'new' = 'Tạo view "View ADM"'), 'nhật ký view'; c := c + 1;
  assert not has_function_privilege('anon', 'public.dd_add_option(text,text,text,text)', 'execute'), 'anon dd_add_option'; c := c + 1;
  assert not has_function_privilege('authenticated', 'app.dd_add(text,text,text,text)', 'execute'), 'không gọi thẳng app.dd_add'; c := c + 1;

  raise notice 'ADMIN_TEST_PASSED: % check đạt', c;
end $$;
rollback;

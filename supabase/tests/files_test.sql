-- M7-1: file trên Drive (0022 + 0025 khớp hệ cũ) – file_attach / file_remove / file_open / file_list / file_set_names:
-- quyền hồ sơ, 1 file/giấy tờ, ≤20 đính kèm, trả `trash` (file cũ vào thùng rác Drive), đính kèm giữ số khi thay, nhật ký.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/files_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000fa0';
  t1 uuid := '00000000-0000-4000-8000-000000000fb1';
  t2 uuid := '00000000-0000-4000-8000-000000000fb2';
  r bigint;
  rn bigint;
  v int;
  j jsonb;
  fid bigint;
  i int;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('FL-P1', 'FL-P1'), ('FL-P2', 'FL-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'fl_admin', 'admin', null, true), (t1, 'fl_t1', 'pic', 'FL-P1', true), (t2, 'fl_t2', 'pic', 'FL-P2', true);
  insert into public.recruitment_records (candidate_code, full_name, pic, rank) values ('FL001', 'Người File', 'FL-P1', '6') returning id, row_version into r, v;
  insert into public.recruitment_records (candidate_code, full_name, pic) values ('FL002', 'Chưa PIC', null) returning id into rn;

  -- ---------- quyền ----------
  begin
    perform public.file_attach(t2, r, 'cv', 'D1', 'a.pdf', 10, 'application/pdf');
    assert false, 'TA khác PIC phải bị từ chối';
  exception when others then assert sqlstate = 'PT404', 'TA khác PIC: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.file_open(t1, rn, 'cv');
    assert false, 'hồ sơ pic=null: TA không tải được';
  exception when others then assert sqlstate = 'PT404', 'pic null: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.file_attach(t1, r, 'khac', 'D1', 'a.pdf', 10, '');
    assert false, 'loại lạ';
  exception when others then assert sqlstate = 'PT422', 'loại lạ: ' || sqlstate; c := c + 1;
  end;

  -- ---------- CV: 1 file, thay thì xóa mềm file cũ ----------
  j := public.file_attach(t1, r, 'cv', 'DCV1', 'FL001_Người File_CV.pdf', 1000, 'application/pdf');
  assert j -> 'record' ->> 'cv_file' = 'FL001_Người File_CV.pdf', 'v_records.cv_file sau khi tải CV'; c := c + 1;
  assert j -> 'file' ->> 'uploaded_by' = 'fl_t1', 'người tải'; c := c + 1;
  j := public.file_attach(a, r, 'cv', 'DCV2', 'cv2.pdf', 1000, 'application/pdf');
  assert j -> 'trash' = '["DCV1"]'::jsonb, 'thay CV: file cũ vào thùng rác'; c := c + 1;
  assert (select count(*) from public.record_files where record_id = r and kind = 'cv' and deleted_at is null) = 1, '1 CV còn hiệu lực'; c := c + 1;
  assert exists (select 1 from public.audit_logs where record_id = r and action = 'UPDATE'
                  and changes -> 'cv_file' = '{"old":"FL001_Người File_CV.pdf","new":"cv2.pdf"}'::jsonb), 'nhật ký thay CV'; c := c + 1;
  assert (select row_version from public.recruitment_records where id = r) = v, 'CV không đổi row_version'; c := c + 1;

  -- ---------- giấy tờ: ghi "<drive id>|<tên>" vào cột, tăng version ----------
  update public.recruitment_records set health_check = 'Yes', id_card = 'OLDDRV|cccd cũ.pdf' where id = r;
  j := public.file_attach(t1, r, 'id_card', 'DID1', 'FL001_Người File_CCCD.pdf', 500, 'application/pdf');
  assert j -> 'trash' = '["OLDDRV"]'::jsonb, 'giấy tờ chuyển từ hệ cũ (chỉ có ở cột) cũng vào thùng rác khi thay'; c := c + 1;
  j := public.file_attach(t1, r, 'health_check', 'DHC1', 'FL001_Người File_Giấy khám sức khỏe.pdf', 500, 'application/pdf');
  assert j -> 'record' ->> 'health_check' = 'DHC1|FL001_Người File_Giấy khám sức khỏe.pdf', 'cột giấy tờ dạng id|tên'; c := c + 1;
  assert (j -> 'record' ->> 'row_version')::int = v + 2, 'giấy tờ tăng row_version'; c := c + 1;
  assert exists (select 1 from public.audit_logs where record_id = r and changes -> 'health_check' ->> 'old' = 'Yes'), 'nhật ký: thay giá trị cũ "Yes"'; c := c + 1;
  j := public.file_open(t1, r, 'health_check');
  assert j ->> 'drive_file_id' = 'DHC1', 'file_open trả drive id'; c := c + 1;
  assert exists (select 1 from public.audit_logs where record_id = r and action = 'DOWNLOAD' and changes ? 'health_check'), 'nhật ký DOWNLOAD'; c := c + 1;
  j := public.file_remove(t1, r, 'health_check');
  assert j -> 'record' ->> 'health_check' = '' and j -> 'trash' = '["DHC1"]'::jsonb, 'xóa giấy tờ: cột rỗng, file vào thùng rác'; c := c + 1;
  assert not exists (select 1 from public.record_files where record_id = r and kind = 'health_check' and deleted_at is null), 'xóa mềm'; c := c + 1;
  begin
    perform public.file_open(t1, r, 'health_check');
    assert false, 'file đã xóa không tải được';
  exception when others then assert sqlstate = 'PT404', 'tải file đã xóa: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.file_remove(t1, r, 'health_check');
    assert false, 'xóa lần 2';
  exception when others then assert sqlstate = 'PT404', 'xóa lần 2: ' || sqlstate; c := c + 1;
  end;

  -- ---------- Payslips: nhiều file, tối đa 20, thay theo id ----------
  fid := public.file_reserve_id();
  j := public.file_attach(t1, r, 'payslip', 'DP1', 'p1.pdf', 10, 'application/pdf', null, fid);
  assert (j -> 'file' ->> 'id')::bigint = fid, 'id dành trước (số trong tên file như hệ cũ)'; c := c + 1;
  assert exists (select 1 from public.audit_logs where record_id = r and action = 'ATTACHMENT' and changes -> 'payslip' = '{"old":"","new":"Tải lên p1.pdf"}'::jsonb),
         'nhật ký ATTACHMENT "Tải lên"'; c := c + 1;
  for i in 2..20 loop
    j := public.file_attach(t1, r, 'payslip', 'DP' || i, 'p' || i || '.pdf', 10, 'application/pdf');
  end loop;
  fid := (j -> 'file' ->> 'id')::bigint;
  begin
    perform public.file_attach(t1, r, 'payslip', 'DP21', 'p21.pdf', 10, '');
    assert false, 'quá 20 file';
  exception when others then assert sqlstate = 'PT400' and sqlerrm = 'TOO_MANY', 'quá 20: ' || sqlstate; c := c + 1;
  end;
  j := public.file_attach(t1, r, 'payslip', 'DPX', 'thay.pdf', 10, '', fid);
  assert (j -> 'file' ->> 'id')::bigint = fid and j -> 'trash' = '["DP20"]'::jsonb, 'thay: giữ dòng + số, file cũ vào thùng rác'; c := c + 1;
  assert (select count(*) from public.record_files where record_id = r and kind = 'payslip' and deleted_at is null) = 20, 'thay: vẫn 20'; c := c + 1;
  assert exists (select 1 from public.audit_logs where record_id = r and action = 'ATTACHMENT'
                  and changes -> 'payslip' = '{"old":"p20.pdf","new":"Thay bằng thay.pdf"}'::jsonb), 'nhật ký thay'; c := c + 1;
  j := public.file_list(t1, r);
  assert jsonb_array_length(j -> 'attachments') = 20 and j ->> 'rank' = '6', 'file_list'; c := c + 1;
  fid := (j -> 'attachments' -> 0 ->> 'id')::bigint;
  j := public.file_open(t1, r, 'payslip', fid);
  assert j ->> 'drive_file_id' = 'DP1', 'tải đính kèm theo id'; c := c + 1;
  assert exists (select 1 from public.audit_logs where record_id = r and action = 'ATTACHMENT' and changes -> 'payslip' ->> 'new' = 'Tải xuống p1.pdf'),
         'tải xuống đính kèm ghi ATTACHMENT như hệ cũ'; c := c + 1;
  j := public.file_remove(t1, r, '', fid);   -- Edge chỉ gửi file_id: hàm tự lấy loại
  assert j -> 'trash' = '["DP1"]'::jsonb, 'xóa đính kèm: file vào thùng rác'; c := c + 1;
  assert jsonb_array_length(public.file_list(t1, r) -> 'attachments') = 19, 'xóa đính kèm'; c := c + 1;
  begin
    perform public.file_list(t2, r);
    assert false, 'TA khác xem đính kèm';
  exception when others then assert sqlstate = 'PT404', 'file_list TA khác: ' || sqlstate; c := c + 1;
  end;

  -- ---------- Admin thấy hồ sơ chưa PIC ----------
  j := public.file_attach(a, rn, 'resume', 'DR1', 'r.pdf', 10, '');
  assert j -> 'record' ->> 'resume' = 'DR1|r.pdf', 'Admin ghi hồ sơ chưa PIC'; c := c + 1;

  -- đổi tên theo Mã NV (Edge): danh sách file + ghi tên mới
  j := public.file_drive_list(r);
  assert jsonb_array_length(j) = 20 and not exists (select 1 from jsonb_array_elements(j) e where e ->> 'kind' = 'cv'), 'file_drive_list: giấy tờ + đính kèm, không CV'; c := c + 1;
  fid := (select (e ->> 'id')::bigint from jsonb_array_elements(j) e where e ->> 'kind' = 'id_card');
  perform public.file_set_names(r, jsonb_build_array(jsonb_build_object('id', fid, 'file_name', 'E99_Người File_CCCD.pdf')));
  assert (select file_name from public.record_files where id = fid) = 'E99_Người File_CCCD.pdf', 'file_set_names'; c := c + 1;
  perform public.file_set_names(rn, jsonb_build_array(jsonb_build_object('id', fid, 'file_name', 'x')));
  assert (select file_name from public.record_files where id = fid) = 'E99_Người File_CCCD.pdf', 'file_set_names chỉ trong đúng hồ sơ'; c := c + 1;

  assert not has_function_privilege('authenticated', 'public.file_attach(uuid,bigint,text,text,text,bigint,text,bigint,bigint)', 'execute'), 'người dùng không gọi thẳng file_attach'; c := c + 1;
  assert not has_function_privilege('authenticated', 'public.file_set_names(bigint,jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'public.file_reserve_id()', 'execute'), 'file_set_names / file_reserve_id chỉ Edge'; c := c + 1;
  assert not has_function_privilege('authenticated', 'public.file_open(uuid,bigint,text,bigint)', 'execute'), 'file_open'; c := c + 1;
  assert not has_function_privilege('anon', 'public.file_list(uuid,bigint)', 'execute'), 'anon file_list'; c := c + 1;
  raise notice 'FILES_TEST_PASSED: % check đạt', c;
end $$;
rollback;

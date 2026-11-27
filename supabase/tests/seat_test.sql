-- Quy trình 1 – mã ghế (0038 + 0039): RLS theo TA, luồng trạng thái, cấp mã liên tiếp, bộ đếm, nhật ký, tổng hợp.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/seat_test.sql   (1 giao dịch, ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000038a0';
  t1 uuid := '00000000-0000-4000-8000-0000000038b1';
  t2 uuid := '00000000-0000-4000-8000-0000000038b2';
  s1 bigint; s2 bigint; s3 bigint;
  n int;
  v_last bigint;
  codes text[];
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('SEAT-P1', 'SEAT-P1'), ('SEAT-P2', 'SEAT-P2') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'seat_admin', 'admin', null, true), (t1, 'seat_t1', 'pic', 'SEAT-P1', true), (t2, 'seat_t2', 'pic', 'SEAT-P2', true);
  update public.seat_code_counter set last_issued = 25597257 where id = 1;
  delete from public.audit_logs where action like 'SEAT_%';

  -- ---------- TA1 tạo 2 dòng, TA2 tạo 1 dòng ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', t1::text, true);
  insert into public.seat_requests (ban, vung, nhom_chuc_danh, ranking_ap, vi_tri_ap, so_luong, quan_ly_truc_tiep)
  values ('Chuỗi Cung Ứng', 'Miền Nam', 'Rank 6', '6A', 'Nhân viên kho', 2, 'QL A') returning id into s1;
  insert into public.seat_requests (ban, vung, nhom_chuc_danh, ranking_ap, vi_tri_ap, so_luong, quan_ly_truc_tiep)
  values ('Chuỗi Cung Ứng', 'Miền Bắc', 'Rank 5', '5B', 'Trưởng ca', 1, 'QL B') returning id into s2;
  assert (select owner_id from public.seat_requests where id = s1) = t1, 'owner = auth.uid()'; c := c + 1;
  begin
    insert into public.seat_requests (ban, vung, nhom_chuc_danh, ranking_ap, vi_tri_ap, so_luong, quan_ly_truc_tiep, status)
    values ('X', 'Miền Nam', 'Rank 6', '6A', 'NV', 1, 'QL', 'gui');
    assert false, 'TA không được tạo thẳng trạng thái gui';
  exception when others then assert sqlstate = '42501', 'insert gui: ' || sqlstate; c := c + 1;
  end;
  begin
    insert into public.seat_requests (ban, vung, nhom_chuc_danh, ranking_ap, vi_tri_ap, so_luong, quan_ly_truc_tiep)
    values ('X', 'Miền Tây', 'Rank 6', '6A', 'NV', 1, 'QL');
    assert false, 'vùng ngoài danh sách phải bị chặn';
  exception when others then assert sqlstate = '23514', 'vùng sai: ' || sqlstate; c := c + 1;
  end;

  perform set_config('request.jwt.claim.sub', t2::text, true);
  insert into public.seat_requests (ban, vung, nhom_chuc_danh, ranking_ap, vi_tri_ap, so_luong, quan_ly_truc_tiep)
  values ('Chuỗi Cung Ứng', 'Miền Trung', 'Rank 6', '6B', 'Lái xe nâng', 1, 'QL C') returning id into s3;
  select count(*) into n from public.seat_requests where id in (s1, s2, s3);
  assert n = 1, 'TA2 chỉ thấy dòng của mình, thấy ' || n; c := c + 1;
  update public.seat_requests set note = 'sửa trộm' where id = s1;
  get diagnostics n = row_count;
  assert n = 0, 'TA2 không sửa được dòng TA1'; c := c + 1;
  delete from public.seat_requests where id = s1;
  get diagnostics n = row_count;
  assert n = 0, 'TA2 không xóa được dòng TA1'; c := c + 1;

  -- ---------- TA1 gửi HRBP ----------
  perform set_config('request.jwt.claim.sub', t1::text, true);
  update public.seat_requests set status = 'gui' where id in (s1, s2);
  assert (select ngay_gui from public.seat_requests where id = s1) = (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'ngày gửi = hôm nay (VN)'; c := c + 1;
  update public.seat_requests set note = 'sửa sau gửi' where id = s1;
  get diagnostics n = row_count;
  assert n = 0, 'TA không sửa được dòng đã gửi'; c := c + 1;
  begin
    update public.seat_requests set status = 'nhap' where id = s1;
    get diagnostics n = row_count;
    assert n = 0, 'TA không tự kéo dòng đã gửi về nháp';
    c := c + 1;
  exception when others then assert sqlstate = '42501', 'kéo về: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.seat_issue_codes(array[s1]);
    assert false, 'TA không được cấp mã';
  exception when others then assert sqlstate = '42501', 'TA cấp mã: ' || sqlstate; c := c + 1;
  end;

  -- ---------- Admin: thấy tất cả, trả về, xác nhận, cấp mã ----------
  perform set_config('request.jwt.claim.sub', a::text, true);
  select count(*) into n from public.seat_requests where id in (s1, s2, s3);
  assert n = 3, 'admin thấy tất cả, thấy ' || n; c := c + 1;
  update public.seat_requests set status = 'nhap' where id = s2;
  assert (select status = 'nhap' and ngay_gui is null from public.seat_requests where id = s2), 'trả về TA xóa ngày gửi'; c := c + 1;
  begin
    update public.seat_requests set status = 'da_cap_ma', ma_ghe = array['12345678'] where id = s1;
    assert false, 'không được ghi mã ngoài RPC';
  exception when others then assert sqlstate in ('42501', 'P0001'), 'ghi mã tay: ' || sqlstate; c := c + 1;
  end;
  update public.seat_requests set status = 'xac_nhan' where id = s1;
  -- dòng s2 đang nháp: RPC bỏ qua, không cấp
  select array_agg(x) into codes from (select unnest(ma_ghe) x from public.seat_issue_codes(array[s1, s2])) q;
  assert codes = array['25597258', '25597259'], 'cấp 2 mã liên tiếp: ' || coalesce(codes::text, 'null'); c := c + 1;
  assert (select status from public.seat_requests where id = s2) = 'nhap', 'dòng chưa xác nhận không được cấp'; c := c + 1;
  assert public.seat_counter_get() = 25597259, 'bộ đếm = mã cuối'; c := c + 1;
  begin
    update public.seat_requests set note = 'sửa sau cấp' where id = s1;
    get diagnostics n = row_count;
    assert n = 0, 'dòng đã cấp mã bị khóa';
    c := c + 1;
  exception when others then assert sqlstate in ('42501', 'P0001'), 'sửa sau cấp: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.seat_counter_set(25597000);
    assert false, 'bộ đếm không được lùi';
  exception when others then assert sqlerrm like '%SEAT_COUNTER_NO_ROLLBACK%', 'lùi bộ đếm: ' || sqlerrm; c := c + 1;
  end;
  v_last := public.seat_counter_set(25597300);
  assert v_last = 25597300, 'đặt bộ đếm tiến'; c := c + 1;

  -- ---------- Nhật ký (0039) ----------
  execute 'reset role';
  assert (select count(*) from public.audit_logs where action = 'SEAT_CREATE') = 3, 'log tạo'; c := c + 1;
  assert (select count(*) from public.audit_logs where action = 'SEAT_SUBMIT') = 2, 'log gửi'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'SEAT_RETURN' and actor_username = 'seat_admin'
                 and (changes ->> 'seat_id')::bigint = s2), 'log trả về'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'SEAT_CONFIRM' and (changes ->> 'seat_id')::bigint = s1), 'log xác nhận'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'SEAT_ISSUE' and (changes ->> 'seat_id')::bigint = s1
                 and changes -> 'ma_ghe' -> 'new' = '["25597258","25597259"]'::jsonb), 'log cấp mã có mã'; c := c + 1;
  assert (select count(*) from public.audit_logs where action = 'SEAT_COUNTER') = 1, 'chỉ log lần đặt bộ đếm tay'; c := c + 1;
  assert not exists (select 1 from public.audit_logs where action = 'SEAT_UPDATE'), 'không có log sửa rỗng'; c := c + 1;

  -- ---------- Tổng hợp ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);
  select coalesce(sum(so_ghe), 0) into n from public.seat_summary();
  assert n = 4, 'admin: tổng 4 ghế, được ' || n; c := c + 1;
  select coalesce(sum(so_ghe), 0) into n from public.seat_summary() where status = 'da_cap_ma';
  assert n = 2, 'admin: 2 ghế đã cấp'; c := c + 1;
  perform set_config('request.jwt.claim.sub', t2::text, true);
  select coalesce(sum(so_ghe), 0) into n from public.seat_summary();
  assert n = 1, 'TA2 chỉ thấy số của mình, được ' || n; c := c + 1;
  -- TA2 xóa được dòng nháp của mình (ghi log SEAT_DELETE)
  delete from public.seat_requests where id = s3;
  execute 'reset role';
  assert exists (select 1 from public.audit_logs where action = 'SEAT_DELETE' and (changes ->> 'seat_id')::bigint = s3), 'log xóa'; c := c + 1;

  raise notice 'SEAT_TEST_PASSED: % check đạt', c;
end $$;
rollback;

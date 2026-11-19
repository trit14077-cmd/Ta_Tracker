-- candidate_list_test.sql – Test View v_records, candidate_dup_info, list_candidates, check_phone
-- Chạy trong 1 giao dịch và rollback ở cuối.
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-0000000002a0';
  t1 uuid := '00000000-0000-4000-8000-0000000002b1';
  t2 uuid := '00000000-0000-4000-8000-0000000002b2';
  id1 bigint; id2 bigint; id3 bigint; id4 bigint; id5 bigint;
  j jsonb;
  res jsonb;
  d jsonb;
begin
  insert into auth.users (id) values (a), (t1), (t2);
  insert into public.pics (code, name) values ('TEST-P1', 'TEST-P1'), ('TEST-P2', 'TEST-P2');
  insert into public.profiles (id, username, role, pic_code, active) values
    (a, 'clist_admin', 'admin', null, true),
    (t1, 'clist_t1', 'pic', 'TEST-P1', true),
    (t2, 'clist_t2', 'pic', 'TEST-P2', true);

  -- 1. Tạo hồ sơ test
  -- Hồ sơ 1: Lead mới, SĐT 0900000001, PIC TEST-P1
  insert into public.recruitment_records (candidate_code, full_name, phone, pic, is_archived)
    values ('CLIST01', 'Nguyễn Văn Một', '0900000001', 'TEST-P1', false) returning id into id1;

  -- Hồ sơ 2: Trùng SĐT với Hồ sơ 1, nhưng thuộc TEST-P2
  insert into public.recruitment_records (candidate_code, full_name, phone, pic, r1_status, r1_date, is_archived)
    values ('CLIST02', 'Nguyễn Văn Hai', '0900000001', 'TEST-P2', 'Passed', '2026-11-10', false) returning id into id2;

  -- Hồ sơ 3: R1 Failed, SĐT riêng
  insert into public.recruitment_records (candidate_code, full_name, phone, pic, r1_status, r1_date, is_archived)
    values ('CLIST03', 'Trần Thị Ba', '0900000003', 'TEST-P1', 'Failed', '2026-11-12', false) returning id into id3;

  -- Hồ sơ 4: OB Joined, đã nghỉ việc, có tenor
  insert into public.recruitment_records (candidate_code, full_name, phone, pic, ob_date, ob_status, emp_status, attrition_date, is_archived)
    values ('CLIST04', 'Lê Văn Bốn', '0900000004', 'TEST-P1', '2026-11-01', 'Joined', 'Resigned', '2026-11-05', false) returning id into id4;

  -- Hồ sơ 5: Bị lưu trữ (archived)
  insert into public.recruitment_records (candidate_code, full_name, phone, pic, is_archived)
    values ('CLIST05', 'Phạm Văn Năm', '0900000005', 'TEST-P1', true) returning id into id5;

  -- 2. Kiểm tra các cột tính toán trong v_records (Admin context)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', a::text, true);

  select to_jsonb(v.*) into j from public.v_records v where id = id1;
  assert j ->> 'board_col' = 'lead', 'CLIST01 board_col phải là lead'; c := c + 1;
  assert j ->> 'board_sub' = 'lead_new', 'CLIST01 board_sub phải là lead_new'; c := c + 1;
  assert (j ->> 'has_phone_dup')::boolean = true, 'CLIST01 phải có has_phone_dup = true'; c := c + 1;

  select to_jsonb(v.*) into j from public.v_records v where id = id2;
  assert j ->> 'board_col' = 'lusu', 'CLIST02 R1 Passed chưa có R2 date phải là lusu'; c := c + 1;
  assert j ->> 'board_sub' = 'su', 'CLIST02 board_sub phải là su'; c := c + 1;

  select to_jsonb(v.*) into j from public.v_records v where id = id3;
  assert j ->> 'board_col' = 'r1', 'CLIST03 R1 Failed phải là box r1'; c := c + 1;
  assert j ->> 'board_sub' is null, 'CLIST03 R1 Failed board_sub phải là null'; c := c + 1;

  select to_jsonb(v.*) into j from public.v_records v where id = id4;
  assert j ->> 'board_col' = 'ob', 'CLIST04 OB Joined phải là box ob'; c := c + 1;
  assert j ->> 'tenor' = '<7D', 'CLIST04 2026-11-01 đến 2026-11-05 (4 ngày) tenor phải là <7D'; c := c + 1;

  -- 3. Kiểm tra candidate_dup_info:
  -- 3.1 Admin gọi:
  d := public.candidate_dup_info(id1);
  assert (d ->> 'count')::int = 1, 'Admin dup count = 1'; c := c + 1;
  assert (d -> 'with' -> 0 ->> 'code') = 'CLIST02', 'Admin thấy code trùng CLIST02'; c := c + 1;
  assert (d -> 'with' -> 0 ->> 'pic') = 'TEST-P2', 'Admin thấy pic trùng TEST-P2'; c := c + 1;

  -- 3.2 TA1 gọi (hồ sơ id1 là của TA1, trùng với id2 của TA2):
  perform set_config('request.jwt.claim.sub', t1::text, true);
  d := public.candidate_dup_info(id1);
  assert (d ->> 'count')::int = 1, 'TA1 dup count = 1'; c := c + 1;
  assert (d ->> 'others')::int = 1, 'TA1 thấy 1 hồ sơ của TA khác'; c := c + 1;
  assert (d -> 'own') = '[]'::jsonb, 'TA1 không có hồ sơ của chính mình trùng'; c := c + 1;
  assert d -> 'with' is null, 'TA1 KHÔNG ĐƯỢC thấy trường with'; c := c + 1;

  -- 4. Kiểm tra list_candidates:
  -- 4.1 TA1 chỉ thấy hồ sơ của TEST-P1 (id1, id3, id4), không thấy id2 của TEST-P2:
  res := public.list_candidates(1, 25);
  assert (res ->> 'total')::int = 3, 'TA1 list_candidates thấy 3 hồ sơ chưa lưu trữ của mình'; c := c + 1;

  -- 4.2 Lọc box 'lead':
  res := public.list_candidates(1, 25, 'id', 'desc', '', '{}'::jsonb, 'lead');
  assert (res ->> 'total')::int = 1, 'Lọc box lead trả về đúng 1'; c := c + 1;
  assert (res -> 'items' -> 0 ->> 'candidate_code') = 'CLIST01', 'Lọc box lead ra CLIST01'; c := c + 1;

  -- 4.3 Lọc trùng SĐT (dup=true):
  res := public.list_candidates(1, 25, 'id', 'desc', '', '{}'::jsonb, '', '', '', true);
  assert (res ->> 'total')::int = 1, 'Lọc dup=true trả về 1 (CLIST01)'; c := c + 1;

  -- 4.4 Lọc tenor:
  res := public.list_candidates(1, 25, 'id', 'desc', '', '{}'::jsonb, '', '', '<7D');
  assert (res ->> 'total')::int = 1, 'Lọc tenor <7D trả về 1 (CLIST04)'; c := c + 1;

  -- 4.5 Lọc archived:
  res := public.list_candidates(1, 25, 'id', 'desc', '', '{}'::jsonb, '', '', '', false, true);
  assert (res ->> 'total')::int = 1, 'Lọc archived=true trả về 1 (CLIST05)'; c := c + 1;

  -- 4.6 Tìm kiếm theo đuôi số điện thoại:
  res := public.list_candidates(1, 25, 'id', 'desc', '900000001');
  assert (res ->> 'total')::int = 1, 'Tìm kiếm phone trả về 1'; c := c + 1;

  -- 5. Admin gọi list_candidates thấy đủ 4 hồ sơ (cả của TEST-P1 và TEST-P2):
  perform set_config('request.jwt.claim.sub', a::text, true);
  res := public.list_candidates(1, 25);
  assert (res ->> 'total')::int = 4, 'Admin thấy đủ 4 hồ sơ active'; c := c + 1;

  -- 6. check_phone:
  -- Admin thấy thông tin PIC khác
  res := public.check_phone('0900000001');
  assert jsonb_array_length(res -> 'duplicates') = 2, 'Admin check_phone thấy 2 kết quả trùng'; c := c + 1;

  -- TA1 kiểm tra phone trùng:
  perform set_config('request.jwt.claim.sub', t1::text, true);
  res := public.check_phone('0900000001');
  assert jsonb_array_length(res -> 'duplicates') = 2, 'TA1 check_phone thấy 2 kết quả'; c := c + 1;
  -- Dòng của TA2 bị che:
  assert (res -> 'duplicates' -> 0 ->> 'candidate_code') = '(ẩn)' or (res -> 'duplicates' -> 1 ->> 'candidate_code') = '(ẩn)', 'Hồ sơ của TA khác bị che'; c := c + 1;

  -- 7. Bảo mật / tương thích bổ sung khi tiếp quản (19/11):
  -- 7.1 TA hỏi thông tin trùng của hồ sơ PIC khác => null (không lộ)
  assert public.candidate_dup_info(id2) is null, 'TA1 không xem được dupInfo của hồ sơ TA2'; c := c + 1;
  -- 7.2 TA vẫn biết hồ sơ của mình trùng SĐT với hồ sơ PIC khác (has_phone_dup tính trên toàn bộ hồ sơ như hệ cũ)
  assert (select has_phone_dup from public.v_records where id = id1), 'has_phone_dup tính cả hồ sơ PIC khác'; c := c + 1;
  -- 7.3 tìm kiếm coi % và _ là ký tự thường (hệ cũ tìm chuỗi con)
  res := public.list_candidates(1, 25, 'id', 'desc', '%');
  assert (res ->> 'total')::int = 0, 'Tìm "%" không khớp mọi hồ sơ'; c := c + 1;
  -- 7.4 sắp xếp tăng dần theo mã + phân trang
  res := public.list_candidates(1, 10, 'candidate_code', 'asc');
  assert (res -> 'items' -> 0 ->> 'candidate_code') = 'CLIST01' and (res -> 'items' -> 2 ->> 'candidate_code') = 'CLIST04', 'Sắp xếp theo mã tăng dần'; c := c + 1;
  -- 7.5 đếm thẻ KPI: TA1 có CLIST01 (lead), CLIST03 (rớt R1), CLIST04 (OB Joined); hỏi PIC khác vẫn chỉ đếm của mình
  res := public.board_counts('TEST-P2');
  assert (res -> 'counts' -> 'lead' ->> 'total')::int = 1 and (res -> 'counts' -> 'r1' ->> 'total')::int = 1
     and (res -> 'counts' -> 'r1' ->> 'failed')::int = 1 and (res -> 'counts' -> 'ob' ->> 'total')::int = 1
     and (res -> 'counts' -> 'lusu' ->> 'total')::int = 0, 'board_counts của TA1: ' || res::text; c := c + 1;
  assert (res -> 'subs' ->> 'lead_new')::int = 1 and (res -> 'subs' ->> 'r1_wait')::int = 0, 'board_counts subs của TA1'; c := c + 1;
  perform set_config('request.jwt.claim.sub', a::text, true);
  res := public.board_counts('TEST-P2');
  assert (res -> 'counts' -> 'lusu' ->> 'total')::int = 1 and (res -> 'counts' -> 'lead' ->> 'total')::int = 0, 'Admin lọc board_counts theo PIC'; c := c + 1;
  perform set_config('request.jwt.claim.sub', t1::text, true);

  -- 7.6 anon không gọi được hàm nào
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.check_phone('0900000001');
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'anon không gọi được check_phone (dò SĐT)';
  end; c := c + 1;
  begin
    perform public.list_candidates(1, 25);
    raise exception 'EXPECTED_DENY';
  exception when others then
    assert sqlerrm <> 'EXPECTED_DENY', 'anon không gọi được list_candidates';
  end; c := c + 1;
  execute 'reset role';

  raise notice 'CANDIDATE_LIST_TEST_PASSED: % checks đạt', c;
end $$;
rollback;

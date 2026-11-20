-- Nhật ký 12 tháng (0026): lô dòng cũ, chỉ xóa dòng đã xuất (id ≤ id cuối file), chỉ Admin, không xóa dòng < 12 tháng.
-- Chạy:  psql -v ON_ERROR_STOP=1 -f supabase/tests/audit_purge_test.sql   (ROLLBACK ở cuối)
begin;
do $$
declare
  c int := 0;
  a  uuid := '00000000-0000-4000-8000-000000000aa0';
  t1 uuid := '00000000-0000-4000-8000-000000000ab1';
  cut timestamptz := public.audit_purge_cutoff();
  j jsonb;
  n int;
  last_id bigint;
begin
  insert into auth.users (id) values (a), (t1);
  insert into public.pics (code, name) values ('AU-P1', 'AU-P1') on conflict do nothing;
  insert into public.profiles (id, username, role, pic_code, active) values (a, 'au_admin', 'admin', null, true), (t1, 'au_t1', 'pic', 'AU-P1', true);
  delete from public.audit_logs;   -- bắt đầu sạch (rollback ở cuối)
  insert into public.audit_logs (at, actor_username, actor_role, action, candidate_code, changes)
  select now() - interval '13 months' + (g || ' minutes')::interval, 'x', 'pic', 'UPDATE', 'C' || g, jsonb_build_object('note', jsonb_build_object('old', '=cmd', 'new', 'b'))
    from generate_series(1, 5) g;
  insert into public.audit_logs (at, actor_username, actor_role, action, candidate_code, changes)
  values (now() - interval '11 months', 'x', 'pic', 'UPDATE', 'MOI', '{}');

  assert cut <= now() - interval '12 months' + interval '1 day' and cut > now() - interval '12 months' - interval '1 day', 'mốc ≈ 12 tháng'; c := c + 1;
  j := public.audit_purge_batch(cut, 0, 3);
  assert jsonb_array_length(j -> 'rows') = 3 and (j ->> 'remaining')::int = 5, 'lô 3 dòng, còn 5 dòng cũ'; c := c + 1;
  last_id := (j -> 'rows' -> 2 ->> 'id')::bigint;

  begin
    perform public.purge_audit(t1, cut, last_id, 'f.csv');
    assert false, 'TA không dọn được';
  exception when others then assert sqlstate = 'PT403', 'TA: ' || sqlstate; c := c + 1;
  end;
  begin
    perform public.purge_audit(a, now(), last_id, 'f.csv');
    assert false, 'mốc mới hơn 12 tháng';
  exception when others then assert sqlstate = 'PT400', 'TOO_RECENT: ' || sqlstate; c := c + 1;
  end;

  n := public.purge_audit(a, cut, last_id, 'NhatKy_1-3.csv');
  assert n = 3, 'chỉ xóa 3 dòng đã xuất'; c := c + 1;
  assert (public.audit_purge_batch(cut, 0, 100) ->> 'remaining')::int = 2, 'còn 2 dòng cũ chưa xuất'; c := c + 1;
  assert exists (select 1 from public.audit_logs where candidate_code = 'MOI'), 'dòng < 12 tháng giữ nguyên'; c := c + 1;
  assert exists (select 1 from public.audit_logs where action = 'AUDIT_PURGE' and actor_username = 'au_admin'
                  and changes -> 'BATCH' ->> 'new' like 'Xuất 3 dòng nhật ký trước % ra Drive (file "NhatKy_1-3.csv") rồi xóa khỏi hệ thống.'), 'nhật ký lần dọn'; c := c + 1;

  assert not has_function_privilege('authenticated', 'public.purge_audit(uuid,timestamptz,bigint,text)', 'execute')
     and not has_function_privilege('authenticated', 'public.audit_purge_batch(timestamptz,bigint,integer)', 'execute'), 'chỉ Edge gọi'; c := c + 1;
  raise notice 'AUDIT_PURGE_TEST_PASSED: % check đạt', c;
end $$;
rollback;

-- 0026_audit_purge.sql – M6-5/M7: chính sách lưu nhật ký 12 tháng (Q7, D-10; DATABASE_SCHEMA §… purge_audit).
-- Edge `audit-purge` (chỉ Admin): đọc các dòng cũ hơn mốc theo lô (audit_purge_batch), xuất CSV lên Drive ("TA Tracker Nhật ký"),
-- XONG mới gọi purge_audit xóa đúng các dòng đã xuất (at < mốc và id ≤ id cuối của file). Ghi 1 dòng nhật ký AUDIT_PURGE.

-- mốc: đầu ngày (giờ Việt Nam) cách đây 12 tháng
create or replace function public.audit_purge_cutoff() returns timestamptz
language sql stable security definer set search_path = ''
as $$ select (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') - interval '12 months') at time zone 'Asia/Ho_Chi_Minh' $$;
revoke all on function public.audit_purge_cutoff() from public, anon, authenticated;
grant execute on function public.audit_purge_cutoff() to service_role;

-- 1 lô dòng cũ hơn mốc, id tăng dần (sau p_after_id); kèm số dòng còn lại
create or replace function public.audit_purge_batch(p_before timestamptz, p_after_id bigint, p_limit int)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
        select id, at, actor_username, actor_role, action, record_id, candidate_code, changes
          from public.audit_logs where at < p_before and id > coalesce(p_after_id, 0)
         order by id limit greatest(1, least(coalesce(p_limit, 5000), 20000))) x), '[]'::jsonb),
    'remaining', (select count(*) from public.audit_logs where at < p_before and id > coalesce(p_after_id, 0)))
$$;
revoke all on function public.audit_purge_batch(timestamptz, bigint, int) from public, anon, authenticated;
grant execute on function public.audit_purge_batch(timestamptz, bigint, int) to service_role;

-- xóa các dòng ĐÃ xuất (at < p_before và id ≤ p_max_id); chỉ Admin; ghi 1 dòng AUDIT_PURGE
create or replace function public.purge_audit(p_actor uuid, p_before timestamptz, p_max_id bigint, p_file text)
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_n int;
begin
  if v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được dọn nhật ký.';
  end if;
  if p_before > public.audit_purge_cutoff() then
    raise exception 'TOO_RECENT' using errcode = 'PT400', detail = 'Chỉ được xóa nhật ký cũ hơn 12 tháng.';
  end if;
  delete from public.audit_logs where at < p_before and id <= p_max_id;
  get diagnostics v_n = row_count;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, v_actor.username, v_actor.role, 'AUDIT_PURGE', null, '',
          jsonb_build_object('BATCH', jsonb_build_object('old', '', 'new',
            'Xuất ' || v_n || ' dòng nhật ký trước ' || to_char(p_before at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || ' ra Drive (file "' || coalesce(p_file, '') || '") rồi xóa khỏi hệ thống.')));
  return v_n;
end $$;
revoke all on function public.purge_audit(uuid, timestamptz, bigint, text) from public, anon, authenticated;
grant execute on function public.purge_audit(uuid, timestamptz, bigint, text) to service_role;

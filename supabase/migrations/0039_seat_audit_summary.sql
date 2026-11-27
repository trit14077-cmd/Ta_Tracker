-- 0039_seat_audit_summary (Quy trình 1 – mã ghế, phần bổ sung cho 0038)
-- 1) Nhật ký audit_logs cho mọi thao tác trên seat_requests và khi HRSS đặt lại bộ đếm mã.
-- 2) seat_summary: tab "Tổng hợp" (bước 1, tab TongHop của sheet) – số dòng / số ghế theo tháng gửi, TA, vùng, trạng thái.
-- Kế hoạch: docs/KE_HOACH_MA_GHE_VA_CNB.md (bước 1.3, 1.5). Chưa áp dụng trên project nào.

-- 0) Sửa 0038: hàm trigger không cần quyền EXECUTE của người dùng (security_audit báo anon gọi được).
revoke all on function public.seat_requests_guard() from public, anon, authenticated;

-- 1) Nhật ký ------------------------------------------------------------------
-- action: SEAT_CREATE | SEAT_UPDATE | SEAT_SUBMIT (nhap→gui) | SEAT_RETURN (gui→nhap) | SEAT_CONFIRM (gui→xac_nhan)
--         | SEAT_ISSUE (→da_cap_ma) | SEAT_DELETE | SEAT_COUNTER. changes: {"seat_id": id, "<cột>": {"old","new"}}.
create or replace function public.tg_seat_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.profiles;
  v_action text;
  v_changes jsonb := '{}'::jsonb;
  v_old jsonb;
  v_new jsonb;
  k text;
begin
  select * into v_actor from public.profiles where id = (select auth.uid());
  if tg_op = 'INSERT' then
    v_action := 'SEAT_CREATE';
    v_changes := jsonb_build_object('status', jsonb_build_object('old', '', 'new', new.status),
                                    'so_luong', jsonb_build_object('old', '', 'new', new.so_luong));
  elsif tg_op = 'DELETE' then
    v_action := 'SEAT_DELETE';
    v_changes := jsonb_build_object('status', jsonb_build_object('old', old.status, 'new', ''));
  else
    v_action := case
      when old.status = new.status then 'SEAT_UPDATE'
      when old.status = 'nhap' and new.status = 'gui' then 'SEAT_SUBMIT'
      when old.status = 'gui' and new.status = 'nhap' then 'SEAT_RETURN'
      when old.status = 'gui' and new.status = 'xac_nhan' then 'SEAT_CONFIRM'
      when new.status = 'da_cap_ma' then 'SEAT_ISSUE'
      else 'SEAT_UPDATE' end;
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    for k in select jsonb_object_keys(v_new) loop
      if v_old -> k is distinct from v_new -> k then
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('old', v_old -> k, 'new', v_new -> k));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, coalesce(v_actor.username, 'system'), coalesce(v_actor.role, 'system'), v_action, null, '',
          v_changes || jsonb_build_object('seat_id', coalesce(new.id, old.id)));
  return coalesce(new, old);
end $$;
revoke all on function public.tg_seat_audit() from public, anon, authenticated;

create trigger seat_requests_audit after insert or update or delete on public.seat_requests
  for each row execute function public.tg_seat_audit();

-- Bộ đếm: chỉ ghi khi HRSS đặt tay (seat_counter_set). Khi cấp mã, seat_issue_codes bật app.seat_issue = 'on'
-- và mỗi ghế tăng bộ đếm một lần – các lần đó đã nằm trong nhật ký SEAT_ISSUE nên không ghi lại.
create or replace function public.tg_seat_counter_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_actor public.profiles;
begin
  if old.last_issued = new.last_issued
     or (coalesce(current_setting('app.seat_issue', true), '') = 'on' and new.last_issued = old.last_issued + 1) then
    return new;
  end if;
  select * into v_actor from public.profiles where id = (select auth.uid());
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_actor.id, coalesce(v_actor.username, 'system'), coalesce(v_actor.role, 'system'), 'SEAT_COUNTER', null, '',
          jsonb_build_object('last_issued', jsonb_build_object('old', old.last_issued, 'new', new.last_issued)));
  return new;
end $$;
revoke all on function public.tg_seat_counter_audit() from public, anon, authenticated;

create trigger seat_code_counter_audit after update on public.seat_code_counter
  for each row execute function public.tg_seat_counter_audit();

-- 2) Tổng hợp -----------------------------------------------------------------
-- security invoker: RLS của seat_requests áp dụng – TA chỉ thấy số của mình, admin thấy tất cả.
-- Tháng = tháng của Ngày gửi; dòng chưa gửi tính theo ngày tạo (giờ Việt Nam).
create or replace function public.seat_summary(p_from date default null, p_to date default null)
returns table (thang text, ta text, vung text, status text, so_dong bigint, so_ghe bigint)
language sql stable security invoker set search_path = ''
as $$
  with s as (
    select to_char(coalesce(r.ngay_gui, (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date), 'YYYY-MM') as thang,
           coalesce(p.username, '') as ta, r.vung, r.status, r.so_luong,
           coalesce(r.ngay_gui, (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date) as d
      from public.seat_requests r
      left join public.profiles p on p.id = r.owner_id
  )
  select thang, ta, vung, status, count(*), sum(so_luong)::bigint
    from s
   where (p_from is null or d >= p_from) and (p_to is null or d <= p_to)
   group by thang, ta, vung, status
   order by thang desc, ta, vung, status
$$;
revoke all on function public.seat_summary(date, date) from public, anon;
grant execute on function public.seat_summary(date, date) to authenticated, service_role;

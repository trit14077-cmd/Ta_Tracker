-- 0015_ops_rpcs.sql – M6-1: Công việc, Phỏng vấn, Lịch, Target (thay Ops.gs: hListTasks_, hListInterviews_, hCalendar_,
-- hTargets_). Đọc qua RPC (gộp tên người dùng, thông tin hồ sơ, sắp xếp như hệ cũ); ghi thẳng bảng qua PostgREST (RLS 0005),
-- dữ liệu được kiểm bằng shared/opsRules (validateTask/Interview/Event) ở trình duyệt + ràng buộc dưới đây.
-- Quyền xem giữ RLS 0005: Admin tất cả; TA việc/sự kiện của mình hoặc gắn hồ sơ mình thấy; phỏng vấn theo hồ sơ;
-- target theo can_view_target (TARGET, G1).

-- ============ tên đăng nhập theo id (TA không đọc được profiles của người khác) ============
-- Đặt trong schema app (không mở ra API). Chỉ trả username – thứ hệ cũ vẫn hiện cho TA (người phụ trách việc…).
create or replace function app.username(p_id uuid)
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select p.username from public.profiles p where p.id = p_id), '') $$;
revoke all on function app.username(uuid) from public, anon;
grant execute on function app.username(uuid) to authenticated, service_role;

-- ============ ràng buộc + done_at tự động (hệ cũ: server đặt done_at khi chuyển sang xong) ============
alter table public.tasks add constraint tasks_status_chk check (status in ('open', 'done'));
alter table public.tasks add constraint tasks_title_chk check (length(btrim(title)) between 1 and 200);
alter table public.calendar_events add constraint calendar_events_title_chk check (length(btrim(title)) between 1 and 200);

create or replace function public.tg_task_done_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'done' then
    new.done_at := case when tg_op = 'UPDATE' and old.status = 'done' then old.done_at else coalesce(new.done_at, now()) end;
  else
    new.done_at := null;
  end if;
  return new;
end $$;
create trigger tasks_done_at before insert or update of status on public.tasks
  for each row execute function public.tg_task_done_at();

-- ============ quyền sửa / xóa như hệ cũ (PO chốt 20/11/2026) ============
-- Công việc (Ops.gs taskEditable_): Admin, người phụ trách, người tạo, hoặc TA có PIC = PIC của hồ sơ gắn việc.
alter policy tk_update on public.tasks
  using ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r
                                                where r.id = record_id and r.pic = (select app.my_pic()))))
  with check ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r
                                                where r.id = record_id and r.pic = (select app.my_pic()))));
alter policy tk_delete on public.tasks
  using ((select app.is_admin()) or owner_id = (select auth.uid()) or created_by = (select auth.uid())
         or (record_id is not null and exists (select 1 from public.recruitment_records r
                                                where r.id = record_id and r.pic = (select app.my_pic()))));
-- Phỏng vấn (Ops.gs hDeleteInterview_): chỉ người tạo hoặc Admin xóa.
alter policy is_delete on public.interview_schedules
  using (((select app.is_admin()) or created_by = (select auth.uid()))
         and exists (select 1 from public.recruitment_records r where r.id = record_id));

-- ============ nhật ký (Ops.gs audit_: TASK, INTERVIEW, TARGET) – PO chốt làm ngay ở M6-1 ============
-- 1 dòng audit_logs mỗi lần tạo / sửa / xóa, nội dung như hệ cũ, dạng changes = {khóa: {old, new}}.
-- SECURITY DEFINER vì người dùng không có quyền ghi audit_logs (chỉ RPC / trigger).
create or replace function public.tg_ops_audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  me public.profiles;
  v_code text := '';
  rec_id bigint;
  act text;
  fkey text;
  oldv text := '';
  newv text := '';
begin
  select * into me from public.profiles where id = auth.uid();
  if tg_table_name = 'tasks' then
    act := 'TASK'; fkey := 'task';
    if tg_op = 'INSERT' then
      rec_id := new.record_id;
      newv := 'Tạo việc: ' || new.title || ' (hạn ' || coalesce(new.due::text, '') || ', ' || app.username(new.owner_id) || ')';
    elsif tg_op = 'UPDATE' then
      rec_id := new.record_id;
      newv := case when new.status = 'done' then 'Xong: ' else 'Cập nhật việc: ' end || new.title;
    else
      rec_id := old.record_id;
      oldv := old.title;
    end if;
  elsif tg_table_name = 'interview_schedules' then
    act := 'INTERVIEW'; fkey := 'interview';
    if tg_op = 'INSERT' then
      rec_id := new.record_id;
      newv := 'Thêm phỏng vấn ' || case when new.round = 'Khác' then new.round_name else new.round end || ' ngày '
              || coalesce(new.date::text, '') || case when new.result <> '' then ' (' || new.result || ')' else '' end;
    elsif tg_op = 'UPDATE' then
      rec_id := new.record_id;
      newv := 'Sửa phỏng vấn ' || new.round || ' ngày ' || coalesce(new.date::text, '')
              || case when new.result <> '' then ' (' || new.result || ')' else '' end;
    else
      rec_id := old.record_id;
      oldv := old.round || ' ' || coalesce(old.date::text, '');
    end if;
  else
    act := 'TARGET';
    if tg_op = 'DELETE' then
      fkey := old.period_type || ' ' || old.period_key;
      oldv := old.value::text;
    else
      fkey := new.period_type || ' ' || new.period_key;
      oldv := case when tg_op = 'UPDATE' then old.value::text else '' end;
      newv := new.value::text || ' (' || concat_ws(' / ', coalesce(nullif(new.pic, ''), 'Tất cả TA'),
              coalesce(nullif(new.position, ''), 'mọi vị trí'), coalesce(nullif(new.dept, ''), 'mọi phòng ban')) || ')';
    end if;
  end if;
  if rec_id is not null then
    select candidate_code into v_code from public.recruitment_records where id = rec_id;
  end if;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (me.id, coalesce(me.username, 'system'), coalesce(me.role, 'system'), act, rec_id, coalesce(v_code, ''),
          jsonb_build_object(fkey, jsonb_build_object('old', oldv, 'new', newv)));
  return null;
end $$;
revoke all on function public.tg_ops_audit() from public, anon, authenticated;
create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function public.tg_ops_audit();
create trigger interview_schedules_audit after insert or update or delete on public.interview_schedules
  for each row execute function public.tg_ops_audit();
create trigger targets_audit after insert or update or delete on public.targets
  for each row execute function public.tg_ops_audit();

-- ============ list_tasks (= hListTasks_) ============
-- p_view: mine | upcoming | overdue | done | all. p_record_id: chỉ việc của 1 hồ sơ (mọi trạng thái).
-- Trả {tasks:[TaskItem…] (≤ 300), today}; TaskItem như hệ cũ: owner / created_by là username; candidate_* từ hồ sơ.
create or replace function public.list_tasks(p_view text default 'mine', p_record_id bigint default null, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with td as (select coalesce(p_today, public.rr_today()) as d),
  t as (
    select k.*, r.candidate_code, r.full_name, coalesce(r.pic, '') as pic
      from public.tasks k
      left join public.recruitment_records r on r.id = k.record_id
     cross join td
     where case
             when p_record_id is not null then k.record_id = p_record_id
             when coalesce(p_view, 'mine') = 'mine' then k.status <> 'done' and k.owner_id = (select auth.uid())
             when p_view = 'upcoming' then k.status <> 'done' and k.due >= td.d
             when p_view = 'overdue' then k.status <> 'done' and k.due < td.d
             when p_view = 'done' then k.status = 'done'
             else true
           end
  ), s as (
    select * from t
     order by case when p_view = 'done' and p_record_id is null then t.done_at end desc nulls last,
              t.due asc nulls last, coalesce(t.due_time, '') asc, t.id
     limit 300
  )
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'type', s.type, 'due', coalesce(s.due::text, ''), 'due_time', coalesce(s.due_time, ''),
        'priority', s.priority, 'status', s.status, 'owner', app.username(s.owner_id), 'note', s.note,
        'created_by', app.username(s.created_by), 'created_at', s.created_at, 'done_at', coalesce(s.done_at::text, ''),
        'candidate_id', coalesce(s.record_id, 0), 'candidate_code', coalesce(s.candidate_code, ''),
        'full_name', coalesce(s.full_name, ''), 'pic', s.pic)
        order by case when p_view = 'done' and p_record_id is null then s.done_at end desc nulls last,
                 s.due asc nulls last, coalesce(s.due_time, '') asc, s.id) from s), '[]'::jsonb),
    'today', (select d from td))
$$;

-- ============ list_interviews (= hListInterviews_) ============
-- {interviews: lịch sử phỏng vấn đã thêm, profile: R1/R2 ghi trên hồ sơ (chỉ đọc)}; hồ sơ không xem được -> null.
create or replace function public.list_interviews(p_record_id bigint)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select case when r.id is null then null else jsonb_build_object(
    'interviews', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'candidate_id', i.record_id, 'round', i.round, 'round_name', i.round_name,
        'date', coalesce(i.date::text, ''), 'time', coalesce(i.time, ''), 'interviewer', i.interviewer, 'result', i.result,
        'feedback', i.feedback, 'created_by', app.username(i.created_by), 'created_at', i.created_at, 'updated_at', i.updated_at,
        'source', 'history') order by coalesce(i.date::text, '') || coalesce(i.time, ''), i.id)
      from public.interview_schedules i where i.record_id = r.id), '[]'::jsonb),
    'profile', (select coalesce(jsonb_agg(x.o order by x.n), '[]'::jsonb) from (
        select 1 as n, jsonb_build_object('id', 0, 'candidate_id', r.id, 'round', 'R1', 'round_name', '',
                 'date', coalesce(r.r1_date::text, ''), 'time', r.r1_time, 'interviewer', '', 'result', r.r1_status,
                 'feedback', '', 'created_by', '', 'source', 'profile') as o
         where r.r1_date is not null or r.r1_status <> ''
        union all
        select 2, jsonb_build_object('id', 0, 'candidate_id', r.id, 'round', 'R2', 'round_name', '',
                 'date', coalesce(r.r2_date::text, ''), 'time', r.r2_time, 'interviewer', r.r2_interviewer, 'result', r.r2_status,
                 'feedback', '', 'created_by', '', 'source', 'profile')
         where r.r2_date is not null or r.r2_status <> '') x))
  end
  from (select 1) one
  left join public.recruitment_records r on r.id = p_record_id
$$;

-- ============ target_list (= hTargets_) ============
-- Kỳ do client tính bằng shared/opsRules.periodRange (p_from, p_to). Thực tế = OB Joined (theo OB date) trong kỳ, khớp
-- PIC / vị trí / phòng ban của target, trên TOÀN BỘ hồ sơ không lưu trữ (như hệ cũ: loadCands_ không lọc theo người xem).
-- Số thực tế đếm bằng hàm definer nhưng chỉ cho target người gọi được xem (can_view_target).
create or replace function public.rr_target_actual(p_pic text, p_position text, p_dept text, p_from date, p_to date)
returns int
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_view_target(p_pic) then
    raise exception 'Không có quyền xem target này' using errcode = '42501';
  end if;
  return (select count(*) from public.recruitment_records c
           where not c.is_archived and c.ob_status = 'Joined' and c.ob_date between p_from and p_to
             and (coalesce(p_pic, '') = '' or c.pic = p_pic)
             and (coalesce(p_position, '') = '' or c.position = p_position)
             and (coalesce(p_dept, '') = '' or c.dept = p_dept));
end $$;
revoke all on function public.rr_target_actual(text, text, text, date, date) from public, anon;
grant execute on function public.rr_target_actual(text, text, text, date, date) to authenticated, service_role;

create or replace function public.target_list(p_type text, p_key text, p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object('period_type', p_type, 'period_key', p_key, 'from', p_from, 'to', p_to,
    'targets', coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'period_type', x.period_type, 'period_key', x.period_key, 'pic', coalesce(x.pic, ''),
        'position', x.position, 'dept', x.dept, 'value', x.value, 'actual', x.actual,
        'pct', case when x.value > 0 then (round(x.actual::numeric * 1000 / x.value) / 10)::float8 end,
        'updated_by', app.username(x.updated_by), 'updated_at', x.updated_at)
        order by (coalesce(x.pic, '') || x.position || x.dept) collate "C"), '[]'::jsonb))
  from (
    select t.*, public.rr_target_actual(t.pic, t.position, t.dept, p_from, p_to) as actual
      from public.targets t
     where t.period_type = p_type and t.period_key = p_key
  ) x
$$;

-- ============ calendar_range (= hCalendar_) ============
-- Gộp: công việc (theo hạn), lịch sử phỏng vấn, ngày R1 / R2 / OB ghi trên hồ sơ (bỏ nếu đã có buổi phỏng vấn cùng vòng,
-- cùng ngày), sự kiện riêng. Tối đa 62 ngày, 2.000 mục. p_pic (chỉ Admin): chỉ mục của hồ sơ PIC đó, hoặc việc / sự kiện
-- không gắn hồ sơ của người dùng có PIC đó. people_per_pic: số ứng viên khác nhau có mục trong khoảng, theo PIC (trước lọc).
create or replace function public.calendar_range(p_from date, p_to date, p_pic text default '')
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_pic text := case when (select app.is_admin()) then btrim(coalesce(p_pic, '')) else '' end;
  res jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Khoảng ngày không hợp lệ.' using errcode = '22023';
  end if;
  if p_to > p_from + 62 then
    raise exception 'Mỗi lần xem tối đa 62 ngày.' using errcode = '22023';
  end if;
  with ev as (
    -- công việc
    select 'task-' || k.id as id, 'task' as kind, k.title, k.due as date, coalesce(k.due_time, '') as time, '' as end_time,
           k.status = 'done' as done, case when k.status = 'done' then 'Xong' else '' end as status,
           k.type || case when k.owner_id is not null then ' · ' || app.username(k.owner_id) else '' end as note,
           null::text as owner, k.owner_id as owner_id, k.record_id
      from public.tasks k where k.due between p_from and p_to
    union all
    -- lịch sử phỏng vấn
    select 'iv-' || i.id, 'interview', 'Phỏng vấn ' || case when i.round = 'Khác' then i.round_name else i.round end,
           i.date, coalesce(i.time, ''), '', i.result <> '' and i.result <> 'Pending', i.result, i.interviewer,
           null, null, i.record_id
      from public.interview_schedules i where i.date between p_from and p_to
    union all
    -- ngày R1 / R2 / OB trên hồ sơ (không lưu trữ)
    select x.kind || '-' || r.id, x.kind, x.title, x.d, x.t, '', x.st <> '' and x.st <> 'Pending', x.st, x.note, null, null, r.id
      from public.recruitment_records r
     cross join lateral (values
        ('r1', 'Phỏng vấn R1', r.r1_date, coalesce(r.r1_time, ''), r.r1_status, '', 'R1'),
        ('r2', 'Phỏng vấn R2', r.r2_date, coalesce(r.r2_time, ''), r.r2_status, r.r2_interviewer, 'R2'),
        ('ob', 'Onboard', r.ob_date, '', r.ob_status, '', 'Onboard')) as x(kind, title, d, t, st, note, round)
     where not r.is_archived and x.d between p_from and p_to
       and not exists (select 1 from public.interview_schedules i2
                        where i2.record_id = r.id and i2.round = x.round and i2.date = x.d)
    union all
    -- sự kiện riêng
    select 'ev-' || e.id, 'event', e.title, e.date, coalesce(e.time, ''), coalesce(e.end_time, ''), false, '',
           e.type || case when e.note <> '' then ' · ' || e.note else '' end,
           app.username(e.owner_id), e.owner_id, e.record_id
      from public.calendar_events e where e.date between p_from and p_to
  ), full_ev as (
    select ev.*, r.candidate_code, r.full_name, coalesce(r.pic, '') as rpic,
           (select p.pic_code from public.profiles p where p.id = ev.owner_id) as owner_pic
      from ev left join public.recruitment_records r on r.id = ev.record_id
  ), shown as (
    select * from full_ev f
     where v_pic = '' or (case when f.record_id is not null then f.rpic = v_pic else f.owner_pic = v_pic end)
     order by f.date, coalesce(nullif(f.time, ''), '99'), f.id
  ), ppl as (
    select rpic, count(distinct record_id) as n from full_ev where record_id is not null and rpic <> '' group by rpic
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'events', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', s.id, 'kind', s.kind, 'title', s.title, 'date', s.date, 'time', s.time, 'end_time', s.end_time,
        'done', s.done, 'status', s.status, 'note', s.note, 'owner', s.owner,
        'candidate_id', coalesce(s.record_id, 0), 'candidate_code', coalesce(s.candidate_code, ''),
        'full_name', coalesce(s.full_name, ''), 'pic', s.rpic)) order by s.date, coalesce(nullif(s.time, ''), '99'), s.id)
      from (select * from shown limit 2000) s), '[]'::jsonb),
    'truncated', (select count(*) > 2000 from shown),
    'people_per_pic', coalesce((select jsonb_object_agg(rpic, n) from ppl), '{}'::jsonb),
    'people_total', (select count(distinct record_id) from full_ev where record_id is not null and rpic <> ''))
  into res;
  return res;
end $$;

-- ============ quyền ============
revoke all on function public.list_tasks(text, bigint, date), public.list_interviews(bigint), public.target_list(text, text, date, date),
  public.calendar_range(date, date, text), public.tg_task_done_at() from public, anon;
grant execute on function public.list_tasks(text, bigint, date), public.list_interviews(bigint), public.target_list(text, text, date, date),
  public.calendar_range(date, date, text) to authenticated, service_role;

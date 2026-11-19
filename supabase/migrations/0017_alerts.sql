-- 0017_alerts.sql – M6-3: chuông nhắc việc (Ops.gs hAlerts_; giao diện AlertsBell).
--   overdue / due_soon : công việc chưa xong quá hạn / hạn hôm nay–ngày mai (TA: việc mình phụ trách; Admin: mọi việc)
--   passed_no_hr       : hồ sơ (không lưu trữ) giai đoạn Passed / Offer mà HR Info chưa "verified"
--   missing_docs       : hồ sơ giai đoạn Offer còn thiếu giấy tờ bắt buộc (requiredDocuments), kèm tên giấy tờ thiếu
-- Mỗi danh sách tối đa 20 mục + tổng số. Phạm vi hồ sơ theo RLS (Admin tất cả, TA hồ sơ PIC mình) như scopedCands_.

-- Biểu thức giai đoạn (alias r = recruitment_records), GIỐNG HỆT shared/stage.ts currentStage(). Chép thành chữ để chạy
-- trong SQL động (gọi hàm theo từng dòng chậm – xem 0014). Đối chiếu golden: supabase/tests/alerts_test.sql.
create or replace function public.rr_stage_sql()
returns text language sql immutable set search_path = ''
as $$
  select $s$(case
    when btrim(r.ob_status) = 'Joined' then 'Hired'
    when btrim(r.ob_status) in ('Noshow', 'Canceled') then 'Rejected'
    when btrim(r.ob_status) <> '' or r.ob_date is not null then 'Offer'
    when btrim(r.r2_status) = 'Passed' then 'Passed'
    when btrim(r.r2_status) in ('Failed', 'Canceled') then 'Rejected'
    when btrim(r.r2_status) in ('KIV', 'Không liên lạc được') then 'On Hold'
    when btrim(r.r2_status) = 'Pending' then 'Evaluation'
    when r.r2_date is not null then 'Interview'
    when btrim(r.r1_status) = 'Failed' then 'Rejected'
    when btrim(r.r1_status) in ('KIV', 'Không liên lạc được') then 'On Hold'
    when btrim(r.r1_status) = 'Passed' then 'Interview'
    when btrim(r.r1_status) = 'Pending' or r.r1_date is not null then 'Screening'
    else 'New' end)$s$
$$;

-- Giấy tờ bắt buộc còn thiếu (= requiredDocuments + kiểm ô trống), dạng mảng tên hiển thị theo fieldCatalog.
create or replace function public.rr_missing_docs_sql()
returns text language sql immutable set search_path = ''
as $$
  select $s$(array_remove(array[
    case when (btrim(r.rank) ~ '^6' or r.position ~* '(lái xe nâng|forklift|reach\s?truck|read\s?truck)') and btrim(r.health_check) = '' then 'Health check' end,
    case when (btrim(r.rank) ~ '^6' or r.position ~* '(lái xe nâng|forklift|reach\s?truck|read\s?truck)') and btrim(r.id_card) = '' then 'ID Card' end,
    case when r.position ~* '(lái xe nâng|forklift|reach\s?truck|read\s?truck)' and btrim(r.forklift_cert) = '' then 'Chứng chỉ lái xe nâng' end
  ], null))$s$
$$;

create or replace function public.alerts(p_today date default null)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  td date := coalesce(p_today, public.rr_today());
  res jsonb;
begin
  execute format($q$
    with tk as (
      select k.*, r.candidate_code, r.full_name, coalesce(r.pic, '') as pic
        from public.tasks k left join public.recruitment_records r on r.id = k.record_id
       where k.status <> 'done' and k.due <= $1 + 1
         and ((select app.is_admin()) or k.owner_id = (select auth.uid()))
    ), tko as (
      select jsonb_build_object('id', id, 'title', title, 'type', type, 'due', coalesce(due::text, ''), 'due_time', coalesce(due_time, ''),
               'priority', priority, 'status', status, 'owner', app.username(owner_id), 'note', note,
               'created_by', app.username(created_by), 'created_at', created_at, 'done_at', '',
               'candidate_id', coalesce(record_id, 0), 'candidate_code', coalesce(candidate_code, ''),
               'full_name', coalesce(full_name, ''), 'pic', pic) as o,
             due < $1 as overdue, due, coalesce(due_time, '') as tm, id
        from tk
    ), c as (
      select r.id, r.candidate_code, r.full_name, coalesce(r.pic, '') as pic, %1$s as stage, %2$s as missing
        from public.recruitment_records r
       where not r.is_archived and r.ob_status not in ('Joined', 'Noshow', 'Canceled')
         and (btrim(r.r2_status) = 'Passed' or btrim(r.ob_status) <> '' or r.ob_date is not null)
    ), nohr as (
      select c.* from c
       where c.stage in ('Passed', 'Offer')
         and not exists (select 1 from public.hr_info h where h.record_id = c.id and h.status = 'verified')
    ), md as (
      select c.* from c where c.stage = 'Offer' and cardinality(c.missing) > 0
    )
    select jsonb_build_object(
      'counts', jsonb_build_object(
        'overdue', (select count(*) from tko where overdue),
        'due_soon', (select count(*) from tko where not overdue),
        'passed_no_hr', (select count(*) from nohr),
        'missing_docs', (select count(*) from md)),
      'overdue', coalesce((select jsonb_agg(o order by due, tm, id) from (select * from tko where overdue order by due, tm, id limit 20) x), '[]'::jsonb),
      'due_soon', coalesce((select jsonb_agg(o order by due, tm, id) from (select * from tko where not overdue order by due, tm, id limit 20) x), '[]'::jsonb),
      'passed_no_hr', coalesce((select jsonb_agg(jsonb_build_object('candidate_id', id, 'candidate_code', candidate_code,
                                  'full_name', full_name, 'pic', pic) order by id) from (select * from nohr order by id limit 20) x), '[]'::jsonb),
      'missing_docs', coalesce((select jsonb_agg(jsonb_build_object('candidate_id', id, 'candidate_code', candidate_code,
                                  'full_name', full_name, 'pic', pic, 'detail', array_to_string(missing, ', ')) order by id)
                                  from (select * from md order by id limit 20) x), '[]'::jsonb),
      'today', $1)
  $q$, public.rr_stage_sql(), public.rr_missing_docs_sql()) into res using td;
  return res;
end $$;

revoke all on function public.rr_stage_sql(), public.rr_missing_docs_sql(), public.alerts(date) from public, anon;
grant execute on function public.rr_stage_sql(), public.rr_missing_docs_sql(), public.alerts(date) to authenticated, service_role;

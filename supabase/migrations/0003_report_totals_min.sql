create or replace function public.report_totals(p_from date default null, p_to date default null)
returns table(leads bigint, r1_passed bigint, r2_passed bigint, ob_joined bigint, emp_active bigint, emp_resigned bigint)
language sql stable security invoker set search_path = ''
as $$
  select count(*),
         count(*) filter (where r1_status='Passed'),
         count(*) filter (where r2_status='Passed'),
         count(*) filter (where ob_status='Joined'),
         count(*) filter (where emp_status='Active'),
         count(*) filter (where emp_status='Resigned')
  from public.recruitment_records
  where not is_archived
    and (p_from is null or created_at::date >= p_from)
    and (p_to   is null or created_at::date <= p_to)
$$;
revoke all on function public.report_totals(date,date) from public, anon;
grant execute on function public.report_totals(date,date) to authenticated;

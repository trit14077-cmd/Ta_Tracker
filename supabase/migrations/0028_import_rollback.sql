-- 0028_import_rollback.sql – M7-4: hoàn tác (rollback) theo lô nhập Excel. PO chốt 22/11/2026 (phương án a):
--   * chỉ Admin; chỉ lô nhập Excel (import_batches.source = 'excel') – KHÔNG BAO GIỜ đụng lô ETL 'etl:*' (M8);
--   * chỉ gỡ hồ sơ CHƯA bị đụng sau khi nhập: row_version = 1 (mọi thao tác sửa/kéo/lưu trữ/đính kèm đều tăng version)
--     và chưa có dữ liệu con (lịch sử vòng, lịch PV, bình luận, công việc, checklist tuyển, sự kiện lịch, HR info,
--     gửi form HR, file, bản dịch, đơn ứng tuyển đã gắn). Hồ sơ còn lại được GIỮ và báo lý do (EDITED / HAS_DATA);
--   * trước khi xóa ghi bản chụp đầy đủ hồ sơ vào audit_logs (action IMPORT_ROLLBACK) để có thể khôi phục tay;
--   * chạy thử (p_dry_run) trả đúng kết quả sẽ xảy ra mà không xóa gì.
-- Ghi qua Edge records-import (service_role) như import_records/import_finish.

alter table public.import_batches add column if not exists rolled_back_at timestamptz;
alter table public.import_batches add column if not exists rolled_back_by uuid references public.profiles(id);

-- ============ lý do giữ lại 1 hồ sơ của lô (null = gỡ được) ============
create or replace function app.import_keep_reason(p_id bigint, p_row_version int) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when p_row_version <> 1 then 'EDITED'
    when exists (select 1 from public.status_history       where record_id = p_id)
      or exists (select 1 from public.interview_schedules  where record_id = p_id)
      or exists (select 1 from public.comments             where record_id = p_id)
      or exists (select 1 from public.tasks                where record_id = p_id)
      or exists (select 1 from public.hiring_checklists    where record_id = p_id)
      or exists (select 1 from public.calendar_events      where record_id = p_id)
      or exists (select 1 from public.hr_info              where record_id = p_id)
      or exists (select 1 from public.hr_form_sends        where record_id = p_id)
      or exists (select 1 from public.record_files         where record_id = p_id)
      or exists (select 1 from public.translations         where record_id = p_id)
      or exists (select 1 from public.applications         where record_id = p_id)
      then 'HAS_DATA'
  end
$$;
revoke all on function app.import_keep_reason(bigint, int) from public, anon, authenticated;

-- ============ danh sách lô nhập Excel (mới nhất trước) ============
-- Trả [{id, created_at, created_by, note, row_count, remaining, removable, rolled_back_at, rolled_back_by}]
create or replace function public.import_batch_list(p_actor uuid, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
begin
  if v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được hoàn tác lô nhập.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'created_at', b.created_at, 'created_by', coalesce(pc.username, ''), 'note', b.note,
             'row_count', b.row_count, 'remaining', s.remaining, 'removable', s.removable,
             'rolled_back_at', b.rolled_back_at, 'rolled_back_by', coalesce(pr.username, ''))
           order by b.id desc)
      from (select * from public.import_batches where source = 'excel'
             order by id desc limit least(200, greatest(1, coalesce(p_limit, 50)))) b
      left join public.profiles pc on pc.id = b.created_by
      left join public.profiles pr on pr.id = b.rolled_back_by
      cross join lateral (
        select count(*)::int as remaining,
               count(*) filter (where app.import_keep_reason(r.id, r.row_version) is null)::int as removable
          from public.recruitment_records r where r.import_batch_id = b.id) s
  ), '[]'::jsonb);
end $$;
revoke all on function public.import_batch_list(uuid, int) from public, anon, authenticated;
grant execute on function public.import_batch_list(uuid, int) to service_role;

-- ============ hoàn tác 1 lô ============
-- Trả {batch_id, dry_run, removed, kept_count, kept:[{id, candidate_code, full_name, reason}] (≤ 500)}
create or replace function public.import_rollback(p_actor uuid, p_batch_id bigint, p_dry_run boolean default true)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  v_batch public.import_batches;
  v_removed int := 0;
  v_kept_count int := 0;
  v_kept jsonb := '[]'::jsonb;
  v_note text;
  v_app bigint;
  r record;
begin
  if v_actor.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được hoàn tác lô nhập.';
  end if;
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy lô nhập.';
  end if;
  if v_batch.source <> 'excel' then
    raise exception 'INVALID_OP' using errcode = 'PT422', detail = 'Chỉ hoàn tác được lô nhập Excel (không phải lô chuyển dữ liệu).';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('import', 0));   -- không chạy song song với import_records

  -- khóa các dòng của lô: người khác đang sửa phải chờ; sửa xong (version tăng) thì dòng đó được giữ lại
  for r in
    select x.id, x.candidate_code, x.full_name, app.import_keep_reason(x.id, x.row_version) as reason
      from (select * from public.recruitment_records where import_batch_id = p_batch_id order by id for update) x
  loop
    if r.reason is not null then
      v_kept_count := v_kept_count + 1;
      if v_kept_count <= 500 then
        v_kept := v_kept || jsonb_build_array(jsonb_build_object('id', r.id, 'candidate_code', r.candidate_code,
                                                                 'full_name', coalesce(r.full_name, ''), 'reason', r.reason));
      end if;
      continue;
    end if;
    if not coalesce(p_dry_run, true) then
      insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
      select v_actor.id, v_actor.username, v_actor.role, 'IMPORT_ROLLBACK', rr.id, rr.candidate_code,
             jsonb_build_object('ALL', jsonb_build_object('old', to_jsonb(rr), 'new', 'Hoàn tác lô nhập #' || p_batch_id))
        from public.recruitment_records rr where rr.id = r.id;
      delete from public.recruitment_records where id = r.id returning applicant_id into v_app;
      -- applicant do link_applicant tạo lúc nhập: xóa nếu không còn hồ sơ nào dùng chung (không để sót SĐT/tên mồ côi)
      if v_app is not null then
        delete from public.applicants a
         where a.id = v_app and not exists (select 1 from public.recruitment_records x where x.applicant_id = v_app);
      end if;
    end if;
    v_removed := v_removed + 1;
  end loop;

  if not coalesce(p_dry_run, true) then
    v_note := 'Hoàn tác lô nhập #' || p_batch_id || ': gỡ ' || v_removed || ' hồ sơ, giữ lại ' || v_kept_count
              || ' hồ sơ đã được sửa hoặc có dữ liệu kèm theo.';
    update public.import_batches
       set rolled_back_at = now(), rolled_back_by = v_actor.id,
           note = case when note = '' then v_note else note || ' | ' || v_note end
     where id = p_batch_id;
    insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
    values (v_actor.id, v_actor.username, v_actor.role, 'IMPORT_ROLLBACK', null, '',
            jsonb_build_object('BATCH', jsonb_build_object('old', '', 'new', v_note)));
  end if;

  return jsonb_build_object('batch_id', p_batch_id, 'dry_run', coalesce(p_dry_run, true), 'removed', v_removed,
                            'kept_count', v_kept_count, 'kept', v_kept);
end $$;
revoke all on function public.import_rollback(uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function public.import_rollback(uuid, bigint, boolean) to service_role;

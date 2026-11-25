-- M7-3b: form ứng tuyển có "Vị trí ứng tuyển" (chọn từ dropdown 'position') và nhãn TA trên tên file CV.
-- Nhãn TA = mã PIC của link (VD TA3-Thang); link chung (không có TA) = 'Admin'. Nhãn KHÔNG hiện cho ứng viên.

alter table public.applications add column if not exists position text not null default '';

-- apply_info: thêm nhãn TA (pic_label) và danh sách vị trí (positions) cho Edge; giữ nguyên 'regions'
create or replace function public.apply_info(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_pic text;
begin
  if v_code = '' then
    v_pic := '';
  elsif v_code !~ '^[A-Za-z0-9]{12,40}$' then
    return jsonb_build_object('valid', false);
  else
    select l.pic into v_pic from public.apply_links l
     where l.code = v_code and (l.pic = '' or exists (select 1 from public.pics p where p.code = l.pic and p.active));
    if v_pic is null then return jsonb_build_object('valid', false); end if;
  end if;
  return jsonb_build_object('valid', true, 'pic', v_pic,
    'pic_label', case when v_pic = '' then 'Admin' else v_pic end,
    'positions', coalesce((select jsonb_agg(o.value order by o.sort_order, o.value)
                             from public.dropdown_options o where o.list_key = 'position' and o.active), '[]'::jsonb),
    'regions', coalesce((
    select jsonb_agg(jsonb_build_object('region', g.value, 'locations', g.locs) order by g.sort_order, g.value)
      from (select o.value, o.sort_order,
                   (select jsonb_agg(l.value order by l.sort_order, l.value)
                      from public.hierarchy h join public.dropdown_options l on l.list_key = 'location' and l.value = h.child_value and l.active
                     where h.parent_type = 'region' and h.parent_value = o.value) as locs
              from public.dropdown_options o where o.list_key = 'region' and o.active) g
     where g.locs is not null), '[]'::jsonb));
end $$;
revoke all on function public.apply_info(text) from public, anon, authenticated;
grant execute on function public.apply_info(text) to service_role;

-- apply_insert: thêm p_position (sau p_area). Đổi chữ ký => bỏ hàm cũ rồi tạo lại + cấp quyền lại.
drop function if exists public.apply_insert(text, text, text, text, text, text, text, text, text);
create or replace function public.apply_insert(p_pic text, p_full_name text, p_phone text, p_email text, p_area text, p_position text,
                                               p_note text, p_cv_drive_id text, p_cv_name text, p_ip text)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.applications (pic, full_name, phone, email, area, position, note, cv_drive_file_id, cv_file_name, consent_at, status)
  values (nullif(p_pic, ''), p_full_name, p_phone, coalesce(p_email, ''), coalesce(p_area, ''), coalesce(p_position, ''), coalesce(p_note, ''),
          nullif(p_cv_drive_id, ''), coalesce(p_cv_name, ''), now(), 'new')
  returning id into v_id;
  insert into public.rate_limits (bucket, key, window_start, hits) values ('apply_phone', p_phone, now(), 1) on conflict do nothing;
  insert into public.rate_limits (bucket, key, window_start, hits) values ('apply_link', coalesce(p_pic, ''), date_trunc('hour', now()), 1)
    on conflict (bucket, key, window_start) do update set hits = public.rate_limits.hits + 1;
  if coalesce(p_ip, '') <> '' then
    insert into public.rate_limits (bucket, key, window_start, hits) values ('apply_ip', p_ip, date_trunc('hour', now()), 1)
      on conflict (bucket, key, window_start) do update set hits = public.rate_limits.hits + 1;
  end if;
  delete from public.rate_limits where bucket like 'apply\_%' and window_start < now() - interval '1 day';
  return v_id;
end $$;
revoke all on function public.apply_insert(text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_insert(text, text, text, text, text, text, text, text, text, text) to service_role;

-- app_json: thêm 'position' vào hộp thư của TA/Admin (phần còn lại giữ nguyên 0024)
create or replace function app.app_json(a public.applications) returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'key', a.id::text, 'created_at', a.created_at, 'pic', coalesce(a.pic, ''),
    'full_name', a.full_name, 'phone', a.phone, 'email', a.email, 'area', a.area, 'position', a.position, 'note', a.note,
    'cv_name', case when coalesce(a.cv_drive_file_id, '') <> '' then coalesce(nullif(a.cv_file_name, ''), 'CV') else '' end,
    'status', app.app_status_ui(a.status),
    'candidate_code', coalesce((select r.candidate_code from public.recruitment_records r where r.id = a.record_id), ''),
    'handled_by', coalesce((select p.username from public.profiles p where p.id = a.handled_by), ''),
    'handled_at', coalesce(a.handled_at::text, ''),
    -- cùng SĐT đã có trong danh sách ứng viên (cùng luật danh sách: cùng SĐT = cùng người). TA chỉ thấy mã hồ sơ của mình.
    'dup', (select case when count(*) = 0 then null
                        when app.is_admin() then jsonb_build_object('count', count(*),
                               'codes', jsonb_agg(r.candidate_code || case when coalesce(r.pic, '') <> '' then ' (' || r.pic || ')' else '' end order by r.id))
                        else jsonb_build_object('count', count(*),
                               'codes', coalesce(jsonb_agg(r.candidate_code order by r.id) filter (where r.pic is not null and r.pic = app.my_pic()), '[]'::jsonb)) end
              from public.recruitment_records r where r.phone = a.phone and a.phone <> '' and not r.is_archived))
$$;
revoke all on function app.app_json(public.applications) from public, anon;

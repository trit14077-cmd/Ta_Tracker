-- 0024_applications.sql – M7-3: form ứng tuyển công khai + hộp "Ứng tuyển online" (Apply.gs, PublicApplyForm, ApplicationsInbox).
-- Như hệ cũ:
--  - Mỗi TA có link riêng (hồ sơ gửi qua link tự gán cho TA đó), Admin có link chung (chưa gán TA). Mã link không đoán được:
--    hệ cũ ký HMAC; hệ mới sinh ngẫu nhiên và lưu ở apply_links (không cần thêm bí mật). Mở trang không kèm mã = link chung.
--  - Hồ sơ gửi về CHƯA là ứng viên (form không có vị trí/kho): TA bấm "Tạo hồ sơ", lưu xong thì đánh dấu đã tạo và gắn CV.
--  - Chống spam: honeypot (Edge), 1 lần/SĐT/10 phút (lần sau báo đã nhận, không lưu), tối đa N hồ sơ/giờ/link (N = 600 như
--    hệ cũ, Edge đổi được bằng APPLY_MAX_PER_HOUR), thêm giới hạn theo IP (API_SPEC §4.3).
-- Trạng thái trong bảng giữ new/converted/ignored (0005); giao diện dùng new/done/skipped như hệ cũ (đổi ở RPC).

alter table public.applications add column if not exists cv_file_name text not null default '';

create table if not exists public.apply_links (
  pic text primary key,               -- '' = link chung của Admin
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.apply_links enable row level security;   -- không policy: chỉ qua hàm definer
revoke all on public.apply_links from anon, authenticated;

create or replace function app.app_status_ui(s text) returns text language sql immutable set search_path = ''
as $$ select case s when 'converted' then 'done' when 'ignored' then 'skipped' else 'new' end $$;

create or replace function app.can_see_app(p_pic text) returns boolean language sql stable security definer set search_path = ''
as $$ select app.is_admin() or (p_pic is not null and p_pic <> '' and p_pic = app.my_pic()) $$;

-- mã link của 1 PIC ('' = chung); tạo nếu chưa có
create or replace function app.apply_code(p_pic text) returns text language plpgsql volatile security definer set search_path = ''
as $$
declare v text;
begin
  select code into v from public.apply_links where pic = coalesce(p_pic, '');
  if v is null then
    insert into public.apply_links (pic, code) values (coalesce(p_pic, ''), left(replace(gen_random_uuid()::text, '-', ''), 20))
    on conflict (pic) do nothing;
    select code into v from public.apply_links where pic = coalesce(p_pic, '');
  end if;
  return v;
end $$;
revoke all on function app.apply_code(text) from public, anon, authenticated;

create or replace function app.apply_page_url() returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select value ->> 'url' from public.app_settings where key = 'apply_page'), '') $$;

-- ============ nhân viên ============

-- link để gửi ứng viên: Admin lấy của TA bất kỳ ('' = chung); TA chỉ của mình. Trình duyệt ghép địa chỉ trang + ?apply=<code>.
create or replace function public.apply_link(p_pic text default '')
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pic text := btrim(coalesce(p_pic, ''));
begin
  if not app.is_admin() then
    v_pic := coalesce(app.my_pic(), '');
    if v_pic = '' then
      raise exception 'NO_PIC' using errcode = 'PT403', detail = 'Tài khoản chưa gán mã PIC nên chưa có link ứng tuyển.';
    end if;
  end if;
  if v_pic <> '' and not exists (select 1 from public.pics where code = v_pic) then
    raise exception 'BAD_PIC' using errcode = 'PT400', detail = 'Mã PIC không có trong danh mục.';
  end if;
  return jsonb_build_object('pic', v_pic, 'code', app.apply_code(v_pic), 'page_url', app.apply_page_url());
end $$;
revoke all on function public.apply_link(text) from public, anon;
grant execute on function public.apply_link(text) to authenticated;

-- Admin: địa chỉ trang tuyển dụng trên tên miền công ty ('' = trang đi kèm app)
create or replace function public.apply_set_page_url(p_url text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_old text := app.apply_page_url();
  v_me public.profiles := app.require_admin();
begin
  if v_url <> '' and (v_url !~* '^https://[^\s"''<>]+$' or length(v_url) > 200) then
    raise exception 'BAD_URL' using errcode = 'PT400', detail = 'Địa chỉ phải bắt đầu bằng https:// (VD: https://tuyendung.thesupra.vn/).';
  end if;
  if v_url = '' then
    delete from public.app_settings where key = 'apply_page';
  else
    insert into public.app_settings (key, value, sensitive, updated_by, updated_at)
    values ('apply_page', jsonb_build_object('url', v_url), false, v_me.id, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  perform app.audit(v_me, 'APPLICATION', 'page_url', v_old, v_url);
  return jsonb_build_object('page_url', v_url);
end $$;
revoke all on function public.apply_set_page_url(text) from public, anon;
grant execute on function public.apply_set_page_url(text) to authenticated;

create or replace function app.app_json(a public.applications) returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'key', a.id::text, 'created_at', a.created_at, 'pic', coalesce(a.pic, ''),
    'full_name', a.full_name, 'phone', a.phone, 'email', a.email, 'area', a.area, 'note', a.note,
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

-- hộp thư: mới nhất trước, tối đa 300; p_count_only: chỉ đếm (số trên nút)
create or replace function public.applications_list(p_status text default 'new', p_pic text default '', p_count_only boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin boolean := app.is_admin();
  v_pic text := case when app.is_admin() then btrim(coalesce(p_pic, '')) else '' end;
  v_status text := coalesce(nullif(p_status, ''), 'new');
  v_counts jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active) then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Tài khoản không tồn tại hoặc đã bị khóa.';
  end if;
  select jsonb_build_object('new', count(*) filter (where status = 'new'), 'done', count(*) filter (where status = 'converted'),
                            'skipped', count(*) filter (where status = 'ignored'), 'all', count(*))
    into v_counts
    from public.applications a where app.can_see_app(a.pic) and (v_pic = '' or a.pic = v_pic);
  if p_count_only then return jsonb_build_object('counts', v_counts); end if;
  return jsonb_build_object(
    'counts', v_counts,
    'page_url', case when v_admin then app.apply_page_url() else null end,
    'items', coalesce((select jsonb_agg(app.app_json(x) order by x.id desc) from (
        select a.* from public.applications a
         where app.can_see_app(a.pic) and (v_pic = '' or a.pic = v_pic)
           and (v_status = 'all' or app.app_status_ui(a.status) = v_status)
         order by a.id desc limit 300) x), '[]'::jsonb));
end $$;
revoke all on function public.applications_list(text, text, boolean) from public, anon;
grant execute on function public.applications_list(text, text, boolean) to authenticated;

-- Bỏ qua / đưa lại vào Mới
create or replace function public.application_set_status(p_id bigint, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.applications;
  v_me public.profiles;
  v_before text;
begin
  if p_status not in ('new', 'skipped') then
    raise exception 'BAD_STATUS' using errcode = 'PT400', detail = 'Trạng thái không hợp lệ.';
  end if;
  select * into v_me from public.profiles where id = auth.uid() and active;
  select * into a from public.applications where id = p_id for update;
  if v_me.id is null or a.id is null or not app.can_see_app(a.pic) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng tuyển.';
  end if;
  v_before := app.app_status_ui(a.status);
  update public.applications
     set status = case p_status when 'skipped' then 'ignored' else 'new' end,
         handled_by = case when p_status = 'new' then null else v_me.id end,
         handled_at = case when p_status = 'new' then null else now() end,
         record_id = case when p_status = 'new' then null else record_id end
   where id = p_id returning * into a;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_me.id, v_me.username, v_me.role, 'APPLICATION', null, '',
          jsonb_build_object('application#' || p_id, jsonb_build_object('old', v_before, 'new', p_status)));
  return app.app_json(a);
end $$;
revoke all on function public.application_set_status(bigint, text) from public, anon;
grant execute on function public.application_set_status(bigint, text) to authenticated;

-- TA vừa tạo hồ sơ từ hồ sơ ứng tuyển: đánh dấu đã tạo + gắn CV ứng viên gửi khi hồ sơ chưa có CV (= hConvertApplication_)
create or replace function public.application_convert(p_id bigint, p_record_id bigint)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  a public.applications;
  r public.recruitment_records;
  v_me public.profiles;
  v_cv boolean := false;
begin
  select * into v_me from public.profiles where id = auth.uid() and active;
  select * into a from public.applications where id = p_id for update;
  if v_me.id is null or a.id is null or not app.can_see_app(a.pic) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng tuyển.';
  end if;
  select * into r from public.recruitment_records where id = p_record_id;
  if r.id is null or not (v_me.role = 'admin' or (coalesce(r.pic, '') <> '' and r.pic = v_me.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng viên.';
  end if;
  if coalesce(a.cv_drive_file_id, '') <> ''
     and not exists (select 1 from public.record_files where record_id = r.id and kind = 'cv' and deleted_at is null) then
    insert into public.record_files (record_id, kind, drive_file_id, file_name, uploaded_by)
    values (r.id, 'cv', a.cv_drive_file_id, coalesce(nullif(a.cv_file_name, ''), 'CV'), v_me.id);
    v_cv := true;
  end if;
  update public.applications set status = 'converted', record_id = r.id, handled_by = v_me.id, handled_at = now()
   where id = p_id returning * into a;
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (v_me.id, v_me.username, v_me.role, 'APPLICATION', r.id, r.candidate_code,
          jsonb_build_object('application#' || p_id, jsonb_build_object('old', 'new',
            'new', 'Tạo hồ sơ từ form ứng tuyển online' || case when v_cv then ' (kèm CV)' else '' end)));
  return jsonb_build_object('application', app.app_json(a), 'cv_attached', v_cv);
end $$;
revoke all on function public.application_convert(bigint, bigint) from public, anon;
grant execute on function public.application_convert(bigint, bigint) to authenticated;

-- CV ứng viên gửi (Edge `files` tải từ Drive)
create or replace function public.application_cv(p_actor uuid, p_id bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor public.profiles := public.rpc_actor(p_actor);
  a public.applications;
begin
  select * into a from public.applications where id = p_id;
  if a.id is null or not (v_actor.role = 'admin' or (coalesce(a.pic, '') <> '' and a.pic = v_actor.pic_code)) then
    raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy hồ sơ ứng tuyển.';
  end if;
  if coalesce(a.cv_drive_file_id, '') = '' then
    raise exception 'NO_CV' using errcode = 'PT404', detail = 'Hồ sơ này không kèm CV.';
  end if;
  return jsonb_build_object('drive_file_id', a.cv_drive_file_id, 'file_name', coalesce(nullif(a.cv_file_name, ''), 'CV'));
end $$;
revoke all on function public.application_cv(uuid, bigint) from public, anon, authenticated;
grant execute on function public.application_cv(uuid, bigint) to service_role;

-- ============ công khai (chỉ Edge `apply`, service_role) ============

-- mã link -> PIC ('' = chung) hoặc null khi mã sai / PIC đã tắt; kèm khu vực + tỉnh đang tuyển (chỉ tên địa điểm)
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
  return jsonb_build_object('valid', true, 'pic', v_pic, 'regions', coalesce((
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

-- trước khi tải CV: 'ok' | 'repeated' (SĐT vừa gửi < 10 phút: báo đã nhận, không lưu) | 'limited' (quá N/giờ/link hoặc IP)
create or replace function public.apply_gate(p_pic text, p_phone text, p_ip text, p_max_per_hour int, p_max_per_ip int)
returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.rate_limits where bucket = 'apply_phone' and key = p_phone and window_start > now() - interval '10 minutes') then
    return 'repeated';
  end if;
  if coalesce((select hits from public.rate_limits where bucket = 'apply_link' and key = coalesce(p_pic, '')
                and window_start = date_trunc('hour', now())), 0) >= p_max_per_hour then
    return 'limited';
  end if;
  if coalesce(p_ip, '') <> '' and coalesce((select hits from public.rate_limits where bucket = 'apply_ip' and key = p_ip
                and window_start = date_trunc('hour', now())), 0) >= p_max_per_ip then
    return 'limited';
  end if;
  return 'ok';
end $$;
revoke all on function public.apply_gate(text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.apply_gate(text, text, text, int, int) to service_role;

-- lưu 1 hồ sơ ứng tuyển (đã kiểm ở Edge) + ghi lượt đếm chống spam
create or replace function public.apply_insert(p_pic text, p_full_name text, p_phone text, p_email text, p_area text, p_note text,
                                               p_cv_drive_id text, p_cv_name text, p_ip text)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.applications (pic, full_name, phone, email, area, note, cv_drive_file_id, cv_file_name, consent_at, status)
  values (nullif(p_pic, ''), p_full_name, p_phone, coalesce(p_email, ''), coalesce(p_area, ''), coalesce(p_note, ''),
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
revoke all on function public.apply_insert(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_insert(text, text, text, text, text, text, text, text, text) to service_role;

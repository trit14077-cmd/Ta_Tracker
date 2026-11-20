-- 0020_admin_catalog.sql – M7-6: quản trị Drop-list, đề xuất giá trị, View đã lưu (Api2.gs: hAddOption_, hPatchOption_,
-- hPutSubSource_, hPutHierarchy_, hReviewRequest_, hCreateView_ / hPatchView_ / hDeleteView_).
-- Mỗi thao tác 1 giao dịch (hệ cũ: mutate_ + khóa), CHỈ Admin, nhật ký DROPDOWN / VIEW cùng câu chữ hệ cũ.
-- Như hệ cũ: đổi tên 1 giá trị => đổi luôn trên mọi hồ sơ đang dùng (cột lấy theo fieldCatalog.dropdownListKey, do trình
-- duyệt gửi, được kiểm trong rr_writable_columns), trên bảng ánh xạ Sub_Source và phân cấp Region → Location → Site;
-- đổi ánh xạ Sub_Source → Source tính lại cột Source của hồ sơ. Hệ mới tăng row_version các hồ sơ bị đổi để màn hình đang
-- mở không ghi đè giá trị cũ. Danh mục PIC nằm ở bảng pics (đổi mã tự lan sang hồ sơ / tài khoản / target nhờ FK cascade).

-- ============ tiện ích nội bộ (không ai ngoài các hàm dưới gọi được) ============
create or replace function app.require_admin() returns public.profiles
language plpgsql stable security definer set search_path = ''
as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and active;
  if me.id is null or me.role <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403', detail = 'Chỉ Admin được thực hiện thao tác này.';
  end if;
  return me;
end $$;
revoke all on function app.require_admin() from public, anon;
grant execute on function app.require_admin() to authenticated;

create or replace function app.audit(p_me public.profiles, p_action text, p_key text, p_old text, p_new text) returns void
language sql volatile security definer set search_path = ''
as $$
  insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
  values (p_me.id, p_me.username, p_me.role, p_action, null, '',
          jsonb_build_object(coalesce(nullif(p_key, ''), '-'), jsonb_build_object('old', coalesce(p_old, ''), 'new', coalesce(p_new, ''))))
$$;
revoke all on function app.audit(public.profiles, text, text, text, text) from public, anon, authenticated;

-- = addOptionRow_ (+ ánh xạ Sub_Source, phân cấp): có rồi thì bật lại; chưa có thì thêm cuối danh sách.
create or replace function app.dd_add(p_list text, p_value text, p_mapped_source text, p_parent text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_list = 'pic' then
    insert into public.pics (code, name, active, sort_order)
    values (p_value, p_value, true, coalesce((select max(sort_order) from public.pics), 0) + 1)
    on conflict (code) do update set active = true;
  else
    insert into public.dropdown_options (list_key, value, active, sort_order)
    values (p_list, p_value, true, coalesce((select max(sort_order) from public.dropdown_options where list_key = p_list), 0) + 1)
    on conflict (list_key, value) do update set active = true;
  end if;
  if p_list = 'sub_source' and coalesce(p_mapped_source, '') <> '' then
    insert into public.sub_source_map (sub_source, source) values (p_value, p_mapped_source)
    on conflict (sub_source) do update set source = excluded.source;
  end if;
  if p_list in ('location', 'site') and coalesce(p_parent, '') <> '' then
    insert into public.hierarchy (parent_type, parent_value, child_value)
    values (case p_list when 'location' then 'region' else 'location' end, p_parent, p_value)
    on conflict do nothing;
  end if;
end $$;
revoke all on function app.dd_add(text, text, text, text) from public, anon, authenticated;

-- ============ thêm giá trị (= hAddOption_) ============
create or replace function public.dd_add_option(p_list text, p_value text, p_mapped_source text default '', p_parent text default '')
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.profiles := app.require_admin();
  v text := btrim(normalize(coalesce(p_value, ''), NFC));
begin
  if btrim(coalesce(p_list, '')) = '' or v = '' then
    raise exception 'INVALID_INPUT' using errcode = 'PT400', detail = 'Vui lòng chọn danh mục và nhập giá trị mới.';
  end if;
  perform app.dd_add(btrim(p_list), v, btrim(coalesce(p_mapped_source, '')), btrim(normalize(coalesce(p_parent, ''), NFC)));
  perform app.audit(me, 'DROPDOWN', btrim(p_list), '', 'Thêm tùy chọn: "' || v || '"');
end $$;

-- ============ đổi tên / bật-tắt (= hPatchOption_) ============
-- p_columns: các cột hồ sơ dùng danh mục này (fieldCatalog.dropdownListKey = p_list) để đổi theo; chỉ nhận cột ghi được.
create or replace function public.dd_update_option(p_list text, p_old text, p_new text default null, p_active boolean default null,
                                                   p_columns text[] default '{}')
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.profiles := app.require_admin();
  l text := btrim(coalesce(p_list, ''));
  o text := btrim(normalize(coalesce(p_old, ''), NFC));
  n text := btrim(normalize(coalesce(p_new, p_old, ''), NFC));
  col text;
  cnt int;
  touched int := 0;
begin
  if l = '' or o = '' or n = '' then
    raise exception 'INVALID_INPUT' using errcode = 'PT400', detail = 'Thiếu thông tin tùy chọn cần cập nhật.';
  end if;
  if o <> n then
    if l = 'pic' then
      if exists (select 1 from public.pics where code = n) then
        raise exception 'DUPLICATE' using errcode = 'PT409', detail = 'Giá trị "' || n || '" đã có trong danh mục.';
      end if;
      update public.pics set code = n, name = case when name = o or name = '' then n else name end where code = o;  -- FK cascade
    else
      if exists (select 1 from public.dropdown_options where list_key = l and value = n) then
        raise exception 'DUPLICATE' using errcode = 'PT409', detail = 'Giá trị "' || n || '" đã có trong danh mục.';
      end if;
      update public.dropdown_options set value = n where list_key = l and value = o;
      foreach col in array coalesce(p_columns, '{}') loop
        if not (col = any (public.rr_writable_columns())) then
          raise exception 'INVALID_FIELD' using errcode = 'PT422', detail = col;
        end if;
        execute format('update public.recruitment_records set %1$I = $1, row_version = row_version + 1, updated_at = now() where %1$I = $2', col)
          using n, o;
        get diagnostics cnt = row_count;
        touched := touched + cnt;
      end loop;
      if l = 'sub_source' then
        update public.sub_source_map set sub_source = n where sub_source = o;
      elsif l = 'region' then
        update public.hierarchy set parent_value = n where parent_type = 'region' and parent_value = o;
      elsif l = 'location' then
        update public.hierarchy set child_value = n where parent_type = 'region' and child_value = o;
        update public.hierarchy set parent_value = n where parent_type = 'location' and parent_value = o;
      elsif l = 'site' then
        update public.hierarchy set child_value = n where parent_type = 'location' and child_value = o;
      end if;
    end if;
    perform app.audit(me, 'DROPDOWN', l, o, 'Đổi tên thành "' || n || '"');
  end if;
  if p_active is not null then
    if l = 'pic' then update public.pics set active = p_active where code = n;
    else update public.dropdown_options set active = p_active where list_key = l and value = n;
    end if;
    perform app.audit(me, 'DROPDOWN', l, n, case when p_active then 'Kích hoạt lại' else 'Ngừng sử dụng (Deactivated)' end);
  end if;
  return jsonb_build_object('records_updated', touched);
end $$;

-- ============ ánh xạ Sub_Source → Source (= hPutSubSource_) ============
create or replace function public.dd_set_sub_source_map(p_mapping jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.profiles := app.require_admin();
  cnt int;
begin
  if jsonb_typeof(p_mapping) is distinct from 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'PT400', detail = 'Dữ liệu ánh xạ Sub_Source -> Source không hợp lệ.';
  end if;
  insert into public.sub_source_map (sub_source, source)
    select distinct on (btrim(e.key)) btrim(e.key), btrim(coalesce(e.value #>> '{}', ''))
      from jsonb_each(p_mapping) e where btrim(e.key) <> ''
  on conflict (sub_source) do update set source = excluded.source;
  update public.recruitment_records r set source = m.source, row_version = r.row_version + 1, updated_at = now()
    from (select distinct on (btrim(e.key)) btrim(e.key) as sub_source, btrim(coalesce(e.value #>> '{}', '')) as source
            from jsonb_each(p_mapping) e where btrim(e.key) <> '') m
   where r.sub_source = m.sub_source and r.source is distinct from m.source;
  get diagnostics cnt = row_count;
  perform app.audit(me, 'DROPDOWN', 'sub_source_mapping', '', 'Cập nhật bảng ánh xạ Sub_Source → Source');
  return jsonb_build_object('records_updated', cnt);
end $$;

-- ============ phân cấp Region → Location → Site (= hPutHierarchy_: thay toàn bộ từng loại được gửi) ============
create or replace function public.dd_set_hierarchy(p_region_to_locations jsonb default null, p_location_to_sites jsonb default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.profiles := app.require_admin();
begin
  if jsonb_typeof(p_region_to_locations) = 'object' then
    delete from public.hierarchy where parent_type = 'region';
    insert into public.hierarchy (parent_type, parent_value, child_value)
      select 'region', btrim(e.key), btrim(c #>> '{}')
        from jsonb_each(p_region_to_locations) e cross join lateral jsonb_array_elements(case when jsonb_typeof(e.value) = 'array' then e.value else '[]' end) c
       where btrim(c #>> '{}') <> ''
    on conflict do nothing;
  end if;
  if jsonb_typeof(p_location_to_sites) = 'object' then
    delete from public.hierarchy where parent_type = 'location';
    insert into public.hierarchy (parent_type, parent_value, child_value)
      select 'location', btrim(e.key), btrim(c #>> '{}')
        from jsonb_each(p_location_to_sites) e cross join lateral jsonb_array_elements(case when jsonb_typeof(e.value) = 'array' then e.value else '[]' end) c
       where btrim(c #>> '{}') <> ''
    on conflict do nothing;
  end if;
  perform app.audit(me, 'DROPDOWN', 'hierarchy', '', 'Cập nhật phân cấp Vùng (Region) → Tỉnh/Thành (Location) → Điểm làm việc (Site)');
end $$;

-- ============ duyệt đề xuất giá trị (= hReviewRequest_) ============
create or replace function public.dd_review_request(p_id bigint, p_status text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.profiles := app.require_admin();
  rq public.dropdown_requests;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'INVALID_INPUT' using errcode = 'PT400', detail = 'Trạng thái duyệt không hợp lệ.';
  end if;
  select * into rq from public.dropdown_requests where id = p_id for update;
  if rq.id is null then raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy yêu cầu đề xuất.'; end if;
  update public.dropdown_requests set status = p_status, reviewed_by = me.id, reviewed_at = now() where id = p_id;
  if p_status = 'approved' then
    perform app.dd_add(rq.list_key, rq.proposed_value, rq.mapped_source, rq.parent_value);
  end if;
  perform app.audit(me, 'DROPDOWN', rq.list_key, rq.proposed_value,
                    case when p_status = 'approved' then 'Đã phê duyệt đề xuất' else 'Đã từ chối đề xuất' end);
end $$;

-- ============ View đã lưu (= hCreateView_ / hPatchView_ / hDeleteView_) ============
-- config đã được trình duyệt làm sạch như sanitizeViewConfig_ (khóa lọc, cột, sắp xếp hợp lệ) – ở đây kiểm lại phần ràng buộc.
create unique index if not exists saved_views_name_uniq on public.saved_views (name);

create or replace function public.view_save(p_id bigint, p_values jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.profiles := app.require_admin();
  cur public.saved_views;
  v_name text;
  v_aud text;
  v_ids uuid[];
  res public.saved_views;
begin
  if p_id is not null then
    select * into cur from public.saved_views where id = p_id for update;
    if cur.id is null then raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy view.'; end if;
  end if;
  v_name := btrim(coalesce(p_values ->> 'name', cur.name, ''));
  if v_name = '' or length(v_name) > 80 then
    raise exception 'VALIDATION_FAILED' using errcode = 'PT400', detail = 'Tên view không được để trống và tối đa 80 ký tự.';
  end if;
  if exists (select 1 from public.saved_views where name = v_name and id is distinct from p_id) then
    raise exception 'DUPLICATE_VIEW' using errcode = 'PT400', detail = 'View "' || v_name || '" đã tồn tại.';
  end if;
  v_aud := coalesce(p_values ->> 'audience', cur.audience, 'all');
  if v_aud not in ('all', 'admin', 'users') then
    raise exception 'VALIDATION_FAILED' using errcode = 'PT400', detail = 'Đối tượng xem view không hợp lệ.';
  end if;
  v_ids := case when p_values ? 'user_ids' then array(select (x #>> '{}')::uuid from jsonb_array_elements(p_values -> 'user_ids') x)
                else coalesce(cur.user_ids, '{}') end;
  if v_aud = 'users' and cardinality(v_ids) = 0 then
    raise exception 'VALIDATION_FAILED' using errcode = 'PT400', detail = 'Hãy chọn ít nhất một người dùng khi gán view cho từng TA.';
  end if;
  if p_id is null then
    insert into public.saved_views (name, description, config, audience, user_ids, is_active, sort_order, created_by)
    values (v_name, left(btrim(coalesce(p_values ->> 'description', '')), 300), coalesce(p_values -> 'config', '{"filters":{}}'::jsonb),
            v_aud, v_ids, coalesce((p_values ->> 'is_active')::boolean, true),
            greatest(0, least(1000, coalesce((p_values ->> 'sort_order')::int, 0))), me.id)
    returning * into res;
    perform app.audit(me, 'VIEW', 'saved_view', '', 'Tạo view "' || v_name || '"');
  else
    update public.saved_views set
      name = v_name,
      description = case when p_values ? 'description' then left(btrim(coalesce(p_values ->> 'description', '')), 300) else description end,
      config = coalesce(p_values -> 'config', config), audience = v_aud, user_ids = v_ids,
      is_active = coalesce((p_values ->> 'is_active')::boolean, is_active),
      sort_order = case when p_values ? 'sort_order' then greatest(0, least(1000, (p_values ->> 'sort_order')::int)) else sort_order end,
      updated_at = now()
    where id = p_id returning * into res;
    perform app.audit(me, 'VIEW', 'saved_view', cur.name, 'Cập nhật view "' || v_name || '"');
  end if;
  return to_jsonb(res) || jsonb_build_object('created_by', app.username(res.created_by));
end $$;

create or replace function public.view_delete(p_id bigint)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me public.profiles := app.require_admin();
  cur public.saved_views;
begin
  select * into cur from public.saved_views where id = p_id for update;
  if cur.id is null then raise exception 'NOT_FOUND' using errcode = 'PT404', detail = 'Không tìm thấy view.'; end if;
  if (select count(*) from public.saved_views) <= 1 then
    raise exception 'LAST_VIEW' using errcode = 'PT400', detail = 'Phải còn ít nhất một view trong hệ thống.';
  end if;
  delete from public.saved_views where id = p_id;
  perform app.audit(me, 'VIEW', 'saved_view', cur.name, 'Xóa view "' || cur.name || '"');
end $$;

-- ============ quyền: chỉ người đăng nhập gọi được (trong hàm tự kiểm Admin) ============
do $$
declare s text;
begin
  foreach s in array array[
    'public.dd_add_option(text, text, text, text)', 'public.dd_update_option(text, text, text, boolean, text[])',
    'public.dd_set_sub_source_map(jsonb)', 'public.dd_set_hierarchy(jsonb, jsonb)', 'public.dd_review_request(bigint, text)',
    'public.view_save(bigint, jsonb)', 'public.view_delete(bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', s);
    execute format('grant execute on function %s to authenticated', s);
  end loop;
end $$;

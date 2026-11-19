-- 0010_candidate_list_and_view.sql (DEV) – M4-3: danh sách ứng viên phân trang ở server (thay filterCands_/hydrate_ của Api.gs).
--  * Hàm thuần rr_board_col / rr_board_sub / rr_tenor: bản SQL của shared/pipelineRules.ts (boardPosition, boardSub)
--    và shared/validation.ts (computeTenor). Đối chiếu 1:1 trên golden fixture: supabase/tests/sql_parity_test.sql.
--  * View v_records (security_invoker => RLS rr_read áp dụng): r.* + tenor, board_col, board_sub, has_phone_dup, cv_file.
--  * candidate_dup_info / candidate_cccd_dup_info: như dupInfo_ của hệ cũ (TA chỉ thấy mã hồ sơ của PIC mình);
--    chỉ trả kết quả khi người gọi được xem hồ sơ đó.
--  * RPC list_candidates (lọc, tìm, box, sub, tenor, dup, khoảng ngày, sắp xếp, phân trang), get_candidate,
--    check_phone, check_cccd (che hồ sơ PIC khác như maskForeign_).
-- Mọi hàm: thu quyền PUBLIC/anon; chỉ authenticated + service_role được gọi.

-- ============ hàm thuần (giống shared/) ============
-- boardPosition(): rớt vòng nào thì nằm ở ô vòng đó; chưa rớt thì ô xa nhất đã có dữ liệu.
create or replace function public.rr_board_col(r1_status text, r1_date date, r2_status text, r2_date date, ob_status text, ob_date date)
returns text language sql immutable set search_path = ''
as $$
  select case
    when btrim(coalesce(r1_status, '')) = 'Failed' then 'r1'
    when btrim(coalesce(r2_status, '')) in ('Failed', 'Canceled') then 'r2'
    when btrim(coalesce(ob_status, '')) in ('Canceled', 'Noshow') then 'ob'
    when btrim(coalesce(ob_status, '')) <> '' or ob_date is not null then 'ob'
    when btrim(coalesce(r2_status, '')) <> '' then 'r2'
    when btrim(coalesce(r1_status, '')) = 'Passed' or r2_date is not null then 'lusu'
    when btrim(coalesce(r1_status, '')) <> '' or r1_date is not null then 'r1'
    else 'lead'
  end
$$;

-- boardSub(): chỉ số phụ của thẻ KPI (null = không thuộc chỉ số phụ nào).
create or replace function public.rr_board_sub(r1_status text, r1_date date, r2_status text, r2_date date, ob_status text, ob_date date)
returns text language sql immutable set search_path = ''
as $$
  select case public.rr_board_col(r1_status, r1_date, r2_status, r2_date, ob_status, ob_date)
    when 'lead' then 'lead_new'
    when 'r1' then case when btrim(coalesce(r1_status, '')) = 'Failed' then null else 'r1_wait' end
    when 'lusu' then case when r2_date is not null then 'lu' else 'su' end
    when 'r2' then case btrim(coalesce(r2_status, ''))
                     when 'Passed' then 'r2_passed' when 'Failed' then 'r2_failed' when 'Canceled' then 'r2_canceled'
                     else 'lu' end
    when 'ob' then case
                     when btrim(coalesce(r1_status, '')) = 'Failed' or btrim(coalesce(r2_status, '')) in ('Failed', 'Canceled')
                       or btrim(coalesce(ob_status, '')) in ('Canceled', 'Noshow') then null
                     when btrim(coalesce(ob_status, '')) in ('', 'Pending', 'Không liên lạc được') then 'ob_wait'
                     else null end
  end
$$;

-- computeTenor(): số ngày từ ngày OB tới ngày nghỉ (nếu Resigned có ngày nghỉ) hoặc tới hôm nay (giờ VN).
create or replace function public.rr_tenor(ob_date date, emp_status text, attrition_date date, today date)
returns text language sql immutable set search_path = ''
as $$
  select case
    when ob_date is null then ''
    else case
      when d < 1 then '<1D' when d < 3 then '<3D' when d < 7 then '<7D'
      when d < 15 then '<15D' when d < 30 then '<30D' else '>30D' end
  end
  from (select (case when emp_status = 'Resigned' and attrition_date is not null then attrition_date else today end) - ob_date as d) x
$$;

-- Hồ sơ có SĐT trùng hồ sơ khác (đang hoạt động) hay không – tính trên TOÀN BỘ hồ sơ như phoneIndex_ của hệ cũ
-- (TA vẫn biết hồ sơ của mình bị trùng với hồ sơ PIC khác); chỉ trả đúng/sai, không lộ hồ sơ nào.
create or replace function public.rr_has_phone_dup(p_id bigint, p_phone text, p_archived boolean) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_phone, '') <> '' and not coalesce(p_archived, false)
     and exists (select 1 from public.recruitment_records d where d.phone = p_phone and d.id <> p_id and not d.is_archived)
$$;

-- ============ view ============
create or replace view public.v_records with (security_invoker = true) as
select
  r.*,
  public.rr_tenor(r.ob_date, r.emp_status, r.attrition_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) as tenor,
  public.rr_board_col(r.r1_status, r.r1_date, r.r2_status, r.r2_date, r.ob_status, r.ob_date) as board_col,
  public.rr_board_sub(r.r1_status, r.r1_date, r.r2_status, r.r2_date, r.ob_status, r.ob_date) as board_sub,
  public.rr_has_phone_dup(r.id, r.phone, r.is_archived) as has_phone_dup,
  (select f.file_name from public.record_files f
    where f.record_id = r.id and f.kind = 'cv' and f.deleted_at is null order by f.uploaded_at desc limit 1) as cv_file
from public.recruitment_records r;

revoke all on public.v_records from anon, authenticated;
grant select on public.v_records to authenticated, service_role;

-- ============ trùng SĐT / CCCD của 1 hồ sơ (dupInfo_ / cccdDupInfo_) ============
create or replace function public.candidate_dup_info(p_record_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rec record;
  v_is_admin boolean := app.is_admin();
  v_my_pic text := app.my_pic();
  v_count int; v_with jsonb; v_own jsonb; v_others int;
begin
  select id, phone, pic, is_archived into v_rec from public.recruitment_records where id = p_record_id;
  -- chỉ trả cho người được xem hồ sơ này (không lộ thông tin hồ sơ PIC khác)
  if not found or not app.can_see_record(v_rec.pic) or v_rec.is_archived or v_rec.phone = '' then return null; end if;
  if v_is_admin then
    select count(*), jsonb_agg(jsonb_build_object('code', candidate_code, 'pic', pic) order by id)
      into v_count, v_with
      from public.recruitment_records where phone = v_rec.phone and id <> v_rec.id and not is_archived;
    if coalesce(v_count, 0) = 0 then return null; end if;
    return jsonb_build_object('count', v_count, 'with', v_with);
  end if;
  select count(*),
         coalesce(jsonb_agg(candidate_code order by id) filter (where pic = v_my_pic), '[]'::jsonb),
         count(*) filter (where pic is distinct from v_my_pic)
    into v_count, v_own, v_others
    from public.recruitment_records where phone = v_rec.phone and id <> v_rec.id and not is_archived;
  if coalesce(v_count, 0) = 0 then return null; end if;
  return jsonb_build_object('count', v_count, 'own', v_own, 'others', v_others);
end $$;

create or replace function public.candidate_cccd_dup_info(p_record_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pic text; v_archived boolean; v_num text;
  v_is_admin boolean := app.is_admin();
  v_my_pic text := app.my_pic();
  v_count int; v_with jsonb; v_own jsonb; v_others int;
begin
  select r.pic, r.is_archived, h.id_number into v_pic, v_archived, v_num
    from public.recruitment_records r join public.hr_info h on h.record_id = r.id where r.id = p_record_id;
  if not found or not app.can_see_record(v_pic) or v_archived or coalesce(v_num, '') = '' then return null; end if;
  if v_is_admin then
    select count(*), jsonb_agg(jsonb_build_object('code', r.candidate_code, 'pic', r.pic) order by r.id)
      into v_count, v_with
      from public.hr_info h join public.recruitment_records r on r.id = h.record_id
     where h.id_number = v_num and r.id <> p_record_id and not r.is_archived;
    if coalesce(v_count, 0) = 0 then return null; end if;
    return jsonb_build_object('count', v_count, 'with', v_with);
  end if;
  select count(*),
         coalesce(jsonb_agg(r.candidate_code order by r.id) filter (where r.pic = v_my_pic), '[]'::jsonb),
         count(*) filter (where r.pic is distinct from v_my_pic)
    into v_count, v_own, v_others
    from public.hr_info h join public.recruitment_records r on r.id = h.record_id
   where h.id_number = v_num and r.id <> p_record_id and not r.is_archived;
  if coalesce(v_count, 0) = 0 then return null; end if;
  return jsonb_build_object('count', v_count, 'own', v_own, 'others', v_others);
end $$;

-- ============ 1 hồ sơ kèm thông tin trùng ============
create or replace function public.get_candidate(p_id bigint) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select to_jsonb(v) || jsonb_build_object('dup', public.candidate_dup_info(v.id), 'cccd_dup', public.candidate_cccd_dup_info(v.id))
  from public.v_records v where v.id = p_id
$$;

-- ============ kiểm trùng khi nhập (che hồ sơ PIC khác như maskForeign_) ============
create or replace function public.check_phone(p_phone text, p_exclude_id bigint default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('duplicates', coalesce(jsonb_agg(item order by rid desc), '[]'::jsonb))
  from (
    select r.id as rid,
           case when app.is_admin() or (r.pic is not null and r.pic = app.my_pic())
             then jsonb_build_object('id', r.id, 'candidate_code', r.candidate_code, 'full_name', r.full_name, 'pic', r.pic,
                                     'position', r.position, 'created_at', r.created_at)
             else jsonb_build_object('id', 0, 'candidate_code', '(ẩn)', 'full_name', 'Ứng viên của PIC khác', 'pic', '',
                                     'position', '', 'created_at', '')
           end as item
      from public.recruitment_records r
     where btrim(coalesce(p_phone, '')) <> '' and r.phone = btrim(p_phone)
       and (p_exclude_id is null or r.id <> p_exclude_id) and not r.is_archived
     order by r.id desc
     limit 10
  ) x
$$;

create or replace function public.check_cccd(p_id_number text, p_exclude_id bigint default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('duplicates', coalesce(jsonb_agg(item order by rid desc), '[]'::jsonb))
  from (
    select r.id as rid,
           case when app.is_admin() or (r.pic is not null and r.pic = app.my_pic())
             then jsonb_build_object('id', r.id, 'candidate_code', r.candidate_code, 'full_name', r.full_name, 'pic', r.pic,
                                     'position', r.position, 'created_at', r.created_at)
             else jsonb_build_object('id', 0, 'candidate_code', '(ẩn)', 'full_name', 'Ứng viên của PIC khác', 'pic', '',
                                     'position', '', 'created_at', '')
           end as item
      from public.hr_info h join public.recruitment_records r on r.id = h.record_id
     where btrim(coalesce(p_id_number, '')) <> '' and h.id_number = btrim(p_id_number)
       and (p_exclude_id is null or r.id <> p_exclude_id) and not r.is_archived
     order by r.id desc
     limit 10
  ) x
$$;

-- ============ danh sách (filterCands_ + hListCandidates_ của hệ cũ) ============
create or replace function public.list_candidates(
  p_page int default 1, p_page_size int default 25, p_sort_by text default 'id', p_sort_dir text default 'desc',
  p_search text default '', p_filters jsonb default '{}'::jsonb, p_box text default '', p_sub text default '',
  p_tenor text default '', p_dup boolean default false, p_archived boolean default false,
  p_date_from text default '', p_date_to text default ''
) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_page int := greatest(1, coalesce(p_page, 1));
  v_size int := least(200, greatest(10, coalesce(p_page_size, 25)));
  v_sort text := 'id';
  v_dir text := case when lower(coalesce(p_sort_dir, '')) = 'asc' then 'asc' else 'desc' end;
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_like text;
  v_phone text;
  v_from date; v_to date;
  v_subs text[];
  v_where text := format('where is_archived = %L', coalesce(p_archived, false));
  v_total int;
  v_items jsonb := '[]'::jsonb;
  k text;
begin
  if p_sort_by = any (array['id','created_at','candidate_code','full_name','position','site','pic','source','r1_date','r1_status',
                            'r2_date','r2_status','ob_date','ob_month','ob_status','basic_salary','emp_status','attrition_date']) then
    v_sort := p_sort_by;
  end if;

  -- khoảng ngày (ISO): giữ đúng điều kiện cũ "ob_date hoặc r1_date nằm trong khoảng"
  if coalesce(p_date_from, '') ~ '^\d{4}-\d{2}-\d{2}$' then v_from := p_date_from::date; end if;
  if coalesce(p_date_to, '') ~ '^\d{4}-\d{2}-\d{2}$' then v_to := p_date_to::date; end if;
  if v_from is not null then v_where := v_where || format(' and (ob_date >= %L or r1_date >= %L)', v_from, v_from); end if;
  if v_to is not null then v_where := v_where || format(' and (ob_date <= %L or r1_date <= %L)', v_to, v_to); end if;

  -- tìm theo mã / tên / SĐT (chuỗi con, không phân biệt hoa thường; %, _ được hiểu là ký tự thường)
  if v_search <> '' then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_phone := regexp_replace(regexp_replace(v_search, '[\s.\-()]', '', 'g'), '^(\+84|0)', '');
    v_where := v_where || format(' and (lower(candidate_code) like %L or lower(full_name) like %L or phone like %L', v_like, v_like, v_like);
    if v_phone <> '' then
      v_where := v_where || format(' or phone like %L', '%' || replace(replace(v_phone, '%', '\%'), '_', '\_') || '%');
    end if;
    v_where := v_where || ')';
  end if;

  if p_box = any (array['lead','r1','lusu','r2','ob']) then v_where := v_where || format(' and board_col = %L', p_box); end if;
  select array_agg(s) into v_subs from unnest(string_to_array(coalesce(p_sub, ''), ',')) s0, lateral (select btrim(s0) s) t
   where s = any (array['lead_new','r1_wait','su','lu','r2_passed','r2_failed','r2_canceled','ob_wait']);
  if v_subs is not null then v_where := v_where || format(' and board_sub = any (%L::text[])', v_subs); end if;
  if p_tenor = any (array['<1D','<3D','<7D','<15D','<30D','>30D']) then v_where := v_where || format(' and tenor = %L', p_tenor); end if;
  if coalesce(p_dup, false) then v_where := v_where || ' and has_phone_dup'; end if;

  if jsonb_typeof(p_filters) = 'object' then
    foreach k in array array['pic','position','site','source','r1_status','r2_status','ob_status','emp_status','ob_month','region','location'] loop
      if coalesce(p_filters ->> k, '') <> '' then v_where := v_where || format(' and %I = %L', k, p_filters ->> k); end if;
    end loop;
  end if;

  -- Hệ cũ so chuỗi: ô trống nhỏ nhất => tăng dần thì trống đứng đầu, giảm dần thì đứng cuối; hòa thì id giảm dần.
  v_dir := v_dir || case when v_dir = 'asc' then ' nulls first' else ' nulls last' end;
  execute 'select count(*) from public.v_records ' || v_where into v_total;
  if v_total > 0 then
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(''dup'', public.candidate_dup_info(t.id), ''cccd_dup'', public.candidate_cccd_dup_info(t.id))
                                order by t.%I %s, t.id desc), ''[]''::jsonb)
         from (select * from public.v_records %s order by %I %s, id desc limit %s offset %s) t',
      v_sort, v_dir, v_where, v_sort, v_dir, v_size, (v_page - 1) * v_size)
      into v_items;
  end if;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size,
                            'totalPages', greatest(1, ceil(v_total::numeric / v_size)::int));
end $$;

-- ============ đếm thẻ KPI (hBoard_ ?counts=1 của hệ cũ) – không tải dòng về trình duyệt ============
-- Admin lọc được theo PIC; TA luôn chỉ đếm hồ sơ của mình (RLS), tham số PIC bị bỏ qua như hệ cũ.
create or replace function public.board_counts(p_pic text default '') returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with b as (
    select public.rr_board_col(r1_status, r1_date, r2_status, r2_date, ob_status, ob_date) as col,
           public.rr_board_sub(r1_status, r1_date, r2_status, r2_date, ob_status, ob_date) as sub,
           (btrim(coalesce(r1_status, '')) = 'Failed' or btrim(coalesce(r2_status, '')) in ('Failed', 'Canceled')
            or btrim(coalesce(ob_status, '')) in ('Canceled', 'Noshow')) as failed
      from public.recruitment_records
     where not is_archived and (coalesce(p_pic, '') = '' or not app.is_admin() or pic = p_pic)
  )
  select jsonb_build_object(
    'counts', (select jsonb_object_agg(k, jsonb_build_object('total', total, 'failed', failed)) from (
                 select k, count(b.col) total, count(b.col) filter (where b.failed) failed
                   from unnest(array['lead','r1','lusu','r2','ob']) k left join b on b.col = k group by k) x),
    'subs',   (select jsonb_object_agg(s, cnt) from (
                 select s, count(b.sub) cnt from unnest(array['lead_new','r1_wait','su','lu','r2_passed','r2_failed','r2_canceled','ob_wait']) s
                   left join b on b.sub = s group by s) x))
$$;

-- ============ quyền gọi ============
revoke all on function public.rr_has_phone_dup(bigint, text, boolean), public.rr_board_col(text, date, text, date, text, date), public.rr_board_sub(text, date, text, date, text, date),
  public.rr_tenor(date, text, date, date), public.candidate_dup_info(bigint), public.candidate_cccd_dup_info(bigint),
  public.get_candidate(bigint), public.check_phone(text, bigint), public.check_cccd(text, bigint),
  public.list_candidates(int, int, text, text, text, jsonb, text, text, text, boolean, boolean, text, text), public.board_counts(text)
  from public, anon;
grant execute on function public.rr_has_phone_dup(bigint, text, boolean), public.rr_board_col(text, date, text, date, text, date), public.rr_board_sub(text, date, text, date, text, date),
  public.rr_tenor(date, text, date, date), public.candidate_dup_info(bigint), public.candidate_cccd_dup_info(bigint),
  public.get_candidate(bigint), public.check_phone(text, bigint), public.check_cccd(text, bigint),
  public.list_candidates(int, int, text, text, text, jsonb, text, text, text, boolean, boolean, text, text), public.board_counts(text)
  to authenticated, service_role;

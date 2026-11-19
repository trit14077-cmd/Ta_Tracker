-- 0013_board_cards.sql – M5-2/M5-4: dữ liệu bảng Kanban (KanbanBoardView), thay /api/board và /api/board/cards
-- (Pipeline.gs: boardRows_, hBoard_, hBoardCards_) + lịch sử chuyển vòng của 1 hồ sơ.
-- Giống hệ cũ:
--   * hồ sơ không lưu trữ, trong phạm vi người dùng (RLS rr_read);
--   * lọc pic (CHỈ Admin; TA luôn chỉ thấy hồ sơ mình, bộ lọc pic của TA bị bỏ qua), position, region (so khớp đúng);
--   * tìm theo mã / tên / SĐT: cùng cách của list_candidates (chuỗi con không phân biệt hoa thường; SĐT bỏ 0/+84);
--   * ô = rr_board_col (= boardPosition().col); failed_at = vòng rớt (= boardPosition().failedAt);
--   * mỗi ô xếp updated_at giảm dần rồi id giảm dần; 30 thẻ/lần.
-- SECURITY INVOKER; tên cột cố định, giá trị escape %L.

-- ============ điều kiện lọc chung ============
create or replace function public.rr_board_where(p_filters jsonb, p_q text)
returns text
language plpgsql stable set search_path = ''
as $$
declare
  w text := 'not r.is_archived';
  s text := lower(btrim(coalesce(p_q, '')));
  v_like text;
  v_phone text;
begin
  if jsonb_typeof(p_filters) = 'object' then
    if coalesce(p_filters ->> 'pic', '') <> '' and (select app.is_admin()) then
      w := w || format(' and r.pic = %L', p_filters ->> 'pic');
    end if;
    if coalesce(p_filters ->> 'position', '') <> '' then w := w || format(' and r.position = %L', p_filters ->> 'position'); end if;
    if coalesce(p_filters ->> 'region', '') <> '' then w := w || format(' and r.region = %L', p_filters ->> 'region'); end if;
  end if;
  if s <> '' then
    v_like := '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_phone := regexp_replace(regexp_replace(s, '[\s.\-()]', '', 'g'), '^(\+84|0)', '');
    w := w || format(' and (lower(r.candidate_code) like %L or lower(r.full_name) like %L or r.phone like %L', v_like, v_like, v_like);
    if v_phone <> '' then
      w := w || format(' or r.phone like %L', '%' || replace(replace(v_phone, '%', '\%'), '_', '\_') || '%');
    end if;
    w := w || ')';
  end if;
  return w;
end $$;

-- Biểu thức ô Kanban (alias r = recruitment_records), GIỐNG HỆT rr_board_col (0010). Chép thành chữ trong SQL động vì
-- gọi hàm rr_board_col cho từng dòng chậm gấp nhiều lần (hàm có SET search_path nên không được gộp vào truy vấn).
-- board_test.sql đối chiếu từng hồ sơ golden với boardPosition() và board_counts (dùng rr_board_col).
create or replace function public.rr_board_col_sql()
returns text language sql immutable set search_path = ''
as $$
  select $s$(case
    when btrim(r.r1_status) = 'Failed' then 'r1'
    when btrim(r.r2_status) in ('Failed', 'Canceled') then 'r2'
    when btrim(r.ob_status) in ('Canceled', 'Noshow') then 'ob'
    when btrim(r.ob_status) <> '' or r.ob_date is not null then 'ob'
    when btrim(r.r2_status) <> '' then 'r2'
    when btrim(r.r1_status) = 'Passed' or r.r2_date is not null then 'lusu'
    when btrim(r.r1_status) <> '' or r.r1_date is not null then 'r1'
    else 'lead' end)$s$
$$;

-- Thẻ Kanban (= boardCard_ của hệ cũ)
create or replace function public.rr_board_card_sql()
returns text language sql immutable set search_path = ''
as $$
  select $s$jsonb_build_object('id', r.id, 'candidate_code', r.candidate_code, 'full_name', r.full_name, 'phone', r.phone,
    'pic', coalesce(r.pic, ''), 'position', r.position, 'region', r.region, 'location', r.location, 'site', r.site,
    'row_version', r.row_version, 'updated_at', r.updated_at,
    'failed_at', case when btrim(r.r1_status) = 'Failed' then 'r1'
                      when btrim(r.r2_status) in ('Failed', 'Canceled') then 'r2'
                      when btrim(r.ob_status) in ('Canceled', 'Noshow') then 'ob' else '' end)$s$
$$;

-- ============ board_page: số thẻ từng ô + 30 thẻ đầu mỗi ô (= hBoard_) ============
-- p_filters: {pic, position, region}; p_q: chuỗi tìm. Trả {counts:{lead:{total,failed},…}, columns:{lead:[…],…}, page_size:30}
create or replace function public.board_page(p_filters jsonb default '{}'::jsonb, p_q text default '')
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  res jsonb;
begin
  execute format($q$
    with b as materialized (
      select %3$s as col,
             (btrim(r.r1_status) = 'Failed' or btrim(r.r2_status) in ('Failed', 'Canceled')
              or btrim(r.ob_status) in ('Canceled', 'Noshow')) as failed,
             r.updated_at, r.id
        from public.recruitment_records r
       where %2$s
    ), ranked as (
      select b.*, row_number() over (partition by b.col order by b.updated_at desc, b.id desc) as rn from b
    ), cnt as (
      select b.col, count(*) as total, count(*) filter (where b.failed) as failed from b group by b.col
    ), cards as (
      -- 30 thẻ đầu mỗi ô: lấy cột của thẻ theo khóa chính (≤ 150 lần tra index), không nối cả bảng
      select x.col, jsonb_agg(c.card order by x.updated_at desc, x.id desc) as list
        from ranked x
        cross join lateral (select %1$s as card from public.recruitment_records r where r.id = x.id) c
       where x.rn <= 30
       group by x.col
    )
    select jsonb_build_object(
      'counts', (select jsonb_object_agg(k, jsonb_build_object('total', coalesce(n.total, 0), 'failed', coalesce(n.failed, 0)))
                   from unnest(array['lead','r1','lusu','r2','ob']) k left join cnt n on n.col = k),
      'columns', (select jsonb_object_agg(k, coalesce(c.list, '[]'::jsonb))
                    from unnest(array['lead','r1','lusu','r2','ob']) k left join cards c on c.col = k),
      'page_size', 30)
  $q$, public.rr_board_card_sql(), public.rr_board_where(p_filters, p_q), public.rr_board_col_sql()) into res;
  return res;
end $$;

-- ============ board_cards: thêm thẻ của 1 ô (= hBoardCards_) ============
create or replace function public.board_cards(p_col text, p_offset int default 0, p_filters jsonb default '{}'::jsonb,
                                              p_q text default '', p_limit int default 30)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  res jsonb;
begin
  if p_col is null or p_col <> all (array['lead','r1','lusu','r2','ob']) then
    raise exception 'Ô Kanban không hợp lệ: %', p_col using errcode = '22023';
  end if;
  execute format($q$
    with b as (
      select r.id, r.updated_at
        from public.recruitment_records r
       where %2$s
         and %3$s = $1
    ), page as (
      select id, updated_at from b order by updated_at desc, id desc offset $2 limit $3
    )
    select jsonb_build_object(
      'cards', coalesce((select jsonb_agg(c.card order by p.updated_at desc, p.id desc)
                           from page p cross join lateral (select %1$s as card from public.recruitment_records r where r.id = p.id) c),
                        '[]'::jsonb),
      'total', (select count(*) from b))
  $q$, public.rr_board_card_sql(), public.rr_board_where(p_filters, p_q), public.rr_board_col_sql())
  into res
  using p_col, greatest(0, coalesce(p_offset, 0)), least(200, greatest(1, coalesce(p_limit, 30)));
  return res;
end $$;

-- ============ stage_history: lịch sử chuyển vòng bằng Kanban của 1 hồ sơ ============
-- status_history (STAGE_MOVE: from_box, to_box) + tên người làm từ audit_logs cùng giao dịch (cùng record_id, cùng `at`).
-- RLS của 2 bảng áp như đọc thường (người xem được hồ sơ mới thấy).
create or replace function public.stage_history(p_record_id bigint)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'at', h.at, 'from_box', h.from_box, 'to_box', h.to_box, 'actor_username', h.actor_username)
           order by h.at desc, h.id desc), '[]'::jsonb)
    from (
      select sh.id, sh.at, coalesce(sh.from_box, '') as from_box, coalesce(sh.to_box, '') as to_box,
             coalesce(al.actor_username, '') as actor_username
        from public.status_history sh
        left join lateral (
          select a.actor_username from public.audit_logs a
           where a.record_id = sh.record_id and a.action = 'STAGE_MOVE' and a.at = sh.at
           order by a.id limit 1
        ) al on true
       where sh.record_id = p_record_id and sh.kind = 'STAGE_MOVE'
       order by sh.at desc, sh.id desc
       limit 50
    ) h
$$;

-- ============ quyền ============
revoke all on function public.rr_board_where(jsonb, text), public.rr_board_card_sql(), public.rr_board_col_sql(), public.board_page(jsonb, text),
  public.board_cards(text, int, jsonb, text, int), public.stage_history(bigint) from public, anon;
grant execute on function public.rr_board_where(jsonb, text), public.rr_board_card_sql(), public.rr_board_col_sql(), public.board_page(jsonb, text),
  public.board_cards(text, int, jsonb, text, int), public.stage_history(bigint) to authenticated, service_role;

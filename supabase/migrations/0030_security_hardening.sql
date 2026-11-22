-- 0030_security_hardening.sql – M9-3/M9-4: siết quyền theo kết quả quét catalog DEV 22/11/2026 (chỉ đọc).
-- Không đổi hành vi của app: chỉ thu quyền mà không đường gọi nào dùng tới. Không đụng dữ liệu.
--
-- 1) 5 hàm trong schema app (0022–0024) còn EXECUTE cho PUBLIC theo mặc định Postgres ⇒ anon có EXECUTE.
--    anon không có USAGE schema app nên chưa gọi được, nhưng thu luôn (phòng thủ nhiều lớp, checklist M9-4).
--    Giữ nguyên quyền của authenticated/service_role: cấp RÕ cho vai trò nào đang dùng được trước khi thu từ PUBLIC
--    (RLS của applications gọi app.can_see_app() bằng quyền authenticated).
-- 2) public.v_report_rows: Supabase cấp mặc định ALL cho authenticated lúc tạo view, 0011 chỉ thu của public/anon
--    ⇒ authenticated còn INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. View chỉ để đọc: giữ SELECT.
-- 3) Default privileges của role postgres trong schema public đang cấp TRUNCATE/REFERENCES/TRIGGER/MAINTAIN cho
--    anon + authenticated trên MỌI bảng mới. TRUNCATE bỏ qua RLS ⇒ migration sau mà quên revoke sẽ lộ.
--    Thu khỏi mặc định (chỉ ảnh hưởng bảng tạo SAU migration này; mọi migration vẫn phải grant rõ như hiện nay).
--    Hàm: EXECUTE cho PUBLIC là mặc định TOÀN CỤC của Postgres, không thu được theo từng schema (default privileges
--    theo schema chỉ cộng thêm) ⇒ không đổi ở đây; supabase/tests/security_audit.sql trong CI chặn hàm mới mà anon gọi được.

-- 1)
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'execute')
  loop
    if has_function_privilege('authenticated', f, 'execute') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if has_function_privilege('service_role', f, 'execute') then
      execute format('grant execute on function %s to service_role', f);
    end if;
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;

-- 2)
revoke all on public.v_report_rows from authenticated;
grant select on public.v_report_rows to authenticated;

-- 3)
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
do $$
begin
  -- quyền MAINTAIN chỉ có từ Postgres 17 (Supabase DEV và CI đều 17)
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges in schema public revoke maintain on tables from anon, authenticated';
  end if;
end $$;

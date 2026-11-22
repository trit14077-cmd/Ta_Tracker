-- 0029_service_role_app_usage.sql – M8-3: cho service_role (script đối chiếu/cutover, Edge) gọi được các RPC đọc có dùng
-- app.is_admin()/app.my_pic()/app.can_see_record() – ví dụ board_counts (0014) trả 42501 "permission denied for schema app".
-- Bản hẹp như 0004: chỉ USAGE schema app + EXECUTE 3 hàm kiểm quyền. Không mở thêm quyền: với service_role auth.uid() rỗng
-- ⇒ is_admin() = false, my_pic() = null; service_role vốn bypass RLS. Không đụng anon/authenticated.
grant usage on schema app to service_role;
grant execute on function app.is_admin(), app.my_pic(), app.can_see_record(text) to service_role;

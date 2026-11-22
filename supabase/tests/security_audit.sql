-- security_audit.sql – M9-3/M9-4: quét catalog theo checklist bảo mật (IMPLEMENTATION_TASKS "Checklist Claude review").
-- CHỈ ĐỌC catalog (không đọc dữ liệu hồ sơ, không ghi). Mỗi dòng trả về = 1 vi phạm; 0 dòng = đạt.
--   CI:            psql -AtF ' | ' -f supabase/tests/security_audit.sql  (job db: fail nếu có dòng)
--   DEV / PROD:    dán vào SQL Editor của Supabase, hoặc psql với chuỗi kết nối chỉ đọc.
-- Chỉ xét schema public + app (của hệ thống). Không xét auth/storage/extensions (Supabase quản lý).
with rel as (
  select c.oid, n.nspname || '.' || c.relname as obj, c.relkind::text as kind,
         c.relrowsecurity, c.relforcerowsecurity, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm')
),
fn as (
  select p.oid, p.oid::regprocedure::text as obj, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
),
roles(r) as (values ('anon'), ('authenticated')),
pg17 as (select current_setting('server_version_num')::int >= 170000 as yes)
-- 1) RLS bật trên mọi bảng public; không dùng FORCE (DATABASE_SCHEMA §5)
select '1 bảng public chưa bật RLS' as kiem_tra, obj as doi_tuong
from rel where kind in ('r', 'p') and obj like 'public.%' and not relrowsecurity
union all
select '1 bảng dùng FORCE RLS', obj from rel where relforcerowsecurity
-- 2) View phải security_invoker (RLS của người gọi áp vào bảng gốc)
union all
select '2 view thiếu security_invoker', obj
from rel where kind in ('v', 'm')
  and not coalesce(reloptions && array['security_invoker=true', 'security_invoker=on', 'security_invoker=1'], false)
-- 3) SECURITY DEFINER phải có search_path rỗng
union all
select '3 SECURITY DEFINER thiếu search_path=''''', obj
from fn where prosecdef and not coalesce(proconfig && array['search_path=""', 'search_path='], false)
-- 4) anon không có quyền gì trên bảng/view/sequence/hàm của hệ thống (form công khai đi qua Edge + service_role)
union all
select '4 anon có quyền trên bảng/view', obj
from rel where has_table_privilege('anon', oid, 'select,insert,update,delete,truncate,references,trigger')
union all
select '4 anon có quyền trên sequence', n.nspname || '.' || c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app') and c.relkind = 'S'
  and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage,select,update') else false end
union all
select '4 anon gọi được hàm', obj from fn where has_function_privilege('anon', oid, 'execute')
-- 5) TRUNCATE (bỏ qua RLS) / REFERENCES / TRIGGER / MAINTAIN không cấp cho vai trò API
union all
select '5 ' || r || ' có TRUNCATE/REFERENCES/TRIGGER', obj
from rel cross join roles where has_table_privilege(r, oid, 'truncate,references,trigger')
union all
select '5 ' || r || ' có MAINTAIN', obj
from rel cross join roles cross join pg17
where case when pg17.yes then has_table_privilege(r, oid, 'maintain') else false end
-- 6) View chỉ để đọc
union all
select '6 authenticated ghi được vào view', obj
from rel where kind in ('v', 'm') and has_table_privilege('authenticated', oid, 'insert,update,delete')
-- 7) Mặc định cho bảng MỚI (role postgres chạy migration): không tự cấp TRUNCATE/REFERENCES/TRIGGER/MAINTAIN cho anon/authenticated
union all
select '7 default privileges cấp ' || a.privilege_type || ' cho ' || a.grantee::regrole::text,
       coalesce(n.nspname, '(mọi schema)') || ' / loại ' || d.defaclobjtype::text
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
where d.defaclrole = (select oid from pg_roles where rolname = 'postgres')
  and coalesce(n.nspname, 'public') in ('public', 'app')
  and a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
  and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')
order by 1, 2;

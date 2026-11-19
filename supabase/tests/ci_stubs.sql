-- Dựng phần "nền Supabase" tối thiểu trên Postgres trống để áp migrations + chạy test RLS trong CI.
-- CHỈ dùng cho DB tạm trong CI, KHÔNG chạy trên Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
grant usage on schema auth to anon, authenticated, service_role;

-- Giống auth.uid() của Supabase: lấy "sub" trong JWT claims của request.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- Supabase cấp sẵn quyền dùng schema public cho các vai trò API
grant usage on schema public to anon, authenticated, service_role;

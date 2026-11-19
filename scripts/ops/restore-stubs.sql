-- Chuẩn bị Postgres trống (container trong GitHub Actions) để thử restore bản dump schema public + app của Supabase.
-- Dump không chứa schema auth/extensions và vai trò của Supabase, nên tạo bản giả tối thiểu để các đối tượng
-- (FK profiles -> auth.users, hàm gọi auth.uid(), policy "to authenticated", index gin_trgm_ops) dựng được.
-- CHỈ chạy trên DB thử restore, KHÔNG chạy trên Supabase.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

alter table public.recruitment_records add column if not exists legacy_code text;
create index if not exists rr_legacy_code_idx on public.recruitment_records (legacy_code) where legacy_code is not null;
create table if not exists public.import_batches (
  id bigint generated always as identity primary key,
  source text not null,
  row_count int not null default 0,
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon, authenticated;
alter table public.recruitment_records add column if not exists import_batch_id bigint references public.import_batches(id);
create index if not exists rr_import_batch_idx on public.recruitment_records (import_batch_id) where import_batch_id is not null;

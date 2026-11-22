-- M2-7: 20.000 hồ sơ GIẢ + 5.000 bình luận cho đo hiệu năng. CHỈ chạy trên DB tạm của CI (có COMMIT)
-- hoặc project Supabase THỬ NGHIỆM riêng cho k6 (M9-2, RUNBOOK §6): psql "$TEST_DB_URL" -v skip_users=1 -f …
-- (skip_users: không chèn thẳng auth.users – trên Supabase thật tạo user qua admin-users; cần sẵn ≥1 Admin).
-- KHÔNG chạy trên DEV/PROD.
-- Sinh cố định (setseed) để các lần chạy so được với nhau.
select setseed(0.20261119);

\if :{?skip_users}
\echo 'skip_users: không tạo user giả (dùng Admin có sẵn làm tác giả bình luận)'
\else
insert into auth.users (id) values ('00000000-0000-4000-8000-0000000003a0'), ('00000000-0000-4000-8000-0000000003b1');
insert into public.profiles (id, username, role, pic_code) values
  ('00000000-0000-4000-8000-0000000003a0', 'perf_admin', 'admin', null),
  ('00000000-0000-4000-8000-0000000003b1', 'perf_ta3', 'pic', 'TA3-Thang');
\endif

with pics as (select array_agg(code order by sort_order) a from public.pics),
     g as (select g, random() r1, random() r2, random() r3, random() r4, random() r5, random() r6 from generate_series(1, 20000) g)
insert into public.recruitment_records (
  candidate_code, pic, full_name, phone, position, rank, region, location, site, sub_source, source,
  r1_date, r1_status, r2_date, r2_status, ob_date, ob_status, emp_status, created_at)
select
  'P' || lpad(g::text, 6, '0'),
  case when r6 < 0.01 then null else (select a from pics)[1 + (g % 32)] end,
  (array['Nguyễn','Trần','Lê','Phạm','Hoàng','Huỳnh','Phan','Vũ','Võ','Đặng'])[1 + g % 10] || ' ' ||
  (array['Văn','Thị','Hữu','Ngọc','Minh','Thanh'])[1 + (g / 10) % 6] || ' ' ||
  (array['An','Bình','Châu','Dũng','Hà','Hùng','Lan','Linh','Nam','Phúc','Quân','Trang'])[1 + (g / 60) % 12],
  case when r5 < 0.08 then '' else (900000000 + (g * 7919) % 99999999)::text end,
  (array['Nhân viên Kho','Nhân viên Lái xe nâng','Thủ Kho','Giám sát kho','Nhân viên đóng gói'])[1 + (g / 7) % 5],
  (array['6A','6B','5A','4C'])[1 + (g / 3) % 4],
  (array['Miền Bắc','Miền Trung','Miền Nam'])[1 + (g / 11) % 3],
  (array['Bắc Ninh','Nghệ An','Bình Dương'])[1 + (g / 11) % 3],
  (array['DC Bắc Ninh','DC Nghệ An','DC Bình Dương 1'])[1 + (g / 11) % 3],
  (array['Facebook Ads','Zalo','TopCV (Apply)','Referrals'])[1 + (g / 5) % 4],
  (array['Social Media','Social Media','Jobsite','Internal'])[1 + (g / 5) % 4],
  date '2025-01-01' + (r1 * 680)::int + 2,
  case when r2 < 0.10 then '' when r2 < 0.62 then 'Passed' when r2 < 0.92 then 'Failed' else 'Pending' end,
  case when r2 between 0.10 and 0.62 and r3 < 0.6 then date '2025-01-01' + (r1 * 680)::int + 6 end,
  case when r2 between 0.10 and 0.62 and r3 < 0.6 then (case when r4 < 0.5 then 'Passed' when r4 < 0.8 then 'Failed' else 'Canceled' end) else '' end,
  case when r2 between 0.10 and 0.62 and r3 < 0.6 and r4 < 0.5 then date '2025-01-01' + (r1 * 680)::int + 15 end,
  case when r2 between 0.10 and 0.62 and r3 < 0.6 and r4 < 0.5 then (case when r5 < 0.7 then 'Joined' when r5 < 0.85 then 'Noshow' else 'Canceled' end) else '' end,
  case when r2 between 0.10 and 0.62 and r3 < 0.6 and r4 < 0.5 and r5 < 0.7 then (case when r6 < 0.5 then 'Active' else 'Resigned' end) else '' end,
  timestamptz '2025-01-01' + (r1 * 680) * interval '1 day'
from g;

insert into public.comments (record_id, author_id, author_username, author_role, body)
select r.id, a.id, a.username, 'admin', 'Ghi chú ' || r.id
from public.recruitment_records r
cross join (select id, username from public.profiles where role = 'admin'
            order by (username = 'perf_admin') desc, username limit 1) a
where r.id % 4 = 0 or r.id % 3 = 0 and r.pic = 'TA3-Thang';

analyze;
select (select count(*) from public.recruitment_records) records, (select count(*) from public.comments) comments,
       (select count(*) from public.recruitment_records where pic = 'TA3-Thang') ta3_records;

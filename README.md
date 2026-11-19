# NEW – Hệ thống tuyển dụng (Zero-Budget)

**Stack:** React + Vite + TypeScript + Tailwind · Supabase (PostgreSQL, Auth, RLS, Realtime) · Cloudflare Pages (D-01) · GitHub.
Google Sheets chỉ dùng import/export/backup.

## Cấu trúc
- `frontend/` – ứng dụng React + Vite
- `supabase/` – migrations, RLS policies, seed
- `docs/` – kế hoạch và tài liệu kiến trúc (ARCHITECTURE, DATABASE_SCHEMA, API_SPEC, MIGRATION_PLAN, IMPLEMENTATION_TASKS)
- `scripts/` – script migration/import/export

## Phân công
- Claude: audit, thiết kế schema/API/RLS, review.
- Antigravity: triển khai theo tài liệu đã duyệt.
- Product Owner: cung cấp dữ liệu, duyệt schema, nghiệm thu.

## Quy tắc
- Không để Service Role Key ở frontend; không tải toàn bộ dữ liệu; không xóa dữ liệu cũ.
- Mọi thay đổi schema/API phải được ghi lại và duyệt.
- Không để hai AI sửa cùng một module/file đồng thời.

## Kiểm tra trước khi commit
```
npm install
npm run check      # guard (chặn bí mật/dữ liệu thật) + typecheck + lint + test
```
Gốc repo là thư mục `NEW/`. `OLD/` và `Master.xlsx` nằm ngoài repo; `.env`, `etl-out/`, `*.csv`, `*.xlsx` bị chặn bởi `.gitignore` và `scripts/ci/guard.sh`.

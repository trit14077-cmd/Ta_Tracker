# RUNBOOK – Vận hành TA Tracker (M9-7)

Dành cho người vận hành (PO/Admin kỹ thuật). Hướng dẫn cho TA/Admin dùng app: `USER_GUIDE.md`.
Quy tắc chung: **không dán khóa/mật khẩu vào chat hoặc Git**; mọi bí mật để ở GitHub Secrets, Supabase secrets hoặc `NEW/.env` (không commit). Thao tác có ghi dữ liệu trên PROD: làm theo đúng mục dưới, có người thứ hai xem cùng.

## 1. Bản đồ hệ thống

| Thành phần | Ở đâu | Cấu hình / bí mật |
|---|---|---|
| Giao diện web (React) | Cloudflare Pages, build từ `frontend/` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (khóa công khai) |
| Trang ứng tuyển công khai | `frontend/apply.html` (cùng build) trên tên miền công ty | link mỗi TA lấy trong app ("Ứng tuyển online") |
| Database + đăng nhập | Supabase (Postgres 17 + Auth) | migrations `supabase/migrations/0001…`; Auth: rate limit, leaked password protection (SECURITY_REVIEW S6) |
| Edge Functions | Supabase: `records-save`, `records-import`, `files`, `hr-info-save`, `hr-form`, `admin-users`, `audit-purge`, `drive-check`, `apply` (công khai) | Supabase secrets: `ALLOWED_ORIGINS`, `APPLY_ORIGINS`, `GOOGLE_OAUTH_CLIENT_ID/_CLIENT_SECRET/_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `APPLY_MAX_PER_HOUR`, `APPLY_MAX_PER_IP` |
| File CV / giấy tờ | Google Drive (thư mục gốc của tài khoản hệ thống) | OAuth ở trên; kiểm bằng `drive-check` |
| CI | GitHub Actions `ci.yml` (mọi PR) | không cần secret |
| Deploy Edge | `deploy-dev.yml` (bấm tay) | `SUPABASE_ACCESS_TOKEN`, variable `SUPABASE_DEV_PROJECT_REF` |
| Backup + giữ hoạt động | `backup-and-keepalive.yml` (02:17 VN hằng ngày) | `SUPABASE_DB_URL` (session pooler), `BACKUP_PASSPHRASE`, tùy chọn `GDRIVE_SA_JSON`, `GDRIVE_FOLDER_ID`, `ALERT_TELEGRAM_*`, variable `DB_WARN_MB` |
| Canh backup | `backup-watchdog.yml` (08:47 VN hằng ngày) | `ALERT_TELEGRAM_*` (tùy chọn) |
| Diễn tập phục hồi | `restore-drill.yml` (bấm tay) | `RESTORE_DB_URL` (project THỬ NGHIỆM), `BACKUP_PASSPHRASE`, Drive như trên |

## 2. Triển khai thay đổi

Thứ tự luôn là **migration → Edge Function → giao diện** (giao diện mới cần API mới; API mới cần cột/hàm mới).

1. PR xanh CI (guard, typecheck, lint, test, build, quét lộ khóa, migrations + toàn bộ test SQL + `security_audit.sql`).
2. **Migration**: áp từng file theo số thứ tự, đúng một lần (Supabase CLI `supabase db push`, hoặc SQL Editor). Kiểm lại danh sách migration trên project. Sau đó chạy `supabase/tests/security_audit.sql` trong SQL Editor ⇒ **0 dòng**.
3. **Edge Function**: Actions > `deploy-dev` > Run workflow (để trống = tất cả; `apply` tự deploy với `--no-verify-jwt`).
4. **Giao diện**: merge vào nhánh chính ⇒ Cloudflare Pages tự build.
5. Kiểm sau deploy: đăng nhập Admin + 1 TA, mở Ứng viên / Kanban / Báo cáo; `npx tsx scripts/security/smoke.ts` (yêu cầu bị từ chối, không ghi dữ liệu) ⇒ "0 chưa đạt".

Việc đang chờ trên DEV (22/11/2026): apply **0027 → 0028 → 0029 → 0030**, rồi deploy lại toàn bộ Edge Function.

## 3. Rollback

| Hỏng ở đâu | Cách quay lại | Ghi chú |
|---|---|---|
| Giao diện | Cloudflare Pages > Deployments > bản trước > "Rollback to this deployment" | Không ảnh hưởng dữ liệu |
| Edge Function | Tạo nhánh từ commit tốt gần nhất (hoặc `git revert` commit lỗi), chạy `deploy-dev` trên nhánh đó | Tương thích với DB hiện tại vì migration chỉ thêm |
| Migration | Không có "down". Viết migration MỚI sửa tiến (số tiếp theo), qua CI rồi áp | Lỗi làm hỏng dữ liệu ⇒ dừng ghi (§8 "đóng băng") và phục hồi theo §4 |
| Lô nhập Excel sai | App: Nhập Excel > "Lịch sử nhập và hoàn tác theo lô" > Hoàn tác… (chạy thử trước, rồi xóa thật). Chỉ gỡ hồ sơ chưa sửa và chưa có dữ liệu con; có bản chụp trong Nhật ký (`IMPORT_ROLLBACK`) | Lô ETL (`etl:*`) không hoàn tác được bằng nút này |
| Sau cutover, lỗi nghiêm trọng | MIGRATION_PLAN §7: đóng băng hệ mới, xuất phần phát sinh, mở lại hệ cũ (giữ chỉ đọc đến khi nghiệm thu) | PO quyết |

## 4. Backup và phục hồi

### 4.1 Backup hằng ngày (lớp 1, D-12)

- `backup-and-keepalive` chạy 02:17 VN: đếm số dòng nguồn ⇒ đo dung lượng DB ⇒ `pg_dump` schema `public` + `app` và **dữ liệu tài khoản** (`auth.users`, `auth.identities`) ⇒ **thử restore vào Postgres trống và so số dòng** ⇒ gói `supra_YYYYMMDD_HHMM.tar` (2 dump + `src_counts.txt`) ⇒ mã hóa AES256 ⇒ Drive `db-backups/` (giữ 30 bản mới nhất). Chưa có Drive ⇒ artifact 7 ngày trên GitHub.
- Gói chứa dữ liệu cá nhân và mật khẩu đã băm: chỉ người được PO chỉ định giữ `BACKUP_PASSPHRASE` (cất trong trình quản lý mật khẩu, **mất là không giải mã được**).
- Lớp 2 (xuất Sheets để đọc bằng Excel): **chưa làm** – chờ PO chốt phạm vi cột (xem IMPLEMENTATION_TASKS M9-5).

### 4.2 Phục hồi (diễn tập trước nghiệm thu; sự cố thật)

1. Tạo project Supabase **trống** (gói Free cho 2 project đang chạy: khi diễn tập có thể tạm dừng project khác) – lấy chuỗi **Session pooler** (cổng 5432).
2. Checkout commit có đúng các migration mà DB nguồn đã áp (bản dump chỉ mang dữ liệu; cấu trúc + quyền lấy từ migrations).
3. Chạy một trong hai:
   - GitHub: secret `RESTORE_DB_URL` = chuỗi ở bước 1 ⇒ Actions > `restore-drill` > Run (để trống = bản mới nhất trên Drive, hoặc nhập run id của lần backup có artifact).
   - Máy có psql 17: `TARGET_DB_URL=… BACKUP_PASSPHRASE=… bash scripts/ops/restore_supabase.sh <gói>.tar.gpg`.
   Script **từ chối** nếu project đích đã có hồ sơ/tài khoản; áp migrations; nạp dữ liệu trong 1 giao dịch (không chạy trigger nhật ký); so số dòng với `src_counts.txt` ⇒ "PHỤC HỒI ĐẠT".
4. Đối chiếu sâu: `.env` trỏ project mới (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ENV=restore`) ⇒ `npx tsx scripts/migrate/reconcile.ts` ⇒ 11/11.
5. Sự cố thật: cấu hình lại Edge secrets + deploy Edge vào project mới, đổi `VITE_SUPABASE_*` trên Cloudflare Pages, đổi `SUPABASE_DB_URL` của backup. Tài khoản đăng nhập giữ nguyên mật khẩu (đã phục hồi `auth.users`); nếu gói không có dữ liệu tài khoản ⇒ tạo lại bằng màn Tài khoản (MIGRATION_PLAN §7).
6. Diễn tập xong: xóa project thử nghiệm (có dữ liệu cá nhân).

Giải mã tay để xem: `gpg --decrypt -o goi.tar goi.tar.gpg && tar -xf goi.tar` (làm trên máy tin cậy, xóa ngay sau khi dùng).

### 4.3 Giám sát backup

| Tín hiệu | Ý nghĩa | Làm gì |
|---|---|---|
| Email GitHub "backup-and-keepalive failed" / Telegram "FAIL" | Lần backup đó hỏng (kết nối, dump, restore lệch số dòng) | Mở run, đọc bước đỏ; chạy lại bằng Run workflow |
| `backup-watchdog` đỏ / Telegram "CẢNH BÁO backup" | > 36 giờ chưa có backup thành công, hoặc GitHub đã tự tắt lịch (repo 60 ngày không commit) – watchdog tự bật lại | Kiểm tra secrets, chạy tay `backup-and-keepalive` |
| **Thứ Hai không nhận tin "backup tuần này bình thường"** | Cả backup lẫn watchdog có thể đã ngừng | Vào Actions kiểm tra cả hai workflow |
| Cảnh báo "DB … MB ≥ ngưỡng" | Sắp chạm 500 MB gói Free | §5 |

## 5. Dung lượng và hạn mức (gói Free – ARCHITECTURE §7)

- **DB 500 MB**: xem Summary của mỗi lần backup (tổng + 8 bảng lớn nhất). ≥400 MB (mặc định `DB_WARN_MB`) ⇒ Admin dùng thẻ dọn nhật ký cũ hơn 12 tháng trên màn Nhật ký (xuất CSV lên Drive thư mục "TA Tracker Nhật ký" rồi mới xóa), sau đó cân nhắc Supabase Pro.
- **Egress 5 GB/tháng, Edge 500.000 lượt/tháng, MAU**: không đo được bằng SQL – đầu mỗi tháng xem Supabase Dashboard > Usage, ghi vào sổ vận hành.
- **Tạm dừng sau 7 ngày không hoạt động**: backup hằng ngày có truy vấn DB nên giữ project chạy; nếu project vẫn bị pause ⇒ Dashboard > Restore project, rồi kiểm tra workflow backup.
- **Drive**: dung lượng tài khoản hệ thống (CV + backup 30 bản).

## 6. Kiểm thử tải (M9-2)

Chạy trên project Supabase **thử nghiệm riêng** – không chạy trên DEV/PROD (kịch bản có ghi).

1. Tạo project thử nghiệm; áp toàn bộ migrations; tạo 1 Admin (bootstrap như DEV: `scripts/ops/bootstrap_admin.py`).
2. Sinh 20.000 hồ sơ giả: `psql "$TEST_DB_URL" -v skip_users=1 -f supabase/tests/perf_seed.sql`.
3. Đăng nhập Admin, tạo ≥4 tài khoản TA thử nghiệm (PIC có trong danh mục, ví dụ `TA3-Thang`) + giữ 1 Admin.
4. Ghi file `etl-out/k6_users.json` (đã gitignore): `[{"email":"…","password":"…"}, …]`.
5. Cài k6 (https://k6.io) rồi chạy:
   ```
   k6 run -e SUPABASE_URL=https://<ref>.supabase.co -e SUPABASE_ANON_KEY=<khóa công khai> \
          -e K6_USERS_FILE=etl-out/k6_users.json -e K6_WRITE=1 -e K6_ALLOW_WRITE_HOST=<ref>.supabase.co \
          -e K6_VUS=20 -e K6_DURATION=10m --summary-export etl-out/k6_summary.json scripts/perf/k6-load.js
   ```
6. Đạt khi k6 báo mọi threshold ✓: `page_dashboard` p95 < 3000 ms, `page_list` p95 < 2000 ms, `page_kanban` p95 < 1000 ms, `http_req_failed` < 1 %, `checks` > 99 %, `lost_writes` = 0. Ghi số đo vào ACCEPTANCE_CHECKLIST §3, đính kèm `k6_summary.json` vào báo cáo.
7. Xóa project thử nghiệm sau khi đo.

Lần đo đầu nên chạy thêm 1 lượt với cold start (đợi 15 phút không gọi Edge) để thấy độ trễ lưu hồ sơ lần đầu.

## 7. Kiểm thử bảo mật định kỳ

- Mọi PR: CI chạy `security_audit.sql`, `secretScan.ts --bundle --history`, `guard.sh`.
- Sau mỗi lần deploy lên DEV/PROD: `npx tsx scripts/security/smoke.ts` (thêm `SMOKE_TA_EMAIL/SMOKE_TA_PASSWORD` của tài khoản TA thử nghiệm để chạy nhóm TA), và `security_audit.sql` trong SQL Editor.
- Mỗi quý: Supabase Dashboard > Advisors > Security; so với SECURITY_REVIEW.md; rà danh sách tài khoản còn hoạt động.
- Viết migration mới: tạo bảng ⇒ `enable row level security` + policy + `revoke all … from anon` + grant tường minh; tạo hàm ⇒ `revoke all on function … from public, anon` rồi grant cho vai trò cần (CI `security_audit.sql` sẽ chặn nếu quên).

## 8. Sự cố thường gặp

| Triệu chứng | Nguyên nhân hay gặp | Xử lý |
|---|---|---|
| Form ứng tuyển báo lỗi / 401 | `apply` deploy còn kiểm JWT | Deploy lại `apply` bằng `deploy-dev` (tự thêm `--no-verify-jwt`) |
| Form ứng tuyển "Hệ thống đang bận" lặp lại | Drive lỗi hoặc giới hạn gửi | `drive-check` (Admin); xem `APPLY_MAX_PER_HOUR` / `APPLY_MAX_PER_IP` |
| Lỗi CORS trên trình duyệt | Origin của app/trang tuyển dụng chưa có trong `ALLOWED_ORIGINS` / `APPLY_ORIGINS` | Thêm vào Supabase secrets, deploy lại function |
| Tải/xem file báo "Chưa cấu hình Google Drive" | Thiếu/hết hạn secret Google OAuth | Chạy `drive-check`; cấp lại refresh token |
| Lưu hồ sơ báo "đã được người khác sửa" | Hai người sửa cùng lúc (409) – bình thường | Chọn giữ bản nào trong hộp xung đột |
| "Dữ liệu gửi lên quá lớn" (413) | Body vượt giới hạn (JSON 1 MB, nhập 16 MB/lô, CV 5 MB, file 10 MB) | Chia nhỏ file nhập; nén CV |
| Script đối chiếu / service_role báo 42501 "schema app" | Thiếu migration 0029 | Apply 0029 |
| ETL `master.ts` dừng "thiếu tên vị trí 18.11" | Thiếu migration 0027 | Apply 0027; trước khi chạy ETL chép `etl-out/migrate` sang chỗ khác |
| Backup lỗi ở bước restore "foreign key … profiles" | Bảng giả auth.users thiếu id | Đã xử lý (nạp id trước khi restore) – nếu vẫn gặp, kiểm quyền đọc `auth.users` của `SUPABASE_DB_URL` |

## 9. Tài khoản

- Tạo / khóa / đổi quyền / đặt lại mật khẩu: màn **Tài khoản** (Admin). TA bắt buộc có mã PIC. TA nghỉ việc ⇒ **khóa** (không xóa) để giữ nhật ký; chuyển hồ sơ sang PIC khác bằng sửa cột PIC (Admin).
- Quyền xem target của TA khác: bật "Xem mọi target" cho từng TA ở màn Tài khoản (Admin).
- Không dùng chung tài khoản; tài khoản thử nghiệm (smoke/k6) phải khóa sau khi dùng.

## 10. Nhật ký thay đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 22/11/2026 | Bản đầu (M9-7): bản đồ hệ thống, triển khai, rollback, backup/phục hồi (gói có dữ liệu tài khoản + restore_supabase.sh + restore-drill), giám sát (watchdog, tin thứ Hai, dung lượng DB), k6, bảo mật định kỳ, sự cố thường gặp |

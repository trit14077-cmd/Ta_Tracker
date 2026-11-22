# SECURITY_REVIEW – Biên bản review bảo mật (M9-3 / M9-4)

| Mục | Nội dung |
|---|---|
| Ngày | 22/11/2026 |
| Người review | Claude (theo checklist IMPLEMENTATION_TASKS "Checklist Claude review bảo mật") |
| Phạm vi | `supabase/migrations` 0001–0030, `supabase/functions/*`, `frontend/src` (bundle), lịch sử Git (44 commit), DEV `ksxolswxegukfttsumoq` (migration 0001–0026, chỉ đọc) |
| Cách làm | Đọc code; quét catalog Postgres trên DEV (chỉ SELECT catalog); Supabase Security Advisor; quét bundle + lịch sử Git; gọi thử Edge/PostgREST trên DEV bằng yêu cầu **phải bị từ chối** (không ghi dữ liệu) |
| Kết luận | **Không có lỗi High.** 2 Medium + 2 Low đã sửa trong code/migration (chờ deploy/apply); 1 Medium + 1 Low cần cấu hình/xác minh phía PO; còn lại Info |

Claude không kết luận về mặt pháp lý (Nghị định 13/2023 – ARCHITECTURE §6).

## 1. Công cụ kiểm lặp lại được

| Công cụ | Chạy ở đâu | Kiểm gì |
|---|---|---|
| `supabase/tests/security_audit.sql` | CI job `db` (mọi PR); DEV/PROD: dán vào SQL Editor | RLS bật/không FORCE, view `security_invoker`, SECURITY DEFINER có `search_path=''`, anon không có quyền bảng/sequence/hàm, anon/authenticated không TRUNCATE/REFERENCES/TRIGGER/MAINTAIN, view chỉ đọc, default privileges. 0 dòng = đạt |
| `scripts/security/secretScan.ts --bundle frontend/dist --history` | CI job `node` | service_role JWT (giải mã payload – anon key được phép), `sb_secret_`, private key, JSON service account, OAuth client secret / refresh token Google, chuỗi kết nối DB có mật khẩu, token Telegram; tên biến chỉ-server trong bundle |
| `scripts/ci/guard.sh` | CI job `guard`, `npm run check` | file cấm (.env, .xlsx, .csv, dump…) và nội dung giống khóa trong repo |
| `scripts/security/smoke.ts` | máy PO, sau deploy (DEV rồi PROD) | 401 khi không đăng nhập, CORS origin lạ, anon đọc/sửa/xóa bảng, anon/TA gọi thẳng RPC ghi, body quá lớn, link ứng tuyển sai; nhóm TA (cần tài khoản TA thử nghiệm): chức năng Admin, hồ sơ/HR Info/file PIC khác, file .exe đổi đuôi .pdf |
| Test Vitest | CI | `tests/functions/body-limit.test.ts` (10), `tests/security/secretScan.test.ts` (15), `records-save-m42.test.ts` (quyền hồ sơ, pic, version) |

## 2. Checklist

| # | Mục checklist | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | RLS `enable` (không `force`) mọi bảng; `anon` không quyền gì ngoài Edge công khai; `service_role` chỉ cấp bảng cần | **Đạt** sau 0030 | Quét DEV: 0 bảng thiếu RLS, 0 FORCE, anon 0 quyền bảng/sequence. Anon EXECUTE 5 hàm schema app (không có USAGE schema ⇒ không gọi được) – thu ở 0030 (S4). Smoke DEV: anon đọc 8 bảng nhạy cảm ⇒ 401 42501; PATCH/DELETE ⇒ 401. service_role: cấp từng bảng (0004 + từng migration), không default privileges |
| 2 | Không SECURITY DEFINER thiếu `search_path=''`; `check_phone/cccd` không lộ dữ liệu TA khác | **Đạt** | Quét DEV: mọi hàm definer có `search_path=""`. `check_phone`/`check_cccd` (0010) che mã/tên/PIC của PIC khác ("Ứng viên của PIC khác"); `maskDuplicates` ở Edge; `hr_test.sql` "trùng CCCD che PIC khác" |
| 3 | View dùng `security_invoker` | **Đạt** | `v_records`, `v_report_rows` `with (security_invoker = true)`; quét DEV 0 vi phạm |
| 4 | Không `service_role`/GOOGLE_SA trong bundle, log, Git (quét lịch sử) | **Đạt** | secretScan: bundle 7 file 0 phát hiện; lịch sử 44 commit 0 phát hiện; guard OK 225 file. Log Edge chỉ ghi `message` lỗi, không ghi khóa/body |
| 5 | Edge: xác thực JWT, không tin `pic` từ client, giới hạn body, CORS chặt | **Đạt** sau deploy | `getUser(jwt)` + `profiles.active` ở mọi function có đăng nhập; `pic` của TA ép = `pic_code` (validateCreate), đổi pic ⇒ 403 (test M4-2). Giới hạn body: **mới thêm** (S1). CORS: chỉ phản chiếu origin trong `ALLOWED_ORIGINS`/`APPLY_ORIGINS` – smoke DEV 8/8 function ACAO rỗng với origin lạ |
| 6 | Upload: MIME + magic bytes + dung lượng + số file; tên file chuẩn hóa | **Đạt** | `files/logic.ts checkFile` (đuôi, ≤10 MB, magic bytes – kiểm TRƯỚC khi tìm hồ sơ/Drive), `cleanOriginalName`, `MAX_PER_KIND` + RPC ≤20 đính kèm (`files_test.sql`); `apply/logic.ts validateApply` (CV ≤5 MB, magic bytes); `drivePlacement` đặt tên theo quy tắc hệ cũ |
| 7 | Export chống formula injection; TA chỉ xuất hồ sơ của mình | **Đạt** | `sanitizeCellForSpreadsheet` ở xuất danh sách (`candidateService.ts`), file lỗi nhập (`gasImport.ts`), CSV nhật ký (`audit-purge/logic.ts`). Danh sách xuất lấy qua `list_candidates` (RLS rr_read) ⇒ TA chỉ có hồ sơ PIC mình |
| 8 | Log không chứa CCCD/số tài khoản/mật khẩu | **Đạt** | HRINFO chỉ ghi tên trường (0018); `auditChanges` bỏ `temp_password`; hồ sơ chính không có cột CCCD/ngân hàng. Ghi chú: nhật ký ghi giá trị cũ/mới các trường lương như hệ cũ – chỉ Admin + TA phụ trách xem (I4) |
| 9 | Sao lưu mã hóa/hạn chế truy cập | **Đạt** (khi PO cấu hình secrets) | `backup-and-keepalive.yml`: `gpg --symmetric AES256`, xóa bản rõ ngay; đẩy thư mục Drive của tài khoản hệ thống; chưa có Drive ⇒ artifact bản mã hóa 7 ngày. Không dump schema `auth` |

## 3. Phát hiện

| Mã | Mức | Mô tả | Xử lý | Trạng thái |
|---|---|---|---|---|
| S1 | Medium | Không Edge Function nào giới hạn kích thước body; `apply` (công khai) và `files` đọc hết `formData()` rồi mới kiểm 5/10 MB ⇒ có thể bắt function giữ body rất lớn trong bộ nhớ | `readBodyLimited` đếm byte thật, dừng đọc khi vượt; 8 function; 413 | Code xong, **chờ deploy**. Smoke DEV hiện: `apply` body 7 MB ⇒ 404 (bản cũ đọc hết) |
| S2 | Medium | Default privileges của `postgres` trong `public` tự cấp TRUNCATE/REFERENCES/TRIGGER/MAINTAIN cho anon + authenticated trên mọi bảng MỚI; TRUNCATE bỏ qua RLS. Bảng hiện có đều đã revoke ⇒ chưa lộ, nhưng migration sau quên revoke là lộ | 0030 thu khỏi default privileges; `security_audit.sql` mục 5 + 7 | Code xong, **chờ apply 0030** |
| S3 | Low | `v_report_rows`: authenticated còn INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN (0011 chỉ thu của public/anon). View không cập nhật được nên chưa khai thác được | 0030: chỉ còn SELECT | Chờ apply 0030 |
| S4 | Low | 5 hàm schema app còn EXECUTE cho PUBLIC ⇒ anon (không có USAGE schema app ⇒ chưa gọi được) | 0030 thu, cấp rõ lại cho authenticated/service_role | Chờ apply 0030 |
| S5 | Medium | `apply` giới hạn theo IP lấy phần tử ĐẦU của `x-forwarded-for`. Nếu hạ tầng giữ nguyên giá trị client tự gửi, kẻ spam đổi header là vượt được giới hạn/IP (vẫn còn: ≤600/giờ/link, 1 lần/SĐT/10 phút, honeypot) | Cần xác minh trên project THỬ NGHIỆM (gửi 2 lần với `X-Forwarded-For` khác nhau, xem cột ip trong `rate_limits`) – không làm trên DEV vì ghi dữ liệu. Nếu giả được: lấy phần tử cuối/header do Supabase đặt | **Mở – PO/kỹ thuật xác minh** |
| S6 | Low | Supabase Auth: chưa bật "Leaked password protection" (Advisor); giới hạn đăng nhập sai (hệ cũ 8 lần/10 phút) nằm ở cấu hình Auth | Dashboard > Authentication: bật Leaked password protection; Rate limits đặt "sign-in/sign-ups" theo chính sách | **Mở – PO cấu hình** (có thể cần gói trả phí cho mục leaked password) |
| I1 | Info | Advisor: 23 hàm SECURITY DEFINER authenticated gọi được | Đã rà: là RPC frontend dùng, tự kiểm quyền (`app.require_admin`, `app.is_admin/my_pic`, `can_view_target`, `can_see_record`); có test SQL "chỉ Admin"/"PIC khác" (admin_test, ops_test, translations_test, applications_test, rpc_test) | Chấp nhận |
| I2 | Info | `rr_has_phone_dup`/`check_phone`/`check_cccd` cho TA biết SĐT/CCCD đã có trong hệ thống (không lộ hồ sơ) | Quy tắc nhãn trùng của hệ cũ (ARCHITECTURE §3) – giữ nguyên | Chấp nhận |
| I3 | Info | Advisor: `apply_links`, `rate_limits` bật RLS không có policy | Cố ý: chỉ service_role (Edge `apply`) dùng | Chấp nhận |
| I4 | Info | Nhật ký ghi giá trị cũ/mới các trường lương (`basic_salary`, `current_salary`, `salary_expectation`) | Như hệ cũ; đọc theo RLS nhật ký (Admin + TA phụ trách) | Chấp nhận – xem lại ở P2 cùng Q9a |
| I5 | Info | `drive-check` từ chối người chưa đăng nhập bằng 403 (không phải 401) | Vẫn chặn; không sửa | Chấp nhận |

## 4. Việc PO cần làm để đóng M9-3/M9-4

1. Apply migration theo thứ tự **0027 → 0028 → 0029 → 0030** trên DEV; chạy `security_audit.sql` trong SQL Editor ⇒ phải 0 dòng.
2. Deploy lại toàn bộ Edge Function bằng workflow `deploy-dev` (để trống tên function).
3. `npx tsx scripts/security/smoke.ts` ⇒ nhóm Ẩn danh đạt hết (kể cả `apply: body 7 MB` ⇒ 413).
4. Tạo 1 tài khoản TA thử nghiệm (PIC có hồ sơ giả), ghi `SMOKE_TA_EMAIL`/`SMOKE_TA_PASSWORD` vào `NEW/.env`, chạy lại smoke ⇒ nhóm TA đạt hết. Khóa tài khoản sau khi chạy.
5. S5, S6 như bảng trên.
6. Lặp lại bước 1–4 trên PROD trước cutover (MIGRATION_PLAN §8).

## 5. Nhật ký thay đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 22/11/2026 | Biên bản đầu (M9-3/M9-4) |

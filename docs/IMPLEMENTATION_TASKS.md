# IMPLEMENTATION_TASKS – Danh sách việc giao Antigravity

Trạng thái: **v1.0 – cổng G1 ĐÃ QUA (19/11/2026)**; được triển khai theo các tài liệu v1.0. Migration đã áp dụng trên DEV: `0001_core`, `0002_import_prep`, `0003_report_totals_min`, `0004_service_role_grants` – không sửa, thay đổi mới bắt đầu từ `0005`.
Vai trò: Antigravity = triển khai; Claude = review/bảo mật; PO = duyệt + nghiệm thu. Không hai bên cùng sửa một module/file.

## Quy tắc làm việc (bắt buộc)

1. Chỉ làm theo tài liệu đã duyệt. Điểm chưa rõ ⇒ **dừng và hỏi**, không suy đoán nghiệp vụ.
2. Không hardcode dữ liệu nghiệp vụ; không để `service_role`/khóa Google ở frontend hoặc trong Git; không tải toàn bộ dữ liệu; không xóa dữ liệu cũ; không tự đổi schema/API (đề xuất thay đổi ⇒ ghi vào "Nhật ký thay đổi" của tài liệu và chờ duyệt).
3. Tái sử dụng `src/shared/*.ts` **nguyên văn** (copy sang `NEW/` kèm test); không viết lại validate/KPI/pipeline.
4. Sau mỗi module: chạy test, báo **file thay đổi, kết quả test, lỗi còn tồn tại**; Claude review trước khi sang module kế.
5. Dữ liệu thật không đưa vào repo; chỉ dùng seed/ẩn danh.
6. Mỗi PR ≤1 module; có mô tả cách kiểm thử.

## Cổng duyệt

| Cổng | Điều kiện | Người |
|---|---|---|
| G0 | Audit + 5 tài liệu có bản v0.1 (đã xong) | Claude |
| G1 | PO trả lời D-01, D-03, D-04, D-05, D-08, D-09 và Q1–Q10 ⇒ tài liệu v1.0 – **ĐẠT 19/11/2026** (phiếu G1) | PO |
| G2 | Schema + RLS + test RLS đạt (sau M2) | Claude review |
| G3 | Backend đủ API_SPEC, golden test KPI/pipeline đạt (sau M5) | Claude review |
| G4 | Frontend parity + chạy song song (sau M8) | PO |
| G5 | Kiểm thử tải/đồng thời/bảo mật/restore đạt, Critical/High = 0 | PO + Claude |
| G6 | Cutover + nghiệm thu | PO |

Kích cỡ: S ≤ nửa ngày, M ≈ 1–2 ngày, L ≈ 3–5 ngày công của một kỹ sư *(ước lượng thô, chưa đo; điều chỉnh sau M0)*.

## M0 – Khởi tạo hạ tầng (phụ thuộc G1)

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M0-1 | Tạo repo GitHub (private); cấu trúc `NEW/{frontend,supabase,docs,scripts}`; `.gitignore` chặn `.env*`, `scripts/out/`, dữ liệu thật; CI: `tsc --noEmit`, lint, test | S | CI xanh trên PR rỗng – **19/11: đã dựng cục bộ** (gốc repo = `NEW/`, `.gitignore`, `.github/workflows/ci.yml`: guard chặn bí mật/dữ liệu thật + typecheck + lint + test + kiểm cú pháp Python; `npm run check` xanh). **ĐẠT 19/11/2026**: repo private `trit14077-cmd/Ta_Tracker` (prototype cũ giữ ở tag `prototype-2026-11-12`), CI xanh |
| M0-2 | Tạo project Supabase **dev** (đã có) và **prod** (chưa có) (2 project Free) ; bật RLS mặc định; cấu hình Auth (tắt đăng ký tự do, tắt confirm email cho miền giả D-05) | S | `GET /rest/v1/` trả 200 với anon key |
| M0-3 | Tạo dự án **Cloudflare Pages** (D-01) nối GitHub; biến môi trường chỉ có `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | S | URL preview chạy trang trống |
| M0-4 | Tạo Google service account (tài khoản hệ thống) + thư mục Drive; lưu khóa vào **Supabase secrets**. **Kiểm sớm:** service account không có dung lượng Drive riêng, ghi file vào My Drive thường có thể bị từ chối ("Service Accounts do not have storage quota"); nếu gặp ⇒ dùng Shared Drive (cần Google Workspace) hoặc OAuth của tài khoản hệ thống – ảnh hưởng D-03 và backup M9-5 | S | Edge Function thử đọc/ghi 1 file test |
| M0-5 | Supabase CLI: `supabase/migrations`, `supabase/functions`, `supabase/seed.sql`; script `db reset` chạy được | S | `supabase db reset` thành công |
| M0-7 | Chạy **sớm** workflow backup/keep-alive trên project dev để kiểm tra kết nối DB trực tiếp/pooler từ GitHub Actions (rủi ro IPv6) | S | dump thành công, restore thử được – **19/11: workflow `.github/workflows/backup-and-keepalive.yml` sẵn sàng** (pg_dump 17 qua session pooler, tự thử restore vào Postgres trống + đối chiếu số dòng, mã hóa AES256, Drive/Telegram tùy chọn). **ĐẠT 19/11/2026**: lần chạy #1 thành công qua session pooler IPv4 (`aws-0-ap-southeast-2`), restore khớp số dòng, artifact mã hóa 494 KB. Còn: cấu hình Drive (phụ thuộc M0-4) |
| M0-6 | Đo baseline hệ cũ trên Google (nút "Đo tốc độ", `loadtest_*.mjs` trên bản sao) – số liệu để so sánh nghiệm thu | M | Báo cáo baseline P50/P95 các thao tác chính |

## M1 – Thư viện dùng chung

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M1-1 | Chuyển `src/shared/*.ts` vào `NEW/shared/` (package nội bộ) dùng chung cho frontend, Edge Function (Deno), script migrate; bỏ `gasEntry.ts`, `bcrypt` | M | build được ở cả Vite và Deno – **19/11: đã chép nguyên văn 20 file (so từng byte với OLD), bỏ `gasEntry.ts`; `tsc --strict` + lint đạt. Còn: thử build ở Vite (M4) và Deno (M4-1)** |
| M1-2 | Port test hiện có của logic thuần (từ `apps-script/test/run*.mjs`) thành test độc lập (Vitest) cho: validation, pipelineRules, stage, reasonRules, dashboardCalc, candidateCode, documentRules, hrInfoRules | M | ≥ số ca hiện có; chạy trong CI – **19/11: 91 ca trong `tests/shared/`.** Test cũ là test tích hợp qua API Apps Script (676 check, phần lớn về Sheets/cache/workspace/auth không còn áp dụng); đã chuyển toàn bộ check về quy tắc nghiệp vụ thành test gọi thẳng hàm. `hrInfoRules`, `dashboardCalc` được phủ ở M1-3; test riêng `hrInfoRules` bổ sung ở M6-4 |
| M1-3 | Xuất **golden fixtures**: bộ hồ sơ seed + kết quả `totals/boardPosition/currentStage` do code cũ sinh (JSON) | S | file fixture commit được (dữ liệu giả) – **19/11: `tests/golden/fixture.json`** (400 hồ sơ giả sinh cố định; stage, ô Kanban, chỉ số phụ, số field khóa; totals/rates/retention theo 4 khoảng, theo PIC, trend). Là oracle cho M5-1/M5-2 |

## M2 – Database + RLS (cổng G2)

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M2-1 | Migration `0001_core`: `pics`, `profiles`, danh mục, `applicants`, `recruitment_records` (sinh cột **từ FIELD_CATALOG** bằng script, không gõ tay) + index | M | khớp DATABASE_SCHEMA §3, §8 (đủ 82 field) |
| M2-2 | **19/11: `0005_ops_tables` đã áp DEV (17 bảng).** Migration ops (số tiếp theo từ `0005`; tên `0002_ops` cũ không dùng vì 0002 đã là `import_prep`): status_history, interview_schedules, comments, tasks, hiring_checklists, targets, calendar_events, hr_info, hr_form_sends, record_files, translations, applications, saved_views, user_preferences, app_settings, audit_logs, rate_limits, import_batches | M | |
| M2-3 | Hàm `app.*` nền (`is_admin`, `my_pic`, `can_see_record`) + RLS toàn bộ bảng + `revoke` quyền ghi trực tiếp vào `recruitment_records` | M | **19/11: đạt trên DEV – 26/26 bảng `public` bật RLS** |
| M2-4 | **Bộ test RLS** (pgTAP hoặc script): ≥3 PIC + Admin + anon, mọi bảng × mọi thao tác (DATABASE_SCHEMA §5) | M | 100% đạt; CI chặn merge nếu fail – **19/11: `supabase/tests/rls_test.sql` (66 check, tự rollback) + job CI `db` (Postgres 17 trống: áp mọi migration rồi chạy test). Chờ kết quả CI** |
| M2-5 | Seed: pics, dropdown, hierarchy, sub_source, settings (từ `seedData.ts`) | S | **19/11: `0006_seed_catalog` (sinh bởi `scripts/seed/gen_seed_catalog.mjs`) đã áp DEV: 32 PIC, 454 giá trị/41 danh sách, 34 sub_source, 50 phân cấp, 3 cấu hình** |
| M2-6 | **19/11: `0007_write_rpcs` viết xong + test CI (`rpc_test.sql` 40 check, `concurrency_codes.sh` 20 phiên song song). **ĐẠT 19/11/2026**: CI xanh (RLS 66, RPC 40, 20 phiên đồng thời không trùng mã), đã áp DEV. Supabase security advisor còn 3 mục, đều có chủ đích: `rate_limits` không policy (chỉ service_role), `can_view_target` (policy targets cần), `next_candidate_code` (API gợi ý mã, TA chỉ PIC mình). `confirm_hire`/`reopen_hire` làm ở M6-2.** RPC ghi: `save_record`, `create_record`, `next_candidate_code` (advisory lock theo PIC), trigger `status_history`/`audit_logs` | L | test đồng thời: 20 phiên tạo mã cùng PIC không trùng |
| M2-8 | **19/11: đã áp trong 0005.** Quyền xem target (TARGET, G1): `profiles.can_view_all_targets`, `public.can_view_target(pic)`, policy `targets` theo DATABASE_SCHEMA §5; cấp quyền `service_role` cho mọi bảng mới | S | test RLS: TA thường chỉ thấy target của mình, TA được bật thấy tất cả |
| M2-7 | Kiểm kế hoạch thực thi (EXPLAIN) cho danh sách/lọc/tìm kiếm với 20.000 dòng seed | S | P95 truy vấn < 200 ms trên máy dev *(chưa đo)* – **19/11: job CI `perf` (PO chọn đo trong CI, không đụng DEV): 20.000 hồ sơ giả, 14 truy vấn × Admin/TA, 5 lần đo; so policy `rr_read` hiện hành (A) với bản viết lại cho planner dùng index (B). Lần đo 1: A chậm 7/14 truy vấn (346–1006 ms), B < 14 ms ⇒ `0008_rr_read_policy` (PO duyệt). **ĐẠT 19/11/2026**: CI xanh sau 0008 (14/14 truy vấn < 200 ms, RLS 66 + RPC 40 vẫn đạt), đã áp DEV.** |

## M3 – Auth và phân quyền

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M3-1 | Trang đăng nhập (username → email giả), đổi mật khẩu, đăng xuất, tự làm mới phiên | M | **19/11: `frontend/` (React 19 + Vite 8 + Tailwind 4 + supabase-js), chuyển từ OLD/src/App.tsx (đăng nhập, khung menu, đổi MK), i18n VI/EN chép nguyên. Đổi MK kiểm mật khẩu hiện tại như hệ cũ. Build + typecheck trong CI. PO xác nhận đăng nhập chạy được trên máy (19/11)** |
| M3-2 | Edge `admin-users` (tạo/sửa/khóa/đặt lại MK, bật/tắt `can_view_all_targets`) | M | `pic` bắt buộc `pic_code` (`MISSING_PIC`) – **19/11: đã deploy DEV (v1, verify_jwt).** Phần kiểm tra tách `logic.ts` (18 test Vitest), `deno check` trong CI; thử trên DEV: không JWT / JWT anon ⇒ 401. Khóa tài khoản = `profiles.active=false` + ban Auth; Admin không tự khóa/tự hạ quyền mình; audit không chứa mật khẩu. Admin đầu tiên tạo bằng `scripts/ops/bootstrap_admin.py` (PO tự chạy, chỉ chạy được khi chưa có Admin). Còn: PO tắt đăng ký tự do trong Auth, đặt secret `ALLOWED_ORIGINS` khi có domain frontend |
| M3-3 | Màn hình Quản lý người dùng (`UserAdminView`) | M | **19/11: chuyển từ OLD (giữ bố cục/chữ), thêm cột "Xem mọi target", bỏ cột ID/workspace, chặn tự khóa. Build đạt; PO đã thử 19/11: tạo TA + sửa (audit USER_CREATE/USER_UPDATE), TA đăng nhập đúng menu. **Còn thử: Đặt lại MK**** |
| M3-4 | Thử nạp bcrypt hash vào `auth.users` trên dev (bước thử trong D-05b; không được thì cấp mật khẩu tạm + bắt đổi) và ghi kết quả vào MIGRATION_PLAN | S | quyết định đúng/sai bằng thực nghiệm |

## M4 – Ứng viên (đọc) và Edge `records-save`

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M4-1 | Edge `records-save` (create/patch/archive/restore/move/confirm_hire/reopen_hire) theo API_SPEC §4.1, dùng `shared/` – **19/11: create/patch/move/archive/restore viết xong (logic.ts + 15 test), 0009 (TA lưu trữ hồ sơ mình như hệ cũ; chỉ Admin đổi mã UV – PO chốt), workflow `deploy-dev` (Supabase CLI). Chờ: CI, PO tạo token, deploy, thử. confirm/reopen_hire ở M6-2** | L | golden test: cùng đầu vào ⇒ cùng kết quả/lỗi như `validateAndComputeCandidate` |
| M4-2 | Test: 409 khi lệch version; `FIELD_LOCKED`; TA không sửa hồ sơ PIC khác (RLS); `pic` chỉ Admin đổi | M | |
| M4-3 | Danh sách ứng viên: phân trang server, lọc, tìm kiếm, chọn cột, View đã lưu, tùy chỉnh cột | L | tiêu chí danh sách P95 < 2 s (20.000 dòng seed) – **19/11: 0010 (danh sách, đếm KPI, kiểm trùng) + chép CandidateTableView/FormView/DetailModal/KpiStrip… từ hệ cũ; `candidateService` thay dataService (gọi records-save, list_candidates, board_counts; cột hiển thị lưu ở user_preferences). Test SQL: candidate_list 36, sql_parity 409 (chạy cả trên Postgres 17 tại máy). File CV/giấy tờ (M7-1) và lưu HR Info (M6-4) báo "chưa có". View đã lưu: chưa. Chờ: CI, áp 0010 DEV, PO thử** |
| M4-4 | Chi tiết/nhập hồ sơ (`CandidateFormView`, modal), nhập nhanh, kiểm trùng SĐT/CCCD qua RPC | L | |
| M4-5 | `ConflictResolutionModal` nối với 409 | S | |
| M4-6 | Bình luận | S | |

## M5 – Báo cáo, Kanban, KPI (cổng G3 sau M5+M6)

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M5-1 | RPC `report_totals/trend/sources/detail` | L | **0 sai lệch** so với `dashboardCalc.ts` trên golden fixtures + dữ liệu seed lớn |
| M5-2 | RPC `board_counts/board_cards` + `target_actual` + `alerts` + `calendar_range` | L | khớp `pipelineRules`/`opsRules` |
| M5-3 | Dashboard/Overview/TaCharts/FollowWD dùng RPC (không tải dòng thô) | L | tiêu chí Dashboard P95 < 3 s |
| M5-4 | Kanban (`KanbanBoardView`): tải 30 thẻ/cột + "Tải thêm", kéo thả, optimistic UI, xác nhận lưu server riêng | L | Kanban P95 phản hồi UI < 1 s |
| M5-5 | Thẻ KPI + kéo dòng vào thẻ (`PipelineKpiStrip`) | M | |

## M6 – Vận hành tuyển dụng

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M6-1 | Tasks, Interviews, Calendar, Targets | L | |
| M6-2 | Hiring checklist + Xác nhận tuyển (khóa/mở lại Admin) | M | |
| M6-3 | Alerts (chuông) | S | |
| M6-4 | HR Info: Edge `hr-info-save`, `hr-form`, banner (`HrInfoBanner`), trùng CCCD | L | |
| M6-5 | Audit view (`AuditLogView`), chính sách lưu 12 tháng (`purge_audit` + xuất Drive) | M | |

## M7 – File, form công khai, import/export

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M7-1 | Edge `files` (CV, 5 giấy tờ, Salary Proposal, Payslips) + kiểm quyền bằng `can_see_record` | L | TA `pic=null` **không** tải được file (lỗ hổng AUDIT §3.2 #1 đóng) |
| M7-2 | Panel đính kèm/giấy tờ/CV Builder/Translation | M | |
| M7-3 | Edge `apply-submit` + `apply-info` + trang tuyển dụng tĩnh + inbox (`ApplicationsInbox`) | L | chống spam đạt: SĐT 1 lần/10 phút, ≤120/giờ/link, honeypot |
| M7-4 | Edge `records-import` + `ImportExcelView` | L | báo lỗi theo dòng; rollback theo lô |
| M7-5 | Edge `export` (CSV/Sheets) + `sanitizeCellForSpreadsheet` | M | |
| M7-6 | Admin: Drop-list, Views, cấu hình (ob-target, hr-form) | M | |
| M7-7 | i18n Việt/Anh cho thông báo mới | S | |

## M8 – Migration (xem MIGRATION_PLAN.md)

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M8-0 | Thay dữ liệu thật trên DEV bằng bản ẩn danh (DEV-DATA a): bước ẩn danh trong ETL + xóa lô hiện tại + nạp lại, KPI vẫn khớp | S | DEV không còn tên/SĐT/email/địa chỉ/ngày sinh/mã NV/lương thật – **ĐẠT 19/11/2026**: `scripts/etl/anonymize_records.py` (HMAC khóa dùng 1 lần, ánh xạ một-một giữ nhóm trùng SĐT 709/709), nạp lô 4 thay lô thật 3; KPI 6/6 khớp; kiểm trên DEV: 0 SĐT/email/mã NV/ghi chú/lương thật. CSV chưa ẩn danh chỉ còn trong `etl-out/` trên máy PO |
| M8-1 | Script ETL `scripts/migrate/` (trích xuất → staging → biến đổi → nạp), dùng `src/shared`; áp E1a, Q5a (không nạp dòng lỗi, xuất báo cáo). Bản Python `scripts/etl/` hiện có chỉ là diễn tập (MIGRATION_PLAN §2.1) | L | chạy lại 3 lần cùng kết quả |
| M8-2 | Báo cáo ngoại lệ E1–E12 | M | |
| M8-3 | Bộ đối chiếu (số dòng, hash cột, KPI, board, RLS) | M | |
| M8-4 | Dry-run bản sao production → PO duyệt ngoại lệ | M | |

## M9 – Kiểm thử, bảo mật, vận hành (cổng G5)

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M9-1 | Kiểm thử chức năng theo bảng "Chức năng phải giữ" (ARCHITECTURE §3) – checklist ký từng dòng | L | |
| M9-2 | Kiểm thử tải: seed 20.000 dòng; kịch bản 20 người dùng đồng thời (đọc/lưu/Kanban/báo cáo) bằng k6 hoặc tương đương; đo P95 theo bảng nghiệm thu | L | số đo đính kèm báo cáo |
| M9-3 | Kiểm thử bảo mật: RLS (đã có), thử bypass `records-save`, upload file độc hại, rate-limit form, CORS, rò `service_role` (quét repo + bundle) | M | không lỗi High |
| M9-4 | Claude review bảo mật (checklist trong mục dưới) | M | biên bản review |
| M9-5 | Backup 2 lớp (D-12): (1) workflow `scripts/ops/backup-and-keepalive.yml` – `pg_dump` hằng ngày, mã hóa, đẩy Drive, giữ ≥30 bản; (2) Edge `backup` xuất Sheets hằng ngày (chia lô). **Thử restore** từ cả hai vào project trống | M | đối chiếu §6 MIGRATION đạt |
| M9-6 | Giữ hoạt động + giám sát: truy vấn DB hằng ngày (nằm trong workflow M9-5); cảnh báo (email/Telegram) khi workflow fail hoặc backup quá 36 giờ; theo dõi dung lượng DB/egress; kiểm tra workflow chưa bị GitHub tự tắt | S | cố ý làm hỏng job để xác nhận có cảnh báo |
| M9-7 | Tài liệu vận hành + hướng dẫn người dùng (Việt) + runbook rollback | M | |
| M9-8 | Chạy song song 2 tuần, thu phản hồi TA, sửa lỗi | L | Critical/High = 0 |
| M9-9 | Cutover (MIGRATION_PLAN §8) + nghiệm thu | M | PO ký |

## Checklist Claude review bảo mật (M9-4)

- RLS `enable` (không `force`) trên mọi bảng; `anon` không có quyền nào ngoài Edge công khai; `service_role` chỉ được cấp quyền trên bảng cần dùng.
- Không có `SECURITY DEFINER` thiếu `search_path=''`; `check_phone/cccd` không lộ dữ liệu TA khác.
- View dùng `security_invoker`.
- Không `service_role`/GOOGLE_SA trong bundle, log, hoặc Git (quét lịch sử).
- Edge Function: xác thực JWT, không tin `pic` từ client, giới hạn body, CORS chặt.
- Upload: kiểm MIME + magic bytes + dung lượng + số file; tên file được chuẩn hóa (`safeName`).
- Export: chống formula injection; TA chỉ xuất hồ sơ của mình.
- Log không chứa CCCD/số tài khoản/mật khẩu.
- Sao lưu được mã hóa/hạn chế truy cập (chứa dữ liệu cá nhân).

## Tiêu chí nghiệm thu (từ kế hoạch) – kiểm bằng nhiệm vụ nào

| Hạng mục | Mục tiêu | Nhiệm vụ kiểm |
|---|---|---|
| Dashboard | P95 < 3 s | M5-3, M9-2 |
| Danh sách | P95 < 2 s | M4-3, M9-2 |
| Kanban | P95 phản hồi UI < 1 s | M5-4, M9-2 |
| 20.000 bản ghi | tải được | M9-2 |
| 20 người đồng thời | không lỗi/không mất dữ liệu | M9-2 |
| RLS | chặn trái quyền | M2-4, M9-3 |
| KPI | khớp nguồn | M5-1, MIGRATION §6 |
| Backup | phục hồi được | M9-5 |

Các con số là mục tiêu đề xuất, không cam kết; baseline M0-6 và giới hạn gói miễn phí có thể buộc điều chỉnh.

## Nhật ký thay đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 19/11/2026 | Bản nháp đầu |
| 0.2 | 19/11/2026 | M9-5/M9-6 theo D-12; thêm M0-7 |
| 1.0 | 19/11/2026 | G1 đạt. Hosting Cloudflare Pages; số migration tiếp theo từ 0005; thêm M2-8 (quyền xem target), M8-0 (thay dữ liệu DEV bằng bản ẩn danh); M8-1 áp E1a/Q5a; checklist bỏ `force` RLS |

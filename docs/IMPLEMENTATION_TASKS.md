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
| M4-1 | Edge `records-save` (create/patch/archive/restore/move/confirm_hire/reopen_hire) theo API_SPEC §4.1, dùng `shared/` – **19/11: create/patch/move/archive/restore viết xong (logic.ts + 15 test), 0009 (TA lưu trữ hồ sơ mình như hệ cũ; chỉ Admin đổi mã UV – PO chốt), workflow `deploy-dev` (Supabase CLI). **ĐẠT 19/11**: deploy DEV qua workflow deploy-dev; smoke test bằng JWT TA thật `scripts/ops/smoke_records_save.py` 15/15 (tạo, PIC khác 403, thiếu trường 422, sửa, 409 VERSION_CONFLICT, kéo Kanban, kéo lùi 409, lưu trữ/khôi phục, sửa hồ sơ PIC khác 404, list/board_counts), tự dọn sạch. confirm/reopen_hire ở M6-2** | L | golden test: cùng đầu vào ⇒ cùng kết quả/lỗi như `validateAndComputeCandidate` |
| M4-2 | Test: 409 khi lệch version; `FIELD_LOCKED`; TA không sửa hồ sơ PIC khác (RLS); `pic` chỉ Admin đổi | M | |
| M4-3 | Danh sách ứng viên: phân trang server, lọc, tìm kiếm, chọn cột, View đã lưu, tùy chỉnh cột | L | tiêu chí danh sách P95 < 2 s (20.000 dòng seed) – **19/11: 0010 (danh sách, đếm KPI, kiểm trùng) + chép CandidateTableView/FormView/DetailModal/KpiStrip… từ hệ cũ; `candidateService` thay dataService (gọi records-save, list_candidates, board_counts; cột hiển thị lưu ở user_preferences). Test SQL: candidate_list 36, sql_parity 409 (chạy cả trên Postgres 17 tại máy). File CV/giấy tờ (M7-1) và lưu HR Info (M6-4) báo "chưa có". View đã lưu: chưa. CI xanh, **0010 đã áp DEV** (board_counts khớp 9.829 hồ sơ, rớt R1 = 3.013 như oracle). Còn: PO thử giao diện** |
| M4-4 | Chi tiết/nhập hồ sơ (`CandidateFormView`, modal), nhập nhanh, kiểm trùng SĐT/CCCD qua RPC | L | |
| M4-5 | `ConflictResolutionModal` nối với 409 | S | |
| M4-6 | Bình luận | S | |

## M5 – Báo cáo, Kanban, KPI (cổng G3 sau M5+M6)

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M5-1 | RPC `report_totals/trend/sources/detail` | L | **0 sai lệch** so với `dashboardCalc.ts` trên golden fixtures + dữ liệu seed lớn – **19/11: 0011 (report_totals/series/trend/sources/reasons/meta). Golden thêm lý do rớt, theo nhóm, theo kỳ tháng/tuần, theo nguồn, có lọc + 10 ca biên viết tay (410 hồ sơ); lead = R1 date hoặc ngày tạo như hReportRows_. report_parity_test 104 check đạt tại máy (Postgres 17), thử 12 lỗi cố ý: 11 bị bắt (1 là kiểm thừa). Tốc độ tại máy (20.000 hồ sơ, EXPLAIN): 7–141 ms. `report_detail` dời sang M5-3. CI xanh; **0011 đã áp DEV**: report_totals khớp phép đếm SQL độc lập ở 4 khoảng (toàn bộ 9.829 lead, YTD, T10, T11), tổng theo PIC = tổng chung, series 12 tháng = totals cùng khoảng; 6 hàm chạy tổng 136 ms; anon không gọi được; không có cảnh báo bảo mật mới. Còn: PO so số trên giao diện với hệ cũ (M5-3)** |
| M5-2 | RPC `board_counts/board_cards` + `target_actual` + `alerts` + `calendar_range` | L | khớp `pipelineRules`/`opsRules` – **19/11: board_counts (0010), board_page/board_cards/stage_history (0013, board_test 30 check). Còn: target_actual, alerts, calendar_range (làm cùng M6 Targets/AlertsBell/Calendar)** |
| M5-3 | Dashboard/Overview/TaCharts/FollowWD dùng RPC (không tải dòng thô) | L | tiêu chí Dashboard P95 < 3 s– **19/11: chép OverviewDashboard, TaCharts, FollowWdView từ hệ cũ, giữ giao diện; số liệu qua `reportService` (report_meta/totals/trend/reasons/series/sources + 0012 report_counts), lý do ghép bằng `donutsFromReasons` (test = donuts() trên golden); Target OB ở app_settings; FollowWD dùng list_candidates + records-save. Khác hệ cũ: lựa chọn Site/Source của biểu đồ "Performance theo TA" lấy từ toàn bộ hồ sơ thay vì dòng đang lọc. Còn: CI, áp 0012 DEV, PO so số với hệ cũ** |
| M5-4 | Kanban (`KanbanBoardView`): tải 30 thẻ/cột + "Tải thêm", kéo thả, optimistic UI, xác nhận lưu server riêng | L | Kanban P95 phản hồi UI < 1 s – **19/11: chép KanbanBoardView từ hệ cũ, nút Bảng/Kanban trong màn Ứng viên (ô tìm riêng cho Kanban vì hệ mới chưa có ô tìm đầu trang), sửa hồ sơ từ thẻ mở form. Tốc độ tại máy (20.000 hồ sơ): board_page Admin ≤ 186 ms, TA ≤ 28 ms, tải thêm ≤ 32 ms. **0013 đã áp DEV** (board_page 56 ms, board_cards 19 ms; số thẻ khớp board_counts). Đo DEV lộ board_counts (0010, thẻ KPI danh sách) ~1 s/lần → sửa ở 0014. Còn: PO thử kéo thả** |
| M5-5 | Thẻ KPI + kéo dòng vào thẻ (`PipelineKpiStrip`) | M | |

## M6 – Vận hành tuyển dụng

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M6-1 | Tasks, Interviews, Calendar, Targets | L | – **20/11: 0015 + chép TasksView, CalendarView, TargetsView, CandidateOpsPanel (lại vào cửa sổ chi tiết hồ sơ; xác nhận tuyển chờ M6-2); opsService giữ tên hàm dataService cũ. PO chốt 20/11 giữ như hệ cũ: TA sửa/xóa việc gắn hồ sơ PIC mình, chỉ người tạo/Admin xóa phỏng vấn, ghi nhật ký TASK/INTERVIEW/TARGET ngay (trigger). ops_test 44 check; lịch 1 tháng tại máy (20.000 hồ sơ) Admin ≤ 114 ms, TA ≤ 14 ms. CI xanh; **0015 đã áp DEV** (lịch T10 Admin: 1.726 mục = đếm trực tiếp ngày R1/R2/OB, 1.179 ứng viên, 339 ms; anon không gọi được; cảnh báo mới duy nhất: rr_target_actual là definer – cố ý, có kiểm can_view_target). Còn: PO thử** |
| M6-2 | Hiring checklist + Xác nhận tuyển (khóa/mở lại Admin) | M | – **20/11: 0016 (hiring_state, hire_confirm) + records-save confirm_hire/reopen_hire, kiểm bằng `records-save/hiring.ts` (dùng chung giao diện); hiring.test 10 ca, ops_test thêm 17 check (61). CI xanh (sau sửa kiểu deno check), **0016 đã áp DEV**; người dùng không gọi thẳng hire_confirm. Còn: chạy deploy-dev (records-save mới), PO thử** |
| M6-3 | Alerts (chuông) | S | – **20/11: 0017 alerts + chép AlertsBell lên thanh đầu trang (bấm hồ sơ mở cửa sổ chi tiết, "Xem công việc" sang màn Công việc). Giai đoạn khớp currentStage 410/410 golden; alerts_test 12 check, thử 6 lỗi cố ý đều bị bắt; ~9 ms trên 20.000 hồ sơ. CI xanh, **0017 đã áp DEV**: Admin thấy 266 hồ sơ Passed/Offer chưa có HR Info (= đếm trực tiếp, DEV chưa có HR Info nào), 133 Offer thiếu giấy tờ; 16 ms; anon không gọi được. Còn: PO thử** |
| M6-4 | HR Info: Edge `hr-info-save`, `hr-form`, banner (`HrInfoBanner`), trùng CCCD | L | – **20/11: 0018 + Edge hr-info-save, hr-form; chép lại HrInfoBanner nguyên bản (có lại "Link trả lời") + hrService. PO chốt: TA + Admin đều xác nhận/mở lại (như hệ cũ); đọc sheet trả lời làm sau khi có service account Google. hr_test 18, hr-info-save.test 9, deno check 4 function đạt. CI xanh, **0018 đã áp DEV** (DEV chưa có HR Info nào; người dùng chỉ còn quyền đọc hr_info, không gọi thẳng hr_info_write). Còn: deploy-dev, PO thử; tạo service account Google (dùng chung M7-1)** |
| M6-5 | Audit view (`AuditLogView`), chính sách lưu 12 tháng (`purge_audit` + xuất Drive) | M | – **20/11: 0019 + chép AuditLogView (menu Nhật ký), auditService; audit_test 19 check. CI xanh, **0019 đã áp DEV** (list_audit 9 ms; anon không gọi được). Khác hệ cũ: STAGE_MOVE ghi các trường trạng thái đổi (hộp trước/sau xem ở "Lịch sử chuyển vòng" của Kanban). Còn: PO thử; `purge_audit` 12 tháng làm cùng M7 vì phải xuất Drive trước khi xóa (cần service account Google)** |

## M7 – File, form công khai, import/export

| ID | Việc | Cỡ | Hoàn thành khi |
|---|---|---|---|
| M7-1 | Edge `files` (CV, 5 giấy tờ, Salary Proposal, Payslips) + kiểm quyền bằng `can_see_record` | L | TA `pic=null` **không** tải được file (lỗ hổng AUDIT §3.2 #1 đóng)  – **20/11: Drive qua OAuth Gmail cá nhân (secret GOOGLE_OAUTH_*, thư mục gốc TA_Tracker_Storage; `drive-check` đạt 4/4). 0022 (file_attach/remove/open/list, chỉ service_role, quyền như save_record) + Edge `files` (đuôi, ≤10 MB như form cũ, magic bytes, Rank cho Salary Proposal). files_test 28, files.test vitest. Chưa: đổi tên file khi có Emp_ID, dọn file Drive đã xóa mềm (làm cùng purge). Còn: áp 0022 DEV, deploy `files`, PO thử** |
| M7-2 | Panel đính kèm/giấy tờ/CV Builder/Translation | M | – **20/11: đính kèm + giấy tờ nối Edge `files` (M7-1; sửa nút Tải xuống/Thay của panel đính kèm); CV Builder chạy ở trình duyệt; chép nguyên TranslationPanel + 0023 (translation_list/translation_save như Docs.gs: cần bản gốc, rỗng = xóa, nhật ký TRANSLATION; bỏ quyền ghi thẳng bảng translations). translations_test 14. Còn: áp 0023 DEV, PO thử** |
| M7-3 | Edge `apply-submit` + `apply-info` + trang tuyển dụng tĩnh + inbox (`ApplicationsInbox`) | L | chống spam đạt: SĐT 1 lần/10 phút, ≤120/giờ/link, honeypot  – **20/11 (PO chọn làm code, thử trên localhost; đưa lên mạng sau): 0024 (apply_links mã ngẫu nhiên thay HMAC, hộp thư/bỏ qua/tạo hồ sơ + gắn CV, chống spam qua rate_limits) + Edge `apply` (info/submit gộp 1 function, CV lên Drive "TA Tracker CV") + `files` op app_cv; chép nguyên PublicApplyForm (trang apply.html) + ApplicationsInbox (nút Ứng tuyển online). Giữ như hệ cũ: 600 hồ sơ/giờ/link (APPLY_MAX_PER_HOUR), thêm 60/giờ/IP. applications_test 36, apply.test 6. Còn: áp 0023/0024 DEV, deploy `apply` + `files`, PO thử** |
| M7-4 | Edge `records-import` + `ImportExcelView` | L | báo lỗi theo dòng; rollback theo lô – **20/11: 0021 + Edge records-import; chép nguyên gasImport.ts + ImportExcelView (menu Nhập Excel, chỉ Admin); SheetJS bản vá 0.20.3 (cdn.sheetjs.com) thay 0.18.5 có lỗ hổng. import_test 15, records-import.test 6. Rollback theo lô: chưa (hệ cũ không có), dữ liệu đã gắn import_batch_id. CI xanh, **0021 đã áp DEV**. Còn: deploy-dev, PO thử** |
| M7-5 | Edge `export` (CSV/Sheets) + `sanitizeCellForSpreadsheet` | M | – **20/11: nút Xuất ở danh sách đổi từ CSV (M4) sang .xlsx như hệ cũ (TA_TRACKER_UngVien_<ngày>.xlsx, mọi cột fieldCatalog, tên cột Excel, chặn công thức), làm ở trình duyệt qua list_candidates – không cần Edge. Còn: PO thử** |
| M7-6 | Admin: Drop-list, Views, cấu hình (ob-target, hr-form) | M | – **20/11: 0020 + chép DropdownAdminView (menu Drop-list, có danh mục PIC như hệ cũ), thẻ cấu hình form HR dưới trang Drop-list (màn Workspace đã bỏ – D-09), adminService/adminCatalog; ob-target đã có ở TaCharts (M5-3). View: hệ cũ không có mục menu nên giữ ẩn, chỉ có RPC. admin_test 32 check; admin-catalog.test 3 (mọi cột dùng Drop-list đều ghi được). CI xanh; **0020 đã áp DEV** (PO chạy bằng SQL Editor vì lệnh apply_migration bị chặn quyền – 7 hàm, quyền đúng, unique tên view; đã ghi bổ sung vào danh sách migration của Supabase 20/11). Còn: PO thử** |
| M7-7 | i18n Việt/Anh cho thông báo mới | S | – **20/11: từ điển i18nNew.ts bổ sung cho shared/i18n.ts (giữ nguyên gốc) dịch toàn bộ câu mới của giao diện/thông báo service/Edge Function/RPC; i18nNew.test.ts (10 check) quét tự động frontend + functions + migrations đảm bảo không bỏ sót câu tiếng Việt mới nào. Build + lint + test 100% đạt** |

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

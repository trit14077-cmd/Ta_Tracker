# ANTIGRAVITY_PROMPTS – Bộ prompt giao việc theo quy trình

Quy trình: AUDIT → DESIGN → APPROVE → **IMPLEMENT → TEST → MIGRATE → ACCEPT**.
Claude = Architect/Reviewer · Antigravity = Implementation Engineer · PO = duyệt/nghiệm thu.
Cách dùng: (1) dán **Prompt khung** một lần ở đầu mỗi phiên mới của Antigravity; (2) dán lần lượt **P0 → P8**, mỗi prompt chỉ khi cổng trước đã được Claude/PO duyệt; (3) khi Antigravity báo xong, dán phần "BÁO CÁO" của nó về chat với Claude để review.

Bối cảnh hiện tại: build **local, dùng nội bộ**. Chạy `npm run dev` kết nối Supabase DEV; hosting (D-01) hoãn. Quyết định đã chốt: D-03 file giữ trên Google Drive; D-04 chỉ gộp ứng viên khi cùng SĐT hợp lệ + cùng tên; D-08 giữ Google Form HR; D-09 bỏ form nhập riêng từng TA.

## Đính chính tài liệu (áp dụng cho mọi prompt, ghi đè tài liệu cũ)

1. RLS chỉ `enable`, **không** `force` (kể cả mục checklist review bảo mật).
2. RPC gọi từ app đặt trong schema `public` (`security invoker` khi đọc, `security definer` + `set search_path=''` khi ghi có kiểm quyền). Schema `app` chỉ chứa hàm hỗ trợ.
3. Đánh số migration thực tế: `0001_core`, `0002_import_prep`, `0003_report_totals_min` **đã áp dụng trên DEV, không sửa**. Các bảng vận hành (M2-2) thành `0004_ops`, tiếp theo `0005`… Mỗi thay đổi = migration mới.
4. Bỏ M0-3 (hosting) và M0-6 (baseline hệ cũ) khỏi giai đoạn này; M0-1, M0-5 làm ở P0/P2.

---

## PROMPT KHUNG (dán đầu mỗi phiên)

```
Vai trò: Implementation Engineer cho dự án TA Tracker. Thư mục: D:\Ta_Tracker-main\NEW (không đụng OLD).
Claude là Architect/Reviewer; tôi là Product Owner. Bạn KHÔNG tự đổi thiết kế.

Đọc trước mọi việc: NEW/docs/ARCHITECTURE.md, DATABASE_SCHEMA.md, API_SPEC.md, IMPLEMENTATION_TASKS.md, ANTIGRAVITY_PROMPTS.md (mục "Đính chính tài liệu" ghi đè tài liệu cũ), và các migration trong NEW/supabase/migrations.

Quy tắc bắt buộc:
- Chỉ làm đúng phạm vi prompt. Điểm chưa rõ => dừng và hỏi, không suy đoán nghiệp vụ.
- Không hardcode dữ liệu nghiệp vụ. Không đưa service_role / khóa Google vào frontend, bundle, log hay Git. Không commit .env.
- Dữ liệu thật (Master.xlsx, CSV, đầu ra ETL) không vào Git, không gửi ra ngoài máy.
- Không xóa dữ liệu gốc; không sửa migration đã áp dụng; không tự đổi schema/API: đề xuất => ghi vào "Nhật ký thay đổi" của tài liệu rồi chờ duyệt.
- Tái sử dụng NEW/shared (copy từ OLD src/shared/*.ts) NGUYÊN VĂN; không viết lại validate/KPI/pipeline.
- Làm từng module nhỏ: mỗi module chạy test trước khi sang module kế.
- Kết thúc mỗi prompt, in BÁO CÁO gồm: (1) file đã tạo/sửa, (2) lệnh test và kết quả, (3) lỗi/giới hạn còn tồn tại, (4) việc cần Claude review, (5) đề xuất thay đổi tài liệu (nếu có). Không tự khẳng định "xong" nếu test chưa chạy.
```

---

## P0 – Nạp dữ liệu Master vào DEV (đã giao; cổng: Claude đối chiếu KPI)

```
Nhiệm vụ: nạp full dữ liệu Master vào DEV và đối chiếu KPI.
1. Chạy NEW/scripts/etl/master_to_records.py với D:\Ta_Tracker-main\Master.xlsx -> thư mục etl-out (đã trong .gitignore): records.csv, exceptions.csv, oracle_kpi.json.
2. Viết script nạp (Python hoặc Node) đọc records.csv -> public.recruitment_records:
   - 1 dòng public.import_batches; gắn import_batch_id cho mọi dòng.
   - Tạo public.pics trước (code = tên PIC), rồi nạp records theo lô 500 dòng.
   - Có dry-run; chạy lại được (dọn theo import_batch_id).
   - Service key DEV đọc từ .env; không hardcode, không in log.
   - Trước khi nạp: xóa 43 dòng mẫu (import_batches có note "DEV test").
3. Sau nạp: SELECT * FROM public.report_totals() (service role) so oracle_kpi.json:
   9829 / r1_passed 5106 / r2_passed 1658 / ob_joined 1058 / emp_active 554 / emp_resigned 509.
Báo khớp/lệch, KHÔNG sửa dữ liệu cho khớp. Chưa làm giao diện, chưa làm Edge Function.
```

## P1 – Thư viện dùng chung (M1)

```
Nhiệm vụ M1: tạo NEW/shared.
- Copy NGUYÊN VĂN từ OLD src/shared/*.ts: validation, pipelineRules, stage, reasonRules, dashboardCalc, candidateCode, documentRules, hrInfoRules, opsRules. Bỏ gasEntry.ts và phụ thuộc bcrypt.
- Đóng gói package nội bộ build được ở cả Vite (frontend) và Deno (Edge Function).
- Port test logic thuần từ OLD apps-script/test/run*.mjs sang Vitest; số ca >= hiện có; chạy trong CI (tsc --noEmit, lint, test).
- M1-3: xuất golden fixtures (JSON, dữ liệu giả/ẩn danh): bộ hồ sơ seed + totals/boardPosition/currentStage do code cũ sinh.
Không sửa logic. Nếu test cũ fail trên code cũ, báo lại, không tự sửa.
```

## P2 – Database còn lại + test RLS (M2 → cổng G2)

```
Nhiệm vụ M2 (phần chưa làm). 0001–0003 đã có.
- 0004_ops: các bảng M2-2 (status_history, interview_schedules, comments, tasks, hiring_checklists, targets, calendar_events, hr_info, hr_form_sends, record_files, translations, applications, saved_views, user_preferences, app_settings, audit_logs, rate_limits) theo DATABASE_SCHEMA. import_batches đã có, không tạo lại.
- RLS cho mọi bảng mới theo ma trận DATABASE_SCHEMA §5 (enable, không force); revoke ghi trực tiếp.
- M2-4: bộ test RLS tự động (pgTAP hoặc script): >=3 PIC + Admin + anon, mọi bảng x mọi thao tác; CI chặn merge nếu fail.
- M2-5: seed pics/dropdown/hierarchy/sub_source/settings từ seedData.ts.
- M2-6: RPC ghi public.save_record, public.create_record, public.next_candidate_code (advisory lock theo PIC), trigger status_history/audit_logs. Test đồng thời: 20 phiên tạo mã cùng PIC không trùng.
- M2-7: EXPLAIN danh sách/lọc/tìm kiếm trên 20.000 dòng seed.
Mỗi migration một file mới, thử trên DEV trước. Dừng sau M2 để Claude review (cổng G2).
```

## P3 – Auth và phân quyền (M3)

```
Nhiệm vụ M3 (frontend React+Vite+TS trong NEW/frontend, chạy local).
- M3-1: đăng nhập username -> email giả <username>@ta.supra.internal, đổi mật khẩu, đăng xuất, tự làm mới phiên. Chỉ dùng VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.
- M3-2: Edge Function admin-users (tạo/sửa/khóa/đặt lại MK); role pic bắt buộc pic_code (lỗi MISSING_PIC). Xác thực JWT, kiểm admin ở server.
- M3-3: màn hình Quản lý người dùng.
- M3-4: thử nạp bcrypt hash vào auth.users trên DEV (D-05c); ghi kết quả đúng/sai vào MIGRATION_PLAN.md (nhật ký thay đổi).
Không có đăng ký tự do. Test: PIC đăng nhập chỉ thấy dữ liệu của mình.
```

## P4 – Ứng viên: đọc và ghi (M4)

```
Nhiệm vụ M4.
- M4-1: Edge Function records-save (create/patch/archive/restore/move/confirm_hire/reopen_hire) theo API_SPEC §4.1, dùng NEW/shared. Golden test: cùng đầu vào => cùng kết quả/lỗi như validateAndComputeCandidate.
- M4-2: test 409 VERSION_CONFLICT, FIELD_LOCKED, PIC không sửa hồ sơ PIC khác, chỉ Admin đổi pic. Không tin pic từ client.
- M4-3: danh sách ứng viên: phân trang server, lọc, tìm kiếm, chọn cột, View đã lưu (P95 < 2 s trên 20.000 dòng).
- M4-4: chi tiết/nhập hồ sơ, nhập nhanh, kiểm trùng SĐT/CCCD qua RPC (không lộ dữ liệu PIC khác).
- M4-5: ConflictResolutionModal nối 409. M4-6: bình luận.
Không tải toàn bộ bảng về client.
```

## P5 – Báo cáo, Kanban, KPI (M5 → cổng G3 cùng M6)

```
Nhiệm vụ M5.
- M5-1: RPC public.report_totals (bản đầy đủ thay bản tối thiểu 0003, bằng migration mới), report_trend, report_sources, report_detail. Tiêu chí: 0 sai lệch so với dashboardCalc.ts trên golden fixtures và trên dữ liệu đã nạp (so với oracle_kpi.json).
- M5-2: board_counts, board_cards, target_actual, alerts, calendar_range khớp pipelineRules/opsRules.
- M5-3: Dashboard/Overview/TaCharts dùng RPC, không tải dòng thô (P95 < 3 s).
- M5-4: Kanban 30 thẻ/cột + Tải thêm, kéo thả, optimistic UI, xác nhận lưu server riêng (UI phản hồi < 1 s). Khóa Failed, chỉ chuyển tiến, rule lý do.
- M5-5: thẻ KPI + kéo dòng vào thẻ.
```

## P6 – Vận hành tuyển dụng (M6 → G3)

```
Nhiệm vụ M6: Tasks, Interviews, Calendar, Targets; hiring checklist (6 mục) + Xác nhận tuyển (khóa/mở lại Admin); Alerts; HR Info (Edge hr-info-save, hr-form đọc Google Form sheet theo D-08, HrInfoBanner sau R2 Passed, trùng CCCD); Audit view + purge_audit 12 tháng (xuất Drive trước khi xóa).
Log không chứa CCCD/số tài khoản/mật khẩu.
```

## P7 – File, form công khai, import/export (M7)

```
Nhiệm vụ M7 (D-03: file giữ trên Google Drive qua service account; khóa chỉ trong Supabase secrets).
- M7-1: Edge files (CV, 5 giấy tờ, Salary Proposal, Payslips), kiểm quyền bằng can_see_record. PIC không có quyền hoặc hồ sơ pic=null KHÔNG tải được.
- M7-2: panel đính kèm/giấy tờ/CV Builder/Translation.
- M7-3: Edge apply-submit + apply-info + trang tuyển dụng tĩnh + ApplicationsInbox; chống spam: SĐT 1 lần/10 phút, <=120/giờ/link, honeypot.
- M7-4: Edge records-import + ImportExcelView, báo lỗi theo dòng, rollback theo lô.
- M7-5: Edge export (CSV/Sheets) + sanitizeCellForSpreadsheet; PIC chỉ xuất hồ sơ của mình.
- M7-6: Admin Drop-list, Views, cấu hình. M7-7: i18n Việt/Anh cho thông báo mới.
Upload: kiểm MIME + magic bytes + dung lượng + số file; chuẩn hóa tên file.
```

## P8 – Kiểm thử, bảo mật, backup (M9 → G5)

```
Nhiệm vụ M9.
- M9-1: checklist chức năng theo ARCHITECTURE §3, ký từng dòng.
- M9-2: seed 20.000 dòng, 20 người dùng đồng thời (k6 hoặc tương đương); đo P95 Dashboard/Danh sách/Kanban; đính kèm số đo.
- M9-3: thử bypass records-save, upload độc hại, rate-limit form, CORS, quét repo + bundle tìm service_role/khóa Google.
- M9-5: backup 2 lớp (D-12): workflow scripts/ops/backup-and-keepalive.yml (pg_dump hằng ngày, mã hóa, đẩy Drive, giữ >=30 bản) + Edge backup xuất Sheets hằng ngày (chia lô). Thử restore từ cả hai vào project trống. (Workflow chưa từng chạy: kiểm kết nối DB trực tiếp/pooler, rủi ro IPv6.)
- M9-6: cảnh báo Telegram/email khi workflow fail hoặc backup quá 36 giờ; cố ý làm hỏng job để xác nhận có cảnh báo.
Secrets do PO tự đặt trong GitHub; không in ra log. Dừng để Claude review bảo mật (M9-4).
```

---

## Cổng và việc của PO / Claude

| Sau prompt | Ai kiểm | Nội dung |
|---|---|---|
| P0 | Claude | KPI nạp full khớp oracle |
| P2 | Claude (G2) | schema + RLS + test RLS |
| P4–P6 | Claude (G3) | golden test KPI/pipeline, bypass ghi |
| P7 | Claude | quyền file, upload, form công khai |
| P8 | PO + Claude (G5) | tải, bảo mật, restore |

Nhật ký: 0.1 – 19/11/2026 – bản đầu, theo IMPLEMENTATION_TASKS v0.2 và trạng thái DEV sau migration 0003.

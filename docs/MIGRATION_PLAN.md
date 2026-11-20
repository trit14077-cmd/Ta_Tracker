# MIGRATION_PLAN – Chuyển dữ liệu Google Sheets → Supabase

Trạng thái: **v1.0 – ĐÃ DUYỆT (cổng G1, 19/11/2026)**. Quyết định áp dụng: D-04b, D-05b, D-09a, Q5a, E1a, DEV-DATA a, Q7a, Q10b. Tham chiếu: DATABASE_SCHEMA.md (đích), AUDIT.md §4 (rủi ro dữ liệu), CON_LAI_CAN_LAM.md Phase 7 (dữ liệu thử).
Nguyên tắc: **không xóa dữ liệu cũ**; mọi bước có thể chạy lại (idempotent) trên môi trường dev trước; chỉ cutover khi đối chiếu bằng 0 sai lệch hoặc sai lệch đã được PO chấp nhận bằng văn bản.

## 1. Nguồn dữ liệu và ánh xạ

| Nguồn (sheet/nơi lưu) | Đích | Biến đổi chính |
|---|---|---|
| `Candidates` (Master, 89 cột, đọc **theo header**) | `recruitment_records` | bỏ `src_ws/sync_status/synced_at`; `id`→`legacy_id`; `''`→`null` cho `pic`, date, numeric; chuẩn hóa bằng `applyLegacyImportTransformations` + `validateAndComputeCandidate` ở chế độ "legacy" (không bắt `requiredOnCreate`); `tenor`, `cv_file` không lưu |
| `Users` | `auth.users` + `profiles` | D-05; `role`, `pic_code`, `active` giữ; `legacy_id` |
| Dropdowns, SubSource, Hierarchy, Requests | `pics`, `dropdown_options`, `sub_source_map`, `hierarchy`, `dropdown_requests` | `list_key='pic'` → `pics` |
| Comments (Master) + comment trong 30 workspace | `comments` | gộp, khử trùng theo (record, author, created_at, body); nối `candidate_id` qua `legacy_id` |
| Tasks, Interviews, Hiring, Targets, CalendarEvents | `tasks`, `interview_schedules`, `hiring_checklists`, `targets`, `calendar_events` | `owner` (username) → `owner_id`; `items` giữ JSON |
| HrInfo, HrFormSends | `hr_info`, `hr_form_sends` | `data` JSON giữ; `id_number` tách cột |
| Attachments, `cv_link`/`cv_file`, 5 cột giấy tờ | `record_files` | giữ `drive_file_id`; kiểm file tồn tại + tên theo `docFileName` |
| Translations | `translations` | |
| Applications | `applications` | |
| Views | `saved_views` | `user_ids` (id cũ) → uuid mới |
| Properties: `cols_<uid>`, ob-target, hr-form, apply page URL | `user_preferences`, `app_settings` | |
| Audit | `audit_logs` (12 tháng gần nhất) + `status_history` (từ `STAGE_MOVE`) | cũ hơn 12 tháng: xuất CSV vào Drive, không nạp |
| `Workspaces`, `SyncLog`, `Forms`, `Submissions`, `FormTemplate` | **không migrate** (lưu CSV lưu trữ). Forms/Submissions/FormTemplate: bỏ theo D-09a | |

## 2. Giai đoạn

| GĐ | Nội dung | Cổng ra (gate) |
|---|---|---|
| M0 | Dev rehearsal: dựng Supabase dev + schema, chạy ETL với dữ liệu seed của harness (`apps-script/test`) và 1 bản sao Master đã ẩn thông tin cá nhân | ETL chạy lại 3 lần cho kết quả giống nhau |
| M1 | Dry-run bản sao production (đọc-only): xuất báo cáo ngoại lệ (§4) | PO duyệt từng nhóm ngoại lệ (sửa nguồn / bỏ / ánh xạ) |
| M2 | Migrate thử toàn bộ vào staging + đối chiếu (§6) + golden test KPI | 0 sai lệch số lượng; KPI khớp; test RLS đạt |
| M3 | Chạy song song (hệ cũ **chỉ đọc**, hệ mới ghi) – theo ARCHITECTURE/IMPLEMENTATION_TASKS | TA xác nhận số liệu của mình; không lỗi Critical/High |
| M4 | Cutover: đóng băng → migrate delta → chuyển link → mở hệ mới | Checklist cutover (§8) hoàn tất |
| M5 | Sau cutover: theo dõi, giữ hệ cũ chỉ-đọc đến nghiệm thu | PO nghiệm thu |

### 2.1 Diễn tập 19/11/2026 trên DEV (ghi nhận)

- Dùng `scripts/etl/master_to_records.py` (Python, đọc `Master.xlsx`) + `scripts/etl/load_records.py` (nạp qua PostgREST bằng `service_role`, lô 500, dọn theo `import_batch_id`, có `--dry-run`). Nạp 9.829/9.829 dòng, 0 lỗi; chạy lại 2 lần cùng kết quả; `public.report_totals()` khớp oracle 6/6 chỉ số.
- **Khác với quy trình chính thức ở §4–§5, chỉ có giá trị diễn tập:** dùng Master thật chưa ẩn danh; ETL viết bằng Python, chưa dùng `src/shared` (`applyLegacyImportTransformations`, validate); E1 tự cấp mã `IT#####` (trái E1a); nạp cả dòng E3–E5 (trái Q5a); `created_at` chỉ có ngày, lưu 00:00 UTC; 1 dòng thiếu `created_at` nhận `now()`.
- **ĐÃ LÀM 19/11/2026 (M8-0):** DEV đã thay bằng bản ẩn danh (lô 4). Mô tả gốc của việc: xóa lô dữ liệu thật trên DEV và nạp lại bằng bản đã ẩn thông tin cá nhân (tên, SĐT, email, địa chỉ, ngày sinh, mã NV, lương, ghi chú tự do), giữ nguyên các cột trạng thái để KPI vẫn đối chiếu được.

### 2.2 PO chốt phạm vi 20/11/2026

- App Apps Script cũ **chưa chạy thật**; dữ liệu thật duy nhất là **bảng Master** (Excel người dùng, tiêu đề 2 tầng). Vì vậy M8 chỉ chuyển hồ sơ ứng viên (`recruitment_records`); tài khoản TA/Admin tạo mới trên hệ mới; các sheet Users/Comments/Tasks/Interviews/HrInfo/Attachments/Applications/Audit… ở §1 **không có dữ liệu để chuyển**.
- ETL: `npx tsx scripts/migrate/master.ts "<bản chụp .xlsx>"` – đọc theo đúng đường Nhập Excel của hệ cũ (dò tiêu đề, `applyLegacyImportTransformations`, `validateAndComputeCandidate`), kiểm **chặt** (Q5a), E1a; danh mục Drop-list đọc từ DB đích (chỉ đọc). Ra `etl-out/migrate/` (ngoài git): `master_records.jsonl`, `master_exceptions.csv` (E1, E3, E4, E5, E7, E8, E9, DM = ngoài danh mục), `master_merged.csv`, `master_phone_groups.csv` (E6), `master_summary.json` (tổng = nạp + gộp + ngoại lệ). Chạy lại 3 lần cùng SHA-256.
- **20/11/2026 – nạp DEV bản ẩn danh (PO chọn; dữ liệu thật không rời máy):** PO xác nhận `Master.xlsx` là bảng đúng (bản tải "The Supra.xlsx" chỉ 689 dòng). `npx tsx scripts/migrate/loadDev.ts` ẩn danh TRÊN MÁY (`anonymize.ts`, HMAC khóa dùng 1 lần, một-một) – kiểm còn sót SĐT/email/tên/mã NV thật = 0 rồi mới gửi; nạp qua `import_records` (lô 500) thay lô ETL cũ (lô 4). Kết quả: lô 5 = 8.814 hồ sơ, 0 bị từ chối; đối chiếu DEV ↔ ETL khớp (tổng 8.814, R1 Passed 4.449, R2 Passed 1.542, OB Joined 997, Active 517, 30 PIC); 0 SĐT thật, 0 lương. 2 file giấy tờ thử của PO gắn vào lô 4 bị xóa theo.
- Chưa làm: chuẩn hóa tên vị trí theo file Việt–Anh 18.11 (chờ PO duyệt bảng `De_xuat_chuan_hoa_vi_tri.xlsx`), bước nạp (dữ liệu thật **không** nạp vào DEV – M8-0), bộ đối chiếu M8-3.

## 3. Chuẩn bị trước khi trích xuất

1. **Đóng băng ghi** trên hệ cũ (thông báo cho TA/Admin, tạm dừng form ứng tuyển hoặc chấp nhận thu delta bằng `Applications`).
2. Chạy **sync-all** để Master phản ánh mọi workspace; chờ `sync_status` ≠ `pending/conflict` (AUDIT §4.1: workspace có thể giữ bản mới hơn Master). Nếu còn `conflict`, PO quyết bản nào đúng.
3. Sao chép nguyên spreadsheet "The Supra" + 30 workspace + thư mục Drive (bản chụp bất biến, đặt tên theo ngày). Không thao tác trên bản gốc.
4. Chạy `schema-check` (route cũ) để xác nhận header Master khớp `candCols_()`.
5. Ghi lại số liệu gốc: tổng dòng Master, theo PIC, theo `is_archived`, theo `r1_status/r2_status/ob_status`, tổng số comment/task/attachment.

## 4. Quy tắc chất lượng dữ liệu và ngoại lệ

ETL **không tự sửa nghiệp vụ**; mỗi dòng lỗi vào báo cáo `migration_exceptions.csv` (mã dòng, mã UV, lỗi, đề xuất). Danh mục ngoại lệ đã biết:

| Mã | Ngoại lệ | Nguồn | Xử lý đề xuất (PO duyệt) |
|---|---|---|---|
| E1 | `candidate_code` trùng giữa 2 dòng (41 cặp "cùng mã khác người" ở dữ liệu thử) | CON_LAI Phase 7 | **Đã chốt (E1a):** không nạp dòng sau; xuất để TA cấp mã mới ở nguồn theo quy tắc mã của PIC. ETL không tự cấp mã |
| E2 | Dòng "ma": có trong workspace nhưng id đè/nhân đôi do ghi kép lỗi (AUDIT §4.1) | AUDIT | so Master vs workspace theo `candidate_code`; giữ bản `row_version` cao hơn nếu khớp người, còn lại PO quyết |
| E3 | Giá trị trạng thái/lý do không có trong rule (R2_Sub "Định hướng" 86; R1 "Canceled" 77; lý do R1 "Đi lại nhiều/Gia đình…" 47; OB_Sub "Thái độ" 12) | CON_LAI Phase 7 | **Đã chốt (Q5a):** không nạp; xuất báo cáo để sửa ở nguồn, chạy lại ETL sau khi sửa |
| E4 | Kho không thuộc tỉnh (185), tỉnh không thuộc vùng (77) | CON_LAI Phase 7 | **Đã chốt (Q5a):** không nạp; xuất báo cáo. Sửa ở nguồn: sửa dòng, hoặc sửa danh mục `hierarchy` nếu kho thật sự phục vụ nhiều tỉnh, rồi chạy lại |
| E5 | SĐT sai (51), email sai (28) | CON_LAI Phase 7 | **Đã chốt (Q5a):** không nạp; xuất báo cáo để sửa ở nguồn |
| E6 | Trùng SĐT (1.385 hồ sơ) | CON_LAI | **không phải lỗi**: giữ, đánh `applicant_id` theo D-04 và xuất danh sách nhóm nghi ngờ |
| E7 | Ngày/giờ sai định dạng, ô Excel kiểu số/ngày lẫn lộn | Sheets | `parseDisplayDateToIso`, `normalizeExcelTimeValue`; không parse được ⇒ ngoại lệ |
| E8 | `pic` rỗng hoặc không có trong `pics` | AUDIT §3.2 | nạp `pic = null` (Admin thấy); PIC không có trong danh mục ⇒ ngoại lệ |
| E9 | Hồ sơ có `id` nhưng `candidate_code` rỗng | Sheets | ngoại lệ |
| E10 | Comments/Tasks/Interviews trỏ `candidate_id` không còn tồn tại | Sheets | bỏ, ghi ngoại lệ |
| E11 | `record_files`: `drive_file_id` không truy cập được | Drive | ghi ngoại lệ; không chặn migrate |
| E12 | User trùng `username`, role admin không `pic_code`, TA thiếu `pic_code` | Users | ngoại lệ; TA thiếu PIC không tạo tài khoản đến khi gán |

Quy tắc chung: không nuốt lỗi âm thầm; ETL kết thúc với **bảng tổng kết**: nạp / bỏ / ngoại lệ theo từng bảng; tổng nạp + bỏ + ngoại lệ = tổng nguồn.

## 5. Quy trình ETL

1. **Trích xuất**: Sheets API (service account, chỉ đọc) → JSON/CSV theo từng sheet, lưu cùng checksum SHA-256 (thư mục `scripts/out/`, không commit dữ liệu thật vào Git).
2. **Staging**: nạp nguyên văn vào schema `staging` (mọi cột text) để truy vấn đối chiếu.
3. **Biến đổi**: script TypeScript `scripts/migrate/` **import cùng `src/shared`** (không viết lại validate). Sinh `legacy_id → new_id` bảng ánh xạ.
4. **Nạp theo thứ tự FK**: `pics` → `dropdown_*`, `hierarchy`, `sub_source_map` → `app_settings` → `auth.users`/`profiles` → `applicants` → `recruitment_records` → `status_history` → con (`comments`, `tasks`, `interview_schedules`, `hiring_checklists`, `hr_info`, `record_files`, `translations`, `targets`, `calendar_events`, `applications`, `saved_views`, `user_preferences`) → `audit_logs`.
5. Mỗi lần chạy tạo một `import_batches` với `source` ghi loại lô (ví dụ `etl:master_to_records`; bảng không có cột `kind`); mọi bản ghi gắn `import_batch_id` ⇒ **rollback theo lô** (xóa bản ghi của lô, không đụng dữ liệu phát sinh sau).
6. Cuối quy trình: reset identity sequence (`setval`) lớn hơn `max(id)`.
7. **Tài khoản**: tạo qua Auth Admin API. Email giả `<username>@ta.supra.internal` (D-05b). Thử trên dev việc nạp `encrypted_password` từ bcrypt cũ; nếu không tương thích ⇒ mật khẩu tạm ngẫu nhiên, phân phối riêng cho từng người, bắt đổi lần đầu (PO đã đồng ý trong D-05b).
8. **Applicants**: tính `phone_norm` + `name_norm`; gộp theo D-04; xuất `applicant_groups_review.csv` cho nhóm "cùng SĐT khác tên".

## 6. Đối chiếu (bắt buộc trước M3 và M4)

| Kiểm tra | Cách | Ngưỡng đạt |
|---|---|---|
| Số dòng mỗi bảng | nguồn vs đích (+ ngoại lệ đã duyệt) | khớp tuyệt đối |
| Theo PIC / `is_archived` / trạng thái R1,R2,OB | `group by` 2 phía | khớp tuyệt đối |
| Từng cột | hash `md5(string_agg(col order by candidate_code))` nguồn đã chuẩn hóa vs đích | khớp từng cột, hoặc danh sách khác biệt đã được duyệt |
| Mẫu 200 hồ sơ ngẫu nhiên + toàn bộ hồ sơ R2 Passed trở đi trong 30 ngày gần nhất | so tay trên giao diện cũ/mới | 0 sai |
| KPI | `public.report_totals` vs `dashboardCalc.totals` trên cùng dữ liệu, theo tháng gần nhất, theo PIC, theo nguồn | 0 sai lệch |
| Board | `board_counts` vs `boardPosition/boardSub` | 0 sai lệch |
| Quyền | bộ test RLS (DATABASE_SCHEMA §5) trên dữ liệu đã migrate | đạt 100% |
| File | mẫu 100 `record_files`: mở được từ Drive, đúng chủ hồ sơ | 100% |
| Comments/Tasks | số lượng theo hồ sơ | khớp |
| Idempotency | chạy ETL lần 2 vào DB rỗng ⇒ cùng hash | khớp |

## 7. Backup, phục hồi, rollback

- **Trước migrate thật**: backup DB đích rỗng (cấu trúc) và bản chụp nguồn (§3.3).
- **Backup định kỳ sau cutover** (Supabase Free không có backup tự động): `pg_dump` hằng ngày bằng GitHub Actions → lưu ra Drive/khác (mã hóa, giữ ≥30 bản), cộng export Sheets hằng tuần (`backup` Edge Function) để người dùng đọc được bằng Excel. Kết nối DB trực tiếp có thể cần pooler/IPv6 – **kiểm tra trên dev**.
- **Thử restore** vào project trống và kiểm tra bộ đối chiếu §6 – bắt buộc trước nghiệm thu (tiêu chí "Có thể phục hồi").
- **Rollback trước cutover (M0–M3)**: xóa theo `import_batch_id` hoặc tạo lại project dev; hệ cũ không bị ảnh hưởng.
- **Rollback sau cutover**: nếu phát hiện lỗi nghiêm trọng trong N ngày đầu ⇒ (1) đóng băng hệ mới, (2) xuất delta đã phát sinh (hồ sơ/ghi chú mới) thành CSV, (3) mở lại hệ cũ ở chế độ ghi, nạp delta thủ công bằng import. Vì vậy hệ cũ giữ **nguyên vẹn, chỉ đọc**, tối thiểu đến khi PO nghiệm thu.

## 8. Cutover (M4)

| Bước | Người thực hiện |
|---|---|
| 1. Thông báo cửa sổ đóng băng cho TA/Admin | PO |
| 2. Tắt ghi trên hệ cũ (đổi chế độ chỉ đọc hoặc tạm ngừng triển khai web app) | PO/Admin |
| 3. `sync-all`, sao chép Master + workspace + Drive | Admin |
| 4. Chạy ETL vào production (M2 đã diễn tập) | Antigravity (có Claude review báo cáo) |
| 5. Đối chiếu §6; ký xác nhận | PO |
| 6. Cập nhật: link app, link form ứng tuyển (`apply_page_url`), link Google Form HR, CORS | Antigravity |
| 7. Gửi tài khoản/hướng dẫn; mở hệ mới | PO |
| 8. Theo dõi lỗi, hotfix | Antigravity/Claude |

Form ứng tuyển công khai: trong lúc đóng băng, hiển thị trang thông báo bảo trì; hồ sơ phát sinh sau đó được nạp thủ công bằng `records-import` từ sheet `Applications` (delta).

## 9. Rủi ro riêng của migration

| Rủi ro | Giảm thiểu |
|---|---|
| Mất/lệch dữ liệu do workspace chưa sync | bước §3.2 + ngoại lệ E2 |
| Sai lệch múi giờ ngày (UTC vs HCM) | mọi cột nghiệp vụ là `date`/text `HH:mm`; chỉ `created_at`… là `timestamptz`; test với hồ sơ tạo gần 00:00 |
| Excel/Sheets đổi chuỗi thành ngày/số khi xuất | đọc bằng Sheets API với `valueRenderOption=UNFORMATTED_VALUE` + `FORMATTED_VALUE` đối chiếu (harness hiện tại không mô phỏng điều này – AUDIT §5) |
| Dung lượng vượt 500 MB | đo sau M2; `audit_logs` chỉ 12 tháng |
| Quyền Drive: file thuộc tài khoản cá nhân | chuyển chủ sở hữu sang tài khoản hệ thống trước M2 (việc "bạn cần làm" #3) |
| Phát sinh dữ liệu thật vào hệ mới rồi phải rollback | cutover chỉ sau M3 đạt; rollback có quy trình delta |
| Dữ liệu thật lộ vào repo/AI | không commit `scripts/out/`, `etl-out/`; dữ liệu mẫu phải ẩn danh trước khi đưa cho Antigravity; DEV chỉ dùng bản ẩn danh (DEV-DATA a) |
| Dữ liệu cá nhân đặt trên dịch vụ nước ngoài (Nghị định 13/2023) | **PO chấp nhận rủi ro, ghi nhận bằng văn bản** (phiếu G1 19/11/2026, Q10b); không chờ xác nhận pháp chế |

## 10. Nhật ký thay đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 19/11/2026 | Bản nháp đầu |
| 1.0 | 19/11/2026 | Duyệt G1: chốt E1, E3–E5 (không nạp, sửa nguồn); D-09a bỏ Forms; `import_batches` dùng `source`; D-05b; Q10b PO chấp nhận rủi ro; thêm §2.1 kết quả diễn tập 19/11 và việc thay dữ liệu DEV bằng bản ẩn danh |

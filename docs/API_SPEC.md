# API_SPEC – Hợp đồng API

Trạng thái: **v1.0 – ĐÃ DUYỆT (cổng G1, 19/11/2026)**. RPC gọi từ app nằm trong schema `public` (gọi qua `/rest/v1/rpc/<fn>`); schema `app` chỉ chứa hàm hỗ trợ RLS, không gọi trực tiếp. Frontend chạy trên Cloudflare Pages (D-01). Tham chiếu: ARCHITECTURE.md (kiến trúc, D-xx), DATABASE_SCHEMA.md (bảng, RLS, RPC).
Hiện có ~110 route trong `Api.gs → routes_()` (mọi thứ qua một `api()` Apps Script). API mới tách 4 kênh để mỗi loại việc dùng đúng công cụ.

## 1. Quy ước chung

| Mục | Quy ước |
|---|---|
| Base | `https://<project>.supabase.co` – REST `/rest/v1`, RPC `/rest/v1/rpc/<fn>`, Edge `/functions/v1/<name>` |
| Xác thực | `Authorization: Bearer <JWT Supabase Auth>` + `apikey: <anon key>`. Route công khai duy nhất: `POST /functions/v1/apply-submit`, `GET /functions/v1/apply-info` |
| Định dạng | JSON UTF-8; ngày `YYYY-MM-DD`; giờ `HH:mm`; timestamp ISO-8601 UTC |
| Phân trang | PostgREST: `limit` ≤100 + `offset`/`Range`, kèm `Prefer: count=planned`. Danh sách lớn dùng keyset (`(created_at,id)`). Cấm tải toàn bộ bảng |
| Chọn cột | Luôn `select=` các cột cần; danh sách không chọn 82 cột (giữ egress thấp, mục 7 ARCHITECTURE) |
| Đồng thời | Ghi hồ sơ bắt buộc `expected_version`; lệch ⇒ `409 VERSION_CONFLICT` kèm bản hiện tại |
| Lỗi | Edge/RPC trả `{ "error": { "code": "...", "message": "<tiếng Việt>", "details": {...} } }` |
| Idempotency | `records-save` (tạo) nhận `client_request_id` (uuid); gửi lại cùng id trả kết quả cũ |
| Giới hạn | Edge Function: body ≤ 6 MB (file ≤5–10 MB ⇒ upload theo mục 4.4). Free: 500.000 invocations/tháng |

Mã lỗi (giữ tên cũ khi có): `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VERSION_CONFLICT` 409, `VALIDATION_FAILED` 422 (kèm danh sách lỗi theo field), `FIELD_LOCKED` 422 (khóa theo vòng rớt), `MISSING_PIC` 400, `RATE_LIMITED` 429, `FILE_TOO_LARGE` 413, `FILE_TYPE_NOT_ALLOWED` 415, `SERVER_ERROR` 500.

## 2. Bảng ánh xạ route cũ → mới

Kênh: **A** = Supabase Auth · **R** = PostgREST (đọc/ghi bảng nhỏ, có RLS) · **P** = RPC SQL · **E** = Edge Function · **—** = bỏ.

### 2.1 Xác thực và tài khoản

| Route cũ | Kênh | API mới |
|---|---|---|
| `POST /auth/login` | A | `signInWithPassword({email: <username>@ta.supra.internal, password})` (D-05). Rate-limit do Auth |
| `POST /auth/logout` | A | `signOut()` |
| `GET /me` | R | `GET /profiles?id=eq.<uid>&select=id,username,full_name,role,pic_code` |
| `POST /auth/change-password` | A | `updateUser({password})` |
| `GET/POST/PATCH /users` | E | `admin-users` (§4.5) – cần service role |
| `GET/PUT /me/columns` | R | `user_preferences` |
| `GET /health` | — | dùng `GET /rest/v1/` hoặc `app_settings?limit=1` cho keep-alive |

### 2.2 Hồ sơ ứng viên

| Route cũ | Kênh | API mới |
|---|---|---|
| `GET /candidates` | R | `GET /v_records?select=<cột danh sách>&is_archived=eq.false&<bộ lọc>&order=created_at.desc&limit=25` (RLS tự lọc theo PIC) |
| `GET /candidates/:id` | R | `GET /v_records?id=eq.:id` (đủ cột) |
| `GET /candidates/check-phone`, `/check-phone` | P | `public.check_phone(p_phone, p_exclude_id)` |
| `GET /candidates/next-code` | P | `public.next_candidate_code(p_pic)` (chỉ gợi ý; mã chính thức cấp khi tạo) |
| `POST /candidates` | E | `records-save` `{op:"create"}` |
| `PATCH /candidates/:id` | E | `records-save` `{op:"patch"}` |
| `POST /candidates/:id/archive` (và restore) | E | `records-save` `{op:"archive"\|"restore"}` |
| `POST /candidates/:id/move` | E | `records-save` `{op:"move", target_box}` (dùng `pipelineRules.moveChanges`) |
| `GET /board`, `/board/cards` | P | `public.board_counts`, `public.board_cards` |
| `GET /export/data` | E | `export` (§4.8) – xuất CSV/Sheets có kiểm soát |
| `GET /reports/rows` | P | không còn dùng; thay bằng `public.report_*` (§3) |
| `GET /reports/funnel` | — | code chết |
| `GET /audit` | R | `GET /audit_logs?...` (Admin; TA: log hồ sơ của mình) |

### 2.3 CV, giấy tờ, bản dịch

| Route cũ | Kênh | API mới |
|---|---|---|
| `POST/GET/DELETE /candidates/:id/cv` | E | `files` kind=`cv` |
| `POST/GET/DELETE /candidates/:id/docs/:key` | E | `files` kind=`edu_certificate\|health_check\|id_card\|resume\|forklift_cert` |
| `GET /candidates/:id/attachments`, `POST …/attachments/:kind`, `GET /attachments/:id`, `POST /attachments/:id/replace`, `DELETE /attachments/:id` | R + E | liệt kê: `GET /record_files?record_id=eq.:id&deleted_at=is.null`; tải/lên/thay/xóa: `files` |
| `GET/PUT /candidates/:id/translations(/:field)` | R | `translations` (upsert theo `(record_id, field_key)`) |

### 2.4 Danh mục, view, cấu hình

| Route cũ | Kênh | API mới |
|---|---|---|
| `GET /dropdowns` | R | `dropdown_options` + `sub_source_map` + `hierarchy` + `pics` (nên gộp bằng RPC `public.get_dropdowns()` để 1 round-trip) |
| `POST/PATCH /dropdowns/options`, `PUT /dropdowns/sub-source-mapping`, `PUT /dropdowns/hierarchy` | R (Admin) | ghi bảng tương ứng; ghi `audit_logs` bằng trigger |
| `GET/POST/PATCH /dropdown-requests` | R | `dropdown_requests` |
| `GET/POST/PATCH/DELETE /views` | R | `saved_views` |
| `GET/PUT /settings/ob-target`, `/settings/hr-form` | R | `app_settings` (key `ob_target`, `hr_form`) |
| `POST /applications/page-url` | R (Admin) | `app_settings` key `apply_page_url` |
| `POST /form-template/release`, `/forms*`, `/me/form`, `/submissions` | — | **bỏ** (D-09a: TA nhập trực tiếp trong app) |

### 2.5 Nghiệp vụ vận hành

| Route cũ | Kênh | API mới |
|---|---|---|
| `GET/POST/PATCH/DELETE /tasks` | R | `tasks` |
| `GET/POST /candidates/:id/interviews`, `PATCH/DELETE /interviews/:id` | R | `interview_schedules` |
| `GET/PUT /candidates/:id/hiring`, `POST …/hiring/confirm` | R + E | đọc/ghi `hiring_checklists`; **confirm** qua `records-save` `{op:"confirm_hire"}` (đổi `ob_status`, ghi history, khóa) |
| `GET /alerts` | P | `public.alerts()` |
| `GET/PUT/DELETE /targets` | R / P | CRUD `targets` (ghi: Admin); đọc theo RLS: TA chỉ target của mình, trừ TA được Admin bật `can_view_all_targets` (TARGET, G1); thực tế: `public.target_actual` (áp cùng điều kiện) |
| `GET /calendar`, `POST/PATCH/DELETE /calendar/events` | P + R | `public.calendar_range(from,to,filters)` gộp tasks+interviews+ngày R1/R2/OB+events; ghi `calendar_events` |
| `GET/POST /candidates/:id/comments`, `PATCH/DELETE /comments/:id` | R | `comments` |
| `GET/PUT /candidates/:id/hr-info`, `POST …/hr-info/verify` | R + E | `hr_info` (ghi qua `hr-info-save` để validate bằng `hrInfoRules.ts`; verify chỉ Admin) |
| `POST /candidates/:id/hr-form/link`, `GET …/hr-form/response` | E | `hr-form` (ghi `hr_form_sends`, đọc sheet trả lời Google Form – D-08) |

### 2.6 Form ứng tuyển công khai

| Route cũ | Kênh | API mới |
|---|---|---|
| `GET /apply/info` | E (công khai) | `apply-info?code=<mã>` |
| `POST /apply` | E (công khai) | `apply-submit` (§4.3) |
| `GET /applications`, `/applications/link` | R | `applications` (RLS) |
| `POST /applications/:id/status` | R | cập nhật `status` |
| `POST /applications/:id/convert` | E | `records-save` `{op:"create", from_application_id}` |
| `GET /applications/:id/cv` | E | `files` (nguồn `applications.cv_drive_file_id`) |

### 2.7 Import và quản trị cũ

| Route cũ | Kênh | API mới |
|---|---|---|
| `GET /import/existing`, `POST /import/chunk`, `POST /import/finish` | E | `records-import` (§4.2) |
| `/workspaces*`, `/sync-log`, `/sync-dashboard`, `/diag/speed`, `/schema-check` | — | bỏ (không còn workspace/sync). Chẩn đoán tốc độ: Supabase dashboard + `EXPLAIN` |
| `POST /batch` | — | không cần; PostgREST + `Promise.all`; hoặc RPC `public.get_bootstrap()` cho lần mở trang |

## 3. RPC báo cáo / board / tiện ích

Tất cả `SECURITY INVOKER` (trừ `check_*`), nhận tham số `jsonb`, trả `jsonb` đã tổng hợp.

| RPC | Tham số | Trả về |
|---|---|---|
| `public.report_totals(p_from, p_to, p_filters, p_group_by, p_today=null)` – 0011 (bản rút gọn `(p_from, p_to)` của 0003 giữ để đối chiếu nạp dữ liệu) | `filters`: pic, site, source, sub_source, region, dept, position, rank, location (so khớp đúng, rỗng = bỏ qua); `group_by` ∈ none/pic/site/source/sub_source/position/region/dept | none: `Totals` đúng khóa `dashboardCalc.Totals`; nhóm: `[[tên, Totals], …]` = `groupTotals` |
| `public.report_series(p_periods, p_filters, p_today=null)` – 0011 | `p_periods` = `[[from, to], …]` do client tạo bằng `periodsOf` (≤ 60 kỳ, tổng ≤ 20.000 ngày) | `Totals[]` cùng thứ tự = `periodSeries` (không kèm `p`) |
| `public.report_trend(p_from, p_to, p_filters)` – 0011 | | `TrendPoint[]` (month, ob, att, start, churn) |
| `public.report_sources(p_periods, p_filters, p_today=null)` – 0011 | như `report_series` | `SourcePeriod[]` không kèm `p` |
| `public.report_reasons(p_from, p_to, p_filters)` – 0011 | | `{r1_fail, lu_no, no_show, r2_fail, ob_no}` – dữ liệu lý do của 5 biểu đồ tròn; client ghép với `Totals` thành `DonutData` |
| `public.report_counts(p_filters)` – 0012 | | `{all, filtered}` – số hồ sơ được xem / sau bộ lọc (dòng "x / y ứng viên") |
| `public.report_meta(p_today=null)` – 0011 | | `{today (giờ VN), min_date (= MIN_DATE), options:{pic, site, source, sub_source, region, dept, position}}` trên toàn bộ hồ sơ được xem |
| `public.report_detail(p_from, p_to, p_filters, p_limit, p_cursor)` | | bảng chi tiết phân trang (thay `reports/rows`, `FollowWdView`, export) |
| `public.board_counts(p_filters)` | | `{lead,r1,lusu,r2,ob}` + chỉ số phụ `BoardSub` |
| `public.board_page(p_filters, p_q)` – 0013 | `filters`: pic (chỉ Admin), position, region; `p_q` tìm mã/tên/SĐT như `list_candidates` | `{counts:{col:{total, failed}}, columns:{col:[thẻ ≤30]}, page_size:30}` = `hBoard_` |
| `public.board_cards(p_col, p_offset, p_filters, p_q, p_limit=30)` – 0013 | | `{cards, total}`; thẻ: id, candidate_code, full_name, phone, pic, position, region, location, site, row_version, updated_at, failed_at; xếp updated_at rồi id giảm dần |
| `public.stage_history(p_record_id)` – 0013 | | lịch sử chuyển vòng bằng Kanban `[{id, at, from_box, to_box, actor_username}]` (≤ 50, mới nhất trước) |
| `public.check_phone(p_phone, p_exclude_id)` | | `{count, same_pic_count}` – không trả mã/PIC khác |
| `public.next_candidate_code(p_pic)` | | `{code}` |
| `public.alerts()` | | `{overdue, due_soon, hr_missing, offer_docs_missing}` + danh sách rút gọn |
| `public.target_actual(p_type, p_key, p_filters)` | | `{target, actual, pct}` |
| `public.calendar_range(p_from, p_to, p_filters)` | | sự kiện gộp |
| `public.get_dropdowns()` | | `{options, sub_source_map, hierarchy, pics}` |

**Điều kiện nghiệm thu RPC báo cáo:** với cùng dữ liệu, kết quả bằng `dashboardCalc.ts` (so từng số). Ngày "hôm nay" cho ER30/ER60 tính theo `Asia/Ho_Chi_Minh`.

## 4. Edge Functions

Mọi function: kiểm JWT → nạp `profiles` → kiểm `active` → xử lý → trả lỗi chuẩn. Secrets: `SUPABASE_SERVICE_ROLE_KEY` (chỉ `admin-users`, `apply-submit`, `backup`), `GOOGLE_SA_JSON`. Code dùng chung: bundle `shared/` (validation, pipelineRules, reasonRules, candidateCode, documentRules, hrInfoRules) – **cùng nguồn** với frontend.

### 4.1 `records-save`

`POST /functions/v1/records-save`

```jsonc
// create
{ "op":"create", "client_request_id":"uuid", "values":{ /* các key FIELD_CATALOG */ }, "from_application_id": 123 }
// patch
{ "op":"patch", "id": 456, "expected_version": 7, "changes":{ "r1_status":"Passed", "r1_date":"2026-11-19" } }
// move (Kanban/KPI)
{ "op":"move", "id": 456, "expected_version": 7, "target_box":"r2" }
// archive | restore | confirm_hire | reopen_hire (Admin)
{ "op":"archive", "id": 456, "expected_version": 7 }
```

Xử lý `patch`: (1) đọc hồ sơ bằng JWT người gọi (RLS ⇒ 404 nếu không có quyền); (2) `lockedFieldKeys` ⇒ `FIELD_LOCKED` nếu đụng field bị khóa; (3) `validateAndComputeCandidate` với cấu hình drop-list/hierarchy hiện hành ⇒ `VALIDATION_FAILED`; (4) gọi `public.save_record(p_actor = id từ JWT, …)` một giao dịch bằng **service_role** (RPC ghi không cấp cho authenticated; lỗi RPC: `PT404` NOT_FOUND, `PT409` VERSION_CONFLICT/DUPLICATE_CODE, `PT403` FORBIDDEN, `PT422` INVALID_FIELD/INVALID_OP); (5) trả `{ record, warnings, duplicates:{phone,cccd} }`.
Phản hồi `409`: `{error:{code:"VERSION_CONFLICT", details:{ current: <record> }}}` để UI hiện `ConflictResolutionModal`.
Quyền: Admin mọi hồ sơ; TA chỉ hồ sơ `pic = pic_code` của mình; chỉ Admin được đổi `pic`, `reopen_hire`, mở lại hồ sơ đã khóa.
Hiệu năng mục tiêu: P95 phản hồi server < 1 s (tiêu chí Kanban < 1 s ở UI nhờ optimistic update).

### 4.2 `records-import`

`POST /functions/v1/records-import` (Admin) – `{op:"start"|"chunk"|"finish"|"rollback", batch_id, rows:[…≤500], mode:"insert_only"}`. Dùng `applyLegacyImportTransformations` + validate. Mỗi chunk trả `{inserted, skipped, errors:[{row, code, message}]}`. Ghi `import_batches`; mỗi bản ghi mang `import_batch_id` để `rollback` xóa theo lô (chỉ lô chưa có hoạt động nghiệp vụ). Không kiểm trùng SĐT ở server (giữ hành vi cũ: chỉ cảnh báo, kiểm trùng **mã**). Cùng function phục vụ migrate (MIGRATION_PLAN) với `kind='migration'`.

### 4.3 `apply-submit` / `apply-info` (công khai)

`POST /functions/v1/apply-submit` – `multipart/form-data`: `code`, `full_name`, `phone`, `email`, `area`, `note`, `consent`(bắt buộc), `hp` (honeypot, phải rỗng), `cv` (≤5 MB; pdf/doc/docx/jpg/png).
Kiểm: honeypot, consent, SĐT chuẩn hóa, rate-limit (`rate_limits`: mỗi SĐT 1 lần/10 phút, ≤120 lần/giờ/link, giới hạn theo IP thêm), MIME + magic bytes, kích thước. Upload CV lên Drive → ghi `applications`. Trả `{ok:true}` (không lộ trùng SĐT). CORS chỉ cho tên miền trang tuyển dụng. Giữ hành vi: không dùng khóa toàn cục; cho phép client retry (idempotency theo `client_request_id`).

### 4.4 `files`

- `POST /functions/v1/files` `{op:"init", record_id, kind, file_name, size, mime}` → kiểm quyền hồ sơ + loại + dung lượng (CV ≤5 MB; giấy tờ/attachments ≤10 MB, tối đa 20 file/kind, đuôi theo `DOC_ALLOWED_EXT`/`ATTACHMENT_ALLOWED_EXT`; Salary Proposal chỉ khi rank ≥5) → trả URL upload resumable của Drive (token ngắn hạn) **hoặc** nhận file trực tiếp nếu ≤6 MB.
- `{op:"commit", upload_id}` → ghi `record_files`, đổi tên file theo `documentRules.docFileName`, gắn đúng thư mục `docFolderName`.
- `GET /functions/v1/files?id=<file id>` → kiểm quyền → stream từ Drive; ghi `audit_logs` (`DOWNLOAD`).
- `{op:"delete", id}` → `deleted_at` (xóa mềm) + dọn Drive theo lịch.
Kiểm quyền **luôn** qua `app.can_see_record(pic)` (một hàm duy nhất, đã gồm `pic <> ''`): Edge đọc `pic` của hồ sơ theo `record_id` bằng JWT người dùng rồi gọi hàm này.

### 4.5 `admin-users` (Admin)

`{op:"create", username, full_name, role, pic_code, temp_password}` · `{op:"update", id, role?, pic_code?, active?, full_name?, can_view_all_targets?}` · `{op:"reset_password", id, temp_password}`. Tạo `auth.users` bằng service role (email giả theo D-05) + `profiles`. Vai trò `pic` bắt buộc `pic_code` (`MISSING_PIC`). Ghi `audit_logs`.

### 4.6 `hr-info-save`

`{record_id, mode:"draft"|"submit"|"verify", data:{…}}`. Kiểm `hrEligible` (R2 Passed trở đi), `validateHrInfo`, trùng CCCD (cảnh báo qua `public.check_cccd`). ~~`verify` chỉ Admin~~ (PO chốt 20/11/2026: giữ như hệ cũ – TA phụ trách và Admin đều xác nhận / mở lại); chỉ `verified` khóa sửa (như hệ cũ). Thực tế: `{op:"save", record_id, mode:"draft"|"submit", data}` · `{op:"verify", record_id, verified:bool}` → `{info}`; lỗi `NOT_ELIGIBLE` 400, `VALIDATION_FAILED` 400 (+fields), `LOCKED`/`NOT_VERIFIED`/`CHANGED` 409, `NO_HR_INFO` 404.

### 4.7 `hr-form`

`{op:"link", record_id}` ghi `hr_form_sends` và trả link Google Form (tham số từ `app_settings.hr_form`); `{op:"response", record_id}` đọc sheet trả lời (Sheets API, tìm theo SĐT rồi CCCD). Chỉ đọc sheet. `link` trả `{url, sends}`. `response`: PO chốt 20/11 làm sau, khi có tài khoản dịch vụ Google (secret `GOOGLE_SA_JSON`); tới lúc đó trả 503 `HR_SHEET_NOT_CONFIGURED`.

### 4.8 `export` và `backup`

- `export` `{filters, format:"csv"|"sheets"}`: lặp keyset, áp `sanitizeCellForSpreadsheet`, TA chỉ xuất hồ sơ của mình, ghi `audit_logs`. Với Google Sheets: tạo/ghi vào file do Admin chỉ định.
- `backup` (Admin hoặc cron): xuất bảng chính ra CSV/Sheets trong thư mục Drive riêng; **không thay thế `pg_dump`** (MIGRATION_PLAN §7).

## 5. Bảo mật API

- Không route nào dùng `service_role` từ trình duyệt.
- Edge Function không tin dữ liệu từ client về `pic`/quyền; luôn lấy từ `profiles`.
- CORS chặt (chỉ origin Cloudflare Pages của app và trang tuyển dụng); bật giới hạn kích thước body.
- Log: lỗi 5xx ghi vào bảng/Logflare (Free chỉ giữ 1 ngày – cần lưu ngoài nếu muốn truy vết lâu).
- Phiên: JWT hết hạn 1h + refresh (mặc định Supabase); tương đương phiên 6h cũ: đặt thời hạn refresh theo chính sách, không cần đổi cho P1.

## 6. Tương thích ngược khi chạy song song

Trong 2 tuần chạy song song: hệ cũ **chỉ đọc**; chỉ một hệ được ghi tại một thời điểm (cutover theo MIGRATION_PLAN). Không đồng bộ hai chiều.

## 7. Nhật ký thay đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 19/11/2026 | Bản nháp đầu |
| 1.0 | 19/11/2026 | Duyệt G1. Đổi mọi RPC `app.*` gọi từ app sang `public.*` (giữ `app.is_admin/my_pic/can_see_record`); bỏ route form riêng (D-09a); `targets` theo quyền TARGET; `can_see_record` nhận `pic`; ghi chú `report_totals` rút gọn ở 0003; `admin-users` thêm `can_view_all_targets`; CORS theo Cloudflare Pages (D-01) |
| 1.1 | 19/11/2026 | `records-save` gọi `create_record`/`save_record` bằng service_role kèm `p_actor` (DATABASE_SCHEMA 1.2) |
| 1.2 | 19/11/2026 | PO chốt khi đối chiếu hệ cũ: `archive`/`restore` – TA làm được với hồ sơ PIC mình (như hệ cũ), không chỉ Admin; đổi `candidate_code` khi `patch` – chỉ Admin, kiểm trùng (0009). Lỗi thêm: `STEP_LOCKED` 422 (sửa bước sau vòng rớt), `MOVE_*` 409 (kéo thả không hợp lệ), `FORBIDDEN_PIC` / `FORBIDDEN_PIC_CHANGE` 403. Phản hồi: `{record, notices, duplicates:{phone}}` (trùng SĐT của PIC khác bị che như hệ cũ) |
| 1.3 | 19/11/2026 | M5-1 (0011): RPC báo cáo theo kỳ nhận danh sách kỳ `p_periods` do client tạo (dùng lại `periodsOf`/`usePeriods` của hệ cũ) thay vì `p_gran`; thêm `report_series`, `report_reasons`, `report_meta`; mọi hàm có `p_today` (mặc định hôm nay giờ VN) để test; lọc thêm `sub_source`, `site`. `report_detail` chuyển sang M5-3 (cùng FollowWdView) |
| 1.4 | 19/11/2026 | M5-3: thêm `report_counts` (0012). Target OB/tháng = `app_settings.ob_target` (đọc: mọi người; ghi: Admin, qua PostgREST). Follow WD dùng `list_candidates` (ob_status = Joined) + `records-save`, không cần `report_detail` – bỏ khỏi kế hoạch |
| 1.5 | 19/11/2026 | M5-2/M5-4: Kanban dùng `board_page` (thay `/api/board`), `board_cards` theo offset (như hệ cũ, thay cursor), `stage_history`. Kéo thả lưu bằng `records-save` op `move` (đã có từ M4) |
| 1.6 | 20/11/2026 | M6-1: đọc qua `list_tasks(p_view, p_record_id)`, `list_interviews(p_record_id)`, `calendar_range(p_from, p_to, p_pic)`, `target_list(p_type, p_key, p_from, p_to)` (kỳ do client tính bằng `opsRules.periodRange`); ghi `tasks`, `interview_schedules`, `calendar_events`, `targets`, `hiring_checklists` qua PostgREST (RLS 0005), kiểm bằng `opsRules.validate*` ở trình duyệt. `confirm_hire` vẫn chờ M6-2 |
| 1.7 | 20/11/2026 | M6-2: `records-save` thêm `{op:"confirm_hire"|"reopen_hire", id}` (không cần expected_version, như hệ cũ); trả `{record, hiring, ob_updated}`; lỗi `NOT_ELIGIBLE` 400, `HIRING_INCOMPLETE` 400, `LOCKED` 409, `FORBIDDEN` 403 (mở lại không phải Admin). Đọc checklist: RPC `hiring_state`. M6-3: RPC `alerts(p_today)` trả `{counts:{overdue, due_soon, passed_no_hr, missing_docs}, overdue, due_soon, passed_no_hr, missing_docs, today}` như `/api/alerts` cũ |
| 1.8 | 20/11/2026 | M6-4: `hr-info-save` (save/verify), `hr-form` (link; response chờ GOOGLE_SA_JSON); RPC `hr_info_get`, `hr_duplicates`; verify/reopen cho TA phụ trách + Admin như hệ cũ (PO chốt) |
| 1.9 | 20/11/2026 | M6-5: `GET /audit` → RPC `list_audit(p_page, p_page_size, p_code, p_actor, p_action)` trả `{items:[{id, actor_username, actor_role, action, candidate_code, field_key, old_value, new_value, created_at}], total, page, pageSize, totalPages}` như hệ cũ |
| 1.10 | 20/11/2026 | M7-6: `/dropdowns/*` (thêm, đổi tên/bật-tắt, ánh xạ Sub_Source, phân cấp) và duyệt `/dropdown-requests/:id` → RPC `dd_*` (0020); `/views*` → `view_save`, `view_delete` (màn View không có trong menu hệ cũ – giữ ẩn); `/settings/hr-form` → `app_settings.hr_form` (Admin, thẻ cấu hình đặt dưới trang Drop-list vì màn Workspace bỏ theo D-09) |

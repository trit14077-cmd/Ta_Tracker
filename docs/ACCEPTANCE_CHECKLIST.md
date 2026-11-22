# ACCEPTANCE_CHECKLIST – Kiểm thử chức năng trước nghiệm thu (M9-1, cổng G5)

Mỗi dòng = 1 dòng của ARCHITECTURE §3 "Chức năng phải giữ" (bỏ các dòng **B**). Người kiểm làm theo cột "Cách kiểm" trên **DEV sau khi đã apply 0027–0030 và deploy lại Edge Function**, so với hệ cũ trên cùng hồ sơ nếu có thể, rồi ghi Đạt/Không đạt + ngày + chữ ký. Lỗi ghi vào cột "Ghi chú" kèm mã hồ sơ giả (không ghi dữ liệu thật).

- Tài khoản dùng: 1 Admin, 2 TA khác PIC (TA-A, TA-B), 1 TA đã khóa. Dữ liệu: bản ẩn danh trên DEV (batch 5) + hồ sơ giả tạo khi kiểm.
- Cột "Tự động" = test đã chạy trong CI (xanh là điều kiện cần, chưa đủ – vẫn phải kiểm tay trên giao diện).
- Kết quả: ☐ chưa kiểm · ✅ đạt · ❌ không đạt.

## 1. Chức năng

| # | Module | Cách kiểm (tóm tắt) | Tự động | Kết quả | Ngày / Người ký | Ghi chú |
|---|---|---|---|---|---|---|
| F01 | Đăng nhập | Đăng nhập/đăng xuất Admin và TA; đổi mật khẩu; TA khóa không vào được; sai mật khẩu nhiều lần bị chặn tạm (giới hạn ở Supabase Auth – SECURITY_REVIEW S6); phiên hết hạn ⇒ đăng nhập lại | admin-users.test (15) | ☐ | | |
| F02 | Ứng viên – danh sách | Lọc từng bộ lọc; tìm theo mã / tên / SĐT (có dấu và không dấu); phân trang; lưu và mở lại View; tùy chỉnh cột rồi tải lại trang vẫn giữ; nhãn trùng SĐT/CCCD; bấm 6 thẻ KPI ⇒ danh sách lọc đúng và **tổng khớp số trên thẻ**; kéo dòng vào thẻ ⇒ chuyển bước | candidate_list_test.sql, board_test.sql (thẻ KPI = tổng list_candidates), golden | ☐ | | |
| F03 | Ứng viên – chi tiết/nhập | Mở đủ 11 section / 82 field; nhập nhanh (section 1–3); để trống trường bắt buộc ⇒ báo lỗi đúng trường; Source/OB month/Tenor tự tính; mã UV tự sinh theo PIC; check-phone khi gõ SĐT trùng; lưu trữ rồi khôi phục; 2 tab cùng sửa 1 hồ sơ ⇒ tab sau nhận hộp xung đột (409) | records-save.test, records-save-m42.test (409, quyền), validation.test, rpc_test.sql, concurrency_codes.sh | ☐ | | |
| F04 | Khóa theo vòng rớt | R1 Failed ⇒ khóa section R2/OB; R2 Failed/Canceled ⇒ khóa OB; OB Canceled/Noshow ⇒ khóa phần sau; Admin cũng không sửa được trường bị khóa | records-save-m42 (2), rules.test | ☐ | | |
| F05 | Quy tắc trạng thái–lý do | Chọn trạng thái cần lý do mà bỏ trống ⇒ chỉ **cảnh báo**, vẫn lưu được; danh sách lý do đổi theo trạng thái | rules.test (reasonRules) | ☐ | | |
| F06 | Kanban | 5 cột Lead/R1/LU-SU/R2/OB; 30 thẻ/cột + "Tải thêm"; chỉ kéo tiến (kéo lùi bị chặn); hộp xác nhận; nhật ký có `STAGE_MOVE`; lọc PIC/vị trí/khu vực; TA chỉ thấy thẻ PIC mình | board_test.sql, golden (boardPosition/moveChanges) | ☐ | | |
| F07 | CV & giấy tờ | Tải CV/giấy tờ trong app ≤10 MB (code hiện hành; ARCHITECTURE §3 ghi CV ≤5 MB – PO xác nhận mức nào đúng hệ cũ), CV qua form công khai ≤5 MB; 5 loại giấy tờ; tên file trên Drive đúng quy tắc; Salary Proposal chỉ Rank ≥5; Payslips ≤20 file, ≤10 MB; file .exe đổi đuôi .pdf bị từ chối; đổi mã/tên ứng viên ⇒ file trên Drive đổi tên theo; tải xuống có ghi nhật ký | files.test (10), files_test.sql, smoke.ts (nhóm TA) | ☐ | | |
| F08 | Dịch & tạo CV | Lưu bản dịch EN của `experience_summary`; sửa bản gốc ⇒ bản dịch báo cũ (hash nguồn); Tạo CV mẫu CV-EN-1 và in PDF | translations_test.sql | ☐ | | |
| F09 | HR Info | Chỉ mở được khi R2 Passed trở đi; draft → submitted → verified; trùng CCCD báo nhưng che hồ sơ PIC khác; link Google Form công ty + tra phản hồi | hr-info-save.test, hr-form.test, hr_test.sql | ☐ | | |
| F10 | Công việc (Tasks) | Tạo/sửa/xóa; loại, ưu tiên, owner, hạn; Admin giao việc cho TA; TA thấy việc của mình | ops_test.sql | ☐ | | |
| F11 | Lịch phỏng vấn / Calendar | Lịch PV theo hồ sơ + sự kiện tự tạo; xem ngày/tuần/tháng/danh sách | ops_test.sql | ☐ | | |
| F12 | Hiring checklist | 6 mục (3 tay, 3 tự tính); Xác nhận tuyển ⇒ OB Status = Accepted và khóa; TA không mở lại được; Admin mở lại được | hiring.test (10) | ☐ | | |
| F13 | Alerts | Chuông: quá hạn, sắp hạn, R2 passed chưa có HR info, offer thiếu giấy tờ; số trên chuông khớp danh sách | alerts_test.sql | ☐ | | |
| F14 | Target | Target ngày/tuần/tháng/năm × PIC/vị trí/phòng ban; "Thực tế" = OB Joined theo ngày OB; **TA chỉ thấy target của mình**; Admin bật "xem tất cả" cho 1 TA ⇒ TA đó thấy hết | ops_test.sql, rls_test.sql (can_view_target) | ☐ | | |
| F15 | Báo cáo/Dashboard | Số leads, R1, LU, SU, R2, OB, NS, CC, ER, ATT, ER30/60 khớp hệ cũ trên cùng khoảng ngày (đối chiếu M8-3 `reconcile.ts`); FollowWD; biểu đồ; export | report_parity_test.sql, reconcile.test, reportAdapters.test, reconcile.ts trên DEV (11/11) | ☐ | | |
| F16 | Bình luận | Thêm/sửa/xóa bình luận; TA không sửa bình luận người khác | rls_test.sql | ☐ | | |
| F17 | Import Excel | File mẫu 76 cột; nhập nhiều sheet theo chunk; dòng lỗi báo theo dòng + tải file lỗi; không ghi đè hồ sơ trùng mã; **hoàn tác lô** (chạy thử ⇒ xóa thật; hồ sơ đã sửa/có dữ liệu con được giữ) | records-import.test, import_test.sql | ☐ | | |
| F18 | Quản trị | Users (tạo, khóa, đổi role/PIC, reset MK; không tự khóa mình); Drop-list (thêm, đổi tên lan sang hồ sơ, đề xuất giá trị + duyệt, phân cấp Region→Location→Site, SubSource→Source); Views; Audit log (lọc mã/người/hành động); cấu hình ob-target, hr-form; dọn nhật ký 12 tháng | admin-users.test, admin-catalog.test, admin_test.sql, audit_test.sql, audit_purge_test.sql | ☐ | | |
| F19 | Form ứng tuyển công khai | Link riêng mỗi TA + link chung; gửi hồ sơ kèm CV; gửi lại cùng SĐT trong 10 phút ⇒ "đã nhận", không tạo bản 2; honeypot; link sai ⇒ thông báo; inbox: tạo hồ sơ / bỏ qua; trang tĩnh trên tên miền công ty | apply.test, applications_test.sql, smoke.ts | ☐ | | |
| F20 | i18n | Đổi Việt/Anh trên mọi màn hình; thông báo lỗi từ server cũng đổi theo | i18nNew.test | ☐ | | |

## 2. Quy tắc nghiệp vụ (ARCHITECTURE §3.1) – golden tests

| # | Quy tắc | Test | Kết quả |
|---|---|---|---|
| R1 | `currentStage`, `boardPosition`/`boardSub`/`moveChanges` | tests/golden, sql_parity_test.sql, board_test.sql | ☐ |
| R2 | `reasonRules`, `REASON_RENAMES` chỉ khi import legacy | tests/shared/rules.test.ts | ☐ |
| R3 | `validation.ts` (SĐT, ngày, birth, CV link, source, ob_month, tenor) | tests/shared/validation.test.ts | ☐ |
| R4 | `candidateCode.ts` + không trùng khi 20 phiên đồng thời | rules.test, concurrency_codes.sh | ☐ |
| R5 | `documentRules.ts` | rules.test, files.test | ☐ |
| R6 | `dashboardCalc.ts` ⇔ SQL, sai lệch = 0 | report_parity_test.sql, reconcile.ts | ☐ |

## 3. Tiêu chí phi chức năng (IMPLEMENTATION_TASKS "Tiêu chí nghiệm thu")

| Hạng mục | Mục tiêu | Kiểm bằng | Số đo | Kết quả |
|---|---|---|---|---|
| Dashboard | P95 < 3 s | `scripts/perf/k6-load.js` (M9-2) | | ☐ |
| Danh sách | P95 < 2 s | k6 | | ☐ |
| Kanban | P95 phản hồi UI < 1 s | k6 (API) + thao tác tay (optimistic UI) | | ☐ |
| 20.000 bản ghi | tải được | perf_seed + k6 | | ☐ |
| 20 người đồng thời | không lỗi, không mất dữ liệu | k6 (kịch bản ghi trên project test) | | ☐ |
| RLS | chặn trái quyền | rls_test.sql, security_audit.sql, smoke.ts | | ☐ |
| KPI | khớp nguồn | reconcile.ts 11/11 | | ☐ |
| Backup | phục hồi được | `backup-and-keepalive` (restore mỗi lần chạy) + thử restore tay (RUNBOOK §4) | | ☐ |

## 4. Ký nghiệm thu chức năng

| Vai trò | Họ tên | Ngày | Chữ ký |
|---|---|---|---|
| PO | | | |
| Đại diện TA | | | |

## 5. Nhật ký thay đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 22/11/2026 | Bản đầu từ ARCHITECTURE §3 (M9-1) |

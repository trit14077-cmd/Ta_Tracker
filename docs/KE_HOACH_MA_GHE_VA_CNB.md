# Kế hoạch tích hợp 2 quy trình vào TA Tracker (bản chính)

Ngày lập: 27/11/2026. Trạng thái: **đã code xong bản 1 ngày ở local (27/11/2026)**, chưa push migration, chưa deploy. Xem mục 5.

- **Quy trình 1. Mã ghế:** TA yêu cầu mã ghế trên tab của mình, dữ liệu dồn về Admin (HRSS).
- **Quy trình 2. Phối hợp CnB:** chốt danh sách OB ngày 25 hàng tháng và theo dõi hồ sơ.

Nguyên tắc chung (theo quy ước dự án):
- Làm trong `NEW/`. Không sửa `OLD/`.
- Chỉ code, build, test ở máy local. Không tự push migration hay deploy, PO tự publish.
- Dữ liệu cá nhân (CCCD, ngân hàng, MST, địa chỉ) chỉ Admin và TA phụ trách hồ sơ xem được. Mọi thao tác đều ghi `audit_logs`.

---

## 0. Hiện trạng

| Phần | Đã có trong `NEW/` | Ghi chú |
|---|---|---|
| Mã ghế | `shared/seatCodeRules.ts` và test, migration `0038_seat_requests.sql`, `SeatRequestsView.tsx`, `seatService.ts`, tab **Mã ghế** trong `App.tsx`, `docs/SEAT_CODE_RULES.md` | Bản nháp ngày 26/11. Migration **chưa chạy** trên DB nào. Còn 7 câu hỏi mở (mục 6 của SEAT_CODE_RULES). |
| Trường OB trên hồ sơ | `ob_date` (OBD), `emp_id`, `rank`, `position`, `site`, `region`, `unit`, `dept`, `hire_type`, `contract_sign_status` (Tình trạng ký HĐTV), `salary_pay_status` (Tình trạng chi lương), `emp_status` (Active/Resigned), `attrition_date`, `cutoff`, `drive_upload`, giấy tờ `edu_certificate`, `health_check`, `id_card`, `resume`, `doc_note` | Đủ cho template gọn 16 cột của CnB. |
| Thông tin cá nhân | Bảng `hr_info` (`data` jsonb, trạng thái draft/submitted/verified), quy tắc trong `shared/hrInfoRules.ts` | Có CCCD, ngày cấp, nơi cấp, địa chỉ, học vấn, dân tộc, ngân hàng, MST, BHXH… Đây là nguồn để map sang template 98 cột. |
| Kỳ OB | `ob_month` tính theo **tháng lịch** từ `ob_date` | CnB tính kỳ **26 tháng trước đến 24 tháng này**, nên cần hàm riêng. Không đổi `ob_month` để báo cáo cũ giữ nguyên. |
| Follow WD | `FollowWdView.tsx`, `wd_*` | Dùng lại cho cột Upload WD hoặc Ghế WD nếu cần. |

Sheet tham khảo:
- Sheet mã ghế (link `1IfxJ…`): tài khoản Google đang kết nối **không có quyền mở**. SEAT_CODE_RULES được viết từ bản *Copy of Request_Job Requisition*. Cần xác nhận hai sheet là một, xem bước 1.0.
- Sheet *Recruitment x CnB – THE SUPRA*: đã đọc dòng tiêu đề các tab `OB_T6/26` (98 cột, template đầy đủ), `OB_T9`…`OBT11/26` (16 đến 22 cột, bản gọn), `C&B check HS Tháng N`, `Tracking WD`, `Noshow`, `Table`, `map`.

---

## 1. Quy trình 1: Mã ghế

Luồng đã thiết kế (chi tiết ở `SEAT_CODE_RULES.md`):
1. TA nhập dòng ghế (`nhap`) và gửi HRBP (`gui`).
2. HRBP xác nhận (`xac_nhan`).
3. HRSS cấp mã 8 số liên tiếp (`da_cap_ma`).

Mỗi TA chỉ thấy dòng của mình (RLS theo `owner_id`). Admin thấy tất cả, nên đây chính là "data của admin".

### Các bước

| # | Việc | Đầu ra | Xong khi |
|---|---|---|---|
| 1.0 | Đối chiếu với sheet gốc. PO share sheet `1IfxJ…` cho tài khoản đang kết nối, hoặc xác nhận đây chính là *Request_Job Requisition*. So cột, luồng và cách cấp mã. | Ghi chênh lệch (nếu có) vào SEAT_CODE_RULES | PO xác nhận không còn chênh lệch |
| 1.1 | Chốt 7 câu hỏi mở trong SEAT_CODE_RULES §6: công thức mã, ai điền Ranking AP, có tài khoản HRBP không… | Cập nhật SEAT_CODE_RULES, sửa `seatCodeRules.ts` và `0038` nếu cần | Không còn câu hỏi mở |
| 1.2 | Chạy `0038` trên Supabase local (`supabase db reset`). Viết `supabase/tests/seat_requests.sql`: TA A không thấy dòng của TA B; không chuyển trạng thái trái luồng; hai người cấp mã cùng lúc không trùng mã; bộ đếm không lùi. | File test SQL chạy xanh | `npm test` và test SQL đều pass |
| 1.3 | Ghi `audit_logs` cho tạo, gửi, trả về, xác nhận, cấp mã, đổi bộ đếm (theo quy ước của `hr_info_write`) | Bổ sung vào `0038` hoặc migration `0039` | Mỗi thao tác sinh đúng một dòng log |
| 1.4 | Màn Admin "dữ liệu tổng": lọc theo TA, tháng gửi, trạng thái, vùng; chọn nhiều dòng rồi xác nhận hoặc cấp mã; xuất Excel đúng 19 cột `NhapLieu` cộng Trạng thái | Cập nhật `SeatRequestsView.tsx` | Admin thao tác được trên dữ liệu thật của 2 TA thử |
| 1.5 | Tab **Tổng hợp** (bước 1 `TongHop`): số ghế theo tháng, TA, vùng, trạng thái. Tính bằng RPC đọc, không thêm bảng. | RPC `seat_summary(p_from, p_to)` và một khối trong màn Mã ghế | Số liệu khớp với lọc tay |
| 1.6 | Import dữ liệu cũ từ sheet vào `seat_requests`: script `scripts/migrate/seat_import.*`, có chạy thử (dry-run) chỉ in thống kê, gán `owner_id` theo TA | Script và báo cáo số dòng, số lỗi | 166 dòng mẫu vào đủ hoặc có lý do từng dòng lỗi |
| 1.7 | (Tùy chọn, chờ PO) Gắn mã ghế vào hồ sơ ứng viên: chọn mã đã cấp trên form ứng viên. Dùng cho cột "Ghế WD" ở bảng theo dõi CnB (2.6). | Cột `seat_code` trên `recruitment_records` hoặc bảng liên kết | PO đồng ý làm |
| 1.8 | Nghiệm thu: cập nhật `USER_GUIDE.md` và `HUONG_DAN_NHAN_VIEN_TUYEN_DUNG.md` | Hướng dẫn 1 trang cho TA và HRSS | PO chạy thử hết luồng ở local |

---

## 2. Quy trình 2: Phối hợp CnB (chốt OB ngày 25, theo dõi hồ sơ)

### 2.1 Quy tắc nghiệp vụ (đề xuất, chờ PO chốt)

**Kỳ OB tháng T:** từ ngày 26 tháng T‑1 đến ngày 24 tháng T. Ví dụ OB tháng 11 là 26/10 đến 24/11. Chốt vào ngày 25/T.

Một hồ sơ **vào danh sách chốt** khi đủ cả 4 điều kiện:
1. `ob_date` nằm trong kỳ.
2. `salary_pay_status = 'Chi lương'`.
3. Còn làm việc: `emp_status = 'Active'` và không có `attrition_date` tính đến ngày chốt.
4. Hồ sơ không ở trạng thái lưu trữ.

Hồ sơ thiếu một trong các điều kiện trên vẫn hiện ở bản xem trước, kèm **lý do bị loại**: chưa chọn chi lương, đã nghỉ, thiếu Emp_ID… Nhờ vậy TA sửa được trước ngày 25.

Cách ghi giấy tờ theo sheet: `x` là đã có, `o` là thiếu. Hồ sơ có file hoặc giá trị thì ghi `x`, để trống thì ghi `o`. Cần PO xác nhận, xem câu hỏi Q3.

Quy tắc đặt trong `shared/cnbRules.ts`, dùng chung cho trình duyệt và DB, có test:
- `obCycle(date) → { key: '2026-11', label: 'OB_T11/26', from, to }`
- `cnbEligible(record, cutoffDate) → { ok, reasons[] }`
- `docMark(value) → 'x' | 'o'`

### 2.2 Dữ liệu

Migration mới `0040_cnb_ob.sql`. Số `0039` để dành cho phần audit mã ghế nếu cần.

| Bảng | Cột chính | Vì sao |
|---|---|---|
| `cnb_ob_batches` | `cycle_key` (unique, '2026-11'), `from_date`, `to_date`, `status` (`mo` / `da_chot`), `locked_at`, `locked_by`, `note` | Mỗi tháng một đợt. Sau khi chốt thì khóa. |
| `cnb_ob_items` | `batch_id`, `record_id`, `snapshot` jsonb (giá trị các cột template tại lúc chốt), `cnb_*` (CnB kiểm hồ sơ: Bằng cấp, CCCD, KSK, SYLL, HĐTV, HĐLĐ, QĐNV, ghi chú), `checked_by`, `checked_at` | **Ảnh chụp lúc chốt**: sau ngày 25, hồ sơ có sửa thì danh sách đã gửi CnB vẫn giữ nguyên. Phần CnB kiểm hồ sơ thay cho tab `C&B check HS Tháng N`. |

RPC:
- `cnb_ob_preview(p_cycle)`: danh sách trực tiếp từ `recruitment_records` nối `hr_info`, kèm lý do bị loại. TA chỉ thấy hồ sơ của mình, Admin thấy tất cả.
- `cnb_ob_lock(p_cycle)`: chỉ Admin. Chạy trong một giao dịch, chụp `snapshot` rồi khóa đợt. Chốt lại lần hai thì báo lỗi; muốn chốt lại phải dùng `cnb_ob_reopen`, chỉ Admin, có ghi log.
- `cnb_ob_add_late(p_cycle, p_record_id)`: thêm người bổ sung sau chốt, có ghi lý do.
- `cnb_item_check(p_item_id, p_fields)`: ghi kết quả CnB kiểm hồ sơ.

Bảo mật:
- `snapshot` chứa CCCD và tài khoản ngân hàng, nên RLS chỉ cho Admin đọc toàn bộ. TA chỉ đọc item của hồ sơ mình.
- Log chỉ ghi tên trường, không ghi giá trị (giống `hr_info_write`).
- Xuất Excel 98 cột chỉ Admin làm được.

### 2.3 Map template 98 cột (`OB_T6/26`) từ hồ sơ

Viết map trong `shared/cnbTemplate.ts`: một mảng `{ header, source, transform }` theo đúng thứ tự cột của sheet, để xuất ra đúng template.

| Nhóm | Cột sheet | Nguồn trong app |
|---|---|---|
| A. Hồ sơ ứng viên | Mã nhân viên, Họ và tên, Cấp bậc, Chức danh, Ngày tuyển dụng, Phân loại tuyển dụng, Phòng/Vùng/Miền, Các đơn vị thành viên, Phòng/Bộ phận/Nhóm, Đội, Điện thoại di động, HDTV, Drive upload, Bằng cấp, GKSK, CCCD, SYLL, Note Document, Tình trạng làm việc, Ngày nghỉ việc, Tình trạng Cut-off | `emp_id`, `full_name`, `rank`, `position`, `ob_date`, `hire_type`, `region`, `unit`, `dept`, `site`, `phone`, `contract_sign_status`, `drive_upload`, `edu_certificate`, `health_check`, `id_card`, `resume` (qua `docMark`), `doc_note`, `emp_status`, `attrition_date`, `cutoff` |
| A'. Tính ra | Nhóm chức danh ("Rank 5" từ "5C"); Loại hợp đồng, Ngày bắt đầu HĐ, Ngày kết thúc (từ `probation_contract_type`, `ob_date`, `probation_period`); STT | Hàm trong `cnbTemplate.ts` |
| B. `hr_info` (tab thông tin cá nhân) | Địa chỉ thường trú, Địa chỉ hiện tại, Trình độ học vấn, Dân tộc, Số CMND/Hộ chiếu, Ngày cấp, Nơi cấp, Email cá nhân, Mã số thuế, Ngân hàng, Số tài khoản NH | `address_permanent`, `address_current`, `edu_level`, `ethnicity`, `id_number`, `id_issue_date`, `id_issue_place`, `email`, `tax_code`, `bank_name`, `bank_account` |
| C. Hằng số hoặc cấu hình | Tập đoàn, P&L, Công ty pháp lý | Lưu trong `app_settings` (`cnb_constants`), Admin sửa được |
| D. Phụ cấp có sẵn trên hồ sơ | Tiền ăn giữa ca, Hỗ trợ thu hút khó tuyển dụng… | `meal_allowance`, `attraction_allowance`, `fmcg_allowance`, `nightshift_allowance`. Cần PO xác nhận từng cột tương ứng (Q5). |
| E. CnB hoặc HRSS tự điền, để trống | Cost Ctr, Tài khoản AD, Master code, Vùng bảo hiểm, Chu kỳ ca, Email công ty, các cờ thuế Y/N, Loại quyết định, Người ký, Ngày ký, các khoản phụ cấp còn lại, Họ tên và điện thoại QLTT, Chi nhánh NH, Chuyên ngành, Trường, Tỉnh/Quận/Phường/Địa chỉ làm việc | Xuất cột trống. Có thể lấy QLTT từ `seat_requests.quan_ly_truc_tiep` nếu làm bước 1.7. |

Có hai kiểu xuất:
- **Bản gọn** (16 cột như `OBT11/26`): Emp ID, Name, Position, Site, OBD, Emp_STT, Attrition_Date, TA, HĐTV, Chi lương, Drive upload, Bằng cấp, GKSK, CCCD, SYLL, Note Document. Lấy hoàn toàn từ nhóm A.
- **Bản đầy đủ** (98 cột như `OB_T6/26`): thêm nhóm B đến E.

### 2.4 Màn hình

Thêm tab mới **"Chốt OB / CnB"** vào `App.tsx` (`NavTab = 'cnb_ob'`), file `frontend/src/components/CnbObView.tsx` và `services/cnbService.ts`.

- **TA:** chọn kỳ (mặc định là kỳ đang mở) và xem danh sách hồ sơ của mình trong kỳ, gồm cột đủ hoặc thiếu điều kiện, lý do, số trường thông tin cá nhân còn thiếu (`hrMissingCount`), giấy tờ x/o. Bấm một dòng để mở form ứng viên và sửa ngay. Có banner đếm ngược đến ngày 25.
- **Admin:** xem tất cả TA, có ô đếm theo TA (thay tab `Table`: tổng, đã điền thông tin, còn thiếu…). Có nút **Chốt kỳ**, xác nhận hai bước và hiện số người sẽ chốt. Sau chốt: xuất bản gọn hoặc bản đầy đủ, thêm người bổ sung, mở lại kỳ.
- **Kiểm hồ sơ CnB** (thay `C&B check HS Tháng N`): bảng các item đã chốt, mỗi dòng có các ô Bằng cấp, CCCD, KSK, SYLL, HĐTV, HĐLĐ, QĐNV và ghi chú. TA thấy dòng nào CnB báo thiếu để bổ sung.

### 2.5 Các bước

| # | Việc | Đầu ra | Xong khi |
|---|---|---|---|
| 2.0 | PO chốt các câu hỏi Q1 đến Q8 bên dưới | Mục 2.1 và 2.3 được cập nhật | Không còn câu hỏi chặn |
| 2.1 | `shared/cnbRules.ts` và test: kỳ OB (gồm đổi năm 26/12 đến 24/01, tháng 2, ngày 25), điều kiện chốt, `docMark` | Code và `tests/shared/cnbRules.test.ts` | Test pass. Chạy trên `records_anon` ra số người mỗi kỳ hợp lý. |
| 2.2 | Kiểm chứng trên dữ liệu thật: script đếm số người đủ điều kiện kỳ T9, T10, T11/26 từ dữ liệu ẩn danh, so với số dòng các tab `OB_T9`, `OB_T10`, `OBT11/26` (chỉ đếm, không in tên) | Bảng so sánh | Lệch dưới 5% hoặc giải thích được từng nhóm lệch |
| 2.3 | `shared/cnbTemplate.ts`: map 98 cột và 16 cột, có test thứ tự header khớp sheet | Code và test | Xuất thử khớp header từng cột |
| 2.4 | Migration `0040_cnb_ob.sql` (bảng, RLS, RPC preview, lock, reopen, add_late, check, audit) và `supabase/tests/cnb_ob.sql` | SQL và test | Chạy ở local: TA không đọc được snapshot của người khác, chốt hai lần thì bị chặn |
| 2.5 | `cnbService.ts` và `CnbObView.tsx`: bản xem trước cho TA và Admin, chốt, xuất Excel (dùng lại `xlsxDownload.ts`) | Màn hình | Chạy hết luồng kỳ T11/26 trên dữ liệu thử |
| 2.6 | Màn kiểm hồ sơ CnB và ô đếm theo TA. Thêm cột Ghế WD hoặc Upload WD nếu có bước 1.7 (thay tab `Tracking WD`). | Màn hình | CnB đánh dấu được, TA thấy dòng bị báo thiếu |
| 2.7 | (Tùy chọn) Danh sách No-show/Cut-off gửi CnB theo kỳ (thay tab `Noshow`): lọc theo `cutoff`, `cutoff_mail`, `ob_status` | Thêm một bảng trong cùng màn | PO đồng ý làm |
| 2.8 | Nhắc việc: từ ngày 20 đến 24, tạo cảnh báo trong `AlertsBell` cho TA còn hồ sơ thiếu điều kiện hoặc thiếu thông tin. Dùng lại bảng alerts trong `0017`. | Cảnh báo | TA thử nhận được cảnh báo |
| 2.9 | Nghiệm thu và hướng dẫn sử dụng | Cập nhật USER_GUIDE | PO chạy thử song song một kỳ (T12/26, chốt 25/12/2026), so với sheet CnB |

---

## 3. Làm trong 1 ngày (bản chạy được, PO yêu cầu 27/11/2026)

Không chờ trả lời câu hỏi. Làm theo **mặc định** dưới đây, PO sửa sau nếu khác.

| Câu hỏi | Mặc định dùng ngay |
|---|---|
| SEAT §6 (1–7) | Giữ nguyên như bản nháp `0038`: mã = mã lớn nhất + 1, TA nhập Ranking AP, Admin xác nhận thay HRBP |
| Q1 | Ngày 25/T tính vào kỳ T+1 (kỳ T = 25/T‑1 → 24/T) |
| Q2 | "Còn làm việc" tính tại lúc bấm chốt |
| Q3 | Có giá trị → `x`, trống → `o` |
| Q4 | Làm cả 2 kiểu xuất, mặc định bản gọn 16 cột |
| Q5, Q7, Q8 | Chỉ map các cột chắc chắn (nhóm A, B, C). Phụ cấp, chuyên ngành, trường, địa bàn làm việc xuất trống |
| Q6 | Không thêm vai trò `cnb`, Admin làm thay |

### Lịch trong ngày

| Giờ | Việc (số bước ở mục 1, 2) |
|---|---|
| Sáng 1 (2h) | **Mã ghế:** 1.2 chạy `0038` ở local và test SQL, 1.3 audit log, sửa lỗi nếu migration fail |
| Sáng 2 (2h) | **CnB:** 2.1 `cnbRules.ts` và test, 2.3 `cnbTemplate.ts` (16 + 98 cột), 2.4 migration `0040_cnb_ob.sql` (bảng, RLS, preview, lock, reopen, check, audit) |
| Chiều 1 (2,5h) | 2.5 `cnbService.ts` và `CnbObView.tsx`: xem trước cho TA/Admin, chốt kỳ, xuất Excel; thêm phần kiểm hồ sơ CnB (2.6, chỉ các ô giấy tờ) |
| Chiều 2 (1,5h) | 1.4 màn Admin mã ghế (lọc, chọn nhiều, xuất Excel); 2.2 script đếm kỳ T9–T11 trên dữ liệu ẩn danh; `npm test`, build, chạy thử hết luồng ở local |

### Dời sang sau (không chặn dùng thử)

1.0 đối chiếu sheet mã ghế (chờ share quyền), 1.5 Tổng hợp theo tháng, 1.6 import mã ghế cũ, 1.7 gắn mã ghế vào hồ sơ, 2.6 cột Ghế/Upload WD, 2.7 No-show, 2.8 nhắc việc ngày 20–24, cập nhật hướng dẫn sử dụng.

Cuối ngày: chạy `npm test` và build ở local. PO tự push migration (`0038`, `0040`) và deploy.

---

## 4. Câu hỏi cần PO / CnB trả lời

**Quy trình 1:** 7 câu hỏi ở `SEAT_CODE_RULES.md` §6, cộng thêm:
- S8. Có cần gắn mã ghế vào từng hồ sơ ứng viên không (bước 1.7)?
- S9. Share quyền sheet `1IfxJ…` để đối chiếu.

**Quy trình 2:**
- **Q1. Ngày 25 thuộc kỳ nào?** Kỳ 26/10 đến 24/11 thì người OB đúng ngày 25 không nằm trong kỳ nào. Đề xuất: **25/T tính vào kỳ T+1**, tức kỳ thực tế là 25/T‑1 đến 24/T, và chốt sau khi hết ngày 24. Cần xác nhận.
- **Q2. "Còn làm việc" tính đến lúc nào?** Người nghỉ sau ngày chốt nhưng trước khi CnB chạy lương thì xử lý ra sao? Đề xuất: tính tại ngày chốt; người nghỉ sau đó thì CnB tự xử lý trên danh sách đã chốt.
- **Q3. Ký hiệu giấy tờ:** `x` là đã có, `o` là thiếu, đúng không? Ở `OB_T6` có dùng `1`: nghĩa là gì?
- **Q4. Template dùng bản nào?** Bản 98 cột (`OB_T6`) hay bản gọn (`OB_T9` đến `OBT11`)? Đề xuất làm cả hai, mặc định bản gọn.
- **Q5. Phụ cấp:** các cột phụ cấp nào lấy từ hồ sơ (ví dụ Tiền ăn giữa ca = `meal_allowance`)? Cột nào để CnB tự điền?
- **Q6. Có tài khoản riêng cho CnB không?** Nếu có, thêm vai trò `cnb`: xem danh sách đã chốt, kiểm hồ sơ, không sửa hồ sơ ứng viên. Nếu không, Admin làm thay.
- **Q7. Chuyên ngành, Trường, Chi nhánh NH** chưa có trong `hr_info`. Có cần thêm vào form thông tin nhân sự không?
- **Q8. Ban/Chuỗi/Khối, Tỉnh/Quận/Phường làm việc:** lấy từ `hierarchy` theo `site` được không, hay CnB tự điền?

---

## 5. Tiến độ (27/11/2026)

### Đã làm

| Phần | File | Kiểm tra |
|---|---|---|
| Mã ghế: nhật ký, tổng hợp, thu quyền `anon` trên hàm trigger của 0038 | `supabase/migrations/0039_seat_audit_summary.sql` | `supabase/tests/seat_test.sql`: 30 check đạt |
| Mã ghế: lọc TA / vùng / tháng gửi / tìm kiếm, khối **Tổng hợp** | `SeatRequestsView.tsx`, `seatService.ts` (`summary`) | build, typecheck |
| CnB: quy tắc kỳ, điều kiện, giấy tờ | `shared/cnbRules.ts` | `tests/shared/cnbRules.test.ts` |
| CnB: template 16 cột, 98 cột, bảng kiểm hồ sơ | `shared/cnbTemplate.ts` | cùng file test: 18 test đạt |
| CnB: bảng, RLS, xem trước, chốt, mở lại, bổ sung, bỏ, kiểm hồ sơ, nhật ký | `supabase/migrations/0040_cnb_ob.sql` | `supabase/tests/cnb_test.sql`: 39 check đạt |
| CnB: tab **Chốt OB / CnB** | `CnbObView.tsx`, `cnbService.ts`, `App.tsx` | build, typecheck |
| Bản tiếng Anh cho câu mới (gồm câu của bản nháp mã ghế 26/11 còn thiếu) | `frontend/src/i18nNew.ts` | `i18nNew.test.ts` |
| CI chạy 2 test SQL mới | `.github/workflows/ci.yml` | |

Chạy ở local trên Postgres 17: toàn bộ migration 0001–0040; `security_audit.sql` sạch; các test SQL khác đạt, trừ 4 test parity
(`sql_parity`, `report_parity`, `board`, `alerts`) không chạy được vì cần `psql` (máy không có), không liên quan phần mới.
`npm test` 320 đạt, `eslint` sạch, `guard` OK, `frontend` build OK.

### Phát hiện khi đếm trên dữ liệu thật (bước 2.2, chỉ đếm)

Trên `migrate/master_records.jsonl` (8.814 hồ sơ), cột **Tình trạng chi lương trống ở 100% hồ sơ** kỳ T9–T11.
Theo quy tắc "chỉ tính Chi lương", app sẽ **chưa có ai đủ điều kiện** cho tới khi TA điền cột này.
Số OB trong kỳ trừ người đã nghỉ khá sát số dòng trên sheet CnB: T10 là 92 (sheet 93 người, 78 Chi lương, STT tới 94 nhưng thiếu số 25); T11 (dữ liệu tới 22/11) là 83 (sheet 75 dòng, 66 Chi lương).

**PO chốt (27/11): làm cả hai.**
1. Từ kỳ T12/26 trở đi: TA điền *Tình trạng chi lương* trên hồ sơ trước ngày 25. Màn Chốt OB đã báo đỏ "Chưa chọn" từng dòng. Người kỳ T12 không có trong sheet cũ nên bắt buộc phải điền tay.
2. Dữ liệu cũ T10/T11: nhập một lần bằng `scripts/migrate/cnbStatusImport.ts` (logic ở `cnbStatusLib.ts`, test ở `tests/migrate/cnbStatus.test.ts`).
   - Đầu vào: CSV 4 cột `tab,emp_id,contract_sign_status,salary_pay_status`, chỉ lấy Mã NV + 2 trạng thái (OB_T10/26: cột C, J, K; OBT11/26: cột A, I, J).
   - Script không kết nối DB. Nó dry-run trên bản ETL rồi sinh 1 file SQL (1 transaction) để Admin tự chạy trên SQL editor.
   - SQL chỉ điền ô trống (`--overwrite` thì ghi đè), bỏ qua Mã NV trùng trên nhiều hồ sơ, tăng `row_version`, ghi `audit_logs` action `IMPORT_CNB` (old/new + `cnb_tab`). Chạy lại lần 2 không đổi gì thêm.
   - Dry-run trên ETL: 168 Mã NV → 154 khớp (T10 89/93, T11 65/75), 13 không tìm thấy, 1 trùng hồ sơ. Sẽ điền 154 ô chi lương, 144 ô HĐTV.
   - Đã chạy thử SQL trên Postgres 17 cục bộ: điền đúng, giữ ô đã có giá trị, bỏ Mã NV trùng, lần 2 không đổi gì.
   - File SQL chứa Mã NV thật: để ngoài repo, không commit.

### Còn lại

- PO push migration `0038`, `0039`, `0040` lên Supabase và deploy frontend.
- PO chạy file SQL nhập chi lương/HĐTV T10–T11 trên DB PROD (DEV đã ẩn danh Mã NV nên sẽ không khớp ai), xem bảng tổng hợp cuối file.
- TA điền *Tình trạng chi lương* cho người kỳ T12/26 trước 25/12/2026.
- Các bước dời sang sau ở mục 3.
- Lỗi nhỏ có từ `0038`: khi bộ đếm chạm 99999999, ràng buộc bảng báo lỗi trước thông báo `SEAT_CODE_RANGE_EXHAUSTED`. Chỉ xảy ra khi hết dải mã (hiện ở 25,6 triệu), nên chưa sửa.

## 6. Không làm trong đợt này

- Ghi ngược dữ liệu lên Google Sheet tự động. README quy định Sheets chỉ dùng cho import, export và backup. Xuất Excel đúng template để CnB dán vào.
- Đổi cách tính `ob_month` hiện có. Báo cáo cũ vẫn theo tháng lịch, kỳ CnB là trường tính riêng.
- Bất kỳ thay đổi nào trong `OLD/`.

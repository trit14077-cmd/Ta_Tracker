# Quy tắc tạo mã ghế (Quy trình 1)

Trạng thái: **bản nháp chờ duyệt** (26/11/2026). Migration `0038_seat_requests` chưa áp dụng trên project nào.
Nguồn: sheet *Copy of Request_Job Requisition*, tab `NhapLieu` (166 dòng, ngày gửi 24/04/2026 → 11/2026, 29 ngày gửi khác nhau), tab `RawData` (dòng 1 ghi bên nhập từng cột), tab `Process` (5 bước).

Written for: PO và HRSS duyệt quy tắc trước khi chạy migration.

## 1. Luồng

| Bước | Việc | Ai | Trạng thái trong app | Hạn (sheet) |
|---|---|---|---|---|
| 2 | Nhập liệu dòng ghế ở tài khoản riêng | TA | `nhap` | ngày 27–29 hàng tháng |
| 3 | Gửi request cho HRBP | TA | `gui` (ghi *Ngày gửi* = hôm nay) | ngày 27–29 |
| 4 | HRBP xác nhận hoặc điều chỉnh | HRBP | `xac_nhan` (HRSS ghi thay vì chưa có vai trò HRBP) | tối đa 2 ngày làm việc |
| 5 | Cấp mã ghế, trả mã về sheet | HRSS | `da_cap_ma` | tối đa 2 ngày làm việc |

Bước 1 (*Tổng hợp* số ghế theo tháng, tab `TongHop`) chưa đưa vào đợt này.
HRBP có thể trả dòng về TA (`gui` → `nhap`), khi đó xóa *Ngày gửi*.
Dòng đã `da_cap_ma` bị khóa, không sửa được.

## 2. Cột và quy tắc

Thứ tự cột giống tab `NhapLieu` A–S. "Điền" = số dòng có giá trị trên 166 dòng mẫu.

| Cột sheet | Trường DB | Bên điền (dòng 1 `RawData`) | Điền | Quy tắc |
|---|---|---|---|---|
| Ngày gửi | `ngay_gui` | TA | 164/166 | Không nhập tay. Ghi khi TA gửi HRBP, dạng dd/mm/yyyy khi xuất |
| Mã ghế | `ma_ghe` | HRSS | 4/166 | HRSS cấp, xem mục 3 |
| Ban/ Chuỗi/ Khối | `ban` | TA | 166/166 | **Bắt buộc** |
| Các đơn vị thành viên | `don_vi` | TA | 157/166 | Tùy chọn |
| Phòng/ Bộ Phận/ Nhóm | `phong` | TA | 116/166 | Tùy chọn |
| Đội | `doi` | TA | 109/166 | Tùy chọn |
| Tổ (PP/IB/OB/IN/GV) | `to_nhom` | TA | 28/166 | Tùy chọn |
| Nhóm (Site) | `nhom_site` | TA | 0/166 | Tùy chọn, chưa dùng trong mẫu (xem câu hỏi) |
| Phòng/Vùng/Miền | `vung` | TA | 166/166 | **Bắt buộc**, một trong: Miền Bắc, Miền Nam, Miền Trung |
| Nhóm Chức Danh | `nhom_chuc_danh` | TA | 166/166 | **Bắt buộc**, dạng "Rank 2" … "Rank 6" |
| Ranking theo AP | `ranking_ap` | HRBP (*) | 166/166 | **Bắt buộc**, dạng 2A … 6C |
| Ranking Offer | `ranking_offer` | TA | 139/166 | Tùy chọn, cùng dạng. 11 dòng khác Ranking AP: hợp lệ |
| VỊ TRÍ THEO AP (JOB) | `vi_tri_ap` | HRBP (*) | 166/166 | **Bắt buộc** |
| VỊ TRÍ THEO OFFER (Tiếng Việt) | `vi_tri_offer_vi` | TA | 82/166 | Tùy chọn |
| VỊ TRÍ THEO OFFER (Tiếng Anh) | `vi_tri_offer_en` | TA | 19/166 | Tùy chọn |
| Số lượng | `so_luong` | TA | 166/166 | **Bắt buộc**, số nguyên 1–100 (mẫu có 41, 20, 15) |
| Quản lý trực tiếp | `quan_ly_truc_tiep` | TA | 166/166 | **Bắt buộc** |
| Cost center | `cost_center` | HRBP | 0/166 | Không có trong form TA; để trống |
| Note | `note` | Chung | 17/166 | Tùy chọn |

(*) Dòng 1 `RawData` ghi HRBP điền Ranking AP và Vị trí AP, nhưng trong `NhapLieu` hai cột này được điền đầy đủ (166/166) từ bước nhập. Đợt này để TA nhập; cần PO xác nhận (xem mục 6).

Chuẩn hoá và cảnh báo (`shared/seatCodeRules.ts`):
- Chuỗi chuẩn hoá NFC và gộp khoảng trắng. Sheet có "Miền Trung" ở hai dạng Unicode, nếu không chuẩn hoá sẽ thành hai giá trị khác nhau.
- Chữ số của Ranking AP phải khớp "Rank N". Mẫu có 1 dòng lệch (Rank 4 với 3C): đây là **cảnh báo**, không chặn.
- Ngày sheet dd/mm/yyyy; ngày không tồn tại (31/02) bị từ chối.

### Dropdown phụ thuộc Ban → Đơn vị → Phòng → Đội → Tổ (migration 0041, `shared/seatOrgTree.ts`)

Sheet không dùng `INDIRECT`: mỗi ô của tab NhapLieu có danh sách riêng, lọc theo các ô bên trái. Nguồn là tab **RawData** (cây tổ chức, 107 nhánh, file `Request_Job Requisition.xlsx` ngày 27/11/2026).

| Cấp | Cột sheet | Số giá trị | Lọc theo |
|---|---|---|---|
| 1 | C. Ban/ Chuỗi/ Khối | 9 | |
| 2 | D. Các đơn vị thành viên | 19 | Ban |
| 3 | E. Phòng/ Bộ Phận/ Nhóm | 12 | Ban + Đơn vị |
| 4 | F. Đội | 30 | Ban + Đơn vị + Phòng |
| 5 | G. Tổ (PP/IB/OB/IN/GV) | 6 | cả nhánh trên |

- Quy tắc: 5 cột phải là **tiền tố** của một nhánh đang dùng. Được dừng ở giữa (31/166 dòng mẫu dừng ở giữa). Không được bỏ trống cấp giữa rồi điền cấp sau (1 dòng mẫu lỗi kiểu này).
- Đối chiếu 166 dòng NhapLieu: 134 đúng nhánh đầy đủ, 31 dừng ở giữa, 1 lỗi.
- Danh mục ở bảng `seat_org_paths`. Admin thêm nhánh hoặc tắt (`active = false`) trên Supabase Table Editor; TA chỉ đọc.
- DB kiểm khi tạo dòng hoặc khi đổi 1 trong 5 cột (trigger `seat_requests_org_check`, lỗi `SEAT_ORG_INVALID:<cấp>` / `SEAT_ORG_HOLE:<cấp>`). Dòng cũ không bị khóa nếu danh mục đổi sau.
- Form: đổi một cấp thì các cấp dưới tự xóa. Giá trị cũ không còn trong danh mục vẫn hiện, kèm chữ "(không có trong danh mục)".
- Các cột từ Vùng trở đi không phụ thuộc cây (RawData để trống), giữ danh sách phẳng như cũ.

## 3. Cấp mã ghế

Quan sát từ sheet:
- Mã là số **8 chữ số**.
- Mỗi ghế một mã. Dòng có Số lượng = 2 hoặc 3 đã có các mã liên tiếp (ví dụ 25597256, 25597257 cho hai dòng cùng người).
- Mã cấp tăng liên tiếp theo thứ tự: 25597254 → 25597257 (4 mã đã cấp trong sheet, từ 24/04/2026). Các dòng sau ngày này chưa có mã.

Rule áp dụng:
1. Mã tiếp theo = mã đã cấp gần nhất + 1. Dòng có Số lượng N nhận N mã liên tiếp.
2. Điểm bắt đầu lưu trong bảng `seat_code_counter`, khởi tạo **25597257** (mã lớn nhất thấy trong sheet).
3. Bộ đếm **chỉ tăng**. `seat_counter_set` từ chối giá trị nhỏ hơn hiện tại, vì lùi lại sẽ cấp trùng mã.
4. Cấp mã chạy trong giao dịch có khóa advisory, nên hai HRSS bấm cùng lúc không cấp trùng.
5. Mã cấp rồi không tái sử dụng và không sửa được.

Chưa chắc: công thức thực tế của HRSS. Sheet chỉ có 4 mã và không có cột ghi quy tắc. Nếu HRSS dùng dải hoặc tiền tố khác, chỉ cần đổi giá trị bộ đếm và, nếu cần, hàm `seat_issue_codes`.

## 4. Quyền

- TA (`pic`): thấy và sửa dòng của mình khi còn `nhap` (RLS theo `owner_id`). Gửi HRBP được ngay khi dòng đủ bắt buộc (ràng buộc DB kiểm lại).
- Admin (HRSS): thấy tất cả. Xác nhận HRBP, trả về TA, cấp mã. Không sửa dòng `da_cap_ma`.
- Trigger `seat_requests_guard` chặn chuyển trạng thái trái luồng, chặn ghi mã ngoài RPC, kiểm định dạng 8 chữ số.
- Không có vai trò HRBP trong hệ thống. Bước HRBP xác nhận do admin ghi thay.

## 5. Xuất file

Nút **Xuất Excel** xuất các dòng đang chọn (hoặc đang hiển thị) theo đúng 19 cột tab `NhapLieu` và thêm cột **Trạng thái**. Mã nhiều ghế cách nhau bằng dấu phẩy. Dạng này để đổ về sheet chung, hoặc gửi HRBP.

Đẩy dữ liệu ngược lên Google Sheet tự động **chưa làm**. README của dự án ghi Google Sheets chỉ dùng cho import, export và backup, nên đợt này để người dùng tự đưa file lên sheet chung.

## 6. Câu hỏi còn mở cho PO / HRSS

1. **Công thức mã**: mã cấp tiếp theo có đúng là số liền sau mã lớn nhất hiện tại không? Mã thật lớn nhất hiện nay là bao nhiêu (sheet chỉ đến 25597257)?
2. **Ai điền Ranking AP và Vị trí AP**: TA hay HRBP? Hiện đợt này cho TA nhập.
3. **Cost center** (0/166 điền) và **Nhóm (Site)** (0/166 điền): có cần đưa vào form không?
4. **Ngày gửi**: đề xuất ghi tự động khi TA gửi. 2 dòng mẫu thiếu ngày, khả năng là dòng chưa gửi.
5. **Số lượng lớn** (20, 41): có cần cảnh báo hay yêu cầu duyệt riêng không? Đợt này chỉ chặn trên 100.
6. **HRBP có tài khoản riêng không?** Nếu có, bước 4 nên được HRBP tự xác nhận thay vì admin ghi thay.
7. **Lệch "Rank N" với Ranking AP** (1 dòng mẫu): chỉ cảnh báo, PO xác nhận có đúng là cảnh báo không.

## 7. Phạm vi đã làm và chưa làm

Đã làm trong đợt này:
- Quy tắc dùng chung và bộ test (`shared/seatCodeRules.ts`, `tests/shared/seatCodeRules.test.ts`).
- Migration `0038_seat_requests` (bảng, RLS, trigger, RPC cấp mã, bộ đếm). **Chưa chạy trên DB nào**.
- Màn hình **Mã ghế** (`frontend/src/components/SeatRequestsView.tsx`), service `seatService.ts`, xuất Excel.

Làm thêm ngày 27/11/2026 (migration `0039_seat_audit_summary`):
- Ghi `audit_logs` cho mọi thao tác: SEAT_CREATE, SEAT_UPDATE, SEAT_SUBMIT, SEAT_RETURN, SEAT_CONFIRM, SEAT_ISSUE, SEAT_DELETE, SEAT_COUNTER.
- Bước 1 *Tổng hợp*: RPC `seat_summary`, nút **Tổng hợp** trên màn Mã ghế. Thêm lọc theo TA, vùng, tháng gửi.
- Test SQL `supabase/tests/seat_test.sql` (30 check). `0038` và `0039` đã chạy được trên Postgres 17 ở local.

Chưa làm:
- Nhập ngược dữ liệu từ sheet cũ vào bảng `seat_requests`.

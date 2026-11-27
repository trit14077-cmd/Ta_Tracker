# ACCEPTANCE_STEPS – Các bước kiểm tay chi tiết (M9-1)

Đi kèm [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md). Mỗi mục F01–F20 dưới đây tách cột "Cách kiểm" thành từng bước. Tick `[x]` từng bước khi đạt. Tất cả bước của một mục đạt thì ghi ✅ cho dòng đó trong ACCEPTANCE_CHECKLIST. Có bước không đạt thì ghi ❌ và ghi chú lại.

## 0. Chuẩn bị

- [ ] DEV đã apply migration 0027–0030 và deploy lại Edge Function.
- [ ] Có 4 tài khoản: **Admin**, **TA-A** (PIC A), **TA-B** (PIC B), **TA-khóa** (đã bị khóa).
- [ ] Mở 2 trình duyệt hoặc 1 cửa sổ thường + 1 cửa sổ ẩn danh để đăng nhập 2 vai cùng lúc.
- [ ] Chuẩn bị file thử:
  - `cv_4mb.pdf`, `cv_6mb.pdf`, `cv_11mb.pdf`
  - `fake.pdf`: một file .exe đổi đuôi thành .pdf
  - 1 ảnh .jpg nhỏ
  - 21 file payslip nhỏ
- [ ] Chuẩn bị file Excel import: lấy file mẫu 76 cột trong app, điền 5 dòng đúng, 2 dòng lỗi (SĐT sai, ngày sai) và 1 dòng trùng mã với một hồ sơ đã có.
- [ ] Đặt tên hồ sơ giả: tên `TEST 01`, `TEST 02`…, SĐT dạng `0900000001`… Ghi lại mã ứng viên của từng hồ sơ giả.

**Cách ghi lỗi** (cột Ghi chú):
`[Mã hồ sơ giả] – Bước X – Mong đợi: … – Thực tế: …`. Kèm ảnh chụp màn hình nếu được.

---

## F01 – Đăng nhập

- [ ] 1. Admin đăng nhập đúng mật khẩu ⇒ vào app, thấy đủ menu (gồm các menu chỉ Admin có: Nhập Excel, Drop-list, Tài khoản).
- [ ] 2. Admin đăng xuất ⇒ quay về màn đăng nhập. Bấm nút Back của trình duyệt không vào lại được app.
- [ ] 3. TA-A đăng nhập ⇒ **không** thấy các menu Nhập Excel, Drop-list, Tài khoản.
- [ ] 4. TA-A đổi mật khẩu, đăng xuất, đăng nhập bằng mật khẩu mới ⇒ được. Đăng nhập bằng mật khẩu cũ ⇒ bị từ chối.
- [ ] 5. TA-khóa đăng nhập ⇒ bị từ chối, có thông báo rõ ràng.
- [ ] 6. Nhập sai mật khẩu nhiều lần liên tiếp (khoảng 10 lần) ⇒ bị chặn tạm. *Bước này chỉ kiểm được sau khi đã cấu hình S6 trên Dashboard.*
- [ ] 7. Để app mở quá thời hạn phiên, hoặc xóa cookie/localStorage của trang, rồi thao tác ⇒ app yêu cầu đăng nhập lại và không báo lỗi khó hiểu.

## F02 – Ứng viên: danh sách

- [ ] 1. Lần lượt dùng từng bộ lọc (PIC, vị trí, khu vực, trạng thái, khoảng ngày…) ⇒ kết quả đúng với bộ lọc. Bấm xóa lọc ⇒ danh sách trở về như ban đầu.
- [ ] 2. Tìm theo **mã** ứng viên ⇒ ra đúng 1 hồ sơ.
- [ ] 3. Tìm theo **tên có dấu** (`Nguyễn`) và **không dấu** (`nguyen`) ⇒ kết quả như nhau.
- [ ] 4. Tìm theo **SĐT**, cả số đầy đủ và một phần số ⇒ ra đúng hồ sơ.
- [ ] 5. Chuyển trang và đổi số dòng mỗi trang ⇒ tổng số không đổi, không lặp hồ sơ giữa các trang.
- [ ] 6. Đặt vài bộ lọc ⇒ lưu thành View ⇒ tải lại trang (F5) ⇒ mở View đó ⇒ các bộ lọc được khôi phục đúng.
- [ ] 7. Tùy chỉnh cột (ẩn, hiện, đổi thứ tự) ⇒ F5 ⇒ cách sắp cột vẫn được giữ.
- [ ] 8. Tạo 2 hồ sơ giả trùng SĐT (và 2 hồ sơ trùng CCCD nếu có) ⇒ danh sách hiện nhãn trùng ở cả hai hồ sơ.
- [ ] 9. Bấm lần lượt **6 thẻ KPI** ⇒ danh sách lọc theo thẻ, và **tổng số dòng = số trên thẻ**. Ghi lại 6 cặp số.
- [ ] 10. Kéo một dòng vào một thẻ bước ⇒ hồ sơ chuyển sang bước đó và có hộp xác nhận.
- [ ] 11. TA-A chỉ thấy hồ sơ có PIC của mình. Tìm mã một hồ sơ của TA-B ⇒ không ra kết quả.

## F03 – Ứng viên: chi tiết và nhập

- [ ] 1. Mở một hồ sơ đủ dữ liệu ⇒ đếm được **11 section**. Các field hiện đủ, không có ô trống tiêu đề hoặc nhãn hiện dạng key thô (`field_xxx`).
- [ ] 2. **Nhập nhanh**: chỉ điền section 1–3 rồi lưu ⇒ tạo được hồ sơ, **mã UV tự sinh theo PIC** (đúng tiền tố của TA đang đăng nhập).
- [ ] 3. Bỏ trống một trường bắt buộc rồi lưu ⇒ báo lỗi **đúng tên trường đó** và trường được tô hoặc cuộn tới.
- [ ] 4. Điền SubSource ⇒ Source tự điền. Điền ngày OB ⇒ OB month tự tính. Điền ngày Join/Leave ⇒ Tenor tự tính.
- [ ] 5. Gõ một SĐT đã có ở hồ sơ khác ⇒ có cảnh báo trùng ngay khi gõ, chưa cần bấm lưu.
- [ ] 6. Lưu trữ (archive) hồ sơ ⇒ hồ sơ biến mất khỏi danh sách thường. Khôi phục ⇒ hồ sơ hiện lại, dữ liệu còn nguyên.
- [ ] 7. **Xung đột**: mở cùng một hồ sơ ở tab 1 và tab 2. Tab 1 sửa và lưu. Tab 2 sửa trường khác và lưu ⇒ tab 2 hiện **hộp xung đột**, chọn được giữ bản nào, và không mất dữ liệu của tab 1.
- [ ] 8. TA-A mở URL hoặc mã của một hồ sơ thuộc TA-B ⇒ không xem được và không sửa được.

## F04 – Khóa theo vòng rớt

Dùng hồ sơ giả `TEST 04`.
- [ ] 1. Đặt R1 = **Failed** rồi lưu ⇒ section R2 và OB bị khóa (xám, không sửa được).
- [ ] 2. Đổi R1 = Passed. Đặt R2 = **Failed** ⇒ OB bị khóa. Lặp lại với R2 = **Canceled** ⇒ OB bị khóa.
- [ ] 3. R2 = Passed. Đặt OB = **Canceled** ⇒ phần sau OB bị khóa. Lặp lại với OB = **Noshow**.
- [ ] 4. Đăng nhập **Admin**, mở hồ sơ ở trạng thái bước 1 ⇒ Admin cũng **không** sửa được các trường bị khóa.

## F05 – Quy tắc trạng thái và lý do

- [ ] 1. Chọn một trạng thái cần lý do (ví dụ R1 Failed), để trống lý do, rồi lưu ⇒ chỉ hiện **cảnh báo**, hồ sơ **vẫn lưu được**.
- [ ] 2. Đổi trạng thái ⇒ danh sách lý do trong dropdown đổi theo trạng thái. Ghi lại 2–3 cặp trạng thái/lý do để so với hệ cũ.

## F06 – Kanban

- [ ] 1. Mở Kanban ⇒ có 5 cột theo thứ tự **Lead, R1, LU-SU, R2, OB**.
- [ ] 2. Một cột có trên 30 hồ sơ ⇒ ban đầu hiện 30 thẻ. Bấm **"Tải thêm"** ⇒ thêm thẻ, không lặp thẻ.
- [ ] 3. Kéo thẻ sang cột **phía sau** ⇒ hiện hộp xác nhận. Bấm Hủy ⇒ thẻ không đổi cột. Bấm OK ⇒ thẻ chuyển cột.
- [ ] 4. Kéo thẻ **lùi** về cột trước ⇒ bị chặn, có thông báo.
- [ ] 5. Vào **Nhật ký**, lọc theo mã hồ sơ vừa kéo ⇒ có dòng hành động `STAGE_MOVE`.
- [ ] 6. Lọc theo PIC, vị trí, khu vực ⇒ các thẻ lọc đúng.
- [ ] 7. TA-A ⇒ chỉ thấy thẻ có PIC A.
- [ ] 8. Thao tác kéo thả có cảm giác tức thì (dưới 1 giây).

## F07 – CV và giấy tờ

*Chờ PO chốt giới hạn upload trong app là 5 MB hay 10 MB. Ghi kết quả theo mức đang chạy.*
- [ ] 1. Upload `cv_4mb.pdf` trong app ⇒ thành công.
- [ ] 2. Upload `cv_6mb.pdf` trong app ⇒ ghi lại kết quả: (thành công / bị từ chối).
- [ ] 3. Upload `cv_11mb.pdf` trong app ⇒ bị từ chối, có thông báo nêu giới hạn.
- [ ] 4. Upload `fake.pdf` ⇒ **bị từ chối** (không bị lừa bởi đuôi file).
- [ ] 5. Upload đủ **5 loại giấy tờ** ⇒ mỗi loại nằm đúng mục.
- [ ] 6. Mở Google Drive ⇒ tên file đúng quy tắc đặt tên (mã UV, tên, loại giấy tờ).
- [ ] 7. Hồ sơ Rank < 5 ⇒ **không** upload được Salary Proposal. Rank ≥ 5 ⇒ upload được.
- [ ] 8. Payslips: upload 20 file ⇒ được. Upload file thứ 21 ⇒ bị chặn. Một file payslip > 10 MB ⇒ bị chặn.
- [ ] 9. Đổi mã hoặc tên ứng viên rồi lưu ⇒ trên Drive, tên các file của hồ sơ đổi theo.
- [ ] 10. Tải xuống một file ⇒ vào Nhật ký thấy có dòng ghi việc tải xuống.
- [ ] 11. Form công khai: gửi CV 4 MB ⇒ được. Gửi CV 6 MB ⇒ bị từ chối.

## F08 – Dịch và tạo CV

- [ ] 1. Nhập `experience_summary` tiếng Việt ⇒ nhập bản dịch EN và lưu ⇒ mở lại vẫn còn bản dịch.
- [ ] 2. Sửa bản tiếng Việt gốc ⇒ bản dịch EN hiện nhãn **"cũ / cần dịch lại"**.
- [ ] 3. Tạo CV theo mẫu **CV-EN-1** ⇒ xem trước đúng dữ liệu ⇒ in ra PDF (Ctrl+P → Save as PDF): bố cục không vỡ, không mất chữ.

## F09 – HR Info

- [ ] 1. Hồ sơ chưa đến R2 Passed ⇒ HR Info bị khóa hoặc không mở được.
- [ ] 2. Đặt R2 = Passed ⇒ mở được HR Info.
- [ ] 3. Lưu nháp (**draft**) ⇒ chuyển sang **submitted** ⇒ Admin chuyển sang **verified**. Mỗi bước trạng thái đổi đúng.
- [ ] 4. Nhập CCCD trùng với một hồ sơ thuộc TA-B ⇒ có báo trùng nhưng **không lộ** tên hoặc thông tin hồ sơ của TA-B.
- [ ] 5. Link Google Form công ty mở đúng. Tra phản hồi theo hồ sơ ⇒ ra đúng phản hồi.

## F10 – Công việc (Tasks)

- [ ] 1. TA-A tạo việc với đủ loại, ưu tiên, owner, hạn ⇒ việc hiện trong danh sách.
- [ ] 2. Sửa việc ⇒ thay đổi được lưu. Xóa việc ⇒ việc biến mất.
- [ ] 3. Admin tạo việc giao cho TA-B ⇒ TA-B thấy việc đó. TA-A **không** thấy.

## F11 – Lịch

- [ ] 1. Hồ sơ có ngày phỏng vấn ⇒ lịch PV hiện đúng ngày giờ.
- [ ] 2. Tạo sự kiện tự tạo ⇒ sự kiện hiện trên lịch.
- [ ] 3. Chuyển qua các chế độ xem **ngày / tuần / tháng / danh sách** ⇒ dữ liệu hiển thị nhất quán.

## F12 – Hiring checklist

- [ ] 1. Mở checklist ⇒ có **6 mục**: 3 mục tick tay, 3 mục tự tính (tự tick khi đủ điều kiện).
- [ ] 2. Đủ điều kiện ⇒ bấm **Xác nhận tuyển** ⇒ OB Status = **Accepted** và hồ sơ bị khóa.
- [ ] 3. TA ⇒ **không** mở lại được hồ sơ đã khóa.
- [ ] 4. Admin ⇒ mở lại được hồ sơ.

## F13 – Alerts (chuông)

Chuẩn bị 4 hồ sơ hoặc việc giả: 1 việc quá hạn, 1 việc sắp hạn, 1 hồ sơ R2 Passed chưa có HR Info, 1 offer thiếu giấy tờ.
- [ ] 1. Chuông hiện đủ 4 loại cảnh báo.
- [ ] 2. Số trên chuông = số dòng trong danh sách cảnh báo.
- [ ] 3. Xử lý một cảnh báo (bổ sung giấy tờ, đổi hạn) ⇒ số trên chuông giảm.

## F14 – Target

- [ ] 1. Admin tạo target theo ngày, tuần, tháng, năm và theo PIC, vị trí, phòng ban.
- [ ] 2. Cột **"Thực tế"** = số hồ sơ OB Joined theo ngày OB trong kỳ. Đếm tay vài hồ sơ để đối chiếu.
- [ ] 3. TA-A ⇒ chỉ thấy target của mình.
- [ ] 4. Admin bật **"xem tất cả"** cho TA-A ⇒ TA-A thấy target của mọi người. TA-B vẫn chỉ thấy target của mình.

## F15 – Báo cáo và Dashboard

- [ ] 1. Chọn cùng một khoảng ngày trên hệ mới và hệ cũ. So từng chỉ số: Leads, R1, LU, SU, R2, OB, NS, CC, ER, ATT, ER30, ER60. Ghi cả 2 số vào bảng:

  | Chỉ số | Hệ cũ | Hệ mới | Khớp? |
  |---|---|---|---|
  | Leads | | | |
  | R1 | | | |
  | LU | | | |
  | SU | | | |
  | R2 | | | |
  | OB | | | |
  | NS | | | |
  | CC | | | |
  | ER | | | |
  | ATT | | | |
  | ER30 | | | |
  | ER60 | | | |

- [ ] 2. Mở **Follow WD** ⇒ danh sách đúng.
- [ ] 3. Biểu đồ hiển thị và khớp số với bảng.
- [ ] 4. Export ⇒ mở được file, số trong file khớp với màn hình.
- [ ] 5. Dashboard tải xong trong khoảng 3 giây.

## F16 – Bình luận

- [ ] 1. TA-A thêm, sửa, xóa bình luận của chính mình ⇒ được.
- [ ] 2. Admin bình luận vào một hồ sơ mà TA-A xem được ⇒ TA-A **không** sửa và không xóa được bình luận đó.

## F17 – Import Excel (Admin)

- [ ] 1. Tải **file mẫu** ⇒ có đúng 76 cột.
- [ ] 2. Import file đã chuẩn bị (nhiều sheet) ⇒ thanh tiến trình chạy theo từng phần.
- [ ] 3. 2 dòng lỗi được báo **đúng số dòng** và có nút **tải file lỗi**.
- [ ] 4. Dòng trùng mã ⇒ **không ghi đè** hồ sơ đã có (mở hồ sơ đó kiểm tra dữ liệu cũ còn nguyên).
- [ ] 5. **Hoàn tác lô**: bấm chạy thử ⇒ xem danh sách sẽ xóa ⇒ xóa thật ⇒ hồ sơ của lô biến mất.
- [ ] 6. Import lại một lô, sửa 1 hồ sơ trong lô (hoặc thêm bình luận, file) rồi hoàn tác ⇒ hồ sơ đó **được giữ lại**.

## F18 – Quản trị (Admin)

**Tài khoản**
- [ ] 1. Tạo tài khoản mới ⇒ đăng nhập được.
- [ ] 2. Khóa tài khoản ⇒ không đăng nhập được. Mở khóa ⇒ đăng nhập lại được.
- [ ] 3. Đổi role, đổi PIC ⇒ quyền và dữ liệu thấy được thay đổi theo.
- [ ] 4. Reset mật khẩu ⇒ đăng nhập được bằng mật khẩu mới.
- [ ] 5. Admin tự khóa chính mình ⇒ bị chặn.

**Drop-list**
- [ ] 6. Thêm giá trị mới ⇒ giá trị hiện trong dropdown khi nhập hồ sơ.
- [ ] 7. Đổi tên một giá trị ⇒ các hồ sơ đang dùng giá trị đó đổi theo.
- [ ] 8. TA đề xuất giá trị mới ⇒ Admin duyệt ⇒ giá trị xuất hiện trong dropdown.
- [ ] 9. Phân cấp: chọn Region ⇒ Location chỉ hiện các giá trị thuộc Region đó. Tương tự Location → Site, SubSource → Source.

**Khác**
- [ ] 10. Views: tạo, sửa, xóa View dùng chung.
- [ ] 11. Nhật ký: lọc theo mã, theo người, theo hành động ⇒ kết quả đúng.
- [ ] 12. Lưu cấu hình ob-target và hr-form ⇒ F5 ⇒ cấu hình vẫn còn.
- [ ] 13. Dọn nhật ký 12 tháng ⇒ chỉ xóa bản ghi cũ hơn 12 tháng, có xác nhận trước khi xóa.

## F19 – Form ứng tuyển công khai

Mở bằng cửa sổ ẩn danh hoặc điện thoại (không đăng nhập).
- [ ] 1. Link riêng của TA-A ⇒ gửi hồ sơ kèm CV ⇒ hồ sơ vào inbox với PIC = A.
- [ ] 2. Link chung ⇒ gửi được hồ sơ.
- [ ] 3. Gửi lại **cùng SĐT trong vòng 10 phút** ⇒ hiện "đã nhận", inbox **không** có bản thứ 2.
- [ ] 4. Sửa link thành mã sai ⇒ trang hiện thông báo lỗi dễ hiểu, không trắng trang.
- [ ] 5. Honeypot: để lại cho mình chạy kiểm bằng script (người dùng thường không thấy trường này).
- [ ] 6. Trong inbox: **Tạo hồ sơ** từ một đơn ⇒ hồ sơ có đủ dữ liệu. **Bỏ qua** một đơn ⇒ đơn biến mất khỏi danh sách chờ.
- [ ] 7. Trang mở được trên tên miền công ty (nếu đã cấu hình).

## F20 – Ngôn ngữ (i18n)

- [ ] 1. Đổi sang **English** ⇒ đi qua **mọi menu** (Ứng viên, Công việc, Lịch, Target, Nhập Excel, Báo cáo, Follow WD, Drop-list, Nhật ký, Tài khoản), mở chi tiết hồ sơ và form công khai ⇒ không còn chữ Việt sót, không có key thô.
- [ ] 2. Gây một lỗi từ server (ví dụ lưu thiếu trường bắt buộc, upload file quá giới hạn) ⇒ thông báo lỗi hiện bằng tiếng Anh.
- [ ] 3. Đổi về tiếng Việt ⇒ mọi chữ trở lại tiếng Việt. F5 ⇒ app vẫn giữ ngôn ngữ đã chọn.

---

## Sau khi kiểm

1. Chép kết quả (✅ hoặc ❌, ngày, người ký, ghi chú) sang [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md) mục 1.
2. Gửi danh sách các mục ❌ kèm ghi chú để sửa. Sau khi sửa, kiểm lại riêng các mục đó.
3. Khi mọi dòng đều ✅, PO và đại diện TA ký ở mục 4 của ACCEPTANCE_CHECKLIST.

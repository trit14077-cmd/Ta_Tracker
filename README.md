# TA TRACKER — Hệ thống Quản lý & Theo dõi Tuyển dụng Nội bộ

Ứng dụng web đa người dùng phục vụ đội ngũ Tuyển dụng (TA / Intern / PIC) và Quản trị viên (Admin) nhập liệu, theo dõi ứng viên qua 61 trường thông tin (10 phân mục), kiểm soát xung đột chỉnh sửa đồng thời (Optimistic Locking), quản lý danh mục Dropdown động, nhập/xuất Excel và thống kê báo cáo phễu tuyển dụng.

---

## 1. Tính năng chính

- **Quản lý 61 trường dữ liệu ứng viên theo 10 nhóm**:
  1. Định danh (`candidate_code`, `full_name`, `phone`, `email`, CCCD...)
  2. Vị trí tuyển (`department`, `position`, `region` → `location` → `site`, `hire_type`...)
  3. Nguồn (`pic`, `sub_source` → tự động suy ra `source`...)
  4. Vòng 1 (`r1_date`, `r1_time`, `r1_stt`...)
  5. Vòng 2 (`r2_date`, `r2_time`, `r2_stt`...)
  6. Onboard (`ob_date` → tự động tính `ob_month`, `ob_status`, `ob_sub_status`...)
  7. Lương & phụ cấp (`gross_salary`, `probation_pct`, các khoản phụ cấp VND...)
  8. Thử việc & hợp đồng (`probation_period`, `contract_type`, `contract_sign_date`...)
  9. Hồ sơ & thủ tục (`doc_status`, `health_check_status`, `bank_name`...)
  10. Tình trạng làm việc & nghỉ việc (`emp_status`, `attrition_date` → tự động tính `tenor`...)
- **Phân quyền rõ ràng**:
  - Mọi `pic` và `admin` đều có quyền **xem** toàn bộ danh sách ứng viên.
  - Tài khoản `pic` chỉ được chỉnh sửa / lưu trữ (archive) ứng viên có trường `pic` trùng với mã PIC của mình.
  - Tài khoản `admin` có toàn quyền chỉnh sửa ứng viên, nhập file Excel/CSV, quản trị Drop-list và quản lý tài khoản người dùng.
- **Kiểm soát đồng thời (Optimistic Locking)**:
  - Mỗi hồ sơ có `row_version`. Khi cập nhật (`PATCH`), nếu người khác đã lưu phiên bản mới hơn, máy chủ trả về `409 ROW_CONFLICT` kèm dữ liệu hiện tại để người dùng đối chiếu và quyết định.
- **Chuẩn hóa & Xác thực dữ liệu chặt chẽ (Client & Server)**:
  - Số điện thoại chuẩn hóa về 9 chữ số không có số `0` ở đầu (ví dụ `0854 498 989` hoặc `+84854498989` → `854498989`), cảnh báo nếu trùng SĐT với ứng viên khác nhưng không chặn lưu.
  - Ngày tháng nhập theo định dạng `DD/MM/YYYY`, lưu trữ chuẩn `YYYY-MM-DD`.
  - Giờ phỏng vấn chọn từ `09:00` đến `16:30` (bước 30 phút).
  - Các trường tự động (`created_at`, `source`, `ob_month`, `tenor`) chỉ được tính toán tại máy chủ.
- **Nhập / Xuất Excel (.xlsx, .csv)**:
  - Tự động nhận diện cột, hỗ trợ file cũ gộp `OB_Sub_STT` (tự động tách giá trị `Tuyển mới / Tuyển thay thế / Tái tuyển dụng` sang `hire_type`) và chuyển đổi giờ dạng số thập phân Excel (`0.375` → `09:00`).
  - Xuất Excel đủ 61 cột theo đúng thứ tự danh mục và chống tấn công Formula Injection (tự động thêm dấu nháy đơn trước `=`, `+`, `-`, `@`).

---

## 2. Yêu cầu hệ thống & Cài đặt (Windows LAN)

1. Cài đặt **Node.js** (phiên bản LTS 20.x hoặc 22.x).
2. Giải nén mã nguồn vào máy chủ nội bộ Windows.
3. Nhấp đúp vào file **`start.bat`** (hoặc chạy trong Command Prompt):
   - Tự động chạy `npm install` nếu chưa có `node_modules`.
   - Tự động tạo thư mục `data/` và cơ sở dữ liệu SQLite `data/app.sqlite` ở chế độ WAL.
   - Tự động khởi tạo danh mục Dropdown từ dữ liệu gốc (Seed JSON) và tạo tài khoản Admin đầu tiên.
   - Hiển thị địa chỉ IP mạng nội bộ (LAN) để các máy trạm Chrome/Edge trong công ty truy cập.

---

## 3. Khởi tạo tài khoản Quản trị viên lần chạy đầu tiên

- Tài khoản Admin đầu tiên được tạo tự động dựa trên hai biến môi trường `INITIAL_ADMIN_USERNAME` và `INITIAL_ADMIN_PASSWORD` (tối thiểu 8 ký tự) trong file `.env`.
- Ngay ở lần đăng nhập đầu tiên, hệ thống bắt buộc đổi sang mật khẩu mới (tối thiểu 8 ký tự) để bảo mật.

---

## 4. Bảo mật & Vận hành

- Không mở cổng máy chủ ra Internet công cộng; chỉ sử dụng trong mạng LAN nội bộ.
- Mật khẩu được băm bằng `bcryptjs`. Phiên đăng nhập lưu trong cookie `HttpOnly`, `SameSite=Lax`.
- Nhật ký hệ thống (Audit Log) chỉ ghi thêm (append-only) và không ghi thông tin nhạy cảm (SĐT, email, mức lương) ra console log của máy chủ.

// Danh mục vị trí chuẩn theo file "Danh_sach_vi_tri ANH VIET 18.11" (PO duyệt 20/11/2026 – bảng De_xuat_chuan_hoa_vi_tri).
// POSITION_RENAMES: tên cũ (tên tiếng Anh / khác hoa-thường) -> tên chuẩn tiếng Việt; Nhập Excel và ETL tự đổi theo.
// POSITION_EN: tên tiếng Anh của từng vị trí (giao diện English, CV tiếng Anh). Sinh từ file, không sửa tay.
// Chưa đổi: 36 vị trí "chưa khớp" và 4 biến thể có nhóm con (Kho Pick/Pack, Lái xe nâng Forklift/Reachtruck) – chờ PO.

export const POSITION_RENAMES: Record<string, string> = {
  "HRIS & HRSS Executive": "Chuyên viên Tiền lương & Phúc lợi",
  "Workforce Business Intelligence Supervisor": "Giám Sát Phân tích Dữ liệu Nhân sự",
  "Data Platform Administrator": "Giám sát Quản trị Cơ sở Dữ liệu",
  "Legal Manager": "Trưởng phòng Pháp chế",
  "Operational Excellence Manager": "Trưởng phòng Tối ưu Vận hành",
  "Payment Control Executive": "Chuyên Viên Kiểm soát thanh quyết toán",
  "Talent Acquisition Executive": "Chuyên viên Tuyển dụng",
  "Workforce Management Supervisor": "Giám Sát Hoạch định Nguồn lực Thuê Ngoài",
  "Planning Supervisor": "Giám sát kế hoạch kho vận",
  "HSE Supervisor": "Giám Sát An Toàn Sức Khỏe Và Môi Trường",
  "Inventory Supervisor": "Giám sát kho vận",
  "Accounting Executive": "Chuyên viên Kế toán",
  "Finance Manager": "Trưởng phòng Tài chính",
  "Legal Executive": "Chuyên viên Pháp chế",
  "Transport Performance Analyst": "Chuyên viên Phân tích Hiệu suất Vận tải",
  "MPO Intern": "Thực tập sinh mua hàng",
  "FMCG Intern": "Thực tập sinh vận hành",
  "Senior Product Manager": "Trưởng phòng Phát triển Sản phẩm",
  "Security Executive": "Chuyên viên An Ninh",
  "WFM Contractor": "Cộng tác viên nhân sự",
  "Trưởng Kho": "Trưởng kho",
  "Giám sát kho": "Giám Sát kho",
  "Chuyên viên Tối ưu Vận hành": "Chuyên Viên Tối Ưu Vận Hành",
  "Phó phòng Phân tích Hiệu suất Kho vận": "Phó Phòng Phân tích Hiệu suất Kho vận",
  "Nhân Viên Kiểm Soát Số Liệu Kho Vận": "Nhân viên Kiểm soát Số liệu Kho vận",
};

/** Vị trí có trong file nhưng chưa có trong danh mục – thêm mới (0027). */
export const NEW_POSITIONS: string[] = [
  "Chuyên viên Điều phối Kho vận",
  "Chuyên viên Điều phối Giao vận",
  "Chuyên viên Kiểm Soát Dữ Liệu Kho Vận Cấp Cao",
  "Giám Sát Phát Triển Sản Phẩm",
  "Trưởng phòng An toàn Sức khỏe và Môi trường",
  "Giám sát mua hàng",
  "Chuyên Viên mua hàng",
  "Chuyên viên hành chính",
  "Giám sát Tiền lương & Phúc lợi",
  "Phó phòng Tiền lương & Phúc lợi",
  "Chuyên Viên Đối tác Nhân sự",
  "Chuyên Viên Đào tạo",
  "Chuyên viên Truyền thông Nội bộ",
  "Trưởng Phòng Đào tạo và Phát triển Tổ chức",
  "Trưởng phòng Kế Hoạch Kho Vận",
];

export const POSITION_EN: Record<string, string> = {
  "Trưởng phòng Quản lý Kho vận": "Warehouse Logistics Manager",
  "Trưởng kho": "Warehouse Manager",
  "Giám sát kho vận": "Inventory Supervisor",
  "Giám sát kế hoạch kho vận": "Planning Supervisor",
  "Trưởng nhóm Điều phối Kho vận": "Warehouse Logistics Team Leader",
  "Trưởng nhóm Điều phối Giao vận": "Transport Team Leader",
  "Chuyên viên Điều phối Kho vận": "Warehouse Logistics Executive",
  "Chuyên viên Điều phối Giao vận": "Transport Executive",
  "Chuyên viên An Ninh": "Security Executive",
  "Chuyên viên hỗ trợ vận hành": "IT Support Executive",
  "Nhân viên Lái xe nâng": "Forklift Driver Staff / Reachtruck Driver Staff",
  "Nhân viên Kho": "Warehouse Staff",
  "Nhân viên Kiểm soát Số liệu Kho vận": "Logistics Data Control Staff",
  "Chuyên viên Quản lý Kho": "Warehouse Management Executive",
  "Thủ Kho": "Warehouse Keeper",
  "Nhân viên Vận hành Kho": "Warehouse Operations Staff",
  "Phó Trưởng Bộ Phận Kho Vận": "Deputy Warehouse & Logistics Manager",
  "Chuyên viên Kiểm Soát Dữ Liệu Kho Vận Cấp Cao": "Senior Logistics Data Control Executive",
  "Chuyên viên Kiểm soát Số liệu Kho vận": "Logistics Data Control Executive",
  "Giám Sát An Toàn, Sức Khỏe Và Môi Trường": "SHE Supervisor",
  "Trưởng Bộ Phận Quản Lý Kho Vận Cấp Cao": "Senior Warehouse & Logistics Manager",
  "Phó Trưởng BP Kiểm Soát Số Liệu Kho Vận": "Deputy Logistics Data Control Manager",
  "Giám Sát kho": "Warehouse Supervisor",
  "Giám Sát Kiểm soát Dữ liệu Kho vận": "Warehouse Supervisor",
  "CV An Toàn, Sức Khỏe, Môi Trường": "SHE Specialist",
  "Trưởng Bộ Phận Trung Tâm Phân Phối": "Distribution Center Manager",
  "CV An Toàn, Sức Khỏe, Môi Trường Cấp Cao": "Senior SHE Specialist",
  "Chuyên viên Quản lý Kho Cấp cao": "Senior Warehouse Management Executive",
  "Phó Trưởng Bộ Phận Kho": "Deputy Warehouse Manager",
  "Nhân viên Lái xe": "Driver Staff",
  "Nhân viên Quản lý Kho": "Warehouse Management Staff",
  "Công nhân Kho": "Warehouse Worker",
  "Chuyên Viên Tối Ưu Vận Hành": "Operational Excellence Analyst / Operational Excellence Specialist",
  "Trưởng phòng Tối ưu Vận hành": "Operational Excellence Manager",
  "Trưởng phòng Phát triển Sản phẩm": "Senior Product Manager",
  "Giám Sát Phát Triển Sản Phẩm": "Product Operations Supervisor",
  "Phó Phòng Phân tích Hiệu suất Kho vận": "Deputy Manager Logistics Performance Analytics",
  "Trưởng phòng An toàn Sức khỏe và Môi trường": "SHE Manager",
  "Giám sát mua hàng": "Category Procurement Supervisor",
  "Chuyên Viên mua hàng": "Procurement Executive",
  "Thực tập sinh mua hàng": "MPO Intern",
  "Chuyên viên hành chính": "Administration Executive",
  "Giám Sát Hoạch định Nguồn lực Thuê Ngoài": "Workforce Management Supervisor",
  "Giám Sát Phân tích Dữ liệu Nhân sự": "Workforce Business Intelligence Supervisor",
  "Chuyên viên Tiền lương & Phúc lợi": "HRIS & HRSS Executive",
  "Giám sát Tiền lương & Phúc lợi": "Compensation & Benefits Supervisor",
  "Phó phòng Tiền lương & Phúc lợi": "Compensation & Benefits Manager",
  "Chuyên Viên Đối tác Nhân sự": "HR Business Partner",
  "Chuyên viên Tuyển dụng": "Talent Acquisition Executive",
  "Chuyên Viên Đào tạo": "Operations Training Executive",
  "Chuyên viên Truyền thông Nội bộ": "Employee Engagement Executive",
  "Trưởng Phòng Đào tạo và Phát triển Tổ chức": "LnD & EE Manager",
  "Giám sát Tài chính": "Finance Supervisor",
  "Chuyên Viên Kiểm soát thanh quyết toán": "Payment Control Executive",
  "Trưởng phòng Tài chính": "Finance Manager",
  "Chuyên viên Phân tích Hiệu suất Vận tải": "Transport Performance Analyst",
  "Chuyên Viên Điều Phối Giao Vận": "Transport Planner Executive",
  "Trưởng phòng Pháp chế": "Legal Manager",
  "Chuyên viên Pháp chế": "Legal Executive",
  "Giám Sát An Toàn Sức Khỏe Và Môi Trường": "HSE Supervisor",
  "Thực tập sinh vận hành": "FMCG Intern",
  "Business Intelligence & Performance Manager": "Business Intelligence & Performance Manager",
  "Trưởng phòng Kế Hoạch Kho Vận": "DRP, Logistics & Transportation Planning Manager",
  "Giám Sát Phân tích Hiệu suất Kho vận": "Warehouse Logistics Performance Analysis Supervisor",
  "Chuyên viên Kế toán": "Accounting Executive",
  "Cộng tác viên nhân sự": "WFM Contractor",
  "Giám sát Quản trị Cơ sở Dữ liệu": "Data Platform Administrator",
};

/** Tên chuẩn của 1 vị trí (tên cũ => tên mới; còn lại giữ nguyên). */
export function normalizePosition(v: string): string {
  const s = String(v ?? '').normalize('NFC').trim();
  return POSITION_RENAMES[s] ?? s;
}

/** Tên tiếng Anh (không có thì trả lại tên gốc). */
export function positionEn(v: string): string {
  const s = normalizePosition(v);
  return POSITION_EN[s] ?? s;
}

/**
 * Initial Dropdown Seed Data, Sub_Source -> Source Mapping, and
 * Region -> Location -> Site Dependent Hierarchy (DRAFT mapping).
 *
 * NOTE / TODO: This seed file bootstraps the SQLite database on first run.
 * Administrators can add, rename, or deactivate options, and edit the
 * Sub_Source -> Source mapping and Region -> Location -> Site hierarchy
 * directly in the "Drop-list" Admin UI without modifying code.
 */

export const INTERVIEW_TIME_SLOTS: string[] = [
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
];

export interface DropdownListMeta {
  listKey: string;
  label: string;
  options: string[];
}

export const INITIAL_DROPDOWN_LISTS: DropdownListMeta[] = [
  {
    listKey: 'gender',
    label: 'Giới tính (Gender)',
    options: ['Nam', 'Nữ', 'Khác'],
  },
  {
    listKey: 'department',
    label: 'Khối / Phòng ban (Department)',
    options: [
      'Vận hành (Operations)',
      'Kinh doanh (Sales)',
      'Chăm sóc khách hàng (CS)',
      'Kho vận & Giao nhận (Logistics)',
      'Công nghệ thông tin (IT)',
      'Nhân sự & Hành chính (HR & Admin)',
      'Tài chính - Kế toán (Finance)',
      'Marketing',
    ],
  },
  {
    listKey: 'position',
    label: 'Vị trí ứng tuyển (Position)',
    options: [
      'Nhân viên Tư vấn Tuyển sinh / Kinh doanh',
      'Chuyên viên Chăm sóc Khách hàng',
      'Nhân viên Vận hành Cửa hàng',
      'Nhân viên Kho / Điều phối',
      'Trưởng nhóm Kinh doanh (Sales Team Lead)',
      'Quản lý Cửa hàng (Store Manager)',
      'Chuyên viên Tuyển dụng (TA Executive)',
      'Thực tập sinh Tuyển dụng (TA Intern)',
      'Kế toán Tổng hợp',
      'Kỹ sư Phần mềm (Software Engineer)',
    ],
  },
  {
    listKey: 'job_level',
    label: 'Cấp bậc (Job Level)',
    options: [
      'Thực tập sinh (Intern)',
      'Nhân viên mới (Fresher)',
      'Nhân viên (Staff / Executive)',
      'Chuyên viên cao cấp (Senior)',
      'Trưởng nhóm (Team Leader)',
      'Quản lý (Manager)',
    ],
  },
  {
    listKey: 'region',
    label: 'Vùng / Miền (Region)',
    options: ['Miền Bắc', 'Miền Trung', 'Miền Nam'],
  },
  {
    listKey: 'location',
    label: 'Tỉnh / Thành (Location)',
    options: [
      'Hà Nội',
      'Hải Phòng',
      'Bắc Ninh',
      'Đà Nẵng',
      'Nghệ An',
      'Khánh Hòa',
      'TP. Hồ Chí Minh',
      'Bình Dương',
      'Đồng Nai',
      'Cần Thơ',
    ],
  },
  {
    listKey: 'site',
    label: 'Điểm làm việc (Site)',
    options: [
      'HN - Văn phòng Cầu Giấy',
      'HN - Cơ sở Đống Đa',
      'HN - Kho Long Biên',
      'HP - Chi nhánh Ngô Quyền',
      'BN - KCN Tiên Sơn',
      'ĐN - Văn phòng Hải Châu',
      'NA - Chi nhánh TP. Vinh',
      'KH - Chi nhánh Nha Trang',
      'HCM - Văn phòng Quận 1',
      'HCM - Cơ sở Tân Bình',
      'HCM - Kho Thủ Đức',
      'BD - Chi nhánh Thuận An',
      'ĐNa - Chi nhánh Biên Hòa',
      'CT - Chi nhánh Ninh Kiều',
    ],
  },
  {
    listKey: 'hire_type',
    label: 'Phân loại tuyển (Hire_Type)',
    options: ['Tuyển mới', 'Tuyển thay thế', 'Tái tuyển dụng'],
  },
  {
    listKey: 'pic',
    label: 'PIC phụ trách (30 TA / Intern)',
    options: [
      'PIC01 - Nguyễn Minh Anh',
      'PIC02 - Trần Hoàng Nam',
      'PIC03 - Lê Thu Hà',
      'PIC04 - Phạm Quốc Bảo',
      'PIC05 - Hoàng Thanh Thảo',
      'PIC06 - Vũ Đức Duy',
      'PIC07 - Đặng Ngọc Linh',
      'PIC08 - Bùi Tuấn Kiệt',
      'PIC09 - Đỗ Khánh Ly',
      'PIC10 - Ngô Gia Huy',
      'PIC11 - Dương Phương Trang',
      'PIC12 - Lý Minh Khôi',
      'PIC13 - Mai Thanh Trúc',
      'PIC14 - Trương Quốc Khánh',
      'PIC15 - Đinh Hồng Nhung',
      'PIC16 - Phan Nhật Minh',
      'PIC17 - Võ Bích Ngọc',
      'PIC18 - Hồ Anh Tuấn',
      'PIC19 - Cao Thiên Ân',
      'PIC20 - Lâm Thảo Vy',
      'PIC21 - Trịnh Hải Đăng',
      'PIC22 - Đoàn Kim Ngân',
      'PIC23 - Hà Trọng Nghĩa',
      'PIC24 - Lương Yến Nhi',
      'PIC25 - Nghiêm Quang Vinh',
      'PIC26 - Tạ Mai Phương',
      'PIC27 - Chu Tuấn Anh',
      'PIC28 - La Bảo Châu',
      'PIC29 - Kiều Minh Quân',
      'PIC30 - Từ Ngọc Hân',
    ],
  },
  {
    listKey: 'sub_source',
    label: 'Nguồn chi tiết (Sub_Source)',
    options: [
      'Facebook Fanpage TA',
      'Facebook Group Việc làm',
      'Facebook Ads Lead',
      'Zalo OA Tuyển dụng',
      'TikTok Tuyển dụng',
      'VietnamWorks',
      'TopCV',
      'Vieclam24h',
      'CareerViet',
      'ITviec',
      'LinkedIn Recruiter',
      'Giới thiệu nội bộ (Referral)',
      'Ứng viên cũ quay lại (Re-hire)',
      'Ngày hội việc làm (Job Fair)',
      'Trường Đại học / Cao đẳng',
      'Headhunt / Agency',
      'Website Tuyển dụng Công ty',
      'Walk-in / Nộp trực tiếp',
    ],
  },
  {
    listKey: 'interviewer',
    label: 'Người phỏng vấn (Interviewer)',
    options: [
      'Nguyễn Minh Anh (TA)',
      'Trần Hoàng Nam (TA)',
      'Lê Thu Hà (TA Lead)',
      'Phạm Quốc Bảo (HRBP)',
      'Trần Quốc Tuấn (Ops Manager)',
      'Lê Hoàng Việt (Sales Director)',
      'Nguyễn Thị Mai (CS Manager)',
      'Vũ Đình Trọng (Logistics Manager)',
      'Đặng Quang Huy (IT Lead)',
      'Hoàng Bích Phương (Finance Manager)',
    ],
  },
  {
    listKey: 'interview_mode',
    label: 'Hình thức phỏng vấn (Interview Mode)',
    options: ['Trực tiếp (Offline)', 'Trực tuyến (Online / Video)', 'Điện thoại (Phone)'],
  },
  {
    listKey: 'r1_stt',
    label: 'Kết quả Vòng 1 (R1_STT)',
    options: ['Pending', 'Passed', 'Failed', 'No Show', 'Cancelled', 'Rescheduled'],
  },
  {
    listKey: 'r2_stt',
    label: 'Kết quả Vòng 2 (R2_STT)',
    options: ['Pending', 'Passed', 'Failed', 'No Show', 'Cancelled', 'Not Required'],
  },
  {
    listKey: 'offer_status',
    label: 'Trạng thái Offer (Offer_STT)',
    options: ['Pending', 'Sent', 'Accepted', 'Declined', 'Withdrawn'],
  },
  {
    listKey: 'ob_status',
    label: 'Trạng thái Onboard (OB Status)',
    options: ['Pending', 'Accepted', 'Joined', 'No Show', 'Declined', 'Postponed'],
  },
  {
    listKey: 'ob_sub_status',
    label: 'Chi tiết OB (OB_Sub_STT)',
    options: [
      'Đúng hạn',
      'Dời ngày OB (Ứng viên xin dời)',
      'Dời ngày OB (Bộ phận yêu cầu)',
      'Từ chối do mức lương',
      'Từ chối do địa điểm xa',
      'Từ chối do nhận Offer khác',
      'Không liên lạc được ngày OB',
      'Không đạt khám sức khỏe',
    ],
  },
  {
    listKey: 'contract_type',
    label: 'Loại hợp đồng (Contract Type)',
    options: [
      'Hợp đồng thử việc (2 tháng)',
      'Hợp đồng thử việc (1 tháng)',
      'Hợp đồng đào tạo nghề',
      'HĐLĐ xác định thời hạn 12 tháng',
      'HĐLĐ xác định thời hạn 36 tháng',
      'HĐLĐ không xác định thời hạn',
      'Hợp đồng cộng tác viên / Thời vụ',
    ],
  },
  {
    listKey: 'doc_status',
    label: 'Tình trạng hồ sơ (Doc_STT)',
    options: ['Đầy đủ', 'Thiếu hồ sơ (Đang bổ sung)', 'Chưa nộp', 'Đã hậu kiểm hợp lệ'],
  },
  {
    listKey: 'health_check_status',
    label: 'Khám sức khỏe (Health Check)',
    options: ['Đạt (Fit to work)', 'Chờ kết quả', 'Chưa khám', 'Không đạt'],
  },
  {
    listKey: 'bank_name',
    label: 'Ngân hàng (Bank Name)',
    options: [
      'Vietcombank',
      'Techcombank',
      'MB Bank',
      'BIDV',
      'VietinBank',
      'ACB',
      'VPBank',
      'TPBank',
      'Sacombank',
      'Agribank',
    ],
  },
  {
    listKey: 'emp_status',
    label: 'Tình trạng làm việc (Emp_STT)',
    options: ['Working', 'Probation', 'Resigned', 'Terminated', 'Pending OB'],
  },
  {
    listKey: 'attrition_reason',
    label: 'Lý do nghỉ việc (Attrition Reason)',
    options: [
      'Không phù hợp công việc / Áp lực',
      'Thu nhập / Chế độ đãi ngộ',
      'Chuyển nơi ở / Gia đình',
      'Sức khỏe cá nhân',
      'Có định hướng công việc mới',
      'Môi trường / Đồng nghiệp / Quản lý',
      'Không đạt thử việc (Chấm dứt HĐ)',
      'Vi phạm kỷ luật',
    ],
  },
  {
    listKey: 'interview_time',
    label: 'Khung giờ phỏng vấn (09:00 - 16:30)',
    options: INTERVIEW_TIME_SLOTS,
  },
];

/**
 * Mapping from Sub_Source -> Source.
 * Read-only `source` field on candidate records is automatically resolved
 * on the server using this mapping table.
 */
export const INITIAL_SUB_SOURCE_MAPPING: Record<string, string> = {
  'Facebook Fanpage TA': 'Social Media',
  'Facebook Group Việc làm': 'Social Media',
  'Facebook Ads Lead': 'Social Media',
  'Zalo OA Tuyển dụng': 'Social Media',
  'TikTok Tuyển dụng': 'Social Media',
  VietnamWorks: 'Job Board',
  TopCV: 'Job Board',
  Vieclam24h: 'Job Board',
  CareerViet: 'Job Board',
  ITviec: 'Job Board',
  'LinkedIn Recruiter': 'Direct Sourcing',
  'Giới thiệu nội bộ (Referral)': 'Internal Referral',
  'Ứng viên cũ quay lại (Re-hire)': 'Internal Pool',
  'Ngày hội việc làm (Job Fair)': 'Campus & Event',
  'Trường Đại học / Cao đẳng': 'Campus & Event',
  'Headhunt / Agency': 'Agency',
  'Website Tuyển dụng Công ty': 'Career Site',
  'Walk-in / Nộp trực tiếp': 'Direct Walk-in',
};

/**
 * DRAFT Dependent Hierarchy:
 * - Region -> Location[]
 * - Location -> Site[]
 * Editable by Admins in the Drop-list Admin view.
 */
export const INITIAL_REGION_TO_LOCATIONS: Record<string, string[]> = {
  'Miền Bắc': ['Hà Nội', 'Hải Phòng', 'Bắc Ninh'],
  'Miền Trung': ['Đà Nẵng', 'Nghệ An', 'Khánh Hòa'],
  'Miền Nam': ['TP. Hồ Chí Minh', 'Bình Dương', 'Đồng Nai', 'Cần Thơ'],
};

export const INITIAL_LOCATION_TO_SITES: Record<string, string[]> = {
  'Hà Nội': ['HN - Văn phòng Cầu Giấy', 'HN - Cơ sở Đống Đa', 'HN - Kho Long Biên'],
  'Hải Phòng': ['HP - Chi nhánh Ngô Quyền'],
  'Bắc Ninh': ['BN - KCN Tiên Sơn'],
  'Đà Nẵng': ['ĐN - Văn phòng Hải Châu'],
  'Nghệ An': ['NA - Chi nhánh TP. Vinh'],
  'Khánh Hòa': ['KH - Chi nhánh Nha Trang'],
  'TP. Hồ Chí Minh': ['HCM - Văn phòng Quận 1', 'HCM - Cơ sở Tân Bình', 'HCM - Kho Thủ Đức'],
  'Bình Dương': ['BD - Chi nhánh Thuận An'],
  'Đồng Nai': ['ĐNa - Chi nhánh Biên Hòa'],
  'Cần Thơ': ['CT - Chi nhánh Ninh Kiều'],
};

export const LEGACY_HIRE_TYPE_VALUES = new Set([
  'Tuyển mới',
  'Tuyển thay thế',
  'Tái tuyển dụng',
]);

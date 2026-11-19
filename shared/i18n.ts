/**
 * Vietnamese / English for the interface. Vietnamese is the source language (every screen is written in it), so the
 * English side is a dictionary keyed by the exact Vietnamese text, plus a few patterns for sentences with numbers
 * and names in them. `translateText` is pure, so the web app and the demo share it.
 *
 * What is translated: menus, titles, buttons, labels, statuses, hints and the main validation messages.
 * What is NOT translated: stored data (names, positions, Drop-list values, reasons, comments) and messages that
 * the dictionary does not know yet, which simply stay in Vietnamese.
 */
import { FIELD_CATALOG, SECTIONS } from './fieldCatalog.ts';
import { STAGE_LABELS, STAGES } from './stage.ts';
import { EXTRA } from './i18nExtra.ts';

export type Lang = 'vi' | 'en';

/** English field names for the labels that are written in Vietnamese (the others are already English terms). */
const FIELD_EN: Record<string, string> = {
  candidate_code: 'Candidate Code',
  created_at: 'Created (Timestamp)',
  full_name: 'Full Name',
  phone: 'Phone Number',
  position: 'Position',
  region: 'Region',
  location: 'Location',
  unit: 'Unit',
  dept: 'Department',
  site: 'Site (Warehouse)',
  source: 'Source',
  sub_source: 'Sub Source',
  ob_date: 'Onboard Date (OBD)',
  hire_type: 'Hire Type',
  gender: 'Gender',
  birth: 'Date / Year of Birth',
  address: 'Address (optional)',
  cv_link: 'CV Link (LinkedIn, Drive...)',
  cv_file: 'Uploaded CV File',
  forklift_cert: 'Forklift Certificate',
  contract_sign_status: 'Probation Contract Signing Status',
  salary_pay_status: 'Salary Payment Status',
  wd_process: 'Process (WD)',
  wd_step: 'Step (WD)',
  pending_at: 'Pending With (Who?)',
  wd_deadline: 'Deadline (WD)',
  wd_note: 'Note (WD)',
  education_level: 'Education Level',
  experience_years: 'Years of Experience',
  experience_summary: 'Experience Summary',
  r2_interviewer: 'R2 Interviewer',
  current_salary: 'Current Salary',
  salary_expectation: 'Salary Expectation',
};

const SECTION_EN: Record<number, [string, string]> = {
  1: ['1. Identity', '1 Identity'],
  2: ['2. Position', '2 Position'],
  3: ['3. Source', '3 Source'],
  4: ['4. Round 1', '4 Round 1'],
  5: ['5. Round 2', '5 Round 2'],
  6: ['6. Onboard', '6 Onboard'],
  7: ['7. Salary & allowances', '7 Salary & allowances'],
  8: ['8. Probation & contract', '8 Probation & contract'],
  9: ['9. Documents & procedures', '9 Documents'],
  10: ['10. Employment status & attrition', '10 Employment & Attrition'],
  11: ['11. Follow WD', '11 Follow WD'],
};

const EXACT: Record<string, string> = {
  ...EXTRA,
  // ---- navigation and page titles
  'Ứng viên': 'Candidates',
  'Nhập mới': 'New Candidate',
  'Nhập Excel': 'Import Excel',
  'Báo cáo': 'Reports',
  'Nhật ký': 'Audit Log',
  'Tài khoản': 'Accounts',
  'Quản lý tuyển dụng': 'Recruitment management',
  'Mở rộng thanh menu': 'Expand menu',
  'Thu gọn thanh menu': 'Collapse menu',
  'Kéo để đổi độ rộng, nhấp đúp để thu gọn hoặc mở rộng': 'Drag to resize, double-click to collapse or expand',
  'Danh sách Ứng viên': 'Candidate List',
  'Cập nhật Hồ sơ Ứng viên': 'Update Candidate Profile',
  'Nhập Hồ sơ Ứng viên Mới': 'Enter New Candidate',
  'Nhập dữ liệu Excel / CSV': 'Import Excel / CSV data',
  'Báo cáo tuyển dụng theo TA': 'Recruitment report by TA',
  'Follow WD: theo dõi nhân sự đã Joined': 'Follow WD: track people who have Joined',
  'Quản trị Danh mục Drop-list': 'Drop-list Administration',
  'Nhật ký Thay đổi (Audit Log)': 'Change Log (Audit Log)',
  'Quản lý View (bộ lọc và cột lưu sẵn)': 'View management (saved filters and columns)',
  'Quản trị Tài khoản Người dùng': 'User Account Administration',
  'Đề xuất thêm Drop-list': 'Suggest a Drop-list value',
  // ---- login and account
  'Đăng nhập thất bại.': 'Sign-in failed.',
  'Nhập tên đăng nhập...': 'Enter username...',
  'Nhập mật khẩu...': 'Enter password...',
  'Tên đăng nhập': 'Username',
  'Mật khẩu': 'Password',
  'Đang xác thực...': 'Signing in...',
  'Đăng nhập hệ thống': 'Sign in',
  'Yêu cầu đổi mật khẩu lần đầu': 'Password change required on first sign-in',
  'Đang cập nhật...': 'Updating...',
  'Lưu mật khẩu mới': 'Save new password',
  'Mật khẩu mới phải có ít nhất 8 ký tự.': 'The new password must have at least 8 characters.',
  'Mật khẩu xác nhận không khớp.': 'The confirmation password does not match.',
  'Không thể đổi mật khẩu.': 'Could not change the password.',
  'Đổi mật khẩu': 'Change password',
  'Đổi MK': 'Password',
  'Đăng xuất': 'Sign out',
  'Đổi mật khẩu cá nhân': 'Change your password',
  'Đang lưu...': 'Saving...',
  'Cập nhật mật khẩu': 'Update password',
  'Tìm nhanh mã ứng viên, họ tên hoặc SĐT...': 'Quick search by code, name or phone...',
  'Ngôn ngữ': 'Language',
  'Hệ thống Quản lý & Theo dõi Ứng viên Tuyển dụng Nội bộ (LAN)': 'Internal recruitment candidate management & tracking system (LAN)',
  'Đang khởi tạo phiên làm việc THE SUPRA - RECRUITMENT...': 'Starting your THE SUPRA - RECRUITMENT session...',
  // ---- candidate list
  'Có thay đổi chưa lưu. Đóng cửa sổ và bỏ các thay đổi?': 'There are unsaved changes. Close and discard them?',
  'Không thể tải danh sách ứng viên.': 'Could not load the candidate list.',
  'Lỗi lưu dữ liệu.': 'Could not save the data.',
  'Không thể lưu trữ hồ sơ.': 'Could not archive the profile.',
  'Không thể xuất file Excel.': 'Could not export the Excel file.',
  '(đã tắt)': '(turned off)',
  'Admin: đang xem toàn bộ dữ liệu': 'Admin: viewing all data',
  'Tìm theo Mã UV, Họ tên hoặc SĐT...': 'Search by code, name or phone...',
  'Bộ lọc nâng cao': 'Advanced filters',
  'Đang xuất...': 'Exporting...',
  'Xuất Excel (76 cột)': 'Export Excel (all columns)',
  'Nhập ứng viên mới': 'New candidate',
  'Tất cả PIC': 'All PIC',
  'Tất cả vị trí': 'All positions',
  'Tất cả Site': 'All Sites',
  'Tất cả Nguồn': 'All Sources',
  'Tất cả R1_STT': 'All R1_STT',
  'Tất cả R2_STT': 'All R2_STT',
  'Tất cả OB Status': 'All OB Status',
  'Tất cả Emp_STT': 'All Emp_STT',
  'Tất cả Tenor': 'All Tenor',
  'Xóa toàn bộ bộ lọc': 'Clear all filters',
  'Nhóm cột (Click để ẩn/hiện):': 'Column groups (click to hide/show):',
  'Hiện cả hồ sơ đã lưu trữ': 'Show archived profiles too',
  'Đã nộp': 'Submitted',
  'Đã nộp (dữ liệu cũ)': 'Submitted (legacy data)',
  'Thiếu giấy tờ': 'Missing documents',
  'Thiếu giấy tờ bắt buộc (mục 9)': 'Required documents are missing (section 9)',
  'Nhấp đúp để xem toàn bộ thông tin': 'Double-click to see all information',
  'Mở biểu mẫu chỉnh sửa chi tiết': 'Open the detailed edit form',
  'Xem chi tiết hồ sơ (Chỉ xem)': 'View profile details (read only)',
  'Khôi phục hồ sơ': 'Restore profile',
  'Lưu trữ (Archive) hồ sơ': 'Archive profile',
  '25 dòng / trang': '25 rows / page',
  '50 dòng / trang': '50 rows / page',
  '100 dòng / trang': '100 rows / page',
  'Không thể thực hiện thao tác.': 'The action could not be completed.',
  'Tùy chỉnh cột': 'Customize columns',
  'Cột của tôi': 'My columns',
  'Về mặc định': 'Reset to default',
  // ---- column customizer
  'Chọn cột hiển thị và sắp xếp thứ tự. Cấu hình lưu riêng cho tài khoản của bạn, ẩn cột không xóa dữ liệu.': 'Choose which columns to show and their order. This is saved for your account only; hiding a column does not delete data.',
  'Tìm cột...': 'Find a column...',
  'Lưu cấu hình': 'Save layout',
  'Đang dùng cột tùy chỉnh': 'Using custom columns',
  'Không lưu được cấu hình cột.': 'Could not save the column layout.',
  'Đã chọn': 'Selected',
  'Lên': 'Up',
  'Xuống': 'Down',
  'Hủy': 'Cancel',
  'Đóng': 'Close',
  'Lưu': 'Save',
  'Sửa': 'Edit',
  'Xóa': 'Delete',
  // ---- detail and comments
  'Chi tiết hồ sơ ứng viên': 'Candidate profile details',
  'Bình luận nội bộ': 'Internal comments',
  'không hiển thị cho ứng viên': 'not shown to the candidate',
  'Không tải được bình luận.': 'Could not load the comments.',
  'Không thực hiện được.': 'The action could not be completed.',
  'Chưa có bình luận nào.': 'No comments yet.',
  'Xóa bình luận này?': 'Delete this comment?',
  'Viết bình luận nội bộ...': 'Write an internal comment...',
  'Gửi': 'Send',
  'Đã lưu trữ': 'Archived',
  // ---- form
  'Quay lại danh sách': 'Back to the list',
  'Nhập mới hồ sơ ứng viên (76 trường / 11 mục)': 'New candidate profile (all fields / 11 sections)',
  'Điền đủ các trường đánh dấu (*) của mục hiện tại thì mới sang được mục tiếp theo. Mã ứng viên tự động.': 'Fill in all fields marked (*) in the current section to move to the next one. The candidate code is generated automatically.',
  'Lưu và nhập tiếp': 'Save and add another',
  'Chế độ chỉ xem:': 'Read-only mode:',
  'Khác': 'Other',
  'Chưa gán PIC': 'No PIC assigned',
  'Điền đủ các mục phía trước để mở mục này': 'Complete the previous sections to open this one',
  'Tự động ghi khi lưu': 'Filled automatically on save',
  'Chọn PIC để tạo mã': 'Choose a PIC to generate the code',
  '· bấm vào ô để tải file lên (PDF, Word hoặc ảnh, tối đa 10 MB)': '· click a box to upload a file (PDF, Word or image, max 10 MB)',
  'Giấy tờ': 'Documents',
  'Tự động': 'Automatic',
  'File tối đa 10 MB.': 'Files can be up to 10 MB.',
  'File CV tối đa 10 MB.': 'CV files can be up to 10 MB.',
  'Bấm để chọn file khác': 'Click to choose another file',
  'Bấm để tải file lên': 'Click to upload a file',
  'Thiếu giấy tờ bắt buộc': 'Required document missing',
  'Không tải được file.': 'Could not upload the file.',
  'Không xóa được file.': 'Could not delete the file.',
  'Đã nộp (dữ liệu cũ, chưa có file). Bấm nút trên để tải file lên.': 'Submitted (legacy data, no file). Use the button above to upload the file.',
  'Chưa nộp': 'Not submitted',
  'Chọn file khác': 'Choose another file',
  'Tải file CV lên': 'Upload CV file',
  'Không tải được file CV.': 'Could not upload the CV file.',
  'Xóa file CV đã tải lên của hồ sơ này?': 'Delete the CV file uploaded for this profile?',
  'Không xóa được file CV.': 'Could not delete the CV file.',
  'PDF, Word hoặc ảnh, tối đa 10 MB. Có thể chỉ dán link ở ô bên trên.': 'PDF, Word or image, max 10 MB. You can also just paste a link in the box above.',
  'Chọn Vùng/Miền trước...': 'Choose the Region first...',
  'Chọn...': 'Choose...',
  'DD/MM/YYYY hoặc YYYY (VD: 15/08/1999 hoặc 1999)': 'DD/MM/YYYY or YYYY (e.g. 15/08/1999 or 1999)',
  'https://www.linkedin.com/in/... hoặc link Drive': 'https://www.linkedin.com/in/... or a Drive link',
  '9 chữ số (VD: 854498989)': '9 digits (e.g. 854498989)',
  'Số nguyên VND (VD: 9500000)': 'Whole VND amount (e.g. 9500000)',
  'Tự động tính toán': 'Calculated automatically',
  '· còn trường bắt buộc chưa điền': '· required fields are still empty',
  'Tất cả thay đổi đã đồng bộ.': 'All changes are synced.',
  'Đã gửi đề xuất bổ sung giá trị mới tới Admin phê duyệt.': 'Your suggestion for a new value was sent to the Admin for approval.',
  'Máy chủ từ chối dữ liệu do lỗi xác thực. Vui lòng xem chi tiết bên dưới các trường.': 'The server rejected the data because of validation errors. See the details under the fields.',
  'Lỗi kết nối máy chủ khi lưu hồ sơ.': 'Connection error while saving the profile.',
  'Nhập mới hồ sơ': 'New profile',
  // ---- report page
  'So với kỳ trước': 'Versus the previous period',
  'Không tải được dữ liệu báo cáo.': 'Could not load the report data.',
  'Ngưỡng': 'Threshold',
  'Kỳ trước': 'Previous period',
  'Trung bình': 'Average',
  'ER > 30 ngày': 'ER > 30 days',
  'ER > 60 ngày': 'ER > 60 days',
  'Đủ 30 / 60 ngày': '30 / 60 days reached',
  'Tỷ lệ nghỉ việc': 'Attrition rate',
  'Nghỉ trong tháng': 'Left in the month',
  'Đang làm đầu tháng': 'Working at month start',
  'Nghỉ < 30 ngày': 'Left within 30 days',
  'Chưa có dữ liệu trong khoảng này.': 'No data in this range.',
  'Thời gian:': 'Period:',
  'Tất cả TA': 'All TA',
  'Tất cả Source': 'All Sources',
  'Lọc thêm': 'More filters',
  'Xóa bộ lọc': 'Clear filters',
  'Làm mới': 'Refresh',
  'Vùng:': 'Region:',
  'Tất cả': 'All',
  'Phòng/Ban:': 'Department:',
  'Vị trí:': 'Position:',
  'Kỳ đang xem:': 'Viewing period:',
  'Đang tải dữ liệu báo cáo...': 'Loading report data...',
  'Bấm để xem chi tiết': 'Click for details',
  'Lý do ↻': 'Reasons ↻',
  'Chưa có lý do nào được ghi.': 'No reasons recorded.',
  '↻ Quay lại': '↻ Back',
  'Onboard, nghỉ việc & % churn theo tháng': 'Onboard, attrition & % churn by month',
  'Nghỉ việc': 'Attrition',
  '% churn của tháng = số nghỉ trong tháng / (số đang làm đầu tháng + OB trong tháng).': 'Monthly % churn = people who left in the month / (people working at month start + OB in the month).',
  'Hiệu suất tuyển dụng theo tháng': 'Recruitment performance by month',
  'Không có dữ liệu cho kỳ này.': 'No data for this period.',
  'Ứng viên (Leads)': 'Candidates (Leads)',
  'Chưa có dữ liệu.': 'No data yet.',
  'Đã lưu': 'Saved',
  'Không lưu được': 'Could not save',
  'OB, nghỉ việc và %ER của nhóm OB trong kỳ': 'OB, attrition and %ER of the OB cohort in the period',
  'Churn = toàn bộ người nghỉ việc trong kỳ. Rê chuột vào cột để xem nguồn đóng góp. %ER = số còn làm / số OB của kỳ.': 'Churn = everyone who left in the period. Hover a bar to see the contributing sources. %ER = people still working / OB of the period.',
  'OB so với Target · % Achievement': 'OB vs Target · % Achievement',
  'Target do Admin nhập, dùng chung cả team': 'Target is set by the Admin and shared by the whole team',
  'Target do Admin đặt': 'Target is set by the Admin',
  'Nhập Target OB / tháng ở góc phải': 'Enter the monthly OB target in the top right',
  'Admin chưa đặt Target OB': 'The Admin has not set an OB target',
  'Target OB / tháng': 'OB target / month',
  'OB và các bước funnel theo kỳ': 'OB and funnel steps by period',
  'Tất cả ': 'All ',
  'OB (cột)': 'OB (bars)',
  'Số người, tỷ lệ chuyển đổi và thay đổi so với kỳ liền trước': 'Headcount, conversion rate and change versus the previous period',
  'Funnel · số người (tỷ lệ chuyển đổi)': 'Funnel · headcount (conversion rate)',
  'Kỳ': 'Period',
  '30 ngày': '30 days',
  '60 ngày': '60 days',
  // ---- statuses, stages and common words
  'Đang tải...': 'Loading...',
  'Tiếp theo': 'Next',
  'Quay lại': 'Back',
  'Trước': 'Previous',
  'Sau': 'Next',
  'Trang': 'Page',
  'Thêm': 'Add',
  'Tìm kiếm': 'Search',
  'Có': 'Yes',
  'Không': 'No',
  'Xác nhận': 'Confirm',
  'Tải lại': 'Reload',
  'Mới': 'New',
  // ---- Follow WD
  'Tất cả (Follow WD)': 'All (Follow WD)',
  'Quá hạn': 'Overdue',
  'Chưa nhập': 'Not entered',
  'Chưa có': 'None yet',
};

/** [pattern, builder]: sentences that carry numbers or names. */
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Bạn chỉ thấy ứng viên của (.+)$/, (_m, who) => `You only see ${who}'s candidates`],
  [/^Vùng (.+)$/, (_m, v) => `Region ${v}`],
  [/^Địa điểm (.+)$/, (_m, v) => `Location ${v}`],
  [/^Lọc theo view:$/, () => 'Filtered by view:'],
  [/^Tổng \((\d+)\)$/, (_m, n) => `Total (${n})`],
  [/^· (\d+) bắt buộc \(\*\)$/, (_m, n) => `· ${n} required (*)`],
  [/^Mục này còn (\d+) trường chưa hợp lệ hoặc chưa điền\. Điền đủ rồi mới sang mục tiếp theo được\.$/, (_m, n) => `${n} field(s) in this section are invalid or empty. Complete them to go to the next section.`],
  [/^Có (\d+) trường dữ liệu chưa hợp lệ\. Vui lòng kiểm tra hướng dẫn sửa màu đỏ bên dưới từng trường\.$/, (_m, n) => `${n} field(s) are invalid. Please check the red instructions under each field.`],
  [/^Đã tạo hồ sơ "(.+)" thành công\. Sẵn sàng nhập ứng viên tiếp theo\.$/, (_m, c) => `Profile "${c}" was created. Ready for the next candidate.`],
  [/^Đã lưu cập nhật hồ sơ "(.+)" \(Phiên bản v(\d+)\)\.$/, (_m, c, v) => `Profile "${c}" was updated (version v${v}).`],
  [/^Chỉnh sửa hồ sơ: (.+)$/, (_m, c) => `Edit profile: ${c}`],
  [/^Xóa hồ sơ (.+)\?$/, (_m, c) => `Archive profile ${c}?`],
  [/^Xóa file "(.+)"\?$/, (_m, f) => `Delete the file "${f}"?`],
  [/^Chọn (.+)\.\.\.$/, (_m, f) => `Choose ${trInner(f)}...`],
  [/^Nhập (.+)\.\.\.$/, (_m, f) => `Enter ${trInner(f).toLowerCase()}...`],
  [/^(\d+) \/ (\d+) ứng viên$/, (_m, a, b) => `${a} / ${b} candidates`],
  [/^Cập nhật (.+) ·$/, (_m, t) => `Updated ${t} ·`],
  [/^Trang (\d+) \/ (\d+)$/, (_m, a, b) => `Page ${a} / ${b}`],
  [/^(\d+) bình luận$/, (_m, n) => `${n} comments`],
  [/^đã sửa (.+)$/, (_m, t) => `edited ${t}`],
  [/^([\d.,]+) \/ ngày$/, (_m, n) => `${n} / day`],
  [/^(\d+%) · thiếu (\d+)$/, (_m, p, n) => `${p} · short by ${n}`],
  [/^(\d+%) · đạt$/, (_m, p) => `${p} · met`],
  [/^(đang xử lý|hoàn tất) · (\d+%)$/, (_m, w, p) => `${w === 'hoàn tất' ? 'done' : 'in progress'} · ${p}`],
  [/^%ER(30|60): (\d+)\/(\d+) OB đủ (30|60) ngày$/, (_m, k, a, b, d) => `%ER${k}: ${a}/${b} OB with ${d} days`],
  [/^(\d+) (dòng|người|nhóm)$/, (_m, n, w) => `${n} ${w === 'dòng' ? 'rows' : w === 'người' ? 'people' : 'groups'}`],
  [/^(\d+) \/ (\d+) người$/, (_m, a, b) => `${a} / ${b} people`],
  [/^Trùng số điện thoại với (\d+) hồ sơ khác: (.+)$/, (_m, n, list) => `Same phone number as ${n} other profile(s): ${list}`],
  [/^Trùng số điện thoại với (.+)$/, (_m, parts) => 'Same phone number as ' + parts.replace('hồ sơ của bạn:', 'your profiles:').replace(/ và /, ' and ').replace(/(\d+) hồ sơ của TA khác \(liên hệ Admin\)/, '$1 profile(s) of other TAs (contact the Admin)')],
  [/^(Canceled|Noshow) · (.+)$/, (_m, st, why) => `${st} · ${trInner(why)}`],
  // Server messages with numbers or codes (Phase 2 to 4)
  [/^Bản dịch tối đa (\d+) ký tự\.$/, (_m, n) => `The translation can be up to ${n} characters.`],
  [/^Hãy bật lại workspace của (.+) trước khi bàn giao\.$/, (_m, p) => `Turn the workspace of ${p} back on before handing it over.`],
  [/^Không đồng bộ được workspace của (.+) trước khi bàn giao: (.+)$/, (_m, p, e) => `Could not sync the workspace of ${p} before the hand-over: ${e}`],
  [/^Mỗi hồ sơ tối đa (\d+) file (.+)\. Hãy xóa bớt file cũ\.$/, (_m, n, k) => `Each profile can have at most ${n} ${k} files. Delete some old files.`],
  [/^PIC (.+) đã có form\.$/, (_m, p) => `PIC ${p} already has a form.`],
  [/^Workspace của (.+) còn (\d+) hồ sơ xung đột\. Hãy xử lý xung đột rồi bàn giao\.$/, (_m, p, n) => `The workspace of ${p} still has ${n} conflicting profile(s). Resolve them, then hand it over.`],
  [/^Workspace của (.+) đang tắt\. Hãy bật lại trước khi nhận bàn giao\.$/, (_m, p) => `The workspace of ${p} is off. Turn it on before it receives the hand-over.`],
  [/^Đã tạo file cho (.+) nhưng chưa đồng bộ xong\. Hãy bấm "Đồng bộ" ở màn hình Workspace rồi thử lại\.$/, (_m, p) => `The file for ${p} was created but is not fully synced. Press "Sync" on the Workspace screen and try again.`],
  [/^Ứng viên đã rớt ở (R1|R2|Onboard) nên không chuyển tiếp được\. Hãy đổi trạng thái \1 trong hồ sơ nếu cần mở lại\.$/, (_m, r) => `The candidate failed ${r}, so they cannot move forward. Change the ${r} status in the profile to reopen.`],
  [/^Ứng viên đã rớt ở (R1|R2|Onboard) nên các bước sau bị khóa\. Đổi trạng thái \1 để mở lại\.$/, (_m, r) => `The candidate failed ${r}, so the later steps are locked. Change the ${r} status to reopen them.`],
  [/^(.+) chỉ áp dụng cho hồ sơ từ Rank 5 trở lên \(Rank hiện tại: (.+)\)\.$/, (_m, k, r) => `${k} only applies to profiles of Rank 5 or higher (current rank: ${r === 'chưa chọn' ? 'not chosen' : r}).`],
  [/^Hiển thị (\d+)\s*[-–]\s*(\d+) trên (\d+)$/, (_m, a, b, c) => `Showing ${a}–${b} of ${c}`],
  // ---- validation messages (the most common ones)
  [/^Số điện thoại phải gồm đúng 9 chữ số từ 0-9 và không bắt đầu bằng số 0\. Cách sửa: (.+)$/, () => 'The phone number must have exactly 9 digits and must not start with 0. How to fix: enter it like 854498989 (a leading 0 or +84 is removed automatically).'],
  [/^Đã tự động chuẩn hóa số điện thoại từ "(.+)" thành "(.+)"/, (_m, a, b) => `The phone number was normalized from "${a}" to "${b}" (9 digits, leading 0 / +84 removed).`],
  [/^Ngày không đúng định dạng DD\/MM\/YYYY\. Cách sửa: .+$/, () => 'The date is not in DD/MM/YYYY format. How to fix: enter it like 15/11/2026.'],
  [/^Ngày "(.+)" không tồn tại trên lịch\. Cách sửa: .+$/, (_m, d) => `The date "${d}" does not exist on the calendar. How to fix: check the day and month (DD/MM/YYYY).`],
  [/^Ngày\/Năm sinh không hợp lệ\. Cách sửa: .+$/, () => 'The date / year of birth is not valid. How to fix: enter a full date like 15/08/1999 or just the year like 1999.'],
  [/^Năm sinh phải từ (\d+) đến (\d+) \(ứng viên từ 14 đến 80 tuổi\)\.$/, (_m, a, b) => `The birth year must be between ${a} and ${b} (candidates aged 14 to 80).`],
  [/^Link CV không hợp lệ\. Cách sửa: .+$/, () => 'The CV link is not valid. How to fix: paste the full URL, for example https://www.linkedin.com/in/your-name or a Google Drive link.'],
  [/^Mã ứng viên là bắt buộc\. Cách sửa: .+$/, () => 'The candidate code is required. How to fix: enter a code without spaces (e.g. UV2026001).'],
  [/^Mã ứng viên không được chứa khoảng trắng\. Cách sửa: .+$/, () => 'The candidate code must not contain spaces. How to fix: remove the spaces from the code.'],
  [/^Trường "(.+)" là bắt buộc\. Cách sửa: .+$/, (_m, f) => `The field "${f}" is required. How to fix: enter or choose a valid value.`],
  [/^Địa chỉ Email không hợp lệ\. Cách sửa: .+$/, () => 'The email address is not valid. How to fix: use the format name@domain.com or leave it empty.'],
  [/^Giờ phỏng vấn phải nằm trong khung 09:00 đến 16:30 .+$/, () => 'The interview time must be between 09:00 and 16:30 in 30-minute steps. How to fix: choose a time from the list.'],
  [/^"(.+)" phải là số nguyên VND không âm\. Cách sửa: .+$/, (_m, f) => `"${f}" must be a non-negative whole VND amount. How to fix: type digits only (e.g. 9500000).`],
  [/^Phần trăm lương thử việc \(% Probation\) phải từ 0 đến 100\. Cách sửa: .+$/, () => 'The probation salary percentage (% Probation) must be between 0 and 100. How to fix: enter a valid percentage (e.g. 85 or 100).'],
  [/^Giá trị "(.+)" không có trong danh mục "(.+)"\. Cách sửa: .+$/, (_m, v, f) => `The value "${v}" is not in the list "${f}". How to fix: choose one of the available values.`],
  [/^Giá trị "(.+)" không nằm trong danh sách "(.+)"\. Cách sửa: .+$/, (_m, v, f) => `The value "${v}" is not in the list "${f}". How to fix: choose a valid value from the list.`],
  [/^Chưa chọn Vùng\/Miền \(Region\)\. Cách sửa: .+$/, () => 'No Region selected. How to fix: choose the Region before the Location.'],
  [/^Tỉnh\/Thành "(.+)" không thuộc "(.+)"\. Cách sửa: .+$/, (_m, l, r) => `The Location "${l}" is not in "${r}". How to fix: choose a Location that belongs to ${r}.`],
  [/^Chưa chọn Tỉnh\/Thành \(Location\)\. Cách sửa: .+$/, () => 'No Location selected. How to fix: choose the Location before the Site.'],
  [/^Điểm làm việc "(.+)" không thuộc "(.+)"\. Cách sửa: .+$/, (_m, s, l) => `The Site "${s}" is not in "${l}". How to fix: choose a Site that belongs to ${l}.`],
  [/^Đã có lý do \((.+)\) nhưng chưa chọn trạng thái\. Cách sửa: .+$/, (_m, l) => `A reason (${l}) is set but no status is chosen. How to fix: choose the ${l} status first.`],
  [/^Lý do "(.+)" không dùng cho trạng thái "(.+)" \((.+)\)\. Cách sửa: Chọn một trong: (.+)\.$/, (_m, r, s, l, a) => `The reason "${r}" does not apply to the status "${s}" (${l}). How to fix: choose one of: ${a}.`],
  [/^Trạng thái "(.+)" \((.+)\) không có lý do\. Cách sửa: .+$/, (_m, s, l) => `The status "${s}" (${l}) takes no reason. How to fix: leave the reason empty or change the status.`],
  [/^Trạng thái "(.+)" \((.+)\) nên có lý do\. Bạn có thể bổ sung sau\.$/, (_m, s, l) => `The status "${s}" (${l}) should have a reason. You can add it later.`],
  [/^Thiếu giấy tờ bắt buộc cho vị trí này\. Cách sửa: Tải file lên\.$/, () => 'Required documents are missing for this position. How to fix: upload the file.'],
  [/^Có kết quả R2 nhưng R1 chưa Passed\. Hãy kiểm tra lại\.$/, () => 'There is an R2 result but R1 is not Passed. Please check.'],
  [/^Có trạng thái Onboard nhưng R2 chưa Passed\. Hãy kiểm tra lại\.$/, () => 'There is an Onboard status but R2 is not Passed. Please check.'],
  [/^Ngày nghỉ việc \(Attrition_Date\) không được nhỏ hơn Ngày Onboard \(OB_Date\)\. .+$/, () => 'The attrition date must not be earlier than the onboard date (OB_Date). How to fix: enter a later or equal date.'],
];

/** Generated entries: every field label, section title and stage name in the catalog. */
const GENERATED: Record<string, string> = {};
for (const f of FIELD_CATALOG) {
  const en = FIELD_EN[f.key] ?? (f.excelHeader && /^[\x20-\x7E]+$/.test(f.excelHeader) ? f.excelHeader : '');
  if (en && en !== f.label) GENERATED[f.label] = en;
}
for (const s of SECTIONS) {
  const en = SECTION_EN[s.id];
  if (en) {
    GENERATED[s.title] = en[0];
    GENERATED[s.shortTitle] = en[1];
  }
}
for (const st of STAGES) GENERATED[STAGE_LABELS[st].vi] = STAGE_LABELS[st].en;

/** English label of a field (falls back to the Vietnamese label). */
export function fieldLabel(key: string, lang: Lang): string {
  const f = FIELD_CATALOG.find((x) => x.key === key);
  if (!f) return key;
  return lang === 'en' ? GENERATED[f.label] ?? f.label : f.label;
}

const VI_CHAR = /[À-ỹ]/;

/** Lower-case lookup so "Nhập mã ứng viên..." (label written in lower case in the code) still finds "Mã ứng viên". */
let LOWER: Map<string, string> | null = null;
function trInner(vi: string): string {
  const direct = EXACT[vi] ?? GENERATED[vi];
  if (direct !== undefined) return direct;
  if (!LOWER) {
    LOWER = new Map();
    for (const [k, v] of [...Object.entries(EXACT), ...Object.entries(GENERATED)]) LOWER.set(k.toLowerCase(), v);
  }
  return LOWER.get(vi.toLowerCase()) ?? vi;
}

/** Translates one piece of interface text to English. Unknown text is returned unchanged. */
export function translateText(text: string): string {
  // A sort arrow after a column title ("Mã ứng viên ▼") must not stop the title from being found.
  const arrow = /^(.*\S)(\s[▲▼])$/.exec(text);
  if (arrow) {
    const inner = translateText(arrow[1]);
    return inner === arrow[1] ? text : inner + arrow[2];
  }
  if (!text || !VI_CHAR.test(text)) {
    // Plain ASCII entries ("Rank", "Email") are already the same in both languages; only dictionary hits matter here.
    const hit = EXACT[text] ?? GENERATED[text];
    return hit ?? text;
  }
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.slice(lead.length, text.length - trail.length);
  const direct = EXACT[core] ?? GENERATED[core];
  if (direct !== undefined) return lead + direct + trail;
  for (const [re, build] of PATTERNS) {
    const m = re.exec(core);
    if (m) return lead + build(...m) + trail;
  }
  return text;
}

// M7-7: tiếng Anh cho các câu CHỈ CÓ Ở HỆ MỚI (thông báo của service / Edge Function / RPC, vài chữ giao diện mới).
// Bổ sung cho từ điển hệ cũ (shared/i18n.ts + i18nExtra.ts, giữ nguyên): i18n.tsx tra từ điển cũ trước, không thấy mới tra ở đây.
// Test: tests/frontend/i18nNew.test.ts quét mọi câu tiếng Việt mới trong frontend/src + supabase/functions và kiểm có bản dịch.
import { translateText } from '../../shared/i18n.ts';

export const NEW_EN: Record<string, string> = {
  // ---- khung, giao diện mới
  'Đang chuyển sang hệ thống mới': 'Moving to the new system',
  'Màn hình này đang được chuyển sang hệ thống mới. Trong thời gian chuyển đổi, vui lòng tiếp tục dùng hệ thống cũ.':
    'This screen is being moved to the new system. Until then, please keep using the old system.',
  'Tìm mã, tên, SĐT…': 'Search code, name, phone…',
  'Đóng (Esc)': 'Close (Esc)',
  'Đang lưu…': 'Saving…',
  'Vị trí tuyển dụng (Position)': 'Job position (Position)',
  'Điểm làm việc (Site / Kho)': 'Work site (Site / Warehouse)',
  'Tỉnh / Thành phố (Location)': 'Province / City (Location)',
  'TA được xem target của mọi TA (Admin luôn xem được)': "TA may see every TA's targets (Admin always can)",
  'Xem mọi target': 'View all targets',
  '(bạn)': '(you)',
  'Luôn xem': 'Always',
  'Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong frontend/.env.local.': 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing in frontend/.env.local.',

  // ---- đăng nhập / tài khoản
  'Sai tên đăng nhập hoặc mật khẩu.': 'Wrong username or password.',
  'Tài khoản đã bị khóa. Vui lòng liên hệ Admin.': 'This account is locked. Please contact an Admin.',
  'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.': 'Too many failed sign-ins. Please try again in a few minutes.',
  'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.': 'Cannot reach the server. Check the network and try again.',
  'Không đọc được thông tin tài khoản.': 'Could not read the account information.',
  'Tài khoản đã bị khóa hoặc chưa được cấp quyền. Vui lòng liên hệ Admin.': 'This account is locked or has no access yet. Please contact an Admin.',
  'Tài khoản đã bị khóa hoặc chưa được cấp quyền.': 'This account is locked or has no access yet.',
  'Mật khẩu mới phải khác mật khẩu hiện tại.': 'The new password must differ from the current one.',
  'Không tải được danh sách tài khoản.': 'Could not load the account list.',
  'Thao tác không thành công.': 'The action failed.',
  'Không thể cập nhật quyền xem target.': 'Could not update the target view permission.',
  'Không thể tự khóa tài khoản của chính mình': 'You cannot lock your own account',
  'Không tải được danh mục PIC.': 'Could not load the PIC list.',
  'Chỉ Admin được quản lý tài khoản.': 'Only an Admin can manage accounts.',
  'Tên đăng nhập đã tồn tại.': 'This username already exists.',
  'Không tạo được tài khoản (có thể đã tồn tại).': 'Could not create the account (it may already exist).',
  'Không tìm thấy tài khoản.': 'Account not found.',
  'Không đặt lại được mật khẩu.': 'Could not reset the password.',
  'Mật khẩu tạm tối đa 72 ký tự.': 'The temporary password can have at most 72 characters.',
  'Tên đăng nhập 3–40 ký tự, chỉ gồm chữ không dấu, số và . _ -': 'Username: 3–40 characters, unaccented letters, digits and . _ - only',
  'Vai trò phải là admin hoặc pic.': 'Role must be admin or pic.',
  'Tài khoản TA bắt buộc có PIC.': 'A TA account must have a PIC.',
  'Thiếu hoặc sai id tài khoản.': 'Missing or wrong account id.',
  'Không có thay đổi nào.': 'Nothing to change.',
  'Không thể tự khóa hoặc tự hạ quyền tài khoản Admin của chính mình.': 'You cannot lock or downgrade your own Admin account.',
  'Tài khoản không tồn tại hoặc đã bị khóa.': 'The account does not exist or is locked.',

  // ---- hồ sơ ứng viên
  'Hồ sơ vừa được người khác cập nhật.': 'This profile was just updated by someone else.',
  'Hồ sơ ứng viên này vừa được người dùng khác cập nhật. Vui lòng đối chiếu phiên bản hiện tại trước khi ghi đè.':
    'This candidate profile was just updated by another user. Please compare with the current version before overwriting.',
  'Không tải được danh sách ứng viên.': 'Could not load the candidate list.',
  'Không tạo được hồ sơ.': 'Could not create the profile.',
  'Không lưu được hồ sơ.': 'Could not save the profile.',
  'Không lưu trữ được hồ sơ.': 'Could not archive the profile.',
  'Không chuyển được hồ sơ.': 'Could not move the profile.',
  'Không gửi được đề xuất. Vui lòng thử lại.': 'Could not send the proposal. Please try again.',
  'Không tải được danh mục Drop-list.': 'Could not load the drop-down lists.',
  'Không tải được cấu hình Drop-list.': 'Could not load the drop-down configuration.',
  'Không tải thêm được thẻ.': 'Could not load more cards.',
  'Không tải được lịch sử chuyển vòng.': 'Could not load the stage history.',
  'Không tải được số liệu thẻ KPI.': 'Could not load the KPI card numbers.',
  'Không thêm được bình luận.': 'Could not add the comment.',
  'Không sửa được bình luận (chỉ tác giả hoặc Admin).': 'Could not edit the comment (author or Admin only).',
  'Không xóa được bình luận (chỉ tác giả hoặc Admin).': 'Could not delete the comment (author or Admin only).',
  'Chỉ Admin được đổi mã ứng viên.': 'Only an Admin can change the candidate code.',
  'Chỉ Admin được đổi PIC.': 'Only an Admin can change the PIC.',
  'Chỉ Admin được lưu trữ / khôi phục hồ sơ.': 'Only an Admin can archive / restore profiles.',
  'TA chỉ lấy được mã cho PIC của mình.': 'A TA can only get codes for their own PIC.',
  'Lỗi máy chủ khi lưu hồ sơ. Vui lòng thử lại.': 'Server error while saving the profile. Please try again.',
  'Thiếu hoặc sai id hồ sơ.': 'Missing or wrong profile id.',
  'Thiếu mã ứng viên.': 'Candidate code is missing.',

  // ---- công việc, lịch, target, tuyển
  'Bạn không có quyền thực hiện thao tác này.': 'You are not allowed to do this.',
  'Không tải được nhắc việc.': 'Could not load the reminders.',
  'Không tìm thấy hồ sơ ứng viên hoặc bạn không được giao việc cho người khác.': 'Candidate profile not found, or you may not assign tasks to other people.',
  'Không lưu được công việc.': 'Could not save the task.',
  'Không xóa được công việc.': 'Could not delete the task.',
  'Không thêm được buổi phỏng vấn.': 'Could not add the interview.',
  'Không lưu được buổi phỏng vấn.': 'Could not save the interview.',
  'Không xóa được buổi phỏng vấn.': 'Could not delete the interview.',
  'Không tải được checklist tuyển.': 'Could not load the hiring checklist.',
  'Không lưu được checklist.': 'Could not save the checklist.',
  'Không thực hiện được xác nhận tuyển.': 'Could not confirm the hire.',
  'Chỉ Admin mới mở lại được xác nhận tuyển.': 'Only an Admin can reopen a hire confirmation.',
  'Đã xác nhận tuyển rồi.': 'The hire is already confirmed.',
  'Không xóa được target.': 'Could not delete the target.',
  'Không tải được Target.': 'Could not load the targets.',
  'Chỉ Admin được đổi Target.': 'Only an Admin can change the target.',
  'Không lưu được Target.': 'Could not save the target.',
  'Không có quyền xem target này': 'You may not view this target',
  'Không tạo được sự kiện.': 'Could not create the event.',
  'Không lưu được sự kiện.': 'Could not save the event.',
  'Không xóa được sự kiện.': 'Could not delete the event.',
  'Chỉ người tạo hoặc Admin mới xóa được sự kiện này.': 'Only the creator or an Admin can delete this event.',
  'Khoảng ngày không hợp lệ.': 'Invalid date range.',
  'Khoảng ngày quá dài': 'The date range is too long',
  'Mỗi lần xem tối đa 62 ngày.': 'At most 62 days per view.',
  'Tối đa 60 kỳ': 'At most 60 periods',

  // ---- HR Info / form HR
  'Không lưu được thông tin nhân sự.': 'Could not save the HR information.',
  'Lỗi máy chủ khi lưu thông tin nhân sự. Vui lòng thử lại.': 'Server error while saving the HR information. Please try again.',
  'Thông tin nhân sự vừa được người khác sửa. Hãy tải lại rồi thử lại.': 'The HR information was just changed by someone else. Reload and try again.',
  'Thông tin nhân sự đã được xác nhận.': 'The HR information is already confirmed.',
  'Chưa cấu hình tài khoản Google để đọc sheet trả lời của form. Trong thời gian chuyển đổi, vui lòng xem câu trả lời trên hệ thống cũ.':
    'No Google account is set up to read the form answer sheet yet. Until then, please look up the answer in the old system.',
  'Đọc sheet trả lời chưa được bật trên hệ thống mới.': 'Reading the answer sheet is not enabled on the new system yet.',
  'Lỗi máy chủ. Vui lòng thử lại.': 'Server error. Please try again.',
  'Trạng thái / dữ liệu không hợp lệ.': 'Invalid status / data.',

  // ---- quản trị Drop-list / View / cấu hình
  'Không thêm được tùy chọn.': 'Could not add the option.',
  'Không cập nhật được tùy chọn.': 'Could not update the option.',
  'Không lưu được bảng ánh xạ.': 'Could not save the mapping.',
  'Không lưu được phân cấp.': 'Could not save the hierarchy.',
  'Không tải được danh sách đề xuất.': 'Could not load the proposals.',
  'Không duyệt được đề xuất.': 'Could not review the proposal.',
  'Chỉ Admin được đổi cấu hình.': 'Only an Admin can change the settings.',
  'Không lưu được cấu hình.': 'Could not save the settings.',
  'Chỉ Admin được thực hiện thao tác này.': 'Only an Admin can do this.',
  'Dữ liệu ánh xạ Sub_Source -> Source không hợp lệ.': 'Invalid Sub_Source -> Source mapping.',
  'Hãy chọn ít nhất một người dùng khi gán view cho từng TA.': 'Pick at least one user when assigning the view to specific TAs.',
  'Không tìm thấy view.': 'View not found.',
  'Không tìm thấy yêu cầu đề xuất.': 'Proposal not found.',
  'Phải còn ít nhất một view trong hệ thống.': 'At least one view must remain.',
  'Thiếu thông tin tùy chọn cần cập nhật.': 'Missing information about the option to update.',
  'Trạng thái duyệt không hợp lệ.': 'Invalid review status.',
  'Tên view không được để trống và tối đa 80 ký tự.': 'The view name is required and has at most 80 characters.',
  'Vui lòng chọn danh mục và nhập giá trị mới.': 'Please choose a list and enter the new value.',
  'Đối tượng xem view không hợp lệ.': 'Invalid view audience.',
  'Không tải được nhật ký.': 'Could not load the audit log.',

  // ---- nhập Excel
  'Chỉ Admin được nhập Excel.': 'Only an Admin can import Excel files.',
  'Không tải được danh sách hồ sơ hiện có.': 'Could not load the existing profiles.',
  'Không ghi được dữ liệu nhập.': 'Could not write the imported data.',
  'Không ghi được kết quả nhập.': 'Could not write the import result.',
  'Không tìm thấy lô nhập.': 'Import batch not found.',
  'Lỗi máy chủ khi nhập dữ liệu. Vui lòng thử lại.': 'Server error while importing. Please try again.',
  'Dòng dữ liệu không hợp lệ.': 'Invalid data row.',

  // ---- lỗi kỹ thuật (gửi sai yêu cầu) – vẫn dịch để màn hình tiếng Anh không lẫn tiếng Việt
  'Phiên đăng nhập không hợp lệ.': 'Invalid sign-in session.',
  'Chỉ nhận POST.': 'POST only.',
  'Nội dung không phải JSON.': 'The request body is not JSON.',
  'Thiếu nội dung yêu cầu.': 'Missing request body.',
  'Thiếu hoặc sai record_id.': 'Missing or wrong record_id.',
  'Thiếu data.': 'Missing data.',
  'Thiếu values.': 'Missing values.',
  'Thiếu changes.': 'Missing changes.',
  'Thiếu target_box.': 'Missing target_box.',
  'Thiếu expected_version (phiên bản hồ sơ đang mở).': 'Missing expected_version (the version of the open profile).',
  'from_application_id không hợp lệ.': 'Invalid from_application_id.',
  'active phải là true/false.': 'active must be true/false.',
  'Phải là true/false.': 'Must be true/false.',
  'op phải là create, update hoặc reset_password.': 'op must be create, update or reset_password.',
  'op phải là link hoặc response.': 'op must be link or response.',
  'op phải là save hoặc verify.': 'op must be save or verify.',
  'op phải là chunk hoặc finish.': 'op must be chunk or finish.',
  'op phải là create, patch, move, archive, restore, confirm_hire hoặc reopen_hire.': 'op must be create, patch, move, archive, restore, confirm_hire or reopen_hire.',
  'p_periods phải là mảng [[from, to], ...]': 'p_periods must be an array [[from, to], ...]',
  'candidate_code: bắt buộc khi hồ sơ chưa có PIC': 'candidate_code: required when the profile has no PIC',
  'candidate_code: không được để trống': 'candidate_code: must not be empty',
};

// Danh từ trong các câu ghép "Không tải được …" / "Không tìm thấy … hoặc …" / "… chưa có trong hệ thống mới"
export const NOUN_EN: Record<string, string> = {
  'thông tin báo cáo': 'the report information', 'số hồ sơ': 'the profile count', 'số liệu báo cáo': 'the report numbers',
  'hiệu suất theo nhóm': 'the group performance', 'xu hướng theo tháng': 'the monthly trend', 'số liệu theo kỳ': 'the period numbers',
  'số liệu theo nguồn': 'the source numbers', 'lý do': 'the reasons', 'hiệu suất theo tháng': 'the monthly performance',
  'công việc': 'task', 'buổi phỏng vấn': 'interview', 'sự kiện': 'event', target: 'target',
  'Tải file CV': 'Uploading a CV', 'Tải xuống CV': 'Downloading a CV', 'Xóa file CV': 'Deleting a CV', 'Tải giấy tờ': 'Uploading a document',
  'Tải xuống giấy tờ': 'Downloading a document', 'Xóa giấy tờ': 'Deleting a document', 'Đính kèm file': 'Attaching a file',
  'Xóa đính kèm': 'Deleting an attachment',
};
const noun = (s: string) => NOUN_EN[s] ?? translateText(s);

// [mẫu, cách dựng câu tiếng Anh] – giá trị chen vào (tên, mã, số) giữ nguyên
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Dữ liệu chưa hợp lệ: (.+)$/s, (_, r) => `Invalid data: ${translateText(r)}`],
  [/^Không tải được (.+)\.$/, (_, w) => `Could not load ${noun(w)}.`],
  [/^Không tìm thấy (.+) hoặc bạn không có quyền sửa\.$/, (_, w) => `Could not find the ${noun(w)}, or you may not change it.`],
  [/^(.+) chưa có trong hệ thống mới \(làm ở (.+)\)\. Trong thời gian chuyển đổi, vui lòng dùng hệ thống cũ cho việc này\.$/,
    (_, w, p) => `${noun(w)} is not available in the new system yet (planned in ${p}). Until then, please use the old system for this.`],
  [/^Đã chuyển (.+) từ (.+) sang (.+) và đã lưu\. Mở hồ sơ để nhập ngày, giờ, lý do nếu cần\.$/,
    (_, n, a, b) => `Moved ${n} from ${a} to ${b} and saved. Open the profile to enter the date, time or reason if needed.`],
  [/^Mã ứng viên "(.*)" đã tồn tại \(không ghi đè\)\.$/, (_, c) => `Candidate code "${c}" already exists (not overwritten).`],
  [/^Mã ứng viên "(.*)" đã tồn tại trên hệ thống\.$/, (_, c) => `Candidate code "${c}" already exists in the system.`],
  [/^Mã PIC "(.*)" không có trong danh mục PIC\.$/, (_, c) => `PIC code "${c}" is not in the PIC list.`],
  [/^Giá trị "(.*)" đã có trong danh mục\.$/, (_, v) => `Value "${v}" is already in the list.`],
  [/^View "(.*)" đã tồn tại\.$/, (_, v) => `View "${v}" already exists.`],
  [/^Trường không hợp lệ: (.*)$/, (_, f) => `Invalid field: ${f}`],
  [/^Tải xuống file: (.*)$/, (_, f) => `Download file: ${f}`],
  [/^Cột "(.*)" không tồn tại trong danh mục trường\.$/, (_, c) => `Column "${c}" is not in the field catalog.`],
  [/^Không thể sắp xếp theo cột "(.*)"\.$/, (_, c) => `Cannot sort by column "${c}".`],
  [/^Không lưu được hồ sơ tài khoản: (.*)$/, (_, e) => `Could not save the account profile: ${e}`],
  [/^Mật khẩu mới phải có ít nhất (\d+) ký tự\.$/, (_, n) => `The new password must have at least ${n} characters.`],
  [/^Mật khẩu tạm phải có ít nhất (\d+) ký tự\.$/, (_, n) => `The temporary password must have at least ${n} characters.`],
  [/^Đã tạo tài khoản "(.*)" thành công\. Người dùng đăng nhập bằng mật khẩu khởi tạo và nên tự đổi mật khẩu \(nút "Đổi MK"\)\.$/,
    (_, u) => `Account "${u}" created. The user signs in with the initial password and should change it (the "Đổi MK" button).`],
  [/^Đã đặt lại mật khẩu cho "(.*)"\. Người dùng đăng nhập ngay bằng mật khẩu này\.$/, (_, u) => `Password reset for "${u}". The user can sign in with it right away.`],
  [/^Tài khoản PIC chỉ được tạo ứng viên thuộc mã PIC của mình \((.*)\)\.$/, (_, p) => `A PIC account can only create candidates of its own PIC code (${p}).`],
  [/^Bước này bị khóa vì ứng viên đã rớt ở (.+)\. Đổi trạng thái (.+) để mở lại\.$/, (_, a, b) => `This step is locked because the candidate failed at ${a}. Change the ${b} status to unlock it.`],
  [/^Ứng viên đã rớt ở (.+) nên các bước sau bị khóa\. Đổi trạng thái (.+) để mở lại\.$/, (_, a, b) => `The candidate failed at ${a}, so the later steps are locked. Change the ${b} status to unlock them.`],
  [/^Chưa xác nhận tuyển được, còn thiếu: (.*)\.$/, (_, l) => `Cannot confirm the hire yet, still missing: ${l.split(', ').map((x) => translateText(x)).join(', ')}.`],
  [/^Kỳ không hợp lệ: (.*)$/, (_, k) => `Invalid period: ${k}`],
  [/^Ô Kanban không hợp lệ: (.*)$/, (_, k) => `Invalid Kanban column: ${k}`],
  [/^group_by không hợp lệ: (.*)$/, (_, k) => `Invalid group_by: ${k}`],
];

/** Tiếng Anh cho câu mới của hệ mới; không biết thì trả nguyên văn (giống translateText). */
export function translateNew(text: string): string {
  if (!text) return text;
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.slice(lead.length, text.length - trail.length);
  const direct = NEW_EN[core];
  if (direct !== undefined) return lead + direct + trail;
  for (const [re, build] of PATTERNS) {
    const m = re.exec(core);
    if (m) return lead + build(...m) + trail;
  }
  return text;
}

/** Từ điển hệ cũ trước, rồi đến câu mới. */
export function translateAll(text: string): string {
  const old = translateText(text);
  return old !== text ? old : translateNew(text);
}

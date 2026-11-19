/**
 * Follow WD: which "Bước" belongs to which "Quy trình". Read from the real Follow WD sheet (28 people, 12 pairs),
 * so it may be incomplete: the form lists the matching steps first and still allows any other step.
 */
export const WD_STEPS_BY_PROCESS: Record<string, string[]> = {
  'Hợp đồng của nhân viên': ['Duy trì hợp đồng của nhân viên', 'Hợp đồng của nhân viên'],
  'Đề xuất lương thưởng cho quy trình tuyển dụng': [
    'Đánh giá lương thưởng cho quy trình tuyển dụng',
    'Đề xuất lương thưởng cho quy trình tuyển dụng',
  ],
  'Thuê tuyển': ['Chỉ định lịch trình làm việc', 'Thêm khoảng thời gian thử việc', 'Thay đổi chỉ định tổ chức'],
  'Đào tạo nhập môn': ['Thiết lập đào tạo nhập môn', 'Thay đổi lựa chọn phúc lợi'],
  'Thay đổi việc chỉ định tổ chức cho người lao động': ['Thay đổi chỉ định tổ chức'],
  'Thay đổi ảnh': ['Thay đổi ảnh'],
  'Thiết lập đào tạo nhập môn': ['Thiết lập đào tạo nhập môn'],
};

export const WD_STEP_GROUP_MATCH = 'Bước của quy trình đã chọn';
export const WD_STEP_GROUP_OTHER = 'Bước khác';

/** Steps for a process first, then the rest; used to group the Bước dropdown. */
export function wdStepGroup(process: string, step: string): string {
  return (WD_STEPS_BY_PROCESS[process] || []).includes(step) ? WD_STEP_GROUP_MATCH : WD_STEP_GROUP_OTHER;
}

export function sortWdSteps(process: string, steps: string[]): string[] {
  const own = WD_STEPS_BY_PROCESS[process] || [];
  return [...steps].sort((a, b) => Number(!own.includes(a)) - Number(!own.includes(b)));
}

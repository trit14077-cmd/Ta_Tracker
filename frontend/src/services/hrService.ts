// M6-4: Thông tin nhân sự + Google Form HR – thay các hàm tương ứng của dataService cũ (HrInfo.gs, HrForm.gs).
// Cùng tên hàm và kiểu trả về để HrInfoBanner chép từ hệ cũ gần như nguyên văn.
// Đọc: RPC hr_info_get / hr_duplicates (0018). Ghi: Edge hr-info-save (validate bằng shared/hrInfoRules) và hr-form.
import { supabase } from '../lib/supabase.ts';
import { ApiError, fnError } from './candidateService.ts';
import { hrEligible } from '../../../shared/hrInfoRules.ts';

export interface HrInfoRecord {
  data: Record<string, string>;
  status: 'draft' | 'submitted' | 'verified';
  updated_by: string;
  updated_at: string;
  verified_by: string;
  verified_at: string;
}
export interface HrDuplicates {
  count: number;
  own: string[];
  others: number;
  with: { code: string; pic: string }[];
}
export interface HrFormSend {
  id: string;
  candidate_id: string;
  candidate_code: string;
  pic: string;
  phone: string;
  sent_by: string;
  sent_at: string;
}
export interface HrFormResponse {
  found: boolean;
  reason?: 'empty' | 'no_match';
  searched?: { phone: string; cccd: boolean };
  match_by?: 'phone' | 'cccd';
  count?: number;
  row?: number;
  submitted_at?: string;
  answers?: { header: string; value: string; key: string }[];
  mapped?: Record<string, string>;
  sends: HrFormSend[];
}

const NO_DUP: HrDuplicates = { count: 0, own: [], others: 0, with: [] };

async function invoke<T>(fn: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw await fnError(error, fallback);
  return data as T;
}
async function duplicates(candidateId: number): Promise<HrDuplicates> {
  const { data } = await supabase.rpc('hr_duplicates', { p_record_id: candidateId });
  return (data as HrDuplicates) || NO_DUP;
}

export const hrService = {
  /** = GET /hr-info: eligible (đã đạt vòng 2) + HR Info + trùng CCCD. */
  async getHrInfo(candidateId: number): Promise<{ eligible: boolean; info: HrInfoRecord | null; duplicates: HrDuplicates }> {
    const [{ data, error }, { data: rec }] = await Promise.all([
      supabase.rpc('hr_info_get', { p_record_id: candidateId }),
      supabase.from('recruitment_records').select('r1_status, r1_date, r2_status, r2_date, ob_status, ob_date').eq('id', candidateId).maybeSingle(),
    ]);
    if (error) throw new ApiError('Không tải được thông tin nhân sự.', 500, error.code || 'HR_FAILED');
    if (!data || !rec) throw new ApiError('Không tìm thấy hồ sơ ứng viên.', 404, 'NOT_FOUND');
    const res = data as { info: HrInfoRecord | null; duplicates: HrDuplicates };
    return { eligible: hrEligible(rec as Record<string, unknown>), info: res.info, duplicates: res.duplicates || NO_DUP };
  },
  async saveHrInfo(candidateId: number, data: Record<string, string>, mode: 'draft' | 'submit'): Promise<{ info: HrInfoRecord; duplicates: HrDuplicates }> {
    const r = await invoke<{ info: HrInfoRecord }>('hr-info-save', { op: 'save', record_id: candidateId, mode, data }, 'Không lưu được thông tin nhân sự.');
    return { info: r.info, duplicates: await duplicates(candidateId) };
  },
  /** verified:true = xác nhận (cần đủ thông tin); false = mở lại để sửa. TA phụ trách và Admin đều làm được (PO chốt 20/11). */
  async verifyHrInfo(candidateId: number, verified: boolean): Promise<{ info: HrInfoRecord; duplicates: HrDuplicates }> {
    const r = await invoke<{ info: HrInfoRecord }>('hr-info-save', { op: 'verify', record_id: candidateId, verified }, 'Không thực hiện được.');
    return { info: r.info, duplicates: await duplicates(candidateId) };
  },
  async hrFormLink(candidateId: number): Promise<{ url: string; sends: HrFormSend[] }> {
    return invoke('hr-form', { op: 'link', record_id: candidateId }, 'Không lấy được link form.');
  },
  /** Cần tài khoản dịch vụ Google (GOOGLE_SA_JSON) – chưa cấu hình thì server báo HR_SHEET_NOT_CONFIGURED. */
  async hrFormResponse(candidateId: number): Promise<HrFormResponse> {
    return invoke('hr-form', { op: 'response', record_id: candidateId }, 'Không đọc được câu trả lời.');
  },
};

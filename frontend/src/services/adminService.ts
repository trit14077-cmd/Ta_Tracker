// M7-6: quản trị Drop-list, đề xuất giá trị, cấu hình form HR – thay các hàm tương ứng của dataService cũ (Api2.gs).
// Cùng tên hàm để DropdownAdminView chép nguyên văn. Ghi qua RPC 0020 (1 giao dịch, chỉ Admin, nhật ký như cũ);
// màn hình tự tải lại Drop-list sau mỗi thao tác (onRefresh) nên các hàm không trả cấu hình như bản cũ.
import { supabase } from '../lib/supabase.ts';
import { ApiError } from './candidateService.ts';
import { dropdownColumns } from './adminCatalog.ts';
import { HR_FORM_DEFAULT_URL, HR_SHEET_DEFAULT_ID, HR_SHEET_DEFAULT_TAB } from '../../../shared/hrFormMap.ts';

export interface DropdownRequestItem {
  id: number;
  list_key: string;
  proposed_value: string;
  parent_value: string;
  mapped_source: string;
  reason: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string;
  created_at: string;
  reviewed_at: string;
}
export interface HrFormConfig {
  form_url: string;
  sheet_id: string;
  sheet_tab: string;
}

async function rpc(fn: string, args: Record<string, unknown>, fallback: string): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const status = /^PT\d{3}$/.test(error.code || '') ? Number(error.code!.slice(2)) : 500;
    throw new ApiError(status === 500 ? fallback : error.details || error.message || fallback, status, error.message || 'ERROR');
  }
  return data;
}

export const adminService = {
  async addDropdownOption(params: { listKey: string; value: string; mappedSource?: string; parentValue?: string }): Promise<void> {
    await rpc('dd_add_option', { p_list: params.listKey, p_value: params.value, p_mapped_source: params.mappedSource || '', p_parent: params.parentValue || '' }, 'Không thêm được tùy chọn.');
  },
  /** Đổi tên (đổi luôn trên mọi hồ sơ đang dùng giá trị cũ) và/hoặc bật-tắt. */
  async updateDropdownOption(params: { listKey: string; oldValue: string; newValue?: string; active?: boolean }): Promise<void> {
    await rpc('dd_update_option', {
      p_list: params.listKey, p_old: params.oldValue, p_new: params.newValue ?? null, p_active: params.active ?? null,
      p_columns: dropdownColumns(params.listKey),
    }, 'Không cập nhật được tùy chọn.');
  },
  async updateSubSourceMapping(mapping: Record<string, string>): Promise<void> {
    await rpc('dd_set_sub_source_map', { p_mapping: mapping }, 'Không lưu được bảng ánh xạ.');
  },
  async updateHierarchyMapping(params: { regionToLocations?: Record<string, string[]>; locationToSites?: Record<string, string[]> }): Promise<void> {
    await rpc('dd_set_hierarchy', { p_region_to_locations: params.regionToLocations ?? null, p_location_to_sites: params.locationToSites ?? null }, 'Không lưu được phân cấp.');
  },
  /** Admin: mọi đề xuất (200 mới nhất); TA: đề xuất của mình (RLS ddreq_read). */
  async listDropdownRequests(): Promise<DropdownRequestItem[]> {
    const { data, error } = await supabase.from('dropdown_requests').select('*').order('id', { ascending: false }).limit(200);
    if (error) throw new ApiError('Không tải được danh sách đề xuất.', 500, error.code || 'ERROR');
    const ids = [...new Set((data ?? []).flatMap((r) => [r.requested_by, r.reviewed_by]).filter(Boolean))] as string[];
    const { data: users } = ids.length ? await supabase.from('profiles').select('id, username').in('id', ids) : { data: [] };
    const name = new Map((users ?? []).map((u) => [u.id as string, u.username as string]));
    return (data ?? []).map((r) => ({
      id: Number(r.id), list_key: r.list_key, proposed_value: r.proposed_value, parent_value: r.parent_value || '',
      mapped_source: r.mapped_source || '', reason: r.reason || '', requested_by: name.get(r.requested_by) || '',
      status: r.status, reviewed_by: name.get(r.reviewed_by) || '', created_at: r.created_at || '', reviewed_at: r.reviewed_at || '',
    }));
  },
  async reviewDropdownRequest(id: number, status: 'approved' | 'rejected'): Promise<void> {
    await rpc('dd_review_request', { p_id: id, p_status: status }, 'Không duyệt được đề xuất.');
  },

  // ---------------- cấu hình form HR (hệ cũ: màn Workspace – đã bỏ theo D-09; nay ở trang Drop-list)
  async getHrFormConfig(): Promise<HrFormConfig> {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'hr_form').maybeSingle();
    const v = (data?.value || {}) as Partial<HrFormConfig>;
    return { form_url: v.form_url || HR_FORM_DEFAULT_URL, sheet_id: v.sheet_id || HR_SHEET_DEFAULT_ID, sheet_tab: v.sheet_tab || HR_SHEET_DEFAULT_TAB };
  },
  /** = hPutHrFormCfg_: kiểm link Google Form, nhận cả link sheet (lấy ID). Chỉ Admin (RLS as_admin_write). */
  async putHrFormConfig(cfg: HrFormConfig): Promise<HrFormConfig> {
    const url = String(cfg.form_url || '').trim();
    let id = String(cfg.sheet_id || '').trim();
    const tab = String(cfg.sheet_tab || '').trim();
    const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(id);
    if (m) id = m[1];
    if (!/^https:\/\/docs\.google\.com\/forms\//.test(url)) throw new ApiError('Link form phải là link Google Form (https://docs.google.com/forms/...).', 400, 'INVALID_INPUT');
    if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new ApiError('ID sheet trả lời không hợp lệ.', 400, 'INVALID_INPUT');
    const value: HrFormConfig = { form_url: url, sheet_id: id, sheet_tab: tab || HR_SHEET_DEFAULT_TAB };
    const { error } = await supabase.from('app_settings').upsert({ key: 'hr_form', value, sensitive: true, updated_at: new Date().toISOString() });
    if (error) throw new ApiError(error.code === '42501' ? 'Chỉ Admin được đổi cấu hình.' : 'Không lưu được cấu hình.', 403, error.code || 'ERROR');
    return value;
  },
};

// Quản lý tài khoản (M3-3). Đọc profiles qua PostgREST (RLS: Admin thấy tất cả); ghi qua Edge admin-users.
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from './authService.ts';

async function callAdminUsers(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // Lỗi HTTP của function: lấy thông điệp tiếng Việt trong {error:{message}}
    let msg = 'Thao tác không thành công.';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const j = await ctx.json();
        msg = j?.error?.message || msg;
      } catch {
        // giữ thông điệp mặc định
      }
    }
    throw new Error(msg);
  }
  return (data ?? {}) as Record<string, unknown>;
}

export const userAdminService = {
  async listUsers(): Promise<UserProfile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, full_name, role, pic_code, active, can_view_all_targets')
      .order('username');
    if (error) throw new Error('Không tải được danh sách tài khoản.');
    return (data ?? []) as UserProfile[];
  },

  async listPicCodes(): Promise<string[]> {
    const { data, error } = await supabase.from('pics').select('code').eq('active', true).order('sort_order').order('code');
    if (error) throw new Error('Không tải được danh mục PIC.');
    return (data ?? []).map((p) => p.code as string);
  },

  createUser(u: { username: string; password: string; role: 'admin' | 'pic'; pic_code: string; full_name: string }) {
    return callAdminUsers({ op: 'create', username: u.username, temp_password: u.password, role: u.role, pic_code: u.pic_code, full_name: u.full_name });
  },

  updateUser(id: string, changes: { active?: boolean; pic_code?: string | null; role?: 'admin' | 'pic'; full_name?: string; can_view_all_targets?: boolean }) {
    return callAdminUsers({ op: 'update', id, ...changes });
  },

  /** Admin: tạo sẵn thư mục Drive cho từng TA, Intern và Nhật ký (Edge files, op ensure_folders). */
  async ensureDriveFolders(): Promise<string[]> {
    const { data, error } = await supabase.functions.invoke('files', { body: { op: 'ensure_folders' } });
    if (error) throw new Error('Không tạo được thư mục Drive. Kiểm tra cấu hình Google Drive rồi thử lại.');
    return ((data as { folders?: string[] })?.folders ?? []);
  },

  resetPassword(id: string, password: string) {
    return callAdminUsers({ op: 'reset_password', id, temp_password: password });
  },
};

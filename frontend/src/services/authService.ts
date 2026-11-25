// Đăng nhập / phiên / đổi mật khẩu bằng Supabase Auth (M3-1). Thay cho dataService.login/logout/getMe/changePassword.
// Người dùng gõ USERNAME như hệ cũ; email nội bộ (D-05b) được ghép ở đây, người dùng không thấy.
import { supabase } from '../lib/supabase.ts';
import { PASSWORD_MIN, usernameToEmail } from '../../../supabase/functions/admin-users/logic.ts';

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  role: 'admin' | 'pic';
  pic_code: string | null;
  active: boolean;
  can_view_all_targets: boolean;
  /** PIC được ủy quyền xem/sửa (pic_delegations). Rỗng với tài khoản thường. */
  managed_pics?: string[];
  /** Được tạo/quản lý tài khoản Intern (chỉ nhóm TA quản lý). */
  can_create_interns?: boolean;
}

const PROFILE_COLS = 'id, username, full_name, role, pic_code, active, can_view_all_targets';

/** Có quyền sửa hồ sơ của PIC này không: Admin, PIC của chính mình, hoặc PIC được ủy quyền. */
export function canEditPic(user: Pick<UserProfile, 'role' | 'pic_code' | 'managed_pics'>, pic: unknown): boolean {
  if (user.role === 'admin') return true;
  const p = String(pic ?? '');
  if (!p || !user.pic_code) return false;
  return p === user.pic_code || (user.managed_pics ?? []).includes(p);
}

function authMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Sai tên đăng nhập hoặc mật khẩu.';
  if (m.includes('banned')) return 'Tài khoản đã bị khóa. Vui lòng liên hệ Admin.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ít phút.';
  if (m.includes('fetch') || m.includes('network')) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  return raw || 'Đăng nhập thất bại.';
}

async function loadProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle();
  if (error) throw new Error('Không đọc được thông tin tài khoản.');
  if (!data || !data.active) {
    await supabase.auth.signOut();
    throw new Error('Tài khoản đã bị khóa hoặc chưa được cấp quyền. Vui lòng liên hệ Admin.');
  }
  const profile = data as UserProfile;
  if (profile.role === 'pic' && profile.pic_code) {
    // RLS pd_read: chỉ thấy dòng của chính mình. Lỗi đọc => coi như không có ủy quyền (không chặn đăng nhập).
    const { data: dg } = await supabase.from('pic_delegations').select('managed_pic, can_create_interns').eq('manager_pic', profile.pic_code);
    profile.managed_pics = (dg ?? []).map((d) => d.managed_pic as string);
    profile.can_create_interns = (dg ?? []).some((d) => d.can_create_interns);
  }
  return profile;
}

export const authService = {
  /** Phiên đang có trong trình duyệt (mở lại tab) – null nếu chưa đăng nhập. */
  async getMe(): Promise<UserProfile | null> {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    return uid ? loadProfile(uid) : null;
  },

  async login(username: string, password: string): Promise<UserProfile> {
    const u = username.trim();
    if (!u || !password) throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.');
    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(u), password });
    if (error || !data.user) throw new Error(authMessage(error?.message ?? ''));
    return loadProfile(data.user.id);
  },

  async logout(): Promise<void> {
    await supabase.auth.signOut();
  },

  /** Như hệ cũ: phải nhập đúng mật khẩu hiện tại. Supabase không tự kiểm, nên đăng nhập lại để xác nhận trước. */
  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < PASSWORD_MIN) throw new Error(`Mật khẩu mới phải có ít nhất ${PASSWORD_MIN} ký tự.`);
    const check = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password: currentPassword });
    if (check.error) throw new Error('Mật khẩu hiện tại không đúng.');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message.toLowerCase().includes('different') ? 'Mật khẩu mới phải khác mật khẩu hiện tại.' : 'Không thể đổi mật khẩu.');
  },

  /** Báo khi phiên hết hạn / bị đăng xuất ở tab khác. */
  onSignedOut(cb: () => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') cb();
    });
    return () => data.subscription.unsubscribe();
  },
};

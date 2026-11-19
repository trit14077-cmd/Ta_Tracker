import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Thiếu cấu hình thì báo rõ thay vì lỗi khó hiểu (xem frontend/.env.example). */
export const configError =
  !url || !key ? 'Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY trong frontend/.env.local.' : '';

// Chỉ khóa publishable/anon ở trình duyệt. Phiên tự làm mới (autoRefreshToken) và lưu trong localStorage của tab.
export const supabase = createClient(url || 'http://invalid.local', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
});

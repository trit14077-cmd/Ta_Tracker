// Chuyển từ OLD/src/components/UserAdminView.tsx (M3-3). Giữ bố cục/chữ/màu; thay dataService bằng userAdminService.
// Khác bản cũ: id là UUID (bỏ cột ID), thêm cột "Xem mọi target" (TARGET, G1), bỏ thông báo workspace (D-09),
// không cho Admin tự khóa mình (server cũng chặn: SELF_LOCKOUT).
import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, KeyRound, CheckCircle2, AlertTriangle } from 'lucide-react';
import { userAdminService } from '../services/userAdminService.ts';
import type { UserProfile } from '../services/authService.ts';

interface UserAdminViewProps {
  currentUserId: string;
  /** TA quản lý nhóm: chỉ tạo/quản lý Intern do mình tạo (không đổi role, PIC, target). */
  limited?: boolean;
}

export const UserAdminView: React.FC<UserAdminViewProps> = ({ currentUserId, limited = false }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [picOptions, setPicOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [username, setUsername] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [role, setRole] = useState<'pic' | 'admin'>('pic');
  const [picCode, setPicCode] = useState<string>('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const [resetTarget, setResetTarget] = useState<{ id: string; username: string } | null>(null);
  const [newResetPass, setNewResetPass] = useState<string>('');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [list, pics] = await Promise.all([userAdminService.listUsers(), userAdminService.listPicCodes()]);
      setUsers(limited ? list.filter((u) => u.id !== currentUserId) : list);
      setPicOptions(limited ? pics.filter((p) => /^Intern\d+-/.test(p)) : pics);
    } catch (err: unknown) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Không tải được danh sách tài khoản.' });
    } finally {
      setLoading(false);
    }
  }, [limited, currentUserId]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const run = async (fn: () => Promise<unknown>, success?: string, fallback = 'Thao tác không thành công.') => {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      if (success) setMsg({ type: 'success', text: success });
      await loadUsers();
      return true;
    } catch (err: unknown) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : fallback });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    const ok = await run(
      () => userAdminService.createUser({ username: u, password, role, pic_code: picCode, full_name: fullName.trim() || u }),
      `Đã tạo tài khoản "${u}" thành công. Người dùng đăng nhập bằng mật khẩu khởi tạo và nên tự đổi mật khẩu (nút "Đổi MK").`,
      'Không thể tạo tài khoản.',
    );
    if (ok) {
      setUsername('');
      setFullName('');
      setPassword('');
    }
  };

  const handleEnsureFolders = () =>
    run(
      async () => {
        const f = await userAdminService.ensureDriveFolders();
        setMsg({ type: 'success', text: `Đã tạo sẵn thư mục Drive: ${f.join(', ')} và "TA Tracker Nhật ký".` });
      },
      undefined,
      'Không tạo được thư mục Drive.',
    );

  const handleToggleActive = (u: UserProfile) =>
    run(() => userAdminService.updateUser(u.id, { active: !u.active }), undefined, 'Không thể cập nhật trạng thái tài khoản.');

  const handleChangePicAssignment = (u: UserProfile, newPic: string) =>
    run(() => userAdminService.updateUser(u.id, { pic_code: newPic || null }), undefined, 'Không thể cập nhật mã PIC.');

  const handleToggleTargets = (u: UserProfile) =>
    run(() => userAdminService.updateUser(u.id, { can_view_all_targets: !u.can_view_all_targets }), undefined, 'Không thể cập nhật quyền xem target.');

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || !newResetPass) return;
    const t = resetTarget;
    const ok = await run(
      () => userAdminService.resetPassword(t.id, newResetPass),
      `Đã đặt lại mật khẩu cho "${t.username}". Người dùng đăng nhập ngay bằng mật khẩu này.`,
      'Không thể đặt lại mật khẩu.',
    );
    if (ok) {
      setResetTarget(null);
      setNewResetPass('');
    }
  };

  return (
    <div className="space-y-5">
      {!limited && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Thư mục Drive: mỗi TA một thư mục theo mã PIC, Intern dùng chung, cộng "TA Tracker Nhật ký". Bấm để tạo sẵn (không đụng tới file đã có).
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={handleEnsureFolders}
            className="px-3 py-2 text-xs font-semibold bg-slate-800 text-white rounded-md disabled:opacity-50 whitespace-nowrap"
          >
            Tạo sẵn thư mục Drive
          </button>
        </div>
      )}
      {/* Create Account Form */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <span>Quản lý Tài khoản Người dùng (PIC & Admin)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tạo tài khoản cho TA / Intern (vai trò <code className="font-mono-tabular">pic</code>) và gán với mã PIC tương ứng để phân quyền chỉnh sửa hồ sơ.
          </p>
        </div>

        {msg && (
          <div
            className={`p-3 rounded-md border text-xs flex items-center gap-2 ${
              msg.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {msg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{msg.text}</span>
          </div>
        )}

        <form
          onSubmit={handleCreateUser}
          className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tên đăng nhập *
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="VD: pic01_anhnm"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Họ và tên hiển thị
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="VD: Nguyễn Minh Anh"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mật khẩu khởi tạo *
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 8 ký tự"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
            />
          </div>

          {!limited && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Vai trò (Role) *
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'pic' | 'admin')}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value="pic">PIC (TA / Intern)</option>
              <option value="admin">Admin (Quản trị viên)</option>
            </select>
          </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Gán mã PIC {role === 'pic' ? '*' : '(Tùy chọn)'}
            </label>
            <select
              value={picCode}
              onChange={(e) => setPicCode(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value="">-- Chọn mã PIC --</option>
              {picOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Tạo tài khoản</span>
            </button>
          </div>
        </form>
      </div>

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-amber-900 font-medium">
            Đặt lại mật khẩu mới cho tài khoản <strong>{resetTarget.username}</strong>:
          </div>
          <form onSubmit={handleResetPassword} className="flex items-center gap-2">
            <input
              type="password"
              required
              minLength={8}
              value={newResetPass}
              onChange={(e) => setNewResetPass(e.target.value)}
              placeholder="Mật khẩu mới (Tối thiểu 8 ký tự)"
              className="px-3 py-1.5 text-xs bg-white border border-amber-300 rounded"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 rounded hover:bg-amber-700 disabled:opacity-50"
            >
              Xác nhận đặt lại
            </button>
            <button
              type="button"
              onClick={() => {
                setResetTarget(null);
                setNewResetPass('');
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded"
            >
              Hủy
            </button>
          </form>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
              <th className="py-2.5 px-4">Tên đăng nhập</th>
              <th className="py-2.5 px-4">Họ và tên</th>
              <th className="py-2.5 px-4">Vai trò</th>
              <th className="py-2.5 px-4">Mã PIC được gán</th>
              <th className="py-2.5 px-4" title="TA được xem target của mọi TA (Admin luôn xem được)">Xem mọi target</th>
              <th className="py-2.5 px-4">Trạng thái</th>
              <th className="py-2.5 px-4 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  Đang tải danh sách tài khoản...
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono-tabular font-semibold text-slate-900" data-no-i18n>
                      {u.username}
                      {isSelf && <span className="ml-1.5 text-[10px] font-normal text-slate-500">(bạn)</span>}
                    </td>
                    <td className="py-2.5 px-4" data-no-i18n>{u.full_name}</td>
                    <td className="py-2.5 px-4 uppercase font-mono-tabular font-semibold">
                      {u.role === 'admin' ? (
                        <span className="text-blue-700">ADMIN</span>
                      ) : (
                        <span className="text-slate-700">PIC</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {limited ? (
                        <span className="font-mono-tabular" data-no-i18n>{u.pic_code}</span>
                      ) : (
                      <select
                        value={u.pic_code || ''}
                        disabled={busy}
                        onChange={(e) => handleChangePicAssignment(u, e.target.value)}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="">-- Chưa gán PIC --</option>
                        {picOptions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {limited ? (
                        <span className="text-slate-400">—</span>
                      ) : u.role === 'admin' ? (
                        <span className="text-slate-400">Luôn xem</span>
                      ) : (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={u.can_view_all_targets}
                            disabled={busy}
                            onChange={() => handleToggleTargets(u)}
                          />
                          <span>{u.can_view_all_targets ? 'Có' : 'Không'}</span>
                        </label>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {u.active ? (
                        <span className="text-emerald-700 font-semibold">Đang hoạt động</span>
                      ) : (
                        <span className="text-red-600 font-semibold">Đã khóa</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setResetTarget({ id: u.id, username: u.username })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>Đặt lại MK</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy || isSelf}
                        title={isSelf ? 'Không thể tự khóa tài khoản của chính mình' : undefined}
                        onClick={() => handleToggleActive(u)}
                        className={`px-2.5 py-1 text-xs font-medium rounded disabled:opacity-40 ${
                          u.active
                            ? 'text-red-700 bg-red-50 hover:bg-red-100'
                            : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        {u.active ? 'Khóa TK' : 'Mở khóa'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  FileSpreadsheet,
  BarChart3,
  ListFilter,
  History,
  ShieldCheck,
  Search,
  LogOut,
  KeyRound,
  Lock,
  AlertTriangle,
  PlusCircle,
} from 'lucide-react';
import {
  dataService,
  UserProfile,
  DropdownDataResponse,
  CandidateRecord,
} from './services/dataService.ts';
import { CandidateTableView } from './components/CandidateTableView.tsx';
import { CandidateFormView } from './components/CandidateFormView.tsx';
import { ImportExcelView } from './components/ImportExcelView.tsx';
import { FunnelReportView } from './components/FunnelReportView.tsx';
import { DropdownAdminView } from './components/DropdownAdminView.tsx';
import { AuditLogView } from './components/AuditLogView.tsx';
import { UserAdminView } from './components/UserAdminView.tsx';
import { ProposeDropdownModal } from './components/ProposeDropdownModal.tsx';

type NavTab =
  | 'candidates'
  | 'new_candidate'
  | 'import_excel'
  | 'reports'
  | 'droplist'
  | 'audit'
  | 'users';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [dropdowns, setDropdowns] = useState<DropdownDataResponse | null>(null);

  // Login form state
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [loggingIn, setLoggingIn] = useState<boolean>(false);

  // Change password modal / first-login screen state
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false);
  const [currPass, setCurrPass] = useState<string>('');
  const [newPass, setNewPass] = useState<string>('');
  const [confirmPass, setConfirmPass] = useState<string>('');
  const [passError, setPassError] = useState<string>('');
  const [changingPass, setChangingPass] = useState<boolean>(false);

  // Navigation & active workspace state
  const [activeTab, setActiveTab] = useState<NavTab>('candidates');
  const [editingCandidate, setEditingCandidate] = useState<CandidateRecord | null>(null);
  const [globalSearch, setGlobalSearch] = useState<string>('');

  // Unsaved form guard state (no window.confirm)
  const [formIsDirty, setFormIsDirty] = useState<boolean>(false);
  const [pendingNav, setPendingNav] = useState<{
    tab: NavTab;
    candidate?: CandidateRecord | null;
  } | null>(null);

  // Propose new dropdown option modal for PICs
  const [showProposeModal, setShowProposeModal] = useState<boolean>(false);

  const loadDropdowns = useCallback(async () => {
    try {
      const data = await dataService.getDropdowns();
      setDropdowns(data);
    } catch {
      // ignore if unauthenticated
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await dataService.getMe();
        setUser(me);
        await loadDropdowns();
      } catch {
        setUser(null);
      } finally {
        setAuthChecking(false);
      }
    })();
  }, [loadDropdowns]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const me = await dataService.login(loginUsername.trim(), loginPassword);
      setUser(me);
      setLoginPassword('');
      await loadDropdowns();
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await dataService.logout();
    setUser(null);
    setDropdowns(null);
    setEditingCandidate(null);
    setFormIsDirty(false);
    setActiveTab('candidates');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    if (newPass.length < 8) {
      setPassError('Mật khẩu mới phải có ít nhất 8 ký tự.');
      return;
    }
    if (newPass !== confirmPass) {
      setPassError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setChangingPass(true);
    try {
      await dataService.changePassword(currPass, newPass);
      setUser((prev) => (prev ? { ...prev, must_change_password: false } : null));
      setShowPasswordModal(false);
      setCurrPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err: unknown) {
      setPassError(err instanceof Error ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setChangingPass(false);
    }
  };

  const requestNavigate = (targetTab: NavTab, candidateToEdit: CandidateRecord | null = null) => {
    if (activeTab === 'new_candidate' && formIsDirty) {
      setPendingNav({ tab: targetTab, candidate: candidateToEdit });
      return;
    }
    setEditingCandidate(candidateToEdit);
    setActiveTab(targetTab);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
        Đang khởi tạo phiên làm việc TA TRACKER...
      </div>
    );
  }

  // 1. Unauthenticated Login Screen
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-w-md w-full overflow-hidden">
          <div className="px-6 py-5 bg-slate-900 text-white">
            <h1 className="text-lg font-bold tracking-tight">TA TRACKER</h1>
            <p className="text-xs text-slate-300 mt-1">
              Hệ thống Quản lý & Theo dõi Ứng viên Tuyển dụng Nội bộ (LAN)
            </p>
          </div>

          <form onSubmit={handleLogin} className="p-6 space-y-4">
            {loginError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên đăng nhập
              </label>
              <input
                type="text"
                required
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder="Nhập tên đăng nhập..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mật khẩu
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Nhập mật khẩu..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-md transition-colors disabled:opacity-50"
            >
              {loggingIn ? 'Đang xác thực...' : 'Đăng nhập hệ thống'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 2. Mandatory First-Login Password Change Screen
  if (user.must_change_password) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-w-md w-full overflow-hidden">
          <div className="px-6 py-5 bg-amber-600 text-white flex items-center gap-3">
            <Lock className="w-5 h-5 shrink-0" />
            <div>
              <h2 className="text-base font-bold">Yêu cầu đổi mật khẩu lần đầu</h2>
              <p className="text-xs text-amber-100 mt-0.5">
                Xin chào {user.username}, vui lòng đặt mật khẩu mới để kích hoạt phiên làm việc.
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="p-6 space-y-4">
            {passError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {passError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mật khẩu hiện tại
              </label>
              <input
                type="password"
                required
                value={currPass}
                onChange={(e) => setCurrPass(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mật khẩu mới (Tối thiểu 8 ký tự)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nhập lại mật khẩu mới
              </label>
              <input
                type="password"
                required
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleLogout}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Đăng xuất
              </button>
              <button
                type="submit"
                disabled={changingPass}
                className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {changingPass ? 'Đang cập nhật...' : 'Lưu mật khẩu mới'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.FC<{ className?: string }>;
    adminOnly?: boolean;
  }[] = [
    { id: 'candidates', label: 'Ứng viên', icon: Users },
    { id: 'new_candidate', label: 'Nhập mới', icon: UserPlus },
    { id: 'import_excel', label: 'Nhập Excel', icon: FileSpreadsheet, adminOnly: true },
    { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
    { id: 'droplist', label: 'Drop-list', icon: ListFilter, adminOnly: true },
    { id: 'audit', label: 'Nhật ký', icon: History },
    { id: 'users', label: 'Tài khoản', icon: ShieldCheck, adminOnly: true },
  ];

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user.role === 'admin');

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Left Sidebar Navigation */}
      <aside className="w-60 shrink-0 bg-slate-900 text-slate-200 flex flex-col border-r border-slate-800">
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800">
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
            TA TRACKER
          </span>
          <span className="text-[11px] font-mono-tabular text-slate-400">61 Trường</span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              activeTab === item.id &&
              !(item.id === 'new_candidate' && editingCandidate !== null);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => requestNavigate(item.id, null)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}

          {user.role === 'pic' && dropdowns && (
            <div className="pt-4 mt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowProposeModal(true)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-md text-xs font-medium text-blue-300 hover:bg-slate-800 transition-colors"
              >
                <PlusCircle className="w-4 h-4 shrink-0" />
                <span>Đề xuất thêm Drop-list</span>
              </button>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs text-slate-400 space-y-1">
          <div className="text-slate-200 font-semibold truncate">{user.full_name || user.username}</div>
          <div className="truncate">
            Vai trò: <span className="uppercase font-mono-tabular text-slate-300">{user.role}</span>
          </div>
          {user.pic_code && (
            <div className="truncate text-blue-300 font-mono-tabular">{user.pic_code}</div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Quick search, current user, logout */}
        <header className="h-14 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 shrink-0">
          {/* Zone 1: Current View Title */}
          <div className="text-sm font-bold text-slate-900 whitespace-nowrap shrink-0">
            {activeTab === 'candidates' && 'Danh sách Ứng viên'}
            {activeTab === 'new_candidate' &&
              (editingCandidate ? 'Cập nhật Hồ sơ Ứng viên' : 'Nhập Hồ sơ Ứng viên Mới')}
            {activeTab === 'import_excel' && 'Nhập dữ liệu Excel / CSV'}
            {activeTab === 'reports' && 'Báo cáo Phễu Tuyển dụng'}
            {activeTab === 'droplist' && 'Quản trị Danh mục Drop-list'}
            {activeTab === 'audit' && 'Nhật ký Thay đổi (Audit Log)'}
            {activeTab === 'users' && 'Quản trị Tài khoản Người dùng'}
          </div>

          {/* Zone 2: Quick Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  setGlobalSearch(val);
                  if (activeTab !== 'candidates') {
                    requestNavigate('candidates', null);
                  }
                }}
                placeholder="Tìm nhanh mã ứng viên, họ tên hoặc SĐT..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          {/* Zone 3: Current User & Logout */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="text-xs text-slate-600 whitespace-nowrap">
              <strong className="text-slate-900">{user.username}</strong>
              <span className="mx-1.5">·</span>
              <span>{user.role === 'admin' ? 'Admin' : user.pic_code || 'PIC'}</span>
            </div>

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              title="Đổi mật khẩu"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Đổi MK</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-6 overflow-y-auto">
          {!dropdowns ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Đang tải cấu hình danh mục...
            </div>
          ) : (
            <>
              {activeTab === 'candidates' && (
                <CandidateTableView
                  user={user}
                  dropdowns={dropdowns}
                  globalSearch={globalSearch}
                  onCreateNew={() => requestNavigate('new_candidate', null)}
                  onEditCandidate={(cand) => requestNavigate('new_candidate', cand)}
                />
              )}

              {activeTab === 'new_candidate' && (
                <CandidateFormView
                  user={user}
                  dropdowns={dropdowns}
                  editingCandidate={editingCandidate}
                  onDirtyChange={setFormIsDirty}
                  onSaved={(_cand, stayForNext) => {
                    if (!stayForNext) {
                      setEditingCandidate(null);
                      setActiveTab('candidates');
                    }
                  }}
                  onCancel={() => requestNavigate('candidates', null)}
                  onRefreshDropdowns={loadDropdowns}
                />
              )}

              {activeTab === 'import_excel' && user.role === 'admin' && (
                <ImportExcelView onImportSuccess={() => {}} />
              )}

              {activeTab === 'reports' && <FunnelReportView dropdowns={dropdowns} />}

              {activeTab === 'droplist' && user.role === 'admin' && (
                <DropdownAdminView dropdowns={dropdowns} onRefresh={loadDropdowns} />
              )}

              {activeTab === 'audit' && <AuditLogView />}

              {activeTab === 'users' && user.role === 'admin' && (
                <UserAdminView dropdowns={dropdowns} />
              )}
            </>
          )}
        </main>
      </div>

      {/* Unsaved Form Navigation Guard Modal */}
      {pendingNav && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Cảnh báo: Biểu mẫu chưa được lưu
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Bạn đang có dữ liệu nhập dở trên biểu mẫu ứng viên. Nếu rời đi ngay bây giờ, các thay đổi chưa lưu sẽ bị mất.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingNav(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200"
              >
                Ở lại biểu mẫu
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = pendingNav;
                  setPendingNav(null);
                  setFormIsDirty(false);
                  setEditingCandidate(target.candidate ?? null);
                  setActiveTab(target.tab);
                }}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Rời đi và hủy thay đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voluntary Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Đổi mật khẩu cá nhân</h3>
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                className="text-slate-400 hover:text-slate-700 text-xs"
              >
                Đóng
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="p-5 space-y-4">
              {passError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                  {passError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu hiện tại
                </label>
                <input
                  type="password"
                  required
                  value={currPass}
                  onChange={(e) => setCurrPass(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mật khẩu mới (Tối thiểu 8 ký tự)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Xác nhận mật khẩu mới
                </label>
                <input
                  type="password"
                  required
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-md"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={changingPass}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
                >
                  {changingPass ? 'Đang lưu...' : 'Cập nhật mật khẩu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Propose New Dropdown Value Modal for PIC */}
      {showProposeModal && dropdowns && (
        <ProposeDropdownModal
          dropdowns={dropdowns}
          onClose={() => setShowProposeModal(false)}
          onSuccess={loadDropdowns}
        />
      )}
    </div>
  );
}

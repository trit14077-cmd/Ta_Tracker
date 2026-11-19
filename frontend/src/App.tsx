// Chuyển từ OLD/src/App.tsx (M3-1): màn hình đăng nhập, khung (thanh menu kéo được, header), hộp đổi mật khẩu.
// Giữ chữ/màu/bố cục cũ. Thay dataService (Apps Script) bằng authService (Supabase Auth). Các màn hình chưa chuyển
// (M4+) vẫn hiện trong menu nhưng bị làm mờ, để người dùng quen vị trí. Bỏ: Workspace (D-09), tìm nhanh (cần M4-3).
import React, { useState, useEffect } from 'react';
import { LangSwitch } from './i18n.tsx';
import {
  Users, FileSpreadsheet, BarChart3, ListFilter, History, ShieldCheck, LogOut, KeyRound, AlertTriangle,
  ClipboardCheck, ChevronsLeft, ChevronsRight, ListTodo, CalendarDays, Target, Construction, Table2, SquareKanban, Search,
} from 'lucide-react';
import logoUrl from './assets/the-supra-logo.png';
import { authService, type UserProfile } from './services/authService.ts';
import { configError } from './lib/supabase.ts';
import { UserAdminView } from './components/UserAdminView.tsx';
import { CandidateTableView } from './components/CandidateTableView.tsx';
import { OverviewDashboard } from './components/OverviewDashboard.tsx';
import { FollowWdView } from './components/FollowWdView.tsx';
import { KanbanBoardView } from './components/KanbanBoardView.tsx';
import { CandidateFormView } from './components/CandidateFormView.tsx';
import { CandidateDetailModal } from './components/CandidateDetailModal.tsx';
import { TasksView } from './components/TasksView.tsx';
import { CalendarView } from './components/CalendarView.tsx';
import { TargetsView } from './components/TargetsView.tsx';
import { candidateService, type CandidateRecord, type DropdownDataResponse } from './services/candidateService.ts';

type NavTab = 'candidates' | 'tasks' | 'calendar' | 'targets' | 'import_excel' | 'reports' | 'follow_wd' | 'droplist' | 'audit' | 'users';

const SIDEBAR_MIN = 68; // icons only
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MAX = 340;
const clampSidebar = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

const TITLES: Record<NavTab, string> = {
  candidates: 'Danh sách Ứng viên',
  tasks: 'Công việc',
  calendar: 'Lịch tuyển dụng',
  targets: 'Target theo kỳ',
  import_excel: 'Nhập dữ liệu Excel / CSV',
  reports: 'Báo cáo tuyển dụng theo TA',
  follow_wd: 'Follow WD: theo dõi nhân sự đã Joined',
  droplist: 'Quản trị Danh mục Drop-list',
  audit: 'Nhật ký Thay đổi (Audit Log)',
  users: 'Quản trị Tài khoản Người dùng',
};
// Màn hình đã chuyển sang hệ mới. Các mục khác hiện mờ cho tới khi chuyển xong (IMPLEMENTATION_TASKS M4–M7).
const READY: NavTab[] = ['users', 'candidates', 'tasks', 'calendar', 'targets', 'reports', 'follow_wd'];

export default function App() {
  const [sidebarW, setSidebarW] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('ta_sidebar_w'));
      return v ? clampSidebar(v) : SIDEBAR_DEFAULT;
    } catch {
      return SIDEBAR_DEFAULT;
    }
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const sidebarCollapsed = sidebarW <= 110;
  const saveSidebarW = (w: number) => {
    try {
      localStorage.setItem('ta_sidebar_w', String(w));
    } catch {
      // storage may be blocked; the width just is not remembered
    }
  };
  const startSidebarDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setSidebarDragging(true);
    const move = (ev: PointerEvent) => setSidebarW(ev.clientX < 120 ? SIDEBAR_MIN : clampSidebar(ev.clientX));
    const up = (ev: PointerEvent) => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      setSidebarDragging(false);
      saveSidebarW(ev.clientX < 120 ? SIDEBAR_MIN : clampSidebar(ev.clientX));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  const toggleSidebar = () => {
    const w = sidebarCollapsed ? SIDEBAR_DEFAULT : SIDEBAR_MIN;
    setSidebarW(w);
    saveSidebarW(w);
  };

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [startupError, setStartupError] = useState<string>('');

  const [dropdowns, setDropdowns] = useState<DropdownDataResponse>({
    lists: {},
    pics: [],
    subSourceMapping: {},
    regionToLocations: {},
    locationToSites: {},
  });
  const loadDropdowns = async () => {
    try {
      const dd = await candidateService.getDropdowns();
      setDropdowns(dd);
    } catch {
      // fallback
    }
  };
  useEffect(() => {
    if (user) loadDropdowns();
  }, [user]);

  // Login form state
  const [loginUsername, setLoginUsername] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [loggingIn, setLoggingIn] = useState<boolean>(false);

  // Change password modal state
  const [showPasswordModal, setShowPasswordModal] = useState<boolean>(false);
  const [currPass, setCurrPass] = useState<string>('');
  const [newPass, setNewPass] = useState<string>('');
  const [confirmPass, setConfirmPass] = useState<string>('');
  const [passError, setPassError] = useState<string>('');
  const [passDone, setPassDone] = useState<boolean>(false);
  const [changingPass, setChangingPass] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<NavTab>('users');
  // Danh sách ứng viên: kiểu xem Bảng / Kanban (nhớ trong trình duyệt như hệ cũ, khóa 'supra.candidateView').
  const [candView, setCandView] = useState<'table' | 'kanban'>(() => {
    try {
      return localStorage.getItem('supra.candidateView') === 'kanban' ? 'kanban' : 'table';
    } catch {
      return 'table';
    }
  });
  const chooseCandView = (v: 'table' | 'kanban') => {
    setCandView(v);
    try {
      localStorage.setItem('supra.candidateView', v);
    } catch {
      // storage may be blocked; the choice just is not remembered
    }
  };
  const showKanban = candView === 'kanban';
  // Kanban: ô tìm (hệ cũ dùng ô tìm trên thanh đầu trang), form sửa hồ sơ mở từ thẻ, khóa để tải lại sau khi lưu.
  const [kanbanSearch, setKanbanSearch] = useState('');
  const [kanbanKey, setKanbanKey] = useState(0);
  const [kanbanForm, setKanbanForm] = useState<CandidateRecord | null>(null);
  const [kanbanFormDirty, setKanbanFormDirty] = useState(false);
  // Mở hồ sơ từ Công việc / Lịch (hệ cũ: openCandidateById): cửa sổ chi tiết, "Sửa" mở form, "Lưu trữ" như danh sách.
  const [openDetail, setOpenDetail] = useState<CandidateRecord | null>(null);
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState('');
  const openCandidateById = async (id: number) => {
    if (!id) return;
    try {
      setOpenError('');
      setOpenDetail(await candidateService.getCandidate(id));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Không mở được hồ sơ.');
    }
  };
  const closeKanbanForm = () => {
    if (kanbanFormDirty && !window.confirm('Có thay đổi chưa lưu. Đóng cửa sổ và bỏ các thay đổi?')) return;
    setKanbanFormDirty(false);
    setKanbanForm(null);
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await authService.getMe();
        setUser(me);
        if (me) setActiveTab(me.role === 'admin' ? 'users' : 'candidates');
      } catch (err: unknown) {
        setUser(null);
        setStartupError(err instanceof Error ? err.message : '');
      } finally {
        setAuthChecking(false);
      }
    })();
    // Phiên hết hạn / đăng xuất ở tab khác => về màn hình đăng nhập
    return authService.onSignedOut(() => setUser(null));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setStartupError('');
    setLoggingIn(true);
    try {
      const me = await authService.login(loginUsername.trim(), loginPassword);
      setUser(me);
      setActiveTab(me.role === 'admin' ? 'users' : 'candidates');
      setLoginPassword('');
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
    setActiveTab('users');
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
    if (!user) return;
    setChangingPass(true);
    try {
      await authService.changePassword(user.username, currPass, newPass);
      setPassDone(true);
      setCurrPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err: unknown) {
      setPassError(err instanceof Error ? err.message : 'Không thể đổi mật khẩu.');
    } finally {
      setChangingPass(false);
    }
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPassError('');
    setPassDone(false);
    setCurrPass('');
    setNewPass('');
    setConfirmPass('');
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
        Đang khởi tạo phiên làm việc THE SUPRA - RECRUITMENT...
      </div>
    );
  }

  // 1. Unauthenticated Login Screen
  if (!user) {
    const shownError = configError || loginError || startupError;
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-w-md w-full overflow-hidden">
          <div className="px-6 py-5 bg-slate-900 text-white relative">
            <LangSwitch className="absolute top-4 right-4 bg-white" />
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 shrink-0 rounded-lg bg-white flex items-center justify-center">
                <img src={logoUrl} alt="THE SUPRA" className="w-10 h-10 object-contain" />
              </span>
              <h1 className="text-lg font-bold tracking-tight">THE SUPRA - RECRUITMENT</h1>
            </div>
            <p className="text-xs text-slate-300 mt-1">
              Hệ thống Quản lý & Theo dõi Ứng viên Tuyển dụng Nội bộ
            </p>
          </div>

          <form onSubmit={handleLogin} className="p-6 space-y-4">
            {shownError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{shownError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Tên đăng nhập
              </label>
              <input
                type="text"
                required
                autoComplete="username"
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
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Nhập mật khẩu..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>

            <button
              type="submit"
              disabled={loggingIn || !!configError}
              className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-md transition-colors disabled:opacity-50"
            >
              {loggingIn ? 'Đang xác thực...' : 'Đăng nhập hệ thống'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const navItems: { id: NavTab; label: string; icon: React.FC<{ className?: string }>; adminOnly?: boolean }[] = [
    { id: 'candidates', label: 'Ứng viên', icon: Users },
    { id: 'tasks', label: 'Công việc', icon: ListTodo },
    { id: 'calendar', label: 'Lịch', icon: CalendarDays },
    { id: 'targets', label: 'Target', icon: Target },
    { id: 'import_excel', label: 'Nhập Excel', icon: FileSpreadsheet, adminOnly: true },
    { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
    { id: 'follow_wd', label: 'Follow WD', icon: ClipboardCheck },
    { id: 'droplist', label: 'Drop-list', icon: ListFilter, adminOnly: true },
    { id: 'audit', label: 'Nhật ký', icon: History },
    { id: 'users', label: 'Tài khoản', icon: ShieldCheck, adminOnly: true },
  ];
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || user.role === 'admin');

  return (
    <div className="min-h-screen flex bg-[#F5F8FA] text-slate-900">
      {/* Left Sidebar Navigation */}
      <aside
        style={{ width: sidebarW }}
        className={`relative shrink-0 bg-white text-slate-700 flex flex-col border-r border-[#ECEEF2] overflow-hidden ${
          sidebarDragging ? '' : 'transition-[width] duration-200 ease-out'
        }`}
      >
        <div className={`flex items-center gap-2.5 ${sidebarCollapsed ? 'flex-col py-4 px-2' : 'px-5 pt-[22px] pb-5'}`}>
          <img src={logoUrl} alt="THE SUPRA" className="w-9 h-9 shrink-0 object-contain" />
          {!sidebarCollapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <b className="block text-[13px] text-[#111827] whitespace-nowrap overflow-hidden text-ellipsis" title="THE SUPRA - RECRUITMENT">THE SUPRA - RECRUITMENT</b>
              <small className="text-[11px] text-[#6B7280] whitespace-nowrap">Quản lý tuyển dụng</small>
            </span>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Mở rộng thanh menu' : 'Thu gọn thanh menu'}
            className="w-6 h-6 shrink-0 rounded-full border border-[#ECEEF2] bg-white text-[#9CA3AF] hover:text-[#30AFFF] hover:border-[#92EEFF] flex items-center justify-center shadow-sm"
          >
            {sidebarCollapsed ? <ChevronsRight className="w-3.5 h-3.5" /> : <ChevronsLeft className="w-3.5 h-3.5" />}
          </button>
        </div>

        <nav className={`flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden ${sidebarCollapsed ? 'px-2' : 'px-3.5'}`}>
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const ready = READY.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                title={sidebarCollapsed ? item.label : ready ? undefined : 'Đang chuyển sang hệ thống mới'}
                className={`w-full flex items-center rounded-[10px] text-[13px] transition-colors whitespace-nowrap ${
                  sidebarCollapsed ? 'justify-center py-2.5' : 'gap-2.5 px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-[#E3F4FF] text-[#30AFFF] font-semibold'
                    : 'text-[#374151] font-medium hover:bg-[#F5F7FB]'
                } ${ready ? '' : 'opacity-50'}`}
              >
                <Icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-[#30AFFF]' : 'text-[#9CA3AF]'}`} />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {sidebarCollapsed ? (
          <div
            className="p-2 border-t border-[#ECEEF2] flex justify-center"
            title={`${user.full_name || user.username} · ${user.role}${user.pic_code ? ' · ' + user.pic_code : ''}`}
          >
            <span className="w-9 h-9 rounded-full bg-[#E3F4FF] text-[#30AFFF] text-xs font-bold flex items-center justify-center uppercase">
              {(user.full_name || user.username).trim().charAt(0)}
            </span>
          </div>
        ) : (
          <div className="px-5 py-4 border-t border-[#ECEEF2] text-[11.5px] text-[#6B7280] space-y-0.5 whitespace-nowrap">
            <div className="text-[#111827] text-[13px] font-semibold truncate" data-no-i18n>{user.full_name || user.username}</div>
            <div className="truncate">
              Vai trò: <span className="uppercase font-mono-tabular text-[#374151]">{user.role}</span>
            </div>
            {user.pic_code && (
              <div className="truncate text-[#30AFFF] font-mono-tabular" data-no-i18n>{user.pic_code}</div>
            )}
          </div>
        )}

        {/* Drag this edge to make the menu wider or narrower; double-click toggles it */}
        <div
          onPointerDown={startSidebarDrag}
          onDoubleClick={toggleSidebar}
          title="Kéo để đổi độ rộng, nhấp đúp để thu gọn hoặc mở rộng"
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-[#30AFFF]/60 active:bg-[#30AFFF]"
        />
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-[#ECEEF2] px-4 lg:px-6 flex items-center justify-between gap-3 lg:gap-8 shrink-0">
          <div className="text-sm font-bold text-slate-900 whitespace-nowrap min-w-0 truncate lg:shrink-0">
            {TITLES[activeTab]}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden lg:block text-xs text-slate-600 whitespace-nowrap">
              <strong className="text-slate-900" data-no-i18n>{user.username}</strong>
              <span className="mx-1.5">·</span>
              <span>{user.role === 'admin' ? 'Admin' : user.pic_code || 'PIC'}</span>
            </div>

            <LangSwitch />

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              title="Đổi mật khẩu"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Đổi MK</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Đăng xuất</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          {activeTab === 'users' && user.role === 'admin' ? (
            <UserAdminView currentUserId={user.id} />
          ) : activeTab === 'candidates' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-end gap-2">
                {showKanban && (
                  <label className="inline-flex items-center gap-1.5 h-8 px-2.5 bg-white border border-slate-200 rounded-lg shadow-sm">
                    <Search className="w-3.5 h-3.5 text-slate-400" />
                    <input
                      value={kanbanSearch}
                      onChange={(e) => setKanbanSearch(e.target.value)}
                      placeholder="Tìm mã, tên, SĐT…"
                      className="w-56 text-xs outline-none bg-transparent"
                    />
                  </label>
                )}
                <div role="tablist" aria-label="Kiểu xem danh sách ứng viên" className="inline-flex p-0.5 rounded-lg border border-slate-200 bg-white shadow-sm">
                  {([
                    ['table', 'Bảng', Table2],
                    ['kanban', 'Kanban', SquareKanban],
                  ] as const).map(([key, label, Icon]) => {
                    const on = (key === 'kanban') === showKanban;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => chooseCandView(key)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                          on ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" /> {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {showKanban ? (
                <KanbanBoardView
                  key={`kanban-${kanbanKey}`}
                  user={user}
                  dropdowns={dropdowns}
                  globalSearch={kanbanSearch}
                  onEditCandidate={(c) => setKanbanForm(c)}
                />
              ) : (
                <CandidateTableView
                  user={user}
                  dropdowns={dropdowns}
                  globalSearch=""
                  onRefreshDropdowns={loadDropdowns}
                />
              )}
            </div>
          ) : activeTab === 'tasks' ? (
            <TasksView user={user} onOpenCandidate={openCandidateById} />
          ) : activeTab === 'calendar' ? (
            <CalendarView user={user} dropdowns={dropdowns} onOpenCandidate={openCandidateById} />
          ) : activeTab === 'targets' ? (
            <TargetsView user={user} dropdowns={dropdowns} />
          ) : activeTab === 'reports' ? (
            <OverviewDashboard user={user} />
          ) : activeTab === 'follow_wd' ? (
            <FollowWdView user={user} dropdowns={dropdowns} />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-xs text-slate-600 space-y-2">
              <Construction className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-800">{TITLES[activeTab]}</div>
              <p>Màn hình này đang được chuyển sang hệ thống mới. Trong thời gian chuyển đổi, vui lòng tiếp tục dùng hệ thống cũ.</p>
            </div>
          )}
        </main>
      </div>

      {/* Form sửa hồ sơ mở từ Kanban, Công việc, Lịch */}
      {kanbanForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 p-3 sm:p-6 overflow-y-auto">
          <div className="relative w-full max-w-6xl bg-slate-50 rounded-lg shadow-xl border border-slate-200">
            <CandidateFormView
              user={user}
              dropdowns={dropdowns}
              editingCandidate={kanbanForm}
              onDirtyChange={setKanbanFormDirty}
              onSaved={() => {
                setKanbanFormDirty(false);
                setKanbanForm(null);
                setKanbanKey((k) => k + 1);
              }}
              onCancel={closeKanbanForm}
              onRefreshDropdowns={loadDropdowns}
            />
          </div>
        </div>
      )}

      {openDetail && (
        <CandidateDetailModal
          candidate={openDetail}
          user={user}
          canEdit={user.role === 'admin' || (Boolean(user.pic_code) && String(openDetail.pic) === user.pic_code)}
          busy={openBusy}
          error={openError}
          onClose={() => setOpenDetail(null)}
          onEdit={() => {
            setKanbanForm(openDetail);
            setOpenDetail(null);
          }}
          onDelete={async () => {
            const restoring = Boolean(openDetail.is_archived);
            if (!restoring && !window.confirm(`Xóa hồ sơ ${String(openDetail.candidate_code)} - ${String(openDetail.full_name)}?

Hồ sơ được chuyển vào mục lưu trữ và biến khỏi danh sách.`)) return;
            setOpenBusy(true);
            setOpenError('');
            try {
              await candidateService.toggleArchiveCandidate(openDetail.id, !restoring, openDetail.row_version);
              setOpenDetail(null);
            } catch (e) {
              setOpenError(e instanceof Error ? e.message : 'Không thể thực hiện thao tác.');
            } finally {
              setOpenBusy(false);
            }
          }}
        />
      )}

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Đổi mật khẩu cá nhân</h3>
              <button
                type="button"
                onClick={closePasswordModal}
                className="text-slate-400 hover:text-slate-700 text-xs"
              >
                Đóng
              </button>
            </div>
            {passDone ? (
              <div className="p-5 space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-900">
                  Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới.
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closePasswordModal}
                    className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            ) : (
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
                    autoComplete="current-password"
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
                    autoComplete="new-password"
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
                    autoComplete="new-password"
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closePasswordModal}
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import {
  ListFilter,
  Plus,
  Edit2,
  Check,
  X,
  GitBranch,
  Link2,
  Inbox,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  dataService,
  DropdownDataResponse,
  DropdownRequestItem,
} from '../services/dataService.ts';

interface DropdownAdminViewProps {
  dropdowns: DropdownDataResponse;
  onRefresh: () => void;
}

export const DropdownAdminView: React.FC<DropdownAdminViewProps> = ({
  dropdowns,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'lists' | 'sub_source' | 'hierarchy' | 'requests'>(
    'lists'
  );
  const [selectedListKey, setSelectedListKey] = useState<string>('position');
  const [newOptionValue, setNewOptionValue] = useState<string>('');
  const [newOptionParent, setNewOptionParent] = useState<string>('');
  const [newOptionSource, setNewOptionSource] = useState<string>('');
  const [renamingOption, setRenamingOption] = useState<{
    oldValue: string;
    newValue: string;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>('');

  // Sub_Source -> Source draft state
  const [subMapDraft, setSubMapDraft] = useState<Record<string, string>>(
    dropdowns.subSourceMapping || {}
  );

  // Hierarchy draft state
  const [regionLocDraft, setRegionLocDraft] = useState<Record<string, string[]>>(
    dropdowns.regionToLocations || {}
  );
  const [locSiteDraft, setLocSiteDraft] = useState<Record<string, string[]>>(
    dropdowns.locationToSites || {}
  );

  // Requests state
  const [requests, setRequests] = useState<DropdownRequestItem[]>([]);

  useEffect(() => {
    setSubMapDraft(dropdowns.subSourceMapping || {});
    setRegionLocDraft(dropdowns.regionToLocations || {});
    setLocSiteDraft(dropdowns.locationToSites || {});
  }, [dropdowns]);

  const loadRequests = async () => {
    try {
      const list = await dataService.listDropdownRequests();
      setRequests(list);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const handleAddOption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOptionValue.trim()) return;
    await dataService.addDropdownOption({
      listKey: selectedListKey,
      value: newOptionValue.trim(),
      parentValue: newOptionParent.trim(),
      mappedSource: newOptionSource.trim(),
    });
    setNewOptionValue('');
    setNewOptionParent('');
    setNewOptionSource('');
    setStatusMsg(`Đã thêm tùy chọn "${newOptionValue.trim()}" vào danh mục.`);
    onRefresh();
  };

  const handleRenameOption = async (oldVal: string, newVal: string) => {
    if (!newVal.trim() || oldVal === newVal.trim()) {
      setRenamingOption(null);
      return;
    }
    await dataService.updateDropdownOption({
      listKey: selectedListKey,
      oldValue: oldVal,
      newValue: newVal.trim(),
    });
    setRenamingOption(null);
    setStatusMsg(`Đã đổi tên "${oldVal}" thành "${newVal.trim()}" và đồng bộ dữ liệu ứng viên.`);
    onRefresh();
  };

  const handleToggleActive = async (val: string, currentActive: boolean) => {
    await dataService.updateDropdownOption({
      listKey: selectedListKey,
      oldValue: val,
      active: !currentActive,
    });
    setStatusMsg(
      !currentActive
        ? `Đã kích hoạt lại tùy chọn "${val}".`
        : `Đã ngừng sử dụng tùy chọn "${val}" (Không xóa cứng để bảo toàn lịch sử).`
    );
    onRefresh();
  };

  const handleSaveSubSourceMap = async () => {
    await dataService.updateSubSourceMapping(subMapDraft);
    setStatusMsg('Đã lưu bảng ánh xạ Sub_Source → Source và cập nhật các hồ sơ liên quan.');
    onRefresh();
  };

  const handleSaveHierarchy = async () => {
    await dataService.updateHierarchyMapping({
      regionToLocations: regionLocDraft,
      locationToSites: locSiteDraft,
    });
    setStatusMsg('Đã lưu cấu trúc phân cấp Region → Location → Site.');
    onRefresh();
  };

  const handleReviewRequest = async (id: number, status: 'approved' | 'rejected') => {
    await dataService.reviewDropdownRequest(id, status);
    await loadRequests();
    onRefresh();
    setStatusMsg(
      status === 'approved'
        ? 'Đã phê duyệt đề xuất và tự động thêm vào danh sách Drop-list.'
        : 'Đã từ chối đề xuất.'
    );
  };

  const currentOptions = dropdowns.lists[selectedListKey] || [];
  const subSourceOptions = (dropdowns.lists.sub_source || []).map((o) => o.value);
  const regionOptions = (dropdowns.lists.region || []).filter((o) => o.active).map((o) => o.value);
  const locationOptions = (dropdowns.lists.location || [])
    .filter((o) => o.active)
    .map((o) => o.value);
  const siteOptions = (dropdowns.lists.site || []).filter((o) => o.active).map((o) => o.value);

  const pendingReqCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Header & Sub-navigation */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Quản trị Danh mục Drop-list & Ánh xạ Phụ thuộc (Admin)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Thêm mới, đổi tên hoặc ngừng sử dụng tùy chọn (không bao giờ xóa cứng dữ liệu đang dùng). Quản lý ánh xạ{' '}
            <code className="font-mono-tabular">Sub_Source → Source</code> và phân cấp{' '}
            <code className="font-mono-tabular">Region → Location → Site</code>.
          </p>
        </div>

        <div className="inline-flex items-center p-1 bg-slate-100 rounded-md border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('lists')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
              activeTab === 'lists' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" />
            <span>Danh sách tùy chọn</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sub_source')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
              activeTab === 'sub_source' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Sub_Source → Source</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hierarchy')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
              activeTab === 'hierarchy' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Region → Location → Site</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
              activeTab === 'requests' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>Đề xuất từ PIC ({pendingReqCount})</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center justify-between">
          <span>{statusMsg}</span>
          <button
            type="button"
            onClick={() => setStatusMsg('')}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* TAB 1: Manage Options per List */}
      {activeTab === 'lists' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left column: List selector */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-800">
              Chọn Danh mục Drop-list ({dropdowns.listMeta.length})
            </div>
            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {dropdowns.listMeta.map((meta) => {
                const count = (dropdowns.lists[meta.listKey] || []).length;
                const isSelected = selectedListKey === meta.listKey;
                return (
                  <button
                    key={meta.listKey}
                    type="button"
                    onClick={() => {
                      setSelectedListKey(meta.listKey);
                      setRenamingOption(null);
                    }}
                    className={`w-full px-4 py-2.5 text-left text-xs flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-blue-800 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span>{meta.label}</span>
                    <span className="font-mono-tabular text-slate-400">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right column: Options in selected list */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <form onSubmit={handleAddOption} className="flex flex-wrap items-end gap-2.5 pb-4 border-b border-slate-200">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Thêm giá trị mới vào danh mục đang chọn
                </label>
                <input
                  type="text"
                  value={newOptionValue}
                  onChange={(e) => setNewOptionValue(e.target.value)}
                  placeholder="Nhập tên tùy chọn mới..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                />
              </div>

              {selectedListKey === 'sub_source' && (
                <div className="w-48">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nguồn chính (Source)
                  </label>
                  <input
                    type="text"
                    value={newOptionSource}
                    onChange={(e) => setNewOptionSource(e.target.value)}
                    placeholder="VD: Social Media"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                </div>
              )}

              {selectedListKey === 'location' && (
                <div className="w-44">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Thuộc Vùng (Region)
                  </label>
                  <select
                    value={newOptionParent}
                    onChange={(e) => setNewOptionParent(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="">-- Chọn Vùng --</option>
                    {regionOptions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedListKey === 'site' && (
                <div className="w-44">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Thuộc Tỉnh/Thành
                  </label>
                  <select
                    value={newOptionParent}
                    onChange={(e) => setNewOptionParent(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    <option value="">-- Chọn Tỉnh/Thành --</option>
                    {locationOptions.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm tùy chọn</span>
              </button>
            </form>

            <div className="overflow-x-auto max-h-[440px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Giá trị tùy chọn</th>
                    <th className="py-2.5 px-3 w-36">Trạng thái</th>
                    <th className="py-2.5 px-3 w-48 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {currentOptions.map((opt) => {
                    const isRenaming = renamingOption?.oldValue === opt.value;
                    return (
                      <tr key={opt.value} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {isRenaming ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={renamingOption.newValue}
                                onChange={(e) =>
                                  setRenamingOption({
                                    oldValue: opt.value,
                                    newValue: e.target.value,
                                  })
                                }
                                className="px-2 py-1 text-xs border border-blue-500 rounded w-64"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleRenameOption(opt.value, renamingOption.newValue)
                                }
                                className="p-1 bg-blue-600 text-white rounded"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setRenamingOption(null)}
                                className="p-1 bg-slate-200 text-slate-600 rounded"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className={!opt.active ? 'line-through text-slate-400' : ''}>
                              {opt.value}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {opt.active ? (
                            <span className="text-emerald-700 font-semibold">Đang hoạt động</span>
                          ) : (
                            <span className="text-slate-400">Ngừng sử dụng</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRenamingOption({ oldValue: opt.value, newValue: opt.value })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded hover:bg-slate-200"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Đổi tên</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(opt.value, opt.active)}
                            className={`px-2.5 py-1 text-xs font-medium rounded ${
                              opt.active
                                ? 'text-amber-800 bg-amber-50 hover:bg-amber-100'
                                : 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100'
                            }`}
                          >
                            {opt.active ? 'Vô hiệu hóa' : 'Kích hoạt'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Sub_Source -> Source Mapping */}
      {activeTab === 'sub_source' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Bảng ánh xạ Nguồn chi tiết (Sub_Source) → Nguồn chính (Source)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Trường <code className="font-mono-tabular">source</code> trên hồ sơ ứng viên là trường chỉ đọc và tự động lấy theo bảng này.
              </p>
            </div>
            <button
              type="button"
              onClick={handleSaveSubSourceMap}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
            >
              Lưu bảng ánh xạ Source
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {subSourceOptions.map((sub) => (
              <div
                key={sub}
                className="p-3 border border-slate-200 rounded-md flex items-center justify-between gap-3 bg-slate-50/50"
              >
                <span className="text-xs font-semibold text-slate-800 truncate">{sub}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400">→</span>
                  <input
                    type="text"
                    value={subMapDraft[sub] || ''}
                    onChange={(e) =>
                      setSubMapDraft((prev) => ({ ...prev, [sub]: e.target.value }))
                    }
                    placeholder="Nhập Source..."
                    className="px-2.5 py-1 text-xs border border-slate-300 rounded bg-white w-44"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Region -> Location -> Site Hierarchy */}
      {activeTab === 'hierarchy' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Phân cấp Vùng (Region) → Tỉnh/Thành (Location) → Điểm làm việc (Site)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Đánh dấu các Tỉnh/Thành thuộc từng Vùng/Miền và các Điểm làm việc thuộc từng Tỉnh/Thành.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveHierarchy}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                Lưu phân cấp Địa điểm
              </button>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-700">
                1. Ánh xạ Vùng/Miền (Region) → Tỉnh/Thành (Location)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {regionOptions.map((reg) => {
                  const assigned = new Set(regionLocDraft[reg] || []);
                  return (
                    <div key={reg} className="border border-slate-200 rounded-md p-3.5 bg-slate-50/40">
                      <div className="text-xs font-bold text-slate-900 mb-2">{reg}</div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {locationOptions.map((loc) => (
                          <label
                            key={loc}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={assigned.has(loc)}
                              onChange={(e) => {
                                const next = new Set(assigned);
                                if (e.target.checked) next.add(loc);
                                else next.delete(loc);
                                setRegionLocDraft((prev) => ({
                                  ...prev,
                                  [reg]: Array.from(next),
                                }));
                              }}
                              className="rounded border-slate-300 text-blue-600"
                            />
                            <span>{loc}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <h4 className="text-xs font-bold text-slate-700 pt-2">
                2. Ánh xạ Tỉnh/Thành (Location) → Điểm làm việc (Site)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {locationOptions.map((loc) => {
                  const assigned = new Set(locSiteDraft[loc] || []);
                  return (
                    <div key={loc} className="border border-slate-200 rounded-md p-3.5 bg-slate-50/40">
                      <div className="text-xs font-bold text-slate-900 mb-2">{loc}</div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {siteOptions.map((site) => (
                          <label
                            key={site}
                            className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={assigned.has(site)}
                              onChange={(e) => {
                                const next = new Set(assigned);
                                if (e.target.checked) next.add(site);
                                else next.delete(site);
                                setLocSiteDraft((prev) => ({
                                  ...prev,
                                  [loc]: Array.from(next),
                                }));
                              }}
                              className="rounded border-slate-300 text-blue-600"
                            />
                            <span>{site}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PIC Proposed Value Requests */}
      {activeTab === 'requests' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                <th className="py-2.5 px-4">Người đề xuất</th>
                <th className="py-2.5 px-4">Danh mục</th>
                <th className="py-2.5 px-4">Giá trị đề xuất</th>
                <th className="py-2.5 px-4">Cấp cha / Source</th>
                <th className="py-2.5 px-4">Lý do</th>
                <th className="py-2.5 px-4">Trạng thái</th>
                <th className="py-2.5 px-4 text-right">Phê duyệt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Chưa có yêu cầu đề xuất giá trị mới nào từ đội ngũ PIC.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-medium">{req.requested_by}</td>
                    <td className="py-2.5 px-4 font-mono-tabular">{req.list_key}</td>
                    <td className="py-2.5 px-4 font-semibold text-blue-800">
                      {req.proposed_value}
                    </td>
                    <td className="py-2.5 px-4">
                      {req.parent_value || req.mapped_source || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{req.reason || '—'}</td>
                    <td className="py-2.5 px-4">
                      {req.status === 'pending' ? (
                        <span className="text-amber-700 font-semibold">Chờ duyệt</span>
                      ) : req.status === 'approved' ? (
                        <span className="text-emerald-700 font-semibold">Đã duyệt</span>
                      ) : (
                        <span className="text-red-600 font-semibold">Từ chối</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {req.status === 'pending' ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleReviewRequest(req.id, 'approved')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 font-semibold"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Duyệt</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReviewRequest(req.id, 'rejected')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 font-semibold"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Từ chối</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">Bởi {req.reviewed_by}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

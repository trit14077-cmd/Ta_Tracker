import { DropdownConfigBundle } from '../shared/validation.ts';

export interface UserProfile {
  id: number;
  username: string;
  role: 'admin' | 'pic';
  pic_code: string;
  full_name: string;
  must_change_password: boolean;
  active?: number;
  created_at?: string;
}

export interface CandidateRecord {
  id: number;
  row_version: number;
  is_archived: boolean;
  updated_at: string;
  [fieldKey: string]: unknown;
}

export interface CandidateListParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
  pic?: string;
  position?: string;
  site?: string;
  source?: string;
  r1_stt?: string;
  r2_stt?: string;
  ob_status?: string;
  emp_status?: string;
  tenor?: string;
  date_from?: string;
  date_to?: string;
  ob_month?: string;
  archived?: boolean;
}

export interface CandidateListResponse {
  items: CandidateRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DropdownDataResponse extends DropdownConfigBundle {
  listMeta: { listKey: string; label: string }[];
}

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

export interface AuditLogItem {
  id: number;
  actor_username: string;
  actor_role: string;
  action: string;
  candidate_code: string;
  field_key: string;
  old_value: string;
  new_value: string;
  created_at: string;
}

export interface FunnelBucket {
  key: string;
  leads: number;
  r1Passed: number;
  r2Passed: number;
  accepted: number;
  joined: number;
}

export interface FunnelReportResponse {
  summary: {
    leads: number;
    r1Passed: number;
    r2Passed: number;
    accepted: number;
    joined: number;
  };
  byPic: FunnelBucket[];
  bySource: FunnelBucket[];
  byPosition: FunnelBucket[];
}

export interface ImportPreviewRow {
  rowNumber: number;
  valid: boolean;
  errors: Record<string, string>;
  notices: Record<string, string>;
  data: Record<string, string>;
}

export interface ImportPreviewResponse {
  fileName: string;
  columnMapping: { colIndex: number; header: string; fieldKey: string | null }[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  rows: ImportPreviewRow[];
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  currentRow?: CandidateRecord;

  constructor(
    message: string,
    status: number,
    code: string,
    fields?: Record<string, string>,
    currentRow?: CandidateRecord
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.currentRow = currentRow;
  }
}

const FALLBACK_TOKEN_KEY = 'ta_tracker_session_token';
let memorySessionToken = '';

function getFallbackSessionToken(): string {
  if (memorySessionToken) return memorySessionToken;
  try {
    return sessionStorage.getItem(FALLBACK_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setFallbackSessionToken(token: string): void {
  memorySessionToken = token;
  try {
    if (token) {
      sessionStorage.setItem(FALLBACK_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(FALLBACK_TOKEN_KEY);
    }
  } catch {
    // ignore storage restrictions in strict iframe
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const fallbackToken = getFallbackSessionToken();
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(fallbackToken ? { 'x-session-token': fallbackToken } : {}),
      ...(options?.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const errObj = data?.error || {};
    throw new ApiError(
      errObj.message || 'Yêu cầu không hợp lệ hoặc có lỗi xảy ra.',
      res.status,
      errObj.code || 'ERROR',
      errObj.fields,
      errObj.currentRow
    );
  }
  return data as T;
}

function toQueryString(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      sp.set(k, String(v));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Central Frontend Data Service (`dataService`).
 * All backend communication is encapsulated here so the underlying data source can be swapped cleanly.
 */
export const dataService = {
  // Auth
  async getMe(): Promise<UserProfile> {
    const res = await requestJson<{ user: UserProfile }>('/api/me');
    return res.user;
  },

  async login(username: string, password: string): Promise<UserProfile> {
    const res = await requestJson<{ user: UserProfile; sessionToken?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res.sessionToken) {
      setFallbackSessionToken(res.sessionToken);
    }
    return res.user;
  },

  async logout(): Promise<void> {
    try {
      await requestJson('/api/auth/logout', { method: 'POST' });
    } finally {
      setFallbackSessionToken('');
    }
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await requestJson('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  // Candidates
  async listCandidates(params: CandidateListParams): Promise<CandidateListResponse> {
    const query = {
      ...params,
      archived: params.archived ? '1' : '0',
    };
    return requestJson<CandidateListResponse>(`/api/candidates${toQueryString(query)}`);
  },

  async getCandidate(id: number): Promise<CandidateRecord> {
    const res = await requestJson<{ candidate: CandidateRecord }>(`/api/candidates/${id}`);
    return res.candidate;
  },

  async createCandidate(payload: Record<string, unknown>): Promise<{
    candidate: CandidateRecord;
    notices: Record<string, string>;
    phoneDuplicates: { candidate_code: string; full_name: string; pic: string }[];
  }> {
    return requestJson('/api/candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateCandidate(
    id: number,
    payload: Record<string, unknown> & { row_version: number }
  ): Promise<{
    candidate: CandidateRecord;
    notices: Record<string, string>;
    phoneDuplicates: { candidate_code: string; full_name: string; pic: string }[];
  }> {
    return requestJson(`/api/candidates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async toggleArchiveCandidate(id: number, archived: boolean): Promise<CandidateRecord> {
    const res = await requestJson<{ candidate: CandidateRecord }>(`/api/candidates/${id}/archive`, {
      method: 'POST',
      body: JSON.stringify({ archived }),
    });
    return res.candidate;
  },

  async checkPhoneDuplicate(
    phone: string,
    excludeCode?: string
  ): Promise<{
    normalized: string;
    wasNormalized: boolean;
    notice?: string;
    duplicates: {
      id: number;
      candidate_code: string;
      full_name: string;
      pic: string;
      position: string;
      created_at: string;
    }[];
  }> {
    return requestJson(
      `/api/candidates/check-phone${toQueryString({ phone, excludeCode: excludeCode || '' })}`
    );
  },

  getExportCandidatesUrl(params: CandidateListParams): string {
    const query = {
      ...params,
      archived: params.archived ? '1' : '0',
    };
    return `/api/export.xlsx${toQueryString(query)}`;
  },

  getImportTemplateUrl(): string {
    return '/api/import/template.xlsx';
  },

  // Dropdowns & Requests
  async getDropdowns(): Promise<DropdownDataResponse> {
    return requestJson<DropdownDataResponse>('/api/dropdowns');
  },

  async addDropdownOption(params: {
    listKey: string;
    value: string;
    mappedSource?: string;
    parentValue?: string;
  }): Promise<DropdownConfigBundle> {
    const res = await requestJson<{ dropdowns: DropdownConfigBundle }>('/api/dropdowns/options', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return res.dropdowns;
  },

  async updateDropdownOption(params: {
    listKey: string;
    oldValue: string;
    newValue?: string;
    active?: boolean;
  }): Promise<DropdownConfigBundle> {
    const res = await requestJson<{ dropdowns: DropdownConfigBundle }>('/api/dropdowns/options', {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
    return res.dropdowns;
  },

  async updateSubSourceMapping(mapping: Record<string, string>): Promise<DropdownConfigBundle> {
    const res = await requestJson<{ dropdowns: DropdownConfigBundle }>(
      '/api/dropdowns/sub-source-mapping',
      {
        method: 'PUT',
        body: JSON.stringify({ mapping }),
      }
    );
    return res.dropdowns;
  },

  async updateHierarchyMapping(params: {
    regionToLocations?: Record<string, string[]>;
    locationToSites?: Record<string, string[]>;
  }): Promise<DropdownConfigBundle> {
    const res = await requestJson<{ dropdowns: DropdownConfigBundle }>('/api/dropdowns/hierarchy', {
      method: 'PUT',
      body: JSON.stringify(params),
    });
    return res.dropdowns;
  },

  async listDropdownRequests(): Promise<DropdownRequestItem[]> {
    const res = await requestJson<{ requests: DropdownRequestItem[] }>('/api/dropdown-requests');
    return res.requests;
  },

  async submitDropdownRequest(params: {
    listKey: string;
    proposedValue: string;
    parentValue?: string;
    mappedSource?: string;
    reason?: string;
  }): Promise<void> {
    await requestJson('/api/dropdown-requests', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async reviewDropdownRequest(
    id: number,
    status: 'approved' | 'rejected'
  ): Promise<DropdownConfigBundle> {
    const res = await requestJson<{ dropdowns: DropdownConfigBundle }>(
      `/api/dropdown-requests/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    );
    return res.dropdowns;
  },

  // Import
  async previewImportFile(file: File): Promise<ImportPreviewResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return requestJson<ImportPreviewResponse>('/api/import/preview', {
      method: 'POST',
      body: formData,
    });
  },

  async commitImportRows(
    rows: Record<string, string>[]
  ): Promise<{ importedCount: number; skippedCount: number }> {
    return requestJson('/api/import/commit', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    });
  },

  // Audit Log
  async listAuditLogs(params: {
    page?: number;
    pageSize?: number;
    candidate_code?: string;
    actor?: string;
    action?: string;
  }): Promise<{
    items: AuditLogItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    return requestJson(`/api/audit${toQueryString(params)}`);
  },

  // Funnel Report
  async getFunnelReport(filters: {
    pic?: string;
    source?: string;
    position?: string;
    site?: string;
    ob_month?: string;
  }): Promise<FunnelReportResponse> {
    return requestJson(`/api/reports/funnel${toQueryString(filters)}`);
  },

  getFunnelExportUrl(filters: {
    pic?: string;
    source?: string;
    position?: string;
    site?: string;
    ob_month?: string;
  }): string {
    return `/api/reports/funnel/export.xlsx${toQueryString(filters)}`;
  },

  // Admin Users
  async listUsers(): Promise<UserProfile[]> {
    const res = await requestJson<{ users: UserProfile[] }>('/api/users');
    return res.users;
  },

  async createUser(params: {
    username: string;
    password: string;
    role: 'admin' | 'pic';
    pic_code: string;
    full_name: string;
  }): Promise<void> {
    await requestJson('/api/users', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async updateUser(
    id: number,
    params: {
      role?: 'admin' | 'pic';
      pic_code?: string;
      full_name?: string;
      active?: boolean;
      resetPassword?: string;
    }
  ): Promise<void> {
    await requestJson(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  },
};

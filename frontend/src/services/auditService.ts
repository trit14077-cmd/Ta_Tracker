// M6-5: Nhật ký (AuditLogView) – thay dataService.listAuditLogs cũ (/api/audit). RPC list_audit (0019) trải
// changes thành mỗi trường một dòng như hệ cũ. Quyền xem: Admin tất cả; TA hồ sơ PIC mình + việc mình làm.
import { supabase } from '../lib/supabase.ts';
import { ApiError, fnError } from './candidateService.ts';

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

export const auditService = {
  async listAuditLogs(params: { page?: number; pageSize?: number; candidate_code?: string; actor?: string; action?: string }): Promise<{
    items: AuditLogItem[]; total: number; page: number; pageSize: number; totalPages: number;
  }> {
    const { data, error } = await supabase.rpc('list_audit', {
      p_page: params.page || 1, p_page_size: params.pageSize || 50,
      p_code: params.candidate_code || '', p_actor: params.actor || '', p_action: params.action || '',
    });
    if (error) throw new ApiError('Không tải được nhật ký.', 500, error.code || 'AUDIT_FAILED');
    return data as { items: AuditLogItem[]; total: number; page: number; pageSize: number; totalPages: number };
  },
  /** Nhật ký 12 tháng (Edge audit-purge, chỉ Admin): số dòng cũ hơn mốc. */
  async purgePreview(): Promise<{ before: string; count: number }> {
    const { data, error } = await supabase.functions.invoke('audit-purge', { body: { op: 'preview' } });
    if (error) throw await fnError(error, 'Không tải được số dòng nhật ký cũ.');
    return data as { before: string; count: number };
  },
  async purgeRun(): Promise<{ before: string; exported: number; files: string[]; remaining: number }> {
    const { data, error } = await supabase.functions.invoke('audit-purge', { body: { op: 'run' } });
    if (error) throw await fnError(error, 'Không dọn được nhật ký.');
    return data as { before: string; exported: number; files: string[]; remaining: number };
  },
};

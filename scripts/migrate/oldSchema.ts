// Cấu trúc các sheet của hệ cũ (OLD/apps-script/Core.gs: SHEETS_, *_COLS_, candCols_) – nguồn của ETL M8.
// Đích theo MIGRATION_PLAN §1. "skip" = không migrate (chỉ lưu bản chụp lưu trữ).
import { FIELD_CATALOG } from '../../shared/fieldCatalog.ts';

export interface OldSheet {
  name: string;
  cols: string[];
  target: string;
  /** không migrate (D-09a: Forms/Submissions/FormTemplate; Workspaces/SyncLog) */
  skip?: boolean;
  /** sheet chỉ được tạo khi dùng lần đầu: thiếu không phải lỗi */
  optional?: boolean;
}

const CAND_META = ['id', 'row_version', 'is_archived', 'updated_at'];
const CAND_TAIL = ['src_ws', 'sync_status', 'synced_at'];

export const OLD_SHEETS: OldSheet[] = [
  { name: 'Candidates', cols: [...CAND_META, ...FIELD_CATALOG.map((f) => f.key), ...CAND_TAIL], target: 'recruitment_records' },
  { name: 'Users', cols: ['id', 'username', 'password_hash', 'role', 'pic_code', 'full_name', 'must_change_password', 'active', 'created_at'], target: 'auth.users + profiles' },
  { name: 'Dropdowns', cols: ['list_key', 'value', 'active', 'sort_order'], target: 'pics + dropdown_options' },
  { name: 'SubSource', cols: ['sub_source', 'source'], target: 'sub_source_map' },
  { name: 'Hierarchy', cols: ['parent_type', 'parent_value', 'child_value'], target: 'hierarchy' },
  { name: 'Requests', cols: ['id', 'list_key', 'proposed_value', 'parent_value', 'mapped_source', 'reason', 'requested_by', 'status', 'reviewed_by', 'created_at', 'reviewed_at'], target: 'dropdown_requests' },
  { name: 'Views', cols: ['id', 'name', 'description', 'config', 'audience', 'user_ids', 'is_active', 'sort_order', 'created_by', 'created_at', 'updated_at'], target: 'saved_views' },
  { name: 'Audit', cols: ['id', 'actor_username', 'actor_role', 'action', 'candidate_code', 'field_key', 'old_value', 'new_value', 'created_at'], target: 'audit_logs (12 tháng) + status_history' },
  { name: 'Comments', cols: ['id', 'candidate_id', 'author_username', 'author_role', 'body', 'created_at', 'updated_at'], target: 'comments' },
  { name: 'Attachments', cols: ['id', 'candidate_id', 'kind', 'drive_file_id', 'file_name', 'size', 'uploaded_by', 'uploaded_at'], target: 'record_files', optional: true },
  { name: 'Translations', cols: ['id', 'candidate_id', 'field_key', 'source_hash', 'en_text', 'updated_by', 'updated_at'], target: 'translations', optional: true },
  { name: 'HrInfo', cols: ['candidate_id', 'data', 'status', 'id_number', 'updated_by', 'updated_at', 'verified_by', 'verified_at'], target: 'hr_info', optional: true },
  { name: 'HrFormSends', cols: ['id', 'candidate_id', 'candidate_code', 'pic', 'phone', 'sent_by', 'sent_at'], target: 'hr_form_sends', optional: true },
  { name: 'Tasks', cols: ['id', 'candidate_id', 'title', 'type', 'due', 'due_time', 'priority', 'status', 'owner', 'note', 'created_by', 'created_at', 'done_at'], target: 'tasks', optional: true },
  { name: 'Interviews', cols: ['id', 'candidate_id', 'round', 'round_name', 'date', 'time', 'interviewer', 'result', 'feedback', 'created_by', 'created_at', 'updated_at'], target: 'interview_schedules', optional: true },
  { name: 'Hiring', cols: ['candidate_id', 'items', 'confirmed', 'confirmed_by', 'confirmed_at', 'updated_by', 'updated_at'], target: 'hiring_checklists', optional: true },
  { name: 'Targets', cols: ['id', 'period_type', 'period_key', 'pic', 'position', 'dept', 'value', 'updated_by', 'updated_at'], target: 'targets', optional: true },
  { name: 'CalendarEvents', cols: ['id', 'title', 'type', 'date', 'time', 'end_time', 'candidate_id', 'owner', 'note', 'created_at'], target: 'calendar_events', optional: true },
  { name: 'Applications', cols: ['id', 'created_at', 'pic', 'full_name', 'phone', 'email', 'area', 'note', 'cv_file', 'consent_at', 'status', 'candidate_code', 'handled_by', 'handled_at'], target: 'applications', optional: true },
  { name: 'Workspaces', cols: ['id', 'pic_code', 'spreadsheet_id', 'name', 'status', 'created_at', 'last_sync_at', 'last_sync_result'], target: '-', skip: true, optional: true },
  { name: 'SyncLog', cols: ['id', 'at', 'workspace_id', 'pic_code', 'action', 'status', 'message', 'actor'], target: '-', skip: true, optional: true },
  { name: 'Forms', cols: ['id', 'pic_code', 'form_code', 'status', 'template_version', 'created_at', 'link_reset_at', 'last_submit_at'], target: '- (D-09a)', skip: true, optional: true },
  { name: 'Submissions', cols: ['id', 'submission_id', 'form_id', 'form_version', 'pic_code', 'candidate_id', 'candidate_code', 'owner_username', 'submitted_at', 'channel'], target: '- (D-09a)', skip: true, optional: true },
  { name: 'FormTemplate', cols: ['version', 'released_at', 'released_by', 'note'], target: '- (D-09a)', skip: true, optional: true },
];

export interface SheetCheck {
  sheet: string;
  target: string;
  found: boolean;
  skip: boolean;
  optional: boolean;
  rows: number;
  missingCols: string[];
  extraCols: string[];
  ok: boolean;
}

/** So dòng tiêu đề (dòng 1) của 1 sheet với cột mong đợi; đếm dòng có dữ liệu. matrix = null khi không có sheet. */
export function checkSheet(def: OldSheet, matrix: unknown[][] | null): SheetCheck {
  const base = { sheet: def.name, target: def.target, skip: Boolean(def.skip), optional: Boolean(def.optional) };
  if (!matrix) return { ...base, found: false, rows: 0, missingCols: [], extraCols: [], ok: Boolean(def.optional) };
  const head = (matrix[0] ?? []).map((h) => String(h ?? '').trim()).filter(Boolean);
  const rows = matrix.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== '')).length;
  const missingCols = def.cols.filter((c) => !head.includes(c));
  const extraCols = head.filter((h) => !def.cols.includes(h));
  return { ...base, found: true, rows, missingCols, extraCols, ok: missingCols.length === 0 };
}

// Nhật ký 12 tháng: file CSV trên Drive trước khi xóa (Edge audit-purge).
import { expect, it } from 'vitest';
import { auditCsv, auditFileName, type AuditRow } from '../../supabase/functions/audit-purge/logic.ts';

const rows: AuditRow[] = [
  { id: 7, at: '2025-10-01T08:00:00+00:00', actor_username: 'ta1', actor_role: 'pic', action: 'UPDATE', record_id: 3, candidate_code: '=SUM(A1)',
    changes: { note: { old: '=HYPERLINK("x")', new: 'a, "b"' } } },
  { id: 9, at: '2025-10-03T09:00:00+00:00', actor_username: 'admin', actor_role: 'admin', action: 'DROPDOWN', record_id: null, candidate_code: '', changes: {} },
];

it('CSV có BOM, tiêu đề, chặn công thức, bọc dấu phẩy/ngoặc kép', () => {
  const csv = auditCsv(rows);
  expect(csv.startsWith('﻿id,at,actor_username,actor_role,action,record_id,candidate_code,changes\r\n')).toBe(true);
  const line = csv.split('\r\n')[1];
  expect(line.startsWith('7,2025-10-01T08:00:00+00:00,ta1,pic,UPDATE,3,')).toBe(true);
  expect(line).not.toContain(',=SUM');   // ô bắt đầu bằng = bị vô hiệu hóa
  expect(line).toContain(',"{""note""');  // JSON có dấu phẩy/ngoặc kép được bọc đúng
  expect(csv.split('\r\n')[2]).toBe('9,2025-10-03T09:00:00+00:00,admin,admin,DROPDOWN,,,{}');
});

it('tên file theo id và ngày', () => {
  expect(auditFileName(rows)).toBe('NhatKy_7-9_2025-10-01_2025-10-03.csv');
});

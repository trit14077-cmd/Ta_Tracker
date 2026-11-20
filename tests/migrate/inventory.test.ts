// M8-1: kiểm kê bản chụp hệ cũ – so dòng tiêu đề với cột của Core.gs.
import { describe, expect, it } from 'vitest';
import { FIELD_CATALOG } from '../../shared/fieldCatalog.ts';
import { OLD_SHEETS, checkSheet } from '../../scripts/migrate/oldSchema.ts';

const def = (name: string) => OLD_SHEETS.find((s) => s.name === name)!;

describe('OLD_SHEETS', () => {
  it('Candidates = id, row_version, is_archived, updated_at + mọi trường fieldCatalog + src_ws, sync_status, synced_at (candCols_)', () => {
    const c = def('Candidates').cols;
    expect(c.slice(0, 4)).toEqual(['id', 'row_version', 'is_archived', 'updated_at']);
    expect(c.slice(-3)).toEqual(['src_ws', 'sync_status', 'synced_at']);
    expect(c.length).toBe(FIELD_CATALOG.length + 7);
  });
  it('Forms / Submissions / FormTemplate / Workspaces / SyncLog không migrate', () => {
    expect(OLD_SHEETS.filter((s) => s.skip).map((s) => s.name).sort()).toEqual(['FormTemplate', 'Forms', 'Submissions', 'SyncLog', 'Workspaces']);
  });
});

describe('checkSheet', () => {
  it('đủ cột, đếm dòng có dữ liệu (bỏ dòng trống)', () => {
    const r = checkSheet(def('SubSource'), [['sub_source', 'source'], ['FB', 'Online'], ['', ''], ['Zalo', 'Online']]);
    expect(r).toMatchObject({ found: true, rows: 2, missingCols: [], extraCols: [], ok: true });
  });
  it('thiếu cột / cột lạ', () => {
    const r = checkSheet(def('Hierarchy'), [['parent_type', 'child_value', 'ghi chú']]);
    expect(r).toMatchObject({ ok: false, missingCols: ['parent_value'], extraCols: ['ghi chú'] });
  });
  it('thiếu sheet: bắt buộc => lỗi; tạo khi dùng lần đầu => không lỗi', () => {
    expect(checkSheet(def('Users'), null)).toMatchObject({ found: false, ok: false });
    expect(checkSheet(def('Tasks'), null)).toMatchObject({ found: false, ok: true });
  });
});

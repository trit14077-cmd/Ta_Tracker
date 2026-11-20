// M7-6: đổi tên giá trị Drop-list đổi luôn các cột hồ sơ dùng danh mục đó (dd_update_option, 0020). Cột lấy từ
// fieldCatalog.dropdownListKey; RPC chỉ nhận cột trong rr_writable_columns (0007). Test này chặn trường hợp thêm field mới
// dùng Drop-list mà quên cho ghi => đổi tên sẽ báo lỗi.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dropdownColumns } from '../../frontend/src/services/adminCatalog.ts';
import { FIELD_CATALOG } from '../../shared/fieldCatalog.ts';

const sql = readFileSync(new URL('../../supabase/migrations/0007_write_rpcs.sql', import.meta.url), 'utf8');
const block = /function public\.rr_writable_columns\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql)![1];
const writable = new Set([...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));

describe('dropdownColumns', () => {
  it('mọi cột dùng Drop-list (trừ pic – đổi bằng FK cascade) đều ghi được', () => {
    const lists = [...new Set(FIELD_CATALOG.map((f) => (f as { dropdownListKey?: string }).dropdownListKey).filter(Boolean))] as string[];
    expect(lists.length).toBeGreaterThan(10);
    for (const l of lists) for (const c of dropdownColumns(l)) expect(writable.has(c), `${l} -> ${c}`).toBe(true);
  });
  it('pic không gửi cột (FK on update cascade lo)', () => {
    expect(dropdownColumns('pic')).toEqual([]);
  });
  it('ví dụ: position -> cột position', () => {
    expect(dropdownColumns('position')).toEqual(['position']);
  });
});

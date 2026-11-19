// M2-5: sinh supabase/migrations/0006_seed_catalog.sql từ shared/seedData.ts + shared/hrFormMap.ts.
// Chạy từ thư mục NEW:  node scripts/seed/gen_seed_catalog.mjs
// Mọi câu INSERT dùng ON CONFLICT DO NOTHING: chạy lại không ghi đè giá trị Admin đã sửa.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const seed = await import(pathToFileURL(path.join(root, 'shared', 'seedData.ts')).href);

// hrFormMap.ts import validation.ts (không chạy thẳng bằng Node được) – chỉ lấy 3 hằng số bằng regex.
const hrSrc = readFileSync(path.join(root, 'shared', 'hrFormMap.ts'), 'utf8');
const constOf = (name) => {
  const m = new RegExp(`export const ${name} = '([^']*)'`).exec(hrSrc);
  if (!m) throw new Error('Không tìm thấy ' + name);
  return m[1];
};

const q = (s) => "'" + String(s).normalize('NFC').replace(/'/g, "''") + "'";
const rows = (list) => list.map((r) => '  (' + r.join(', ') + ')').join(',\n');
const out = [];

out.push(`-- 0006_seed_catalog.sql (DEV) – M2-5 danh mục ban đầu. SINH TỰ ĐỘNG bởi scripts/seed/gen_seed_catalog.mjs
-- từ shared/seedData.ts (giống setup() của hệ cũ). Không sửa tay; ON CONFLICT DO NOTHING nên không ghi đè dữ liệu đã có.`);

const lists = seed.INITIAL_DROPDOWN_LISTS;
const picList = lists.find((l) => l.listKey === 'pic');
out.push(`\n-- PIC (list_key 'pic' của hệ cũ -> bảng pics; ${picList.options.length} giá trị)
insert into public.pics (code, name, sort_order) values
${rows(picList.options.map((v, i) => [q(v), q(v), i]))}
on conflict (code) do nothing;`);

const dd = [];
for (const l of lists) {
  if (l.listKey === 'pic') continue;
  l.options.forEach((v, i) => dd.push([q(l.listKey), q(v), i]));
}
out.push(`\n-- Drop-list (${lists.length - 1} danh sách, ${dd.length} giá trị)
insert into public.dropdown_options (list_key, value, sort_order) values
${rows(dd)}
on conflict (list_key, value) do nothing;`);

const ssm = Object.entries(seed.INITIAL_SUB_SOURCE_MAPPING);
out.push(`\n-- Sub_Source -> Source (${ssm.length})
insert into public.sub_source_map (sub_source, source) values
${rows(ssm.map(([k, v]) => [q(k), q(v)]))}
on conflict (sub_source) do nothing;`);

const hier = [];
for (const [reg, locs] of Object.entries(seed.INITIAL_REGION_TO_LOCATIONS)) for (const l of locs) hier.push([q('region'), q(reg), q(l)]);
for (const [loc, sites] of Object.entries(seed.INITIAL_LOCATION_TO_SITES)) for (const s of sites) hier.push([q('location'), q(loc), q(s)]);
out.push(`\n-- Phân cấp Region -> Location -> Site (${hier.length})
insert into public.hierarchy (parent_type, parent_value, child_value) values
${rows(hier)}
on conflict do nothing;`);

const hrForm = JSON.stringify({
  form_url: constOf('HR_FORM_DEFAULT_URL'),
  sheet_id: constOf('HR_SHEET_DEFAULT_ID'),
  sheet_tab: constOf('HR_SHEET_DEFAULT_TAB'),
});
out.push(`\n-- Cấu hình (Properties của hệ cũ). hr_form chứa ID sheet trả lời HR (có dữ liệu cá nhân) => sensitive.
insert into public.app_settings (key, value, sensitive) values
  ('ob_target', '0'::jsonb, false),
  ('apply_page_url', '""'::jsonb, false),
  ('hr_form', ${q(hrForm)}::jsonb, true)
on conflict (key) do nothing;
`);

const file = path.join(root, 'supabase', 'migrations', '0006_seed_catalog.sql');
writeFileSync(file, out.join('\n'));
console.log('Đã ghi', path.relative(root, file), `– pics ${picList.options.length}, dropdown ${dd.length}, sub_source ${ssm.length}, hierarchy ${hier.length}`);

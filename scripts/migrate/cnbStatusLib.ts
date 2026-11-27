// Nhập một lần "Tình trạng chi lương" + "Tình trạng ký HĐTV" từ các tab OB cũ của sheet C&B (OB_T10/26, OBT11/26...)
// vào recruitment_records, khớp theo Mã NV (emp_id). Phần thuần — CLI ở cnbStatusImport.ts.
// Nguyên tắc: chỉ điền ô đang trống (trừ khi overwrite); bỏ qua Mã NV trùng trên nhiều hồ sơ; giá trị phải thuộc danh mục.

export const CNB_STATUS_VALUES = {
  salary_pay_status: ['Chi lương', 'Không chi lương'],
  contract_sign_status: ['Hoàn thành ký', 'Chưa ký', 'Đang xử lý'],
} as const;
export type CnbStatusField = keyof typeof CNB_STATUS_VALUES;
export const CNB_STATUS_FIELDS = Object.keys(CNB_STATUS_VALUES) as CnbStatusField[];

export interface CnbStatusRow {
  tab: string;
  emp_id: string;
  contract_sign_status: string;
  salary_pay_status: string;
}

export interface CnbInputIssue { tab: string; emp_id: string; issue: string }

const norm = (v: unknown) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** Chuẩn hóa giá trị về đúng chữ trong danh mục (không phân biệt hoa/thường). '' = để trống; null = không hợp lệ. */
export function normStatus(field: CnbStatusField, v: unknown): string | null {
  const s = norm(v);
  if (!s) return '';
  const hit = CNB_STATUS_VALUES[field].find((x) => x.toLowerCase() === s.toLowerCase());
  return hit ?? null;
}

/** CSV đơn giản (có hỗ trợ ô trong ngoặc kép). Dòng đầu là tiêu đề. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], cell = '', q = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // bỏ BOM
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      cur.push(cell); cell = '';
      if (cur.some((c) => c !== '')) rows.push(cur);
      cur = [];
    } else cell += ch;
  }
  cur.push(cell);
  if (cur.some((c) => c !== '')) rows.push(cur);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => norm(h));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])));
}

/** Kiểm + gộp theo emp_id. Trùng emp_id giữa các dòng: dòng sau thắng nếu giá trị khác thì ghi nhận xung đột. */
export function prepareInput(raw: Record<string, string>[]): { rows: CnbStatusRow[]; issues: CnbInputIssue[] } {
  const issues: CnbInputIssue[] = [];
  const by = new Map<string, CnbStatusRow>();
  for (const r of raw) {
    const tab = norm(r.tab);
    const emp = norm(r.emp_id);
    if (!emp) { issues.push({ tab, emp_id: '', issue: 'thieu_emp_id' }); continue; }
    if (!/^\d+$/.test(emp)) { issues.push({ tab, emp_id: emp, issue: 'emp_id_khong_phai_so' }); continue; }
    const row: CnbStatusRow = { tab, emp_id: emp, contract_sign_status: '', salary_pay_status: '' };
    let bad = false;
    for (const f of CNB_STATUS_FIELDS) {
      const v = normStatus(f, r[f]);
      if (v === null) { issues.push({ tab, emp_id: emp, issue: `gia_tri_la:${f}` }); bad = true; }
      else row[f] = v;
    }
    if (bad) continue;
    if (!row.salary_pay_status && !row.contract_sign_status) { issues.push({ tab, emp_id: emp, issue: 'ca_hai_trong' }); continue; }
    const prev = by.get(emp);
    if (prev && CNB_STATUS_FIELDS.some((f) => prev[f] && row[f] && prev[f] !== row[f])) {
      issues.push({ tab, emp_id: emp, issue: `xung_dot_voi:${prev.tab}` });
    }
    by.set(emp, prev ? { ...row, ...Object.fromEntries(CNB_STATUS_FIELDS.filter((f) => !row[f]).map((f) => [f, prev[f]])) } : row);
  }
  return { rows: [...by.values()], issues };
}

export interface CnbTargetRecord { emp_id: string; contract_sign_status?: string | null; salary_pay_status?: string | null }

export interface CnbMatchStats {
  input: number;
  khong_tim_thay: number;
  trung_ho_so: number;
  khop: number;
  /** số ô sẽ được điền (theo field). */
  se_dien: Record<CnbStatusField, number>;
  /** ô đã có giá trị khác -> giữ nguyên (trừ khi overwrite). */
  khac_gia_tri: Record<CnbStatusField, number>;
  giong_roi: Record<CnbStatusField, number>;
  ho_so_doi: number;
}

/** Mô phỏng đúng logic của SQL sinh ra (buildUpdateSql) trên một tập hồ sơ — dùng cho dry-run. */
export function simulate(rows: CnbStatusRow[], records: CnbTargetRecord[], overwrite = false): CnbMatchStats {
  const by = new Map<string, CnbTargetRecord[]>();
  for (const r of records) {
    const e = norm(r.emp_id);
    if (!e) continue;
    by.set(e, [...(by.get(e) ?? []), r]);
  }
  const z = () => ({ salary_pay_status: 0, contract_sign_status: 0 });
  const st: CnbMatchStats = { input: rows.length, khong_tim_thay: 0, trung_ho_so: 0, khop: 0, se_dien: z(), khac_gia_tri: z(), giong_roi: z(), ho_so_doi: 0 };
  for (const row of rows) {
    const m = by.get(row.emp_id) ?? [];
    if (m.length === 0) { st.khong_tim_thay++; continue; }
    if (m.length > 1) { st.trung_ho_so++; continue; }
    st.khop++;
    let changed = false;
    for (const f of CNB_STATUS_FIELDS) {
      const nv = row[f];
      if (!nv) continue;
      const old = norm(m[0][f]);
      if (old === nv) st.giong_roi[f]++;
      else if (old && !overwrite) st.khac_gia_tri[f]++;
      else { st.se_dien[f]++; changed = true; }
    }
    if (changed) st.ho_so_doi++;
  }
  return st;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Sinh 1 file SQL (1 transaction) để Admin tự chạy trên SQL editor của Supabase:
 *  - chỉ đụng hồ sơ có đúng 1 bản ghi mang emp_id đó (tính cả hồ sơ lưu trữ khi đếm trùng);
 *  - chỉ điền ô trống (overwrite=false), tăng row_version, ghi audit_logs action IMPORT_CNB (old/new từng field);
 *  - cuối file in bảng tổng hợp. Chạy lại lần 2 không đổi gì thêm.
 */
export function buildUpdateSql(rows: CnbStatusRow[], opts: { overwrite?: boolean; source: string }): string {
  if (!rows.length) throw new Error('Không có Mã NV hợp lệ để nhập.');
  const ow = opts.overwrite ? 'true' : 'false';
  const values = rows
    .map((r) => `  (${lit(r.emp_id)}, ${lit(r.contract_sign_status)}, ${lit(r.salary_pay_status)}, ${lit(r.tab)})`)
    .join(',\n');
  const set = (f: CnbStatusField) =>
    `case when i.${f} <> '' and (r.${f} = '' or ${ow}) then i.${f} else r.${f} end`;
  const chg = (f: CnbStatusField) =>
    `case when c.new_${f} is distinct from c.old_${f} then jsonb_build_object('${f}', jsonb_build_object('old', c.old_${f}, 'new', c.new_${f})) else '{}'::jsonb end`;
  return `-- Nhập "Tình trạng chi lương" + "Tình trạng ký HĐTV" từ sheet C&B (${opts.source}).
-- Sinh bởi scripts/migrate/cnbStatusImport.ts — ${rows.length} Mã NV. overwrite=${ow}.
-- Chạy 1 lần trên SQL editor (quyền postgres). Chạy lại không đổi gì thêm. Chứa Mã NV: không commit file này.
drop table if exists pg_temp._cnb_in, pg_temp._cnb_calc;
begin;

create temp table _cnb_in (
  emp_id text primary key, contract_sign_status text not null, salary_pay_status text not null, tab text not null
);

insert into _cnb_in (emp_id, contract_sign_status, salary_pay_status, tab) values
${values};

create temp table _cnb_calc as
select r.id, r.candidate_code, i.emp_id, i.tab,
       r.contract_sign_status as old_contract_sign_status, r.salary_pay_status as old_salary_pay_status,
       ${set('contract_sign_status')} as new_contract_sign_status,
       ${set('salary_pay_status')} as new_salary_pay_status
  from _cnb_in i
  join public.recruitment_records r on btrim(r.emp_id) = i.emp_id
 where (select count(*) from public.recruitment_records r2 where btrim(r2.emp_id) = i.emp_id) = 1;

update public.recruitment_records r
   set contract_sign_status = c.new_contract_sign_status,
       salary_pay_status    = c.new_salary_pay_status,
       row_version = r.row_version + 1,
       updated_at  = now()
  from _cnb_calc c
 where r.id = c.id
   and (c.new_contract_sign_status is distinct from c.old_contract_sign_status
        or c.new_salary_pay_status is distinct from c.old_salary_pay_status);

insert into public.audit_logs (actor_id, actor_username, actor_role, action, record_id, candidate_code, changes)
select null, 'system', 'admin', 'IMPORT_CNB', c.id, c.candidate_code,
       ${chg('contract_sign_status')} || ${chg('salary_pay_status')} || jsonb_build_object('cnb_tab', c.tab)
  from _cnb_calc c
 where c.new_contract_sign_status is distinct from c.old_contract_sign_status
    or c.new_salary_pay_status is distinct from c.old_salary_pay_status;

commit;

-- Tổng hợp (sau commit; bảng tạm còn tới hết phiên).
select i.tab,
       count(*)                                                                as ma_nv,
       count(*) filter (where n.cnt = 0)                                       as khong_tim_thay,
       count(*) filter (where n.cnt > 1)                                       as trung_ho_so,
       count(c.id)                                                             as khop,
       count(*) filter (where c.new_salary_pay_status is distinct from c.old_salary_pay_status)       as dien_chi_luong,
       count(*) filter (where c.new_contract_sign_status is distinct from c.old_contract_sign_status) as dien_hdtv
  from _cnb_in i
  cross join lateral (select count(*) as cnt from public.recruitment_records r where btrim(r.emp_id) = i.emp_id) n
  left join _cnb_calc c on c.emp_id = i.emp_id
 group by i.tab order by i.tab;
`;
}

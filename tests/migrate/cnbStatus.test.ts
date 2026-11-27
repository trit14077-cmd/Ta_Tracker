// Nhập chi lương / ký HĐTV từ sheet C&B (scripts/migrate/cnbStatusLib.ts).
import { describe, expect, it } from 'vitest';
import { buildUpdateSql, normStatus, parseCsv, prepareInput, simulate } from '../../scripts/migrate/cnbStatusLib.ts';

describe('normStatus', () => {
  it('chuẩn hóa về đúng chữ trong danh mục', () => {
    expect(normStatus('salary_pay_status', ' chi  lương ')).toBe('Chi lương');
    expect(normStatus('salary_pay_status', 'KHÔNG CHI LƯƠNG')).toBe('Không chi lương');
    expect(normStatus('contract_sign_status', 'Đang xử lý')).toBe('Đang xử lý');
    expect(normStatus('contract_sign_status', '')).toBe('');
    expect(normStatus('salary_pay_status', 'Có')).toBeNull();
  });
  it('NFD (gõ tổ hợp) vẫn khớp', () => {
    expect(normStatus('salary_pay_status', 'Chi lương'.normalize('NFD'))).toBe('Chi lương');
  });
});

describe('parseCsv', () => {
  it('đọc tiêu đề, BOM, ngoặc kép, CRLF, bỏ dòng trống', () => {
    const r = parseCsv(String.fromCharCode(0xfeff) + 'tab,emp_id,x\r\n"OB_T10/26",123,"a, ""b"""\r\n\r\nT11,456,\n');
    expect(r).toEqual([
      { tab: 'OB_T10/26', emp_id: '123', x: 'a, "b"' },
      { tab: 'T11', emp_id: '456', x: '' },
    ]);
  });
});

describe('prepareInput', () => {
  const row = (tab: string, emp_id: string, c: string, s: string) => ({ tab, emp_id, contract_sign_status: c, salary_pay_status: s });
  it('bỏ dòng thiếu/sai Mã NV, giá trị lạ, cả hai trống', () => {
    const { rows, issues } = prepareInput([
      row('A', '', 'Chưa ký', 'Chi lương'),
      row('A', 'NV01', 'Chưa ký', 'Chi lương'),
      row('A', '1', 'Ký rồi', 'Chi lương'),
      row('A', '2', '', ''),
      row('A', '3', '', 'Chi lương'),
    ]);
    expect(rows.map((r) => r.emp_id)).toEqual(['3']);
    expect(issues.map((i) => i.issue)).toEqual(['thieu_emp_id', 'emp_id_khong_phai_so', 'gia_tri_la:contract_sign_status', 'ca_hai_trong']);
  });
  it('trùng Mã NV giữa 2 tab: dòng sau thắng, giữ ô dòng sau để trống, báo xung đột khi khác', () => {
    const { rows, issues } = prepareInput([
      row('T10', '9', 'Đang xử lý', 'Chi lương'),
      row('T11', '9', 'Hoàn thành ký', ''),
    ]);
    expect(rows).toEqual([{ tab: 'T11', emp_id: '9', contract_sign_status: 'Hoàn thành ký', salary_pay_status: 'Chi lương' }]);
    expect(issues).toEqual([{ tab: 'T11', emp_id: '9', issue: 'xung_dot_voi:T10' }]);
  });
});

describe('simulate', () => {
  const rows = [
    { tab: 'T', emp_id: '1', contract_sign_status: 'Hoàn thành ký', salary_pay_status: 'Chi lương' },
    { tab: 'T', emp_id: '2', contract_sign_status: '', salary_pay_status: 'Không chi lương' },
    { tab: 'T', emp_id: '3', contract_sign_status: 'Chưa ký', salary_pay_status: 'Chi lương' },
    { tab: 'T', emp_id: '4', contract_sign_status: 'Chưa ký', salary_pay_status: 'Chi lương' },
  ];
  const recs = [
    { emp_id: '1', salary_pay_status: '', contract_sign_status: '' },
    { emp_id: ' 2 ', salary_pay_status: 'Chi lương', contract_sign_status: 'Chưa ký' },
    { emp_id: '3', salary_pay_status: '', contract_sign_status: '' },
    { emp_id: '3', salary_pay_status: '', contract_sign_status: '' },
  ];
  it('chỉ điền ô trống, bỏ trùng, đếm không tìm thấy', () => {
    const st = simulate(rows, recs);
    expect(st).toMatchObject({ input: 4, khong_tim_thay: 1, trung_ho_so: 1, khop: 2, ho_so_doi: 1 });
    expect(st.se_dien).toEqual({ salary_pay_status: 1, contract_sign_status: 1 });
    expect(st.khac_gia_tri).toEqual({ salary_pay_status: 1, contract_sign_status: 0 });
  });
  it('overwrite ghi đè giá trị khác', () => {
    const st = simulate(rows, recs, true);
    expect(st.ho_so_doi).toBe(2);
    expect(st.se_dien.salary_pay_status).toBe(2);
  });
});

describe('buildUpdateSql', () => {
  it('escape nháy đơn, 1 transaction, ghi audit IMPORT_CNB, mặc định không overwrite', () => {
    const sql = buildUpdateSql([{ tab: "O'B", emp_id: '1', contract_sign_status: '', salary_pay_status: 'Chi lương' }], { source: 'x' });
    expect(sql).toContain("('1', '', 'Chi lương', 'O''B')");
    expect(sql).toContain('begin;');
    expect(sql).toContain('commit;');
    expect(sql).toContain("'IMPORT_CNB'");
    expect(sql).toContain("(r.salary_pay_status = '' or false)");
    const one = [{ tab: 'T', emp_id: '1', contract_sign_status: 'Chưa ký', salary_pay_status: '' }];
    expect(buildUpdateSql(one, { source: 'x', overwrite: true })).toContain('or true)');
    expect(() => buildUpdateSql([], { source: 'x' })).toThrow();
  });
});

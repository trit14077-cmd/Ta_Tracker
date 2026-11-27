// Quy trình 2 (CnB): kỳ OB 25→24, điều kiện chốt, ký hiệu giấy tờ, template 16 / 98 cột.
import { describe, expect, it } from 'vitest';
import {
  cleanCnbCheck,
  cnbEligibility,
  currentCycleKey,
  cycleKeyOfDate,
  cycleOf,
  daysToLock,
  docMark,
  recentCycleKeys,
  vnTodayIso,
} from '../../shared/cnbRules.ts';
import {
  CNB_CHECK_HEADERS,
  CNB_FULL_HEADERS,
  CNB_FULL_MAP,
  CNB_SHORT_HEADERS,
  probationEnd,
  rankGroup,
  toCnbCheckRow,
  toCnbFullRow,
  toCnbShortRow,
  type CnbSource,
} from '../../shared/cnbTemplate.ts';

describe('kỳ OB', () => {
  it('kỳ tháng 11 = 25/10 → 24/11, chốt 25/11', () => {
    expect(cycleOf('2026-11')).toEqual({ key: '2026-11', label: 'OB_T11/26', from: '2026-10-25', to: '2026-11-24', lockDate: '2026-11-25' });
  });
  it('kỳ tháng 1 lấy 25/12 năm trước', () => {
    expect(cycleOf('2027-01').from).toBe('2026-12-25');
    expect(cycleOf('2027-01').label).toBe('OB_T1/27');
  });
  it('ngày → kỳ: 24 thuộc tháng này, 25 và 26 thuộc tháng sau', () => {
    expect(cycleKeyOfDate('2026-11-24')).toBe('2026-11');
    expect(cycleKeyOfDate('2026-11-25')).toBe('2026-12');
    expect(cycleKeyOfDate('2026-10-26')).toBe('2026-11');
    expect(cycleKeyOfDate('2026-12-31')).toBe('2027-01');
    expect(cycleKeyOfDate('2026-02-28')).toBe('2026-03');
    expect(cycleKeyOfDate('')).toBe('');
    expect(cycleKeyOfDate('31/12/2026')).toBe('');
  });
  it('mọi ngày trong năm thuộc đúng một kỳ và nằm trong [from, to]', () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 86400000) {
      const d = new Date(t).toISOString().slice(0, 10);
      const cy = cycleOf(cycleKeyOfDate(d));
      expect(d >= cy.from && d <= cy.to).toBe(true);
    }
  });
  it('khóa kỳ sai bị từ chối', () => {
    expect(() => cycleOf('2026-13')).toThrow();
    expect(() => cycleOf('11/2026')).toThrow();
  });
  it('giờ Việt Nam: 17h UTC ngày 24 đã là ngày 25 ở VN', () => {
    const now = new Date('2026-11-24T17:30:00Z');
    expect(vnTodayIso(now)).toBe('2026-11-25');
    expect(currentCycleKey(now)).toBe('2026-12');
    expect(daysToLock('2026-12', now)).toBe(30);
    expect(recentCycleKeys(3, now)).toEqual(['2026-12', '2026-11', '2026-10']);
  });
});

describe('điều kiện chốt', () => {
  const base = { ob_date: '2026-11-03', salary_pay_status: 'Chi lương', emp_status: 'Active', emp_id: '6354402', attrition_date: null };
  it('đủ điều kiện', () => {
    expect(cnbEligibility(base, '2026-11')).toEqual({ ok: true, reasons: [], warnings: [] });
  });
  it('ngoài kỳ, chưa chi lương, đã nghỉ, lưu trữ', () => {
    expect(cnbEligibility({ ...base, ob_date: '2026-11-25' }, '2026-11').reasons).toEqual(['ngoai_ky']);
    expect(cnbEligibility({ ...base, salary_pay_status: 'Không chi lương' }, '2026-11').reasons).toEqual(['chua_chi_luong']);
    expect(cnbEligibility({ ...base, salary_pay_status: '' }, '2026-11').reasons).toEqual(['chua_chi_luong']);
    expect(cnbEligibility({ ...base, emp_status: 'Resigned' }, '2026-11').reasons).toEqual(['da_nghi']);
    expect(cnbEligibility({ ...base, is_archived: true }, '2026-11').reasons).toEqual(['luu_tru']);
  });
  it('ngày nghỉ tính tại ngày chốt: nghỉ sau ngày chốt vẫn vào danh sách', () => {
    expect(cnbEligibility({ ...base, attrition_date: '2026-11-20' }, '2026-11').reasons).toEqual(['da_nghi']);
    expect(cnbEligibility({ ...base, attrition_date: '2026-11-25' }, '2026-11').reasons).toEqual(['da_nghi']);
    expect(cnbEligibility({ ...base, attrition_date: '2026-11-28' }, '2026-11').ok).toBe(true);
    expect(cnbEligibility({ ...base, attrition_date: '2026-11-20' }, '2026-11', '2026-11-19').ok).toBe(true);
  });
  it('chữ "Chi lương" khác dạng Unicode / thừa khoảng trắng vẫn nhận', () => {
    expect(cnbEligibility({ ...base, salary_pay_status: ' Chi  lương '.normalize('NFD') }, '2026-11').ok).toBe(true);
  });
  it('cảnh báo không loại', () => {
    const r = cnbEligibility({ ...base, emp_id: '', emp_status: '' }, '2026-11');
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual(['thieu_emp_id', 'chua_ghi_tinh_trang_lam_viec']);
  });
});

describe('giấy tờ và kiểm hồ sơ', () => {
  it('docMark', () => {
    expect(['1', 'x', 'X', 'https://drive/abc', 'Done'].map(docMark)).toEqual(['x', 'x', 'x', 'x', 'x']);
    expect(['', ' ', null, undefined, 'o', '0'].map(docMark)).toEqual(['o', 'o', 'o', 'o', 'o', 'o']);
  });
  it('cleanCnbCheck chỉ giữ ô hợp lệ', () => {
    const r = cleanCnbCheck({ cccd: 'X', ksk: 'o', syll: '', abc: 'x', hdtv: 'có' });
    expect(r.check).toEqual({ cccd: 'x', ksk: 'o', syll: '' });
    expect(r.errors).toHaveLength(2);
  });
});

describe('template', () => {
  const src: CnbSource = {
    emp_id: '6062626', full_name: 'Nguyễn Văn A', position: 'Nhân viên Quản lý Kho', rank: '5C', region: 'Miền Nam',
    unit: 'Chuỗi Cung Ứng', dept: 'Cool Chain Logistics', site: 'Kho Nhà máy 3FF', location: 'TP Hồ Chí Minh',
    hire_type: 'Tái tuyển dụng', ob_date: '2026-06-22', probation_period: '60', contract_sign_status: 'Hoàn thành ký',
    salary_pay_status: 'Chi lương', drive_upload: 'Done', edu_certificate: '1', health_check: '1', id_card: '', resume: '1',
    doc_note: '', emp_status: 'Active', attrition_date: null, pic: 'TA4-V.Khanh', email: 'a@gmail.com',
    hr: { id_number: '052089017518', id_issue_date: '16/09/2021', id_issue_place: 'Cục CS QLHC về TTXH', bank_name: 'VCB',
          bank_account: '0123', address_permanent: 'ĐC 1', address_current: 'ĐC 2', edu_level: 'Đại học', ethnicity: 'Kinh',
          tax_code: '052089017518', phone: '0977000000' },
  };
  it('bản đầy đủ đúng 98 cột như OB_T6/26, không trùng header', () => {
    expect(CNB_FULL_HEADERS).toHaveLength(98);
    expect(new Set(CNB_FULL_HEADERS).size).toBe(98);
    for (const h of Object.keys(CNB_FULL_MAP)) expect(CNB_FULL_HEADERS as readonly string[]).toContain(h);
  });
  it('bản đầy đủ map đúng ô', () => {
    const row = toCnbFullRow(src, 1);
    const at = (h: string) => row[(CNB_FULL_HEADERS as readonly string[]).indexOf(h)];
    expect(row).toHaveLength(98);
    expect(at('STT')).toBe('1');
    expect(at('Tập đoàn')).toBe('Masan Group');
    expect(at('Nhóm chức danh')).toBe('Rank 5');
    expect(at('Ngày tuyển dụng')).toBe('22/06/2026');
    expect(at('Ngày bắt đầu HĐ')).toBe('22/06/2026');
    expect(at('Ngày kết thúc')).toBe('20/08/2026');
    expect(at('Số CMND/Hộ chiếu')).toBe('052089017518');
    expect(at('Email cá nhân')).toBe('A@GMAIL.COM');
    expect(at('Điện thoại di động')).toBe('0977000000');
    expect(at('CCCD')).toBe('o');
    expect(at('GKSK')).toBe('x');
    expect(at('Cost Ctr')).toBe('');
  });
  it('bản gọn 16 cột như OBT11/26', () => {
    expect(CNB_SHORT_HEADERS).toHaveLength(16);
    expect(toCnbShortRow(src)).toEqual([
      '6062626', 'Nguyễn Văn A', 'Nhân viên Quản lý Kho', 'Kho Nhà máy 3FF', '22/06/2026', 'Active', '', 'TA4-V.Khanh',
      'Hoàn thành ký', 'Chi lương', 'Done', 'x', 'x', 'o', 'x', '',
    ]);
  });
  it('bảng kiểm hồ sơ CnB', () => {
    const row = toCnbCheckRow(src, { cccd: 'x', ksk: 'o' }, 'thiếu KSK', 3);
    expect(row).toHaveLength(CNB_CHECK_HEADERS.length);
    expect(row.slice(0, 7)).toEqual(['3', '6062626', 'Nguyễn Văn A', '5C', '22/06/2026', '', 'x']);
  });
  it('rankGroup, probationEnd', () => {
    expect(rankGroup('6A')).toBe('Rank 6');
    expect(rankGroup('')).toBe('');
    expect(probationEnd('2026-06-04', '30')).toBe('03/07/2026');
    expect(probationEnd('2026-06-04', '')).toBe('');
  });
});

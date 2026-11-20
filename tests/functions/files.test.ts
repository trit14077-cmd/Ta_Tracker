// M7-1: Edge `files` – kiểm file trước khi đưa lên Drive, tên thư mục/file như hệ cũ.
import { describe, expect, it } from 'vitest';
import { attachmentKinds, checkFile, contentDisposition, drivePlacement, magicMatches } from '../../supabase/functions/files/logic.ts';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0]);

describe('checkFile', () => {
  it('nhận PDF hợp lệ cho CV và giấy tờ', () => {
    expect(checkFile('cv', 'a.PDF', 1000, PDF)).toEqual({ ok: true, ext: '.pdf', mime: 'application/pdf' });
    expect(checkFile('health_check', 'b.pdf', 1000, PDF).ok).toBe(true);
  });
  it('từ chối loại lạ, đuôi không cho phép, rỗng, quá 10 MB', () => {
    expect(checkFile('khac', 'a.pdf', 10, PDF)).toMatchObject({ ok: false, code: 'INVALID_KIND' });
    expect(checkFile('cv', 'a.xlsx', 10, ZIP)).toMatchObject({ ok: false, code: 'BAD_FILE_TYPE' });
    expect(checkFile('cv', 'a.exe', 10, EXE)).toMatchObject({ ok: false, code: 'BAD_FILE_TYPE' });
    expect(checkFile('cv', 'a.pdf', 0, PDF)).toMatchObject({ ok: false, code: 'EMPTY_FILE' });
    expect(checkFile('cv', 'a.pdf', 10 * 1024 * 1024 + 1, PDF)).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
  });
  it('Excel chỉ cho Salary Proposal / Payslips', () => {
    expect(checkFile('payslip', 'luong.xlsx', 10, ZIP).ok).toBe(true);
  });
  it('nội dung phải đúng đuôi (đổi đuôi .exe thành .pdf bị chặn)', () => {
    expect(checkFile('cv', 'virus.pdf', 10, EXE)).toMatchObject({ ok: false, code: 'BAD_FILE_CONTENT' });
    expect(magicMatches('.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(magicMatches('.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(magicMatches('.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true);
    expect(magicMatches('.docx', PDF)).toBe(false);
  });
});

describe('drivePlacement (documentRules như hệ cũ)', () => {
  it('chưa có mã NV: dùng mã ứng viên', () => {
    expect(drivePlacement({ candidate_code: 'TA10001', full_name: 'Nguyễn Văn A' }, 'health_check', 'scan.PDF')).toEqual({
      folder: 'TA10001_Nguyễn Văn A', file: 'TA10001_Nguyễn Văn A_Giấy khám sức khỏe.pdf',
    });
  });
  it('có mã NV; CV và Payslip', () => {
    expect(drivePlacement({ emp_id: 'E99', candidate_code: 'TA1', full_name: 'B' }, 'cv', 'x.docx').file).toBe('E99_B_CV.docx');
    expect(drivePlacement({ candidate_code: 'TA1', full_name: 'B' }, 'payslip', 'x.pdf').file).toBe('TA1_B_Payslip.pdf');
  });
});

describe('attachmentKinds', () => {
  it('Salary Proposal chỉ Rank 5 trở lên; Rank chưa biết thì cho', () => {
    const at = (rank: string) => Object.fromEntries(attachmentKinds(rank).map((k) => [k.key, k.applicable]));
    expect(at('6')).toEqual({ salary_proposal: false, payslip: true });
    expect(at('5')).toEqual({ salary_proposal: true, payslip: true });
    expect(at('')).toEqual({ salary_proposal: true, payslip: true });
  });
});

it('Content-Disposition giữ tên tiếng Việt', () => {
  const h = contentDisposition('TA1_Nguyễn Đức_CV.pdf');
  expect(h).toContain('filename="TA1_Nguyen Duc_CV.pdf"');
  expect(h).toContain("filename*=UTF-8''TA1_Nguy%E1%BB%85n%20%C4%90%E1%BB%A9c_CV.pdf");
});

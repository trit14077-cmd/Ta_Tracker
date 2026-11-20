// M8 (DEV-DATA a, như M8-0): ẩn danh hồ sơ TRÊN MÁY trước khi gửi lên DEV. Dữ liệu thật không rời máy.
// Giữ nguyên: mã ứng viên, PIC, vị trí, kho/tỉnh/vùng, nguồn, mọi trạng thái/ngày/lý do => KPI, Kanban, báo cáo không đổi.
// Thay một-một (cùng giá trị thật => cùng giá trị giả, giữ các nhóm trùng SĐT/tên): họ tên, SĐT, email, mã NV.
// Bỏ trắng: lương, phụ cấp, lương hiện tại/mong muốn, địa chỉ, link CV. Ngày sinh: chỉ giữ năm. Ghi chú / phản hồi tự do,
// người phỏng vấn, tóm tắt kinh nghiệm: có nội dung => "[đã ẩn]". Giấy tờ dạng "<drive id>|<tên>" => "Yes".
// HMAC với khóa ngẫu nhiên tạo lúc chạy, KHÔNG lưu => không suy ngược được.
import { createHmac, randomBytes } from 'node:crypto';

const FAMILY = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const MIDDLE = ['Văn', 'Thị', 'Hữu', 'Ngọc', 'Minh', 'Thanh', 'Đức', 'Thu', 'Quốc', 'Kim', 'Hoài', 'Gia'];
const GIVEN = ['An', 'Bình', 'Châu', 'Dũng', 'Hà', 'Hùng', 'Lan', 'Linh', 'Nam', 'Phúc', 'Quân', 'Trang', 'Tuấn', 'Vy', 'Yến',
  'Khoa', 'Long', 'Mai', 'Nhi', 'Sơn', 'Tâm', 'Thảo', 'Trung', 'Uyên', 'Việt', 'Xuân', 'Hiếu', 'Khánh', 'Duy', 'Ngân'];

export const HIDE_TEXT = ['r1_note', 'r1_cdd_fb', 'r2_note', 'r2_cdd_fb', 'ob_note', 'doc_note', 'attrition_note', 'wd_note',
  'pending_at', 'experience_summary', 'r2_interviewer'];
export const BLANK = ['basic_salary', 'meal_allowance', 'fmcg_allowance', 'attraction_allowance', 'nightshift_allowance',
  'current_salary', 'salary_expectation', 'address', 'cv_link'];
export const DOCS = ['edu_certificate', 'health_check', 'id_card', 'resume', 'forklift_cert'];

class OneToOne {
  private map = new Map<string, string>();
  private used: Set<string>;
  constructor(private make: (v: string, i: number) => string, forbidden: Iterable<string> = []) { this.used = new Set(forbidden); }
  get size() { return this.map.size; }
  of(v: string): string {
    if (!v) return v;
    let fake = this.map.get(v);
    if (fake === undefined) {
      for (let i = 0; ; i++) {
        fake = this.make(v, i);
        if (!this.used.has(fake)) break;
      }
      this.map.set(v, fake);
      this.used.add(fake);
    }
    return fake;
  }
}

export interface AnonReport { rows: number; names: number; phones: number; emails: number; empIds: number; leftPhone: number; leftEmail: number; leftName: number; leftEmp: number }

/** Ẩn danh danh sách hồ sơ (giá trị đã chuẩn hóa: SĐT 9 số). key chỉ truyền khi test; mặc định khóa ngẫu nhiên dùng 1 lần. */
export function anonymize(rows: Record<string, string>[], key: Buffer = randomBytes(32)): { rows: Record<string, string>[]; report: AnonReport } {
  const h = (kind: string, v: string) => createHmac('sha256', key).update(`${kind}\u0000${v}`).digest();
  const n = (kind: string, v: string) => h(kind, v).readUInt32BE(0);
  const real = (k: string) => new Set(rows.map((r) => r[k]).filter(Boolean));
  const realNames = real('full_name'), realPhones = real('phone'), realEmails = real('email'), realEmp = real('emp_id');
  const names = new OneToOne((v, i) => {
    const x = h('name', `${v}#${i}`);
    return `${FAMILY[x[0] % FAMILY.length]} ${MIDDLE[x[1] % MIDDLE.length]} ${GIVEN[x[2] % GIVEN.length]} ${GIVEN[x[3] % GIVEN.length]}`;
  }, realNames);
  // SĐT giả 9 số (không số 0 đầu như dữ liệu đã chuẩn hóa), đầu 99 – dải không cấp cho thuê bao thật
  const phones = new OneToOne((v, i) => '99' + String(n('phone', `${v}#${i}`) % 10 ** 7).padStart(7, '0'), realPhones);
  const emails = new OneToOne((v, i) => `uv${String(n('email', `${v}#${i}`) % 10 ** 8).padStart(8, '0')}@example.invalid`, realEmails);
  const emps = new OneToOne((v, i) => `NV${String(n('emp', `${v}#${i}`) % 10 ** 7).padStart(7, '0')}`, realEmp);

  const out = rows.map((r) => {
    const o = { ...r };
    o.full_name = names.of(o.full_name ?? '');
    o.phone = phones.of(o.phone ?? '');
    o.email = emails.of(o.email ?? '');
    o.emp_id = emps.of(o.emp_id ?? '');
    for (const k of HIDE_TEXT) if (o[k]) o[k] = '[đã ẩn]';
    for (const k of BLANK) if (k in o) o[k] = '';
    if (o.birth) o.birth = (/(\d{4})\s*$/.exec(o.birth) || [])[1] ?? '';
    for (const k of DOCS) if (o[k]?.includes('|')) o[k] = 'Yes';
    return o;
  });
  const count = (k: string, set: Set<string>) => out.filter((r) => r[k] && set.has(r[k])).length;
  return {
    rows: out,
    report: {
      rows: out.length, names: names.size, phones: phones.size, emails: emails.size, empIds: emps.size,
      leftPhone: count('phone', realPhones), leftEmail: count('email', realEmails), leftName: count('full_name', realNames), leftEmp: count('emp_id', realEmp),
    },
  };
}

/** Ô Timestamp của Excel là số ngày (VD 45612.53) => "DD/MM/YYYY HH:mm:ss"; chuỗi giữ nguyên. */
export function excelSerialToDateTime(v: string): string {
  const s = String(v || '').trim();
  if (!/^\d{5}(\.\d+)?$/.test(s)) return s;
  const ms = Math.round((Number(s) - 25569) * 86400000);
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

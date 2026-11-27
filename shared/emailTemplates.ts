// Mẫu nội dung email theo quy trình tuyển dụng (task tracking #1–#3).
// Khung lấy từ docs/email-templates/ (mail mẫu, dữ liệu giả) + "Thứ tự gửi mail.docx".
// Hệ thống chỉ soạn nội dung theo từng ứng viên; TA copy rồi dán vào Outlook, tự chọn người nhận.
//
// Luồng 1 – Rank 6: 1 mail "THÔNG BÁO NHÂN SỰ MỚI" (trước OB).
// Luồng 2 – Rank 5 trở lên, theo thứ tự:
//   1a. THE SUPRA - THÔNG TIN HỖ TRỢ NHÂN SỰ MỚI NHẬN VIỆC – [HỌ TÊN]   (trước OB)
//   1b. THÔNG TIN NHÂN SỰ NHẬN VIỆC NGÀY dd/mm/yyyy                       (trước OB)
//   2.  [THE SUPRA] REMINDER: THÔNG TIN NHẬN VIỆC                          (trước OB, gửi ứng viên)
//   3.  [TSC] - THÔNG TIN ĐẦU MỐI HỖ TRỢ DÀNH CHO NHÂN SỰ MỚI              (sau OB)

import { formatIsoDateToDisplay } from './validation.ts';

export type EmailFlow = 'rank6' | 'rank5up';
export type EmailTemplateId = 'r6_new_hire' | 'support_prep' | 'ob_schedule' | 'reminder' | 'after_ob_contacts';
export type EmailTiming = 'before_ob' | 'after_ob';

/** Người gửi (chữ ký). TA tự nhập một lần, UI lưu lại trên máy. */
export interface EmailSender {
  name: string;
  title: string;
  phone: string;
  email: string;
}

/** Thông tin TA nhập thêm khi soạn (hồ sơ ứng viên không có). */
export interface EmailExtras {
  obTime: string; // giờ nhận việc, VD 09:00
  workEmail: string; // email công ty của nhân sự mới (mail 1b)
  workAddress: string; // địa điểm làm việc cụ thể
  sendDate: string; // ISO yyyy-mm-dd, ngày gửi (tiêu đề mail rank 6)
}

export const DEFAULT_EXTRAS: EmailExtras = { obTime: '09:00', workEmail: '', workAddress: '', sendDate: '' };

export interface EmailTemplateMeta {
  id: EmailTemplateId;
  flow: EmailFlow;
  step: string;
  timing: EmailTiming;
  label: string;
  purpose: string;
}

export const EMAIL_TEMPLATES: EmailTemplateMeta[] = [
  { id: 'r6_new_hire', flow: 'rank6', step: '1', timing: 'before_ob', label: 'Thông báo nhân sự mới', purpose: 'Báo nhân sự mới để IT tạo user Wincare, site chuẩn bị đón.' },
  { id: 'support_prep', flow: 'rank5up', step: '1a', timing: 'before_ob', label: 'Thông tin hỗ trợ nhân sự mới nhận việc', purpose: 'Nhờ các bộ phận chuẩn bị user, email, laptop, thẻ xe.' },
  { id: 'ob_schedule', flow: 'rank5up', step: '1b', timing: 'before_ob', label: 'Thông tin nhân sự nhận việc', purpose: 'Báo Line Manager/HOD có nhân sự nhận việc và lịch ngày đầu.' },
  { id: 'reminder', flow: 'rank5up', step: '2', timing: 'before_ob', label: 'Reminder thông tin nhận việc', purpose: 'Nhắc ứng viên ngày giờ, địa điểm và hồ sơ nhận việc.' },
  { id: 'after_ob_contacts', flow: 'rank5up', step: '3', timing: 'after_ob', label: 'Đầu mối hỗ trợ & bảo hiểm', purpose: 'Sau OB: gửi nhân sự mới thông tin đầu mối và gói bảo hiểm.' },
];

/** Rank 6x → luồng 1, còn lại (5, 4, 3...) → luồng 2. Chưa có rank thì mặc định luồng 2. */
export function flowOfRank(rank: string | null | undefined): EmailFlow {
  return /^\s*6/.test(String(rank || '')) ? 'rank6' : 'rank5up';
}

export type EmailSuggestion = EmailTemplateMeta & { due: 'now' | 'later' | 'need_ob_date' };

/**
 * Ứng viên này cần những mail nào, mail nào đến lúc gửi:
 * - chưa có ngày OB → mọi mail đều chờ ngày OB;
 * - trước ngày OB → mail "trước OB" là now, mail "sau OB" là later;
 * - từ ngày OB trở đi → mail "sau OB" là now, mail "trước OB" vẫn hiện (later = đã qua) để tra lại.
 */
export function suggestEmails(candidate: Record<string, unknown>, todayIso: string, flow = flowOfRank(String(candidate.rank || ''))): EmailSuggestion[] {
  const ob = String(candidate.ob_date || '').slice(0, 10);
  return EMAIL_TEMPLATES.filter((t) => t.flow === flow).map((t) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ob)) return { ...t, due: 'need_ob_date' as const };
    const afterOb = todayIso >= ob;
    const now = t.timing === 'after_ob' ? afterOb : !afterOb;
    return { ...t, due: now ? ('now' as const) : ('later' as const) };
  });
}

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
  /** Các ô còn thiếu dữ liệu, đã để chỗ trống [ ... ] trong nội dung. */
  missing: string[];
}

type Candidate = Record<string, unknown>;

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/** "2026-07-23" → "Thứ 5, ngày 23 tháng 07 năm 2026". Tính thứ từ ngày, không gõ tay. */
export function longVnDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return `${WEEKDAYS[wd]}, ngày ${m[3]} tháng ${m[2]} năm ${m[1]}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Cell = { h: string; t: string };
const txt = (s: string): Cell => ({ h: esc(s), t: s });
const multi = (lines: string[]): Cell => ({ h: lines.map(esc).join('<br>'), t: lines.join('\n') });

/**
 * Bộ dựng nội dung: mỗi khối có bản HTML (dán Outlook giữ bảng) và bản text.
 * Giá trị thiếu → "[Tên ô]" tô vàng và ghi vào missing.
 */
class Doc {
  html: string[] = [];
  text: string[] = [];
  missing: string[] = [];

  val(label: string, v: unknown): Cell {
    const s = String(v ?? '').trim();
    if (s) return txt(s);
    if (!this.missing.includes(label)) this.missing.push(label);
    return { h: `<span style="background:#fde047">[${esc(label)}]</span>`, t: `[${label}]` };
  }
  p(c: Cell, bold = false) {
    this.html.push(`<p style="margin:0 0 8px">${bold ? `<b>${c.h}</b>` : c.h}</p>`);
    this.text.push(c.t);
  }
  plain(s: string, bold = false) {
    this.p(txt(s), bold);
  }
  list(rows: Cell[]) {
    this.html.push(`<ul style="margin:0 0 8px">${rows.map((r) => `<li>${r.h}</li>`).join('')}</ul>`);
    this.text.push(rows.map((r) => `- ${r.t}`).join('\n'));
  }
  items(rows: string[]) {
    this.list(rows.map(txt));
  }
  field(label: string, v: unknown): Cell {
    const x = this.val(label, v);
    return { h: `${esc(label)}: ${x.h}`, t: `${label}: ${x.t}` };
  }
  table(head: string[], rows: Cell[][]) {
    const td = 'border:1px solid #000;padding:4px 8px;vertical-align:top';
    this.html.push(
      `<table style="border-collapse:collapse;margin:0 0 8px"><tr>${head.map((x) => `<th style="${td};background:#f1f5f9">${esc(x)}</th>`).join('')}</tr>` +
        rows.map((r) => `<tr>${r.map((c) => `<td style="${td}">${c.h}</td>`).join('')}</tr>`).join('') +
        '</table>',
    );
    this.text.push([head.join(' | '), ...rows.map((r) => r.map((c) => c.t.replace(/\n/g, '; ')).join(' | '))].join('\n'));
  }
  signature(s: EmailSender) {
    const lines = [s.name, s.title, 'THE SUPRA CORPORATION', '(A member of MASAN Group)', s.phone && `[M] ${s.phone}`, s.email && `[E] ${s.email}`].filter(Boolean) as string[];
    this.html.push(`<p style="margin:12px 0 0;color:#1e3a8a">${lines.map(esc).join('<br>')}</p>`);
    this.text.push(lines.join('\n'));
  }
  out(subject: string): ComposedEmail {
    return {
      subject,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px">${this.html.join('\n')}</div>`,
      text: this.text.join('\n\n'),
      missing: this.missing,
    };
  }
}

const s = (c: Candidate, k: string) => String(c[k] ?? '').trim();

export function composeEmail(id: EmailTemplateId, c: Candidate, x: EmailExtras, sender: EmailSender): ComposedEmail {
  const d = new Doc();
  const name = s(c, 'full_name');
  const obIso = s(c, 'ob_date');
  const obDate = formatIsoDateToDisplay(obIso);

  switch (id) {
    case 'r6_new_hire': {
      const sendDisp = formatIsoDateToDisplay(x.sendDate).replace(/\//g, '.');
      const place = s(c, 'site') || s(c, 'location');
      d.plain('Dear Anh/Chị,', true);
      d.plain('The Supra gửi thông tin về nhân sự mới dưới đây, nhờ Anh/Chị thực hiện:');
      d.items(['Bộ phận IT tạo user Wincare cho nhân viên', 'Hỗ trợ nhân sự mới ra vào cổng, đón nhân sự mới và hướng dẫn chấm công trên App Wincare']);
      d.table(
        ['STT', 'Công ty', 'Ban/Chuỗi/Khối', 'Phòng/Vùng/Miền', 'Địa điểm', 'Các đơn vị thành viên', 'Mã nhân viên', 'Họ và tên', 'Vị trí', 'Ngày nhận việc'],
        [[
          txt('1'),
          txt('The Supra'),
          d.val('Khối', s(c, 'unit')),
          d.val('Vùng/Miền', s(c, 'region')),
          d.val('Địa điểm/Kho', place),
          d.val('Đơn vị thành viên (Phòng/Ban)', s(c, 'dept')),
          d.val('Mã nhân viên', s(c, 'emp_id')),
          d.val('Họ và tên', name),
          d.val('Vị trí', s(c, 'position')),
          d.val('Ngày nhận việc', obDate),
        ]],
      );
      d.plain('Em cảm ơn Anh/Chị.');
      d.signature(sender);
      return d.out(`[${sendDisp || '[Ngày gửi]'}] THÔNG BÁO NHÂN SỰ MỚI - ${(place || '[Địa điểm]').toUpperCase()}`);
    }

    case 'support_prep': {
      d.plain('Dear Anh/Chị,', true);
      d.plain('Phòng Tuyển dụng xin phép gửi Anh/Chị thông tin nhân sự mới và các công tác chuẩn bị nhằm hỗ trợ nhân sự mới nhận việc theo thông tin như bên dưới:');
      d.plain('1/ Thông tin nhân sự mới:', true);
      d.list([
        d.field('Họ và tên', name),
        d.field('MSNV', s(c, 'emp_id')),
        d.field('Vị trí', s(c, 'position')),
        d.field('Phòng', s(c, 'dept')),
        d.field('Khối', s(c, 'unit')),
        d.field('Vùng/Miền', s(c, 'region')),
        d.field('Địa điểm', x.workAddress || s(c, 'site') || s(c, 'location')),
        d.field('Ngày nhận việc', obDate),
      ]);
      d.plain('2/ Hạng mục cần chuẩn bị:', true);
      d.items([
        'Đón nhân sự mới, hướng dẫn nhận việc và hồ sơ thủ tục',
        'Đào tạo hội nhập nhân sự mới',
        'Setup vân tay ra vào văn phòng, cung cấp thẻ gửi xe',
        'Kiểm tra tồn kho laptop/order laptop mới, cung cấp laptop cho nhân sự mới (theo cấp bậc)',
        'Tạo user Wincare, tạo email mới, set up laptop, confirm license',
      ]);
      d.plain('Rất mong Anh/Chị theo dõi và hỗ trợ hoàn tất các hạng mục trên để đảm bảo nhân sự mới được đón tiếp và bắt đầu công việc thuận lợi.');
      d.plain('Cảm ơn Anh/Chị đã hỗ trợ.');
      d.signature(sender);
      return d.out(`THE SUPRA - THÔNG TIN HỖ TRỢ NHÂN SỰ MỚI NHẬN VIỆC - ${(name || '[Họ và tên]').toUpperCase()}`);
    }

    case 'ob_schedule': {
      d.plain('Dear Anh/Chị,', true);
      d.plain('Phòng Tuyển dụng xin phép gửi Anh/Chị thông tin nhân sự mới và các công tác chuẩn bị nhằm hỗ trợ nhân sự mới nhận việc theo thông tin như bên dưới:');
      d.plain('1/ Thông tin nhân sự mới:', true);
      d.list([
        d.field('Họ và tên', name),
        d.field('MSNV', s(c, 'emp_id')),
        d.field('Email', x.workEmail),
        d.field('Vị trí', s(c, 'position')),
        d.field('Phòng', s(c, 'dept')),
        d.field('Ngày nhận việc', obDate),
      ]);
      d.plain('2/ Lịch trình ngày nhận việc:', true);
      d.table(
        ['Thời gian', 'Lịch trình'],
        [
          [txt('9:00 – 9:30'), multi(['- Đón nhân sự mới nhận việc', '- Hướng dẫn nhận việc và hồ sơ thủ tục', '- IT setup máy tính', '- Hướng dẫn chỗ ngồi cho nhân sự mới'])],
          [txt('9:30 – 10:30'), multi(['- Đào tạo hội nhập nhân sự mới'])],
          [txt('10:30'), multi(['- Bàn giao nhân sự cho Quản lý trực tiếp'])],
        ],
      );
      d.plain('Nhờ Anh/Chị nắm thông tin và cùng hỗ trợ nhân sự mới vào ngày đầu nhận việc.');
      d.plain('Cảm ơn Anh/Chị.');
      d.signature(sender);
      return d.out(`THÔNG TIN NHÂN SỰ NHẬN VIỆC NGÀY ${obDate || '[Ngày nhận việc]'}`);
    }

    case 'reminder': {
      d.plain('Kính gửi Anh/Chị,', true);
      d.plain('Trước tiên, Phòng Nhân sự xin chúc mừng Anh/Chị đã chính thức trở thành thành viên mới của The Supra.');
      d.plain('Nhằm hỗ trợ Anh/Chị chuẩn bị tốt cho ngày nhận việc sắp tới, Phòng Nhân sự The Supra xin phép thông tin đến Anh/Chị các thông tin như bên dưới:');
      d.plain('1. Thời gian nhận việc:', true);
      d.list([d.val('Ngày nhận việc', longVnDate(obIso)), d.field('Thời gian', x.obTime)]);
      d.plain('2. Địa điểm làm việc:', true);
      d.list([d.val('Địa điểm làm việc', x.workAddress || s(c, 'site') || s(c, 'location')), txt('Khi đến, vui lòng thông báo Bảo vệ là nhân sự mới của Công ty để được hướng dẫn.')]);
      d.plain('3. Hồ sơ và giấy tờ cần chuẩn bị:', true);
      d.plain('Anh/Chị vui lòng mang theo các hồ sơ sau (bản sao công chứng không quá 06 tháng):');
      d.items(['Bằng cấp (công chứng 1 bản)', 'Giấy khám sức khỏe (bản gốc)', 'Sơ yếu lý lịch (công chứng 1 bản)', 'CCCD (công chứng 1 bản)']);
      d.plain('Trong ngày làm việc đầu tiên, Anh/Chị sẽ được hướng dẫn hoàn tất thủ tục tiếp nhận, ký kết hợp đồng và tham gia chương trình định hướng hội nhập nhằm hỗ trợ Anh/Chị nhanh chóng thích nghi với môi trường làm việc và văn hóa doanh nghiệp.');
      d.plain('Trong trường hợp cần hỗ trợ thêm thông tin hoặc có thay đổi về lịch nhận việc, Anh/Chị vui lòng phản hồi email này hoặc liên hệ theo thông tin bên dưới.');
      d.plain('Chúng tôi trân trọng chào đón Anh/Chị gia nhập The Supra và tin rằng sự đồng hành của Anh/Chị sẽ đóng góp tích cực vào sự phát triển bền vững của Công ty.');
      d.plain('Trân trọng.');
      d.signature(sender);
      return d.out('[THE SUPRA] REMINDER: THÔNG TIN NHẬN VIỆC');
    }

    case 'after_ob_contacts': {
      d.plain('Xin chào Anh/Chị,', true);
      d.plain('Để thuận tiện trong quá trình làm việc, Anh/Chị có thể tham khảo các thông tin sau đây:');
      d.plain('I. CÁC ĐẦU MỐI LIÊN HỆ', true);
      d.items([
        'IT: thiết bị làm việc, Outlook, tài khoản hệ thống hoặc các sự cố kỹ thuật.',
        'Nhân sự – C&B: hợp đồng lao động, phụ lục hợp đồng; chính sách lương, thưởng, phụ cấp; chấm công, tính lương; BHXH, BHYT, BHTN; bảo hiểm sức khỏe, chế độ phúc lợi.',
        'Nhân sự – Tuyển dụng: yêu cầu tuyển dụng.',
        'Nhân sự – HRBP: quan hệ lao động; lộ trình phát triển nghề nghiệp; đánh giá hiệu suất (KPIs/Performance Review); cơ cấu tổ chức, vai trò & trách nhiệm; môi trường làm việc; các vấn đề cần tư vấn về nhân sự.',
        'Hành chính (Admin): văn phòng, cấp phát tài sản, phòng họp, công tác hoặc hỗ trợ hậu cần.',
      ]);
      d.plain('II. CHƯƠNG TRÌNH BẢO HIỂM TAI NẠN VÀ SỨC KHỎE', true);
      d.items([
        'Bảo hiểm tai nạn 24/24: áp dụng với toàn bộ nhân viên từ ngày bắt đầu làm việc tại Công ty.',
        'Bảo hiểm sức khỏe: nhân viên cấp bậc 4, 5 tham gia từ ngày ký HĐLĐ với Công ty; nhân viên cấp bậc 3 trở lên tham gia từ ngày bắt đầu làm việc tại Công ty.',
        'Bảo hiểm y tế xã hội bắt buộc: áp dụng với toàn bộ nhân viên từ ngày ký HĐLĐ với Công ty.',
      ]);
      d.plain('Anh/Chị vui lòng tham khảo tài liệu đính kèm liên quan đến Chương trình Bảo hiểm Tai nạn và Sức khỏe dành cho Nhân viên và người thân, bao gồm quyền lợi, phạm vi bảo hiểm và hướng dẫn sử dụng App Insmart.');
      d.plain('Trong quá trình làm việc, nếu có bất kỳ thắc mắc hoặc cần trao đổi thêm, Anh/Chị đừng ngần ngại trao đổi với Quản lý trực tiếp hoặc Phòng Nhân sự để được hỗ trợ kịp thời.');
      d.plain('Một lần nữa, chào mừng Anh/Chị gia nhập The Supra. Chúc Anh/Chị có một hành trình làm việc hiệu quả và nhiều thành công tại Công ty.');
      d.plain('Trân trọng,');
      d.signature(sender);
      return d.out('[TSC] - THÔNG TIN ĐẦU MỐI HỖ TRỢ DÀNH CHO NHÂN SỰ MỚI');
    }
  }
}

/** Copy dạng HTML (dán Outlook giữ bảng), trình duyệt không cho thì copy text. */
export async function copyEmailHtml(e: { html: string; text: string }): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([e.html], { type: 'text/html' }),
          'text/plain': new Blob([e.text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    /* rơi xuống copy text */
  }
  try {
    await navigator.clipboard.writeText(e.text);
    return true;
  } catch {
    return false;
  }
}

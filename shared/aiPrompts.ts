/**
 * Ready-made prompts the TA copies into Claude (chat). The app never sends anything to an outside service by itself:
 * the TA pastes the CV or text into Claude, checks the answer, and pastes it back.
 * Prompts carry only what the task needs: no name, phone, ID number, address or salary.
 */

export interface SummaryContext {
  position?: string;
  experienceYears?: string;
}

export function summaryPrompt(ctx: SummaryContext): string {
  const lines = [
    'Bạn là chuyên viên tuyển dụng. Tôi đính kèm CV của một ứng viên.',
    ctx.position ? `Vị trí ứng tuyển: ${ctx.position}.` : '',
    ctx.experienceYears ? `Số năm kinh nghiệm (TA đã nhập): ${ctx.experienceYears}.` : '',
    '',
    'Hãy tóm tắt kinh nghiệm làm việc bằng tiếng Việt, 4 đến 6 dòng, mỗi dòng một ý:',
    '- Công ty và vai trò gần nhất, thời gian làm việc.',
    '- Nhiệm vụ chính và kết quả nếu CV có nêu.',
    '- Kỹ năng, chứng chỉ hoặc công cụ liên quan đến vị trí ứng tuyển.',
    '',
    'Quy tắc: chỉ dùng thông tin có trong CV, không suy đoán; thông tin nào CV không nêu thì ghi "CV không nêu". Không đưa họ tên, số điện thoại, địa chỉ, số CCCD hay mức lương vào phần tóm tắt. Chỉ trả về phần tóm tắt, không thêm lời dẫn.',
  ];
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}

export function translationPrompt(vietnameseText: string): string {
  return [
    'Dịch đoạn tiếng Việt dưới đây sang tiếng Anh chuyên nghiệp, dùng cho hồ sơ tuyển dụng.',
    'Giữ nguyên số liệu, tên công ty và tên riêng; không thêm hoặc bớt thông tin. Chỉ trả về bản dịch, không thêm lời dẫn.',
    '',
    '---',
    vietnameseText.trim(),
  ].join('\n');
}

/** Copies text to the clipboard; returns false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

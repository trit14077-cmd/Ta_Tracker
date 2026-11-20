// M7-7: mọi câu tiếng Việt CHỈ CÓ Ở HỆ MỚI (frontend/src, supabase/functions, detail/raise của migration) phải có tiếng Anh.
// Câu của hệ cũ đã có trong từ điển cũ (shared/i18n.ts) – test này chặn việc thêm câu mới mà quên dịch.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOUN_EN, translateAll } from '../../frontend/src/i18nNew.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VI = /[À-ỹ]/;
function walk(d: string, ext: RegExp, out: string[] = []): string[] {
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(f)) out.push(p);
  }
  return out;
}
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}\n]+)</g;
function literals(src: string): string[] {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out: string[] = [];
  for (const m of s.matchAll(LITERAL)) {
    const v = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (v && VI.test(v) && !v.includes('${')) out.push(v);
  }
  return out;
}
// Mảnh câu ghép với giá trị (dịch qua mẫu ở i18nNew.ts)
const FRAGMENTS = new Set(['Dữ liệu chưa hợp lệ:', 'Không lưu được hồ sơ tài khoản:', 'Chưa xác nhận tuyển được, còn thiếu:', 'Giá trị "']);

// Câu của hệ cũ (thư mục OLD nằm cạnh NEW ở máy phát triển; trên CI không có => chỉ dựa vào từ điển)
const oldSrc = [
  ...walk(join(ROOT, '../OLD/src'), /\.(ts|tsx)$/).map((f) => readFileSync(f, 'utf8')),
  ...walk(join(ROOT, '../OLD/apps-script'), /\.gs$/).map((f) => readFileSync(f, 'utf8')),
].join('\n');
const known = (v: string) => FRAGMENTS.has(v) || Boolean(NOUN_EN[v]) || translateAll(v) !== v || (oldSrc !== '' && oldSrc.includes(v));

describe('câu mới của hệ mới đều có tiếng Anh', () => {
  it('frontend + Edge Function', () => {
    const files = [...walk(join(ROOT, 'frontend/src'), /\.(ts|tsx)$/), ...walk(join(ROOT, 'supabase/functions'), /\.ts$/)];
    expect(files.length).toBeGreaterThan(20);
    const missing: string[] = [];
    for (const f of files) {
      if (f.endsWith('i18nNew.ts')) continue;
      for (const v of literals(readFileSync(f, 'utf8'))) if (!known(v)) missing.push(`${f.replace(ROOT, '')}: ${v}`);
    }
    expect(missing).toEqual([]);
  });
  it('thông báo do database trả về (detail / raise exception)', () => {
    const sql = walk(join(ROOT, 'supabase/migrations'), /\.sql$/).map((f) => readFileSync(f, 'utf8')).join('\n');
    const msgs = new Set<string>();
    for (const m of sql.matchAll(/(?:detail = |raise exception )'([^']*[À-ỹ][^']*)'/g)) msgs.add(m[1].replace(/: %$/, ': X').trim());
    expect(msgs.size).toBeGreaterThan(10);
    expect([...msgs].filter((v) => !known(v))).toEqual([]);
  });
});

describe('mẫu câu có giá trị chen vào', () => {
  it.each([
    ['Không tải được số liệu theo kỳ.', 'Could not load the period numbers.'],
    ['Không tìm thấy buổi phỏng vấn hoặc bạn không có quyền sửa.', 'Could not find the interview, or you may not change it.'],
    ['Tải xuống CV chưa có trong hệ thống mới (làm ở M7-1). Trong thời gian chuyển đổi, vui lòng dùng hệ thống cũ cho việc này.',
      'Downloading a CV is not available in the new system yet (planned in M7-1). Until then, please use the old system for this.'],
    ['Mã ứng viên "TA10001" đã tồn tại (không ghi đè).', 'Candidate code "TA10001" already exists (not overwritten).'],
    ['Mật khẩu mới phải có ít nhất 8 ký tự.', 'The new password must have at least 8 characters.'],
    ['Đã chuyển Nguyễn A từ R1 sang LU / SU và đã lưu. Mở hồ sơ để nhập ngày, giờ, lý do nếu cần.',
      'Moved Nguyễn A from R1 to LU / SU and saved. Open the profile to enter the date, time or reason if needed.'],
    ['  Đang lưu…  ', '  Saving…  '],
  ])('%s', (vi, en) => {
    expect(translateAll(vi)).toBe(en);
  });
  it('câu của hệ cũ vẫn dịch bằng từ điển cũ; dữ liệu giữ nguyên', () => {
    expect(translateAll('Trạng thái')).toBe('Status');
    expect(translateAll('Nguyễn Văn A')).toBe('Nguyễn Văn A');
  });
});

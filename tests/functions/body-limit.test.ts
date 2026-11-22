// M9-3: giới hạn kích thước body cho Edge Function (readBodyLimited / readJsonLimited / readFormLimited).
import { describe, expect, it } from 'vitest';
import {
  BODY_MAX_APPLY, BODY_MAX_IMPORT, BODY_MAX_JSON, BODY_MAX_UPLOAD, BodyTooLarge, DRAIN_MAX, readBodyLimited, readFormLimited, readJsonLimited,
} from '../../supabase/functions/admin-users/logic.ts';

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('https://fn.example/x', { method: 'POST', body, headers });

/**
 * Body dạng luồng, KHÔNG có Content-Length (như chunked); đếm số mảnh đã bị đọc.
 * Dùng Request giả tối thiểu (headers + body): Request thật của Node đọc trước 1 mảnh và lỗi khi hủy luồng.
 */
function streamed(chunks: number, chunkSize: number, headers: Record<string, string> = {}) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (pulled >= chunks) return c.close();
        pulled++;
        c.enqueue(new Uint8Array(chunkSize).fill(0x61));
      },
    },
    { highWaterMark: 0 },
  );
  const req = { headers: new Headers(headers), body: stream } as unknown as Request;
  return { req, pulled: () => pulled };
}

describe('readJsonLimited', () => {
  it('đọc JSON nhỏ bình thường', async () => {
    expect(await readJsonLimited(post(JSON.stringify({ op: 'patch', id: 7 })), BODY_MAX_JSON)).toEqual({ op: 'patch', id: 7 });
  });

  it('JSON sai / body rỗng => SyntaxError (Edge trả 400 BAD_JSON như trước)', async () => {
    await expect(readJsonLimited(post('{oops'), BODY_MAX_JSON)).rejects.toBeInstanceOf(SyntaxError);
    await expect(readJsonLimited(post(''), BODY_MAX_JSON)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('vượt giới hạn => BodyTooLarge (Edge trả 413)', async () => {
    const big = JSON.stringify({ note: 'x'.repeat(2000) });
    await expect(readJsonLimited(post(big), 1000)).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it('đúng bằng giới hạn vẫn nhận', async () => {
    const s = JSON.stringify('x'.repeat(98)); // 100 byte
    expect(await readJsonLimited(post(s), 100)).toBe('x'.repeat(98));
  });
});

describe('readBodyLimited', () => {
  // Edge runtime Supabase chỉ gửi response khi body đã được đọc hết (DEV 22/11/2026: không đọc ⇒ treo 150 s ⇒ 503).
  it('Content-Length khai lớn hơn giới hạn => 413, phần body được đọc bỏ hết để runtime trả được response', async () => {
    const { req, pulled } = streamed(5, 10, { 'Content-Length': '50' });
    await expect(readBodyLimited(req, 20)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(pulled()).toBe(5);
  });

  it('Content-Length khai vượt DRAIN_MAX => cắt luồng ngay, không đọc', async () => {
    const { req, pulled } = streamed(5, 10, { 'Content-Length': String(DRAIN_MAX + 1) });
    await expect(readBodyLimited(req, 100)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(pulled()).toBe(0);
  });

  it('không có Content-Length: vượt giới hạn => 413 sau khi đọc bỏ phần còn lại', async () => {
    const { req, pulled } = streamed(1000, 1024); // ~1 MB
    await expect(readBodyLimited(req, 4096)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(pulled()).toBe(1000);
  });

  it('không có Content-Length: luồng dài quá DRAIN_MAX => đọc bỏ tới DRAIN_MAX rồi cắt', async () => {
    const chunk = 1024 * 1024;
    const { req, pulled } = streamed(DRAIN_MAX / chunk + 20, chunk);
    await expect(readBodyLimited(req, 4096)).rejects.toBeInstanceOf(BodyTooLarge);
    expect(pulled()).toBe(DRAIN_MAX / chunk + 1);
  });

  it('ghép đúng các mảnh khi trong giới hạn', async () => {
    const { req } = streamed(3, 4);
    const bytes = await readBodyLimited(req, 100);
    expect(bytes.byteLength).toBe(12);
    expect(new TextDecoder().decode(bytes)).toBe('aaaaaaaaaaaa');
  });
});

describe('readFormLimited', () => {
  it('đọc multipart (ô chữ + file) trong giới hạn', async () => {
    const fd = new FormData();
    fd.set('op', 'upload');
    fd.set('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'cv.pdf');
    const out = await readFormLimited(post(fd), BODY_MAX_UPLOAD);
    expect(out.get('op')).toBe('upload');
    const f = out.get('file') as File;
    expect(f.name).toBe('cv.pdf');
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it('file vượt giới hạn => BodyTooLarge, không trả FormData', async () => {
    const fd = new FormData();
    fd.set('cv', new Blob([new Uint8Array(3000)]), 'cv.pdf');
    // dựng sẵn byte multipart: hủy luồng FormData đang sinh dở làm undici của Node báo lỗi ngoài test
    const enc = new Response(fd);
    const bytes = new Uint8Array(await enc.arrayBuffer());
    const req = post(bytes, { 'Content-Type': enc.headers.get('Content-Type') ?? '' });
    await expect(readFormLimited(req, 2000)).rejects.toBeInstanceOf(BodyTooLarge);
  });
});

describe('ngưỡng theo function', () => {
  it('ngưỡng đủ chỗ cho giới hạn nghiệp vụ (CV 5 MB, file 10 MB) cộng phần bao', () => {
    expect(BODY_MAX_APPLY).toBeGreaterThan(5 * 1024 * 1024);
    expect(BODY_MAX_UPLOAD).toBeGreaterThan(10 * 1024 * 1024);
    expect(BODY_MAX_IMPORT).toBeGreaterThan(BODY_MAX_JSON);
  });
});

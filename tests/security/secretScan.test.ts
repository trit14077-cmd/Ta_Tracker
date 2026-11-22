// M9-3: bộ quét lộ khóa (scripts/security/secretScanLib.ts).
// Khóa giả được GHÉP lúc chạy để file test không tự khớp guard.sh / secretScan --history.
import { describe, expect, it } from 'vitest';
import { jwtRole, scanGitLogPatch, scanLine, scanText, serverNamesInBundle } from '../../scripts/security/secretScanLib.ts';

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: Record<string, unknown>) => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(payload)}.${'s'.repeat(43)}`;
const SECRET = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8';
const PEM = '-----BEGIN ' + 'PRIVATE KEY-----';

describe('JWT: phân biệt anon và service_role', () => {
  it('đọc role trong payload', () => {
    expect(jwtRole(b64u({ role: 'anon' }))).toBe('anon');
    expect(jwtRole(b64u({ role: 'service_role' }))).toBe('service_role');
    expect(jwtRole('%%%')).toBeNull();
  });

  it('anon key trong bundle là bình thường', () => {
    expect(scanLine(`const k="${jwt({ iss: 'supabase', role: 'anon' })}";`)).toEqual([]);
  });

  it('service_role trong bundle => báo', () => {
    expect(scanLine(`x=${jwt({ iss: 'supabase', role: 'service_role' })}`)).toEqual(['SERVICE_ROLE_JWT']);
  });

  it('JWT phiên người dùng (authenticated) dán nhầm => báo', () => {
    expect(scanLine(jwt({ sub: 'u1', role: 'authenticated' }))).toEqual(['NON_ANON_JWT']);
  });
});

describe('các mẫu khác', () => {
  it.each([
    ['SUPABASE_SECRET_KEY', `key: '${SECRET}'`],
    ['PRIVATE_KEY', PEM],
    ['GOOGLE_SA_JSON', `{"private_` + `key": "${PEM}\\nMIIE"}`],
    ['GOOGLE_OAUTH_CLIENT_SECRET', 'GOC' + 'SPX-' + 'a'.repeat(28)],
    ['GOOGLE_REFRESH_TOKEN', 'token=1/' + '/0' + 'g'.repeat(60)],
    ['DB_URL_WITH_PASSWORD', 'postgresql:' + '//postgres.abc:S3cretPass@aws-0-ap.pooler.supabase.com:5432/postgres'],
    ['TELEGRAM_BOT_TOKEN', '123456789:' + 'AA' + 'h'.repeat(33)],
  ])('%s', (kind, line) => {
    expect(scanLine(line)).toContain(kind);
  });

  it('không báo nhầm: publishable key, URL DB không mật khẩu, tên biến môi trường, regex', () => {
    expect(scanLine("const k='sb_publishable_abcdefghijklmnop'")).toEqual([]);
    expect(scanLine('postgresql://postgres@localhost:5432/postgres')).toEqual([]);
    expect(scanLine("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")).toEqual([]);
    expect(scanLine("p_secret='sb_''secret_[A-Za-z0-9_-]{10,}'")).toEqual([]);
  });

  it('scanText trả số dòng', () => {
    expect(scanText(`a\nb\n${SECRET}\n`)).toEqual([{ kind: 'SUPABASE_SECRET_KEY', line: 3 }]);
  });
});

describe('bundle', () => {
  it('tên biến chỉ dùng ở server lọt vào bundle => báo', () => {
    expect(serverNamesInBundle('fetch(x,{h:import.meta.env.SUPABASE_' + 'SERVICE_ROLE_KEY})')).toEqual(['SUPABASE_' + 'SERVICE_ROLE_KEY']);
    expect(serverNamesInBundle('import.meta.env.VITE_SUPABASE_ANON_KEY')).toEqual([]);
  });
});

describe('lịch sử Git', () => {
  const log = [
    'commit 0123456789abcdef0123456789abcdef01234567',
    'Author: x',
    '    commit message nhắc tới ' + SECRET + ' (không phải dòng thêm vào file)',
    'diff --git a/.env b/.env',
    '--- /dev/null',
    '+++ b/.env',
    '+SUPABASE_KEY=' + SECRET,
    'commit fedcba9876543210fedcba9876543210fedcba98',
    '+++ b/src/a.ts',
    '-' + SECRET,
    '+const ok = 1;',
  ];

  it('chỉ báo dòng được THÊM, kèm commit + file', () => {
    const hits = scanGitLogPatch(log);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'SUPABASE_SECRET_KEY', commit: '0123456789ab', file: '.env' });
  });
});

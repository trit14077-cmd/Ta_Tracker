// M9-3: phần thuần của bộ quét lộ khóa (bundle frontend + lịch sử Git). Test: tests/security/secretScan.test.ts.
// Khác scripts/ci/guard.sh: JWT được GIẢI MÃ payload – anon key (role=anon) được phép nằm trong bundle; chỉ báo khi
// role=service_role (hoặc JWT không phải anon, ví dụ phiên người dùng bị dán nhầm).
// Mẫu được ghép chuỗi để chính file này không tự khớp khi guard.sh quét repo.
// Kết quả CHỈ có tên mẫu + vị trí, KHÔNG có giá trị khóa.

export type SecretKind =
  | 'SUPABASE_SECRET_KEY'
  | 'SERVICE_ROLE_JWT'
  | 'NON_ANON_JWT'
  | 'PRIVATE_KEY'
  | 'GOOGLE_SA_JSON'
  | 'GOOGLE_OAUTH_CLIENT_SECRET'
  | 'GOOGLE_REFRESH_TOKEN'
  | 'DB_URL_WITH_PASSWORD'
  | 'TELEGRAM_BOT_TOKEN';

export interface SecretHit {
  kind: SecretKind;
  line: number;
}

const SIMPLE: [SecretKind, RegExp][] = [
  ['SUPABASE_SECRET_KEY', new RegExp('sb_' + 'secret_[A-Za-z0-9_-]{10,}')],
  ['PRIVATE_KEY', new RegExp('-----BEGIN [A-Z ]*' + 'PRIVATE KEY-----')],
  ['GOOGLE_SA_JSON', new RegExp('"private_' + 'key"\\s*:\\s*"-----')],
  ['GOOGLE_OAUTH_CLIENT_SECRET', new RegExp('GOC' + 'SPX-[A-Za-z0-9_-]{20,}')],
  ['GOOGLE_REFRESH_TOKEN', new RegExp('(?<![A-Za-z0-9])1/' + '/0[A-Za-z0-9_-]{40,}')],
  ['DB_URL_WITH_PASSWORD', new RegExp('postgres(ql)?:' + '//[^:/\\s"\'`]+:[^@\\s"\'`]{6,}@[A-Za-z0-9.-]+')],
  ['TELEGRAM_BOT_TOKEN', new RegExp('(?<![0-9])[0-9]{8,10}:' + 'AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])')],
];
const JWT = new RegExp('ey' + 'J[A-Za-z0-9_-]{8,}\\.(ey' + 'J[A-Za-z0-9_-]{8,})\\.[A-Za-z0-9_-]{8,}', 'g');

/** role trong payload JWT; null nếu không giải mã được. */
export function jwtRole(payloadB64url: string): string | null {
  try {
    const b64 = payloadB64url.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { role?: unknown };
    return typeof json.role === 'string' ? json.role : '';
  } catch {
    return null;
  }
}

/** Quét 1 dòng văn bản. */
export function scanLine(text: string): SecretKind[] {
  const out: SecretKind[] = [];
  for (const [kind, re] of SIMPLE) if (re.test(text)) out.push(kind);
  for (const m of text.matchAll(JWT)) {
    const role = jwtRole(m[1]);
    if (role === 'anon') continue;
    out.push(role === 'service_role' ? 'SERVICE_ROLE_JWT' : 'NON_ANON_JWT');
  }
  return [...new Set(out)];
}

/** Quét cả văn bản (nhiều dòng). Dòng dài (bundle minify) vẫn quét nguyên dòng. */
export function scanText(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    for (const kind of scanLine(l)) hits.push({ kind, line: i + 1 });
  });
  return hits;
}

/**
 * Tên biến bí mật KHÔNG được xuất hiện trong bundle trình duyệt (dấu hiệu code server bị gói nhầm vào frontend).
 * Chỉ áp cho bundle, không áp cho repo (Edge Function đọc các biến này là đúng).
 */
const SERVER_ONLY_NAMES = ['SUPABASE_' + 'SERVICE_ROLE_KEY', 'GOOGLE_' + 'OAUTH_CLIENT_SECRET', 'GOOGLE_' + 'OAUTH_REFRESH_TOKEN', 'GDRIVE_' + 'SA_JSON'];
export function serverNamesInBundle(text: string): string[] {
  return SERVER_ONLY_NAMES.filter((n) => text.includes(n));
}

/** Đọc output `git log -p` từng dòng, gắn commit + file cho mỗi phát hiện (chỉ dòng được THÊM). */
export interface HistoryHit extends SecretHit {
  commit: string;
  file: string;
}
/** Bộ quét tăng dần cho output `git log -p` (đẩy từng dòng; dùng được với luồng readline). */
export function patchScanner() {
  const hits: HistoryHit[] = [];
  let commit = '';
  let file = '';
  let n = 0;
  return {
    hits,
    push(l: string) {
      n++;
      if (l.startsWith('commit ')) {
        commit = l.slice(7, 19);
        return;
      }
      if (l.startsWith('+++ ')) {
        file = l.replace(/^\+\+\+ (b\/)?/, '');
        return;
      }
      if (!l.startsWith('+')) return;
      for (const kind of scanLine(l.slice(1))) hits.push({ kind, line: n, commit, file });
    },
  };
}

export function scanGitLogPatch(lines: Iterable<string>): HistoryHit[] {
  const s = patchScanner();
  for (const l of lines) s.push(l);
  return s.hits;
}

// Google Drive qua OAuth của Gmail cá nhân (secret GOOGLE_OAUTH_*; thư mục gốc GOOGLE_DRIVE_ROOT_FOLDER_ID).
// Access token giữ trong bộ nhớ của phiên Edge tới khi gần hết hạn. Không bao giờ trả token ra ngoài.
const env = (k: string) => Deno.env.get(k) ?? '';
let cached: { token: string; until: number } | null = null;

export class DriveError extends Error {}

export function driveConfigured(): boolean {
  return ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN', 'GOOGLE_DRIVE_ROOT_FOLDER_ID'].every((k) => env(k));
}

export async function token(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_OAUTH_CLIENT_ID'), client_secret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_OAUTH_REFRESH_TOKEN'), grant_type: 'refresh_token',
    }),
  });
  const j = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) throw new DriveError(`token: ${j.error ?? r.status}`);
  cached = { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 300) * 1000 };
  return cached.token;
}

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token()}` } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({})) as { error?: { message?: string } };
    throw new DriveError(`drive ${r.status}: ${j.error?.message ?? ''}`);
  }
  return r;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const FOLDER = 'application/vnd.google-apps.folder';

/** Thư mục con theo tên trong thư mục gốc (tạo nếu chưa có). */
export async function ensureFolder(name: string): Promise<string> {
  const root = env('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  const query = `name = '${q(name)}' and '${q(root)}' in parents and mimeType = '${FOLDER}' and trashed = false`;
  const found = await (await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json() as { files?: { id: string }[] };
  if (found.files?.[0]?.id) return found.files[0].id;
  const made = await (await api('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [root] }),
  })).json() as { id: string };
  return made.id;
}

/** Tải lên (resumable: 1 lần khởi tạo + 1 lần gửi nội dung, chạy với mọi cỡ ≤10 MB). Trả drive file id. */
export async function upload(folderId: string, name: string, mime: string, bytes: ArrayBuffer): Promise<string> {
  const init = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(bytes.byteLength) },
    body: JSON.stringify({ name, parents: [folderId], mimeType: mime }),
  });
  const loc = init.headers.get('Location');
  if (!loc) throw new DriveError('upload: no session');
  const put = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
  const j = await put.json().catch(() => ({})) as { id?: string };
  if (!put.ok || !j.id) throw new DriveError(`upload ${put.status}`);
  return j.id;
}

/** Nội dung file (stream) để trả về trình duyệt. */
export async function download(fileId: string): Promise<Response> {
  return await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
}

/** Dọn file vừa tải lên khi ghi DB thất bại (cho vào thùng rác, không xóa hẳn). */
export async function trash(fileId: string): Promise<void> {
  await api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  }).catch(() => undefined);
}

export function googleConfigured(): boolean {
  return ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'].every((k) => env(k));
}

/** Đọc 1 tab của Google Sheet (giá trị như hiển thị). 403/404 => SheetAccessError (sheet chưa chia sẻ cho tài khoản Google của hệ thống). */
export class SheetAccessError extends Error {}
export async function readSheet(sheetId: string, tab: string): Promise<unknown[][]> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (r.status === 400 || r.status === 403 || r.status === 404) throw new SheetAccessError(String(r.status)); // 400: sai tên tab
  if (!r.ok) throw new DriveError(`sheets ${r.status}`);
  const j = await r.json() as { values?: unknown[][] };
  return j.values ?? [];
}

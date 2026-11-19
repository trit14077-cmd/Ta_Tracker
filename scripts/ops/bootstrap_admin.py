#!/usr/bin/env python3
"""Tạo tài khoản Admin ĐẦU TIÊN trên Supabase DEV (sau đó Admin dùng màn hình Quản lý người dùng / Edge admin-users).

Chạy (từ thư mục NEW), mật khẩu gõ trong terminal và không hiện ra màn hình:
    python scripts/ops/bootstrap_admin.py <username> "<Họ tên>"
Chỉ chạy được khi DB chưa có Admin nào đang hoạt động (tránh dùng nhầm để tạo thêm Admin ngoài quy trình).
Đọc SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ENV=dev từ NEW/.env. Không in khóa, không in mật khẩu.
"""
import getpass, json, re, sys, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_DOMAIN = 'ta.supra.internal'          # giống supabase/functions/admin-users/logic.ts (D-05b)
USERNAME_RE = re.compile(r'^[A-Za-z0-9._-]{3,40}$')
PASSWORD_MIN = 8


def env():
    out = {}
    for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def call(base, key, method, path, body=None, prefer=None):
    h = {'apikey': key, 'Content-Type': 'application/json'}
    if key.count('.') == 2:
        h['Authorization'] = 'Bearer ' + key
    if prefer:
        h['Prefer'] = prefer
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(base + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode('utf-8')
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace').replace(key, '***')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'message': raw[:300]}


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) < 2:
        raise SystemExit('Cách dùng: python scripts/ops/bootstrap_admin.py <username> "<Họ tên>"')
    username, full_name = sys.argv[1].strip(), (sys.argv[2].strip() if len(sys.argv) > 2 else '')
    if not USERNAME_RE.match(username):
        raise SystemExit('Tên đăng nhập 3–40 ký tự, chỉ gồm chữ không dấu, số và . _ -')
    e = env()
    if e.get('SUPABASE_ENV') != 'dev':
        raise SystemExit('Từ chối: SUPABASE_ENV trong .env phải là "dev".')
    url, key = e['SUPABASE_URL'].rstrip('/'), e['SUPABASE_SERVICE_ROLE_KEY']

    st, admins = call(url, key, 'GET', '/rest/v1/profiles?select=id&role=eq.admin&active=is.true')
    if st != 200:
        raise SystemExit(f'Không đọc được profiles (HTTP {st}).')
    if admins:
        raise SystemExit('Đã có Admin đang hoạt động. Hãy dùng màn hình Quản lý người dùng (Edge admin-users) để tạo thêm tài khoản.')

    pw = getpass.getpass('Mật khẩu cho Admin (không hiện khi gõ): ')
    if len(pw) < PASSWORD_MIN:
        raise SystemExit(f'Mật khẩu phải có ít nhất {PASSWORD_MIN} ký tự.')
    if getpass.getpass('Nhập lại mật khẩu: ') != pw:
        raise SystemExit('Hai lần nhập không khớp.')

    st, user = call(url, key, 'POST', '/auth/v1/admin/users', {
        'email': f'{username.lower()}@{EMAIL_DOMAIN}', 'password': pw, 'email_confirm': True,
        'user_metadata': {'username': username},
    })
    if st not in (200, 201) or not user or not user.get('id'):
        raise SystemExit(f'Không tạo được user Auth (HTTP {st}): {(user or {}).get("msg") or (user or {}).get("message")}')
    uid = user['id']
    st, res = call(url, key, 'POST', '/rest/v1/profiles',
                   {'id': uid, 'username': username, 'full_name': full_name, 'role': 'admin'}, prefer='return=minimal')
    if st >= 300:
        call(url, key, 'DELETE', f'/auth/v1/admin/users/{uid}')
        raise SystemExit(f'Không lưu được profile (HTTP {st}): {res}. Đã xóa user Auth vừa tạo.')
    call(url, key, 'POST', '/rest/v1/audit_logs', {
        'actor_username': 'bootstrap_admin.py', 'actor_role': 'system', 'action': 'USER_CREATE',
        'changes': {'target_user': uid, 'username': username, 'role': 'admin'}}, prefer='return=minimal')
    print(f'Đã tạo Admin "{username}" (id {uid}). Đăng nhập bằng tên đăng nhập này và mật khẩu vừa nhập.')


if __name__ == '__main__':
    main()

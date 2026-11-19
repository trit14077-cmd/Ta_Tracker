#!/usr/bin/env python3
"""Kiểm tra nhanh (smoke test) đường ghi hồ sơ trên Supabase DEV bằng JWT THẬT của một tài khoản TA tạm.

Chạy (từ thư mục NEW):  python scripts/ops/smoke_records_save.py
Cần: NEW/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ENV=dev) và frontend/.env.local (VITE_SUPABASE_ANON_KEY).

Các bước: tạo TA tạm (PIC TA1-Phat) -> đăng nhập -> records-save: tạo, sửa, sửa bằng phiên bản cũ (409), kéo Kanban,
lưu trữ, khôi phục, tạo thiếu trường (422), sửa hồ sơ PIC khác (404) -> list_candidates, board_counts bằng JWT TA.
LUÔN dọn sạch (kể cả khi lỗi): hồ sơ test + lịch sử + audit + applicant + profile + tài khoản tạm.
Mật khẩu tạm sinh ngẫu nhiên, không in ra; không in khóa; chỉ dùng dữ liệu giả.
"""
import json, secrets, sys, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PIC = 'TA1-Phat'


def read_env(p):
    out = {}
    if p.exists():
        for line in p.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    return out


env = read_env(ROOT / '.env')
fe = read_env(ROOT / 'frontend' / '.env.local')
if env.get('SUPABASE_ENV') != 'dev':
    raise SystemExit('Từ chối: SUPABASE_ENV trong .env phải là "dev".')
URL, SERVICE, ANON = env['SUPABASE_URL'].rstrip('/'), env['SUPABASE_SERVICE_ROLE_KEY'], fe['VITE_SUPABASE_ANON_KEY']
SECRETS = [SERVICE, ANON]


def call(method, path, body=None, key=None, jwt=None, prefer=None):
    h = {'apikey': key or ANON, 'Content-Type': 'application/json'}
    if jwt:
        h['Authorization'] = 'Bearer ' + jwt
    elif (key or '').count('.') == 2:
        h['Authorization'] = 'Bearer ' + key
    if prefer:
        h['Prefer'] = prefer
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode('utf-8')
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        for s in SECRETS:
            raw = raw.replace(s, '***')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw[:300]}


svc = lambda m, p, b=None, prefer=None: call(m, p, b, key=SERVICE, prefer=prefer)
results = []


def check(name, cond, extra=''):
    results.append(bool(cond))
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {str(extra)[:300]}'))


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    tag = secrets.token_hex(3)
    username = f'smoke_test_{tag}'
    password = secrets.token_urlsafe(18)
    uid, rec_id, applicant_id = None, None, None
    try:
        st, u = svc('POST', '/auth/v1/admin/users', {'email': f'{username}@ta.supra.internal', 'password': password, 'email_confirm': True})
        assert st in (200, 201), f'không tạo được user tạm (HTTP {st})'
        uid = u['id']
        st, _ = svc('POST', '/rest/v1/profiles', {'id': uid, 'username': username, 'full_name': 'Smoke Test', 'role': 'pic', 'pic_code': PIC}, prefer='return=minimal')
        assert st < 300, f'không tạo được profile (HTTP {st})'
        st, tok = call('POST', '/auth/v1/token?grant_type=password', {'email': f'{username}@ta.supra.internal', 'password': password})
        assert st == 200, f'không đăng nhập được (HTTP {st})'
        jwt = tok['access_token']
        rs = lambda body: call('POST', '/functions/v1/records-save', body, jwt=jwt)

        values = {
            'full_name': f'Smoke Test {tag}', 'gender': 'Nữ', 'birth': '1999', 'phone': f'0999{secrets.randbelow(10**6):06d}',
            'position': 'Nhân viên Kho', 'site': 'DC Bình Dương 1', 'region': 'Miền Nam', 'location': 'Bình Dương',
            'unit': 'Chuỗi Cung ứng', 'dept': 'Ambient Retail', 'rank': '6A', 'sub_source': 'Zalo',
            'candidate_code': 'HACK1',
        }
        st, b = rs({'op': 'create', 'values': {**values, 'pic': 'TA2-Hien'}})
        check('TA tạo hồ sơ cho PIC khác => 403 FORBIDDEN_PIC (như hệ cũ)', st == 403 and (b or {}).get('error', {}).get('code') == 'FORBIDDEN_PIC', f'HTTP {st} {b}')
        st, b = rs({'op': 'create', 'values': values})
        rec = (b or {}).get('record') or {}
        rec_id, applicant_id = rec.get('id'), rec.get('applicant_id')
        check('tạo hồ sơ (201)', st == 201, f'HTTP {st} {b}')
        check('PIC tự gán theo TA, mã tự sinh TA100…, bỏ mã gõ tay', rec.get('pic') == PIC and str(rec.get('candidate_code', '')).startswith('TA100'), rec.get('candidate_code'))
        check('source tự tính, SĐT chuẩn hóa 9 số', rec.get('source') == 'Social Media' and len(str(rec.get('phone', ''))) == 9, (rec.get('source'), rec.get('phone')))

        st, b = rs({'op': 'create', 'values': {**values, 'gender': ''}})
        check('tạo thiếu giới tính => 422 VALIDATION_FAILED có lỗi theo field', st == 422 and (b or {}).get('error', {}).get('fields', {}).get('gender'), f'HTTP {st} {b}')

        st, b = rs({'op': 'patch', 'id': rec_id, 'expected_version': 1,
                    'changes': {'r1_date': '19/11/2026', 'r1_time': '09:00', 'r1_status': 'Passed'}})
        rec2 = (b or {}).get('record') or {}
        check('sửa hồ sơ (200), version 2, ngày lưu ISO', st == 200 and rec2.get('row_version') == 2 and rec2.get('r1_date') == '2026-11-19', f'HTTP {st} {b}')

        st, b = rs({'op': 'patch', 'id': rec_id, 'expected_version': 1, 'changes': {'r1_note': 'ghi đè'}})
        err = (b or {}).get('error', {})
        check('sửa bằng phiên bản cũ => 409 VERSION_CONFLICT kèm bản hiện tại', st == 409 and err.get('code') == 'VERSION_CONFLICT'
              and (err.get('details') or {}).get('current', {}).get('row_version') == 2, f'HTTP {st} {b}')

        st, b = rs({'op': 'move', 'id': rec_id, 'expected_version': 2, 'target_box': 'r2'})
        rec3 = (b or {}).get('record') or {}
        check('kéo Kanban LU/SU -> R2: R2 = Pending, version 3', st == 200 and rec3.get('r2_status') == 'Pending' and rec3.get('row_version') == 3, f'HTTP {st} {b}')
        st, b = rs({'op': 'move', 'id': rec_id, 'expected_version': 3, 'target_box': 'r1'})
        check('kéo lùi => 409 MOVE_BACKWARD', st == 409 and (b or {}).get('error', {}).get('code') == 'MOVE_BACKWARD', f'HTTP {st} {b}')

        st, b = rs({'op': 'archive', 'id': rec_id, 'expected_version': 3})
        check('TA lưu trữ hồ sơ của mình (0009)', st == 200 and ((b or {}).get('record') or {}).get('is_archived') is True, f'HTTP {st} {b}')
        st, b = rs({'op': 'restore', 'id': rec_id, 'expected_version': 4})
        check('TA khôi phục hồ sơ của mình', st == 200 and ((b or {}).get('record') or {}).get('is_archived') is False, f'HTTP {st} {b}')

        st, other = svc('GET', f'/rest/v1/recruitment_records?select=id,row_version&pic=neq.{PIC}&pic=not.is.null&limit=1')
        if st == 200 and other:
            o = other[0]
            st, b = rs({'op': 'patch', 'id': o['id'], 'expected_version': o['row_version'], 'changes': {'r1_note': 'chen'}})
            check('sửa hồ sơ của PIC khác => 404 (không lộ hồ sơ)', st == 404, f'HTTP {st} {b}')

        st, b = call('POST', '/rest/v1/rpc/list_candidates', {'p_search': rec.get('candidate_code', '')}, jwt=jwt)
        check('list_candidates bằng JWT TA tìm được hồ sơ vừa tạo', st == 200 and (b or {}).get('total') == 1, f'HTTP {st} {b}')
        st, b = call('POST', '/rest/v1/rpc/list_candidates', {'p_filters': {'pic': 'TA2-Hien'}}, jwt=jwt)
        check('TA lọc PIC khác => 0 hồ sơ (RLS)', st == 200 and (b or {}).get('total') == 0, f'HTTP {st} {b}')
        st, b = call('POST', '/rest/v1/rpc/board_counts', {'p_pic': ''}, jwt=jwt)
        check('board_counts bằng JWT TA', st == 200 and 'counts' in (b or {}), f'HTTP {st} {b}')
    except AssertionError as e:
        check('chuẩn bị', False, str(e))
    finally:
        # dọn sạch bằng service role
        if rec_id:
            for t in ('status_history', 'audit_logs'):
                svc('DELETE', f'/rest/v1/{t}?record_id=eq.{rec_id}', prefer='return=minimal')
            svc('DELETE', f'/rest/v1/recruitment_records?id=eq.{rec_id}', prefer='return=minimal')
        if applicant_id:
            svc('DELETE', f'/rest/v1/applicants?id=eq.{applicant_id}', prefer='return=minimal')
        if uid:
            svc('DELETE', f'/rest/v1/profiles?id=eq.{uid}', prefer='return=minimal')
            svc('DELETE', f'/auth/v1/admin/users/{uid}')
        left = 0
        if rec_id:
            _, r = svc('GET', f'/rest/v1/recruitment_records?select=id&id=eq.{rec_id}')
            left += len(r or [])
        if uid:
            _, p = svc('GET', f'/rest/v1/profiles?select=id&id=eq.{uid}')
            left += len(p or [])
        print(f'Dọn dẹp: {"sạch" if left == 0 else "CÒN SÓT " + str(left) + " dòng"}')
    ok = all(results) and results
    print(f'\nKẾT QUẢ: {sum(results)}/{len(results)} đạt' + ('' if ok else ' – CÓ LỖI'))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()

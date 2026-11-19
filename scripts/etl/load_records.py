#!/usr/bin/env python3
"""Nạp etl-out/records.csv vào public.recruitment_records (Supabase DEV) qua PostgREST bằng service role.

Chạy (từ thư mục NEW):
    python scripts/etl/load_records.py --dry-run          # chỉ đọc, không ghi gì
    python scripts/etl/load_records.py                    # nạp thật
    python scripts/etl/load_records.py --verify-only      # chỉ chạy report_totals() và so oracle

Cấu hình đọc từ NEW/.env (KHÔNG commit):
    SUPABASE_URL=https://<ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...
    SUPABASE_ENV=dev                                      # bắt buộc = dev, chặn nạp nhầm môi trường

Quy trình (chạy lại được nhiều lần):
  1. Xóa dữ liệu mẫu: các import_batches có note 'DEV test' + hồ sơ thuộc các lô đó (mong đợi 43 dòng).
  2. Dọn các lô do chính script này tạo trước đó (source = BATCH_SOURCE) theo import_batch_id.
  3. Tạo trước public.pics (code = tên PIC), bỏ qua PIC đã có.
  4. Tạo 1 dòng import_batches, nạp hồ sơ theo lô 500; lô lỗi thì thử từng dòng để tách dòng lỗi.
  5. Gọi public.report_totals() và so với etl-out/oracle_kpi.json (chỉ báo cáo, không sửa dữ liệu).
Không in khóa; không in dữ liệu cá nhân ra console (chi tiết lỗi theo dòng ghi vào etl-out/load_errors.csv).
"""
import argparse, csv, hashlib, json, os, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # .../NEW
BATCH_SOURCE = 'etl:master_to_records'
SAMPLE_NOTE = 'DEV test'
EXPECTED_SAMPLE_ROWS = 43
CHUNK = 500

DATE_COLS = {'created_at', 'r1_date', 'r2_date', 'ob_date', 'contract_signed_date', 'attrition_date'}
INT_COLS = {'basic_salary', 'meal_allowance', 'fmcg_allowance', 'attraction_allowance', 'nightshift_allowance'}
FLOAT_COLS = {'probation_pct'}
NULLABLE_TEXT = {'pic', 'legacy_code'}             # '' -> null
KPI_KEYS = [('total', 'leads'), ('r1_passed', 'r1_passed'), ('r2_passed', 'r2_passed'),
            ('ob_joined', 'ob_joined'), ('emp_active', 'emp_active'), ('emp_resigned', 'emp_resigned')]


# ---------------------------------------------------------------- cấu hình
def load_env(path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Api:
    def __init__(self, url, key):
        self.base = url.rstrip('/') + '/rest/v1'
        self._key = key
        self.headers = {'apikey': key, 'Content-Type': 'application/json'}
        if key.count('.') == 2:                       # khóa JWT kiểu cũ; khóa sb_secret_ chỉ cần apikey
            self.headers['Authorization'] = 'Bearer ' + key

    def _redact(self, text):
        return text.replace(self._key, '***') if self._key else text

    def req(self, method, path, params=None, body=None, prefer=None):
        url = self.base + path + ('?' + urllib.parse.urlencode(params, safe=',.()*') if params else '')
        h = dict(self.headers)
        if prefer:
            h['Prefer'] = prefer
        data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
        r = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                raw = resp.read().decode('utf-8')
                return resp.status, dict(resp.headers), (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = self._redact(e.read().decode('utf-8', 'replace'))
            try:
                err = json.loads(raw)
            except Exception:
                err = {'message': raw[:500]}
            return e.code, dict(e.headers), err
        except urllib.error.URLError as e:
            raise SystemExit('Lỗi kết nối Supabase: ' + self._redact(str(e.reason)))

    def ok(self, method, path, **kw):
        st, h, b = self.req(method, path, **kw)
        if st >= 300:
            raise SystemExit(f'HTTP {st} {method} {path}: {json.dumps(b, ensure_ascii=False)[:500]}')
        return h, b

    def count(self, table, params):
        p = dict(params, select='id', limit='1')
        h, _ = self.ok('GET', '/' + table, params=p, prefer='count=exact')
        cr = h.get('Content-Range') or h.get('content-range') or '*/0'
        return int(cr.split('/')[-1])

    def batches(self, **filters):
        _, b = self.ok('GET', '/import_batches', params=dict(filters, select='id,source,row_count,note,created_at', order='id'))
        return b


# ---------------------------------------------------------------- dữ liệu
def read_rows(csv_path):
    with open(csv_path, encoding='utf-8', newline='') as f:
        rd = csv.DictReader(f)
        cols = rd.fieldnames
        rows = []
        for r in rd:
            o = {}
            for c in cols:
                v = r[c]
                if c in DATE_COLS:
                    if v == '':
                        if c == 'created_at':
                            continue                  # bỏ key -> DB dùng default now() (Prefer: missing=default)
                        v = None
                elif c in INT_COLS:
                    v = None if v == '' else int(round(float(v)))
                elif c in FLOAT_COLS:
                    v = None if v == '' else float(v)
                elif c in NULLABLE_TEXT:
                    v = v or None
                o[c] = v
            rows.append(o)
    return cols, rows


def in_list(ids):
    return 'in.(' + ','.join(str(i) for i in ids) + ')'


def delete_batches(api, batch_rows, label):
    ids = [b['id'] for b in batch_rows]
    if not ids:
        return 0
    n = api.count('recruitment_records', {'import_batch_id': in_list(ids)})
    api.ok('DELETE', '/recruitment_records', params={'import_batch_id': in_list(ids)}, prefer='return=minimal')
    api.ok('DELETE', '/import_batches', params={'id': in_list(ids)}, prefer='return=minimal')
    print(f'  - {label}: đã xóa {n} hồ sơ, {len(ids)} import_batches (id {ids})')
    return n


def insert_chunk(api, cols, chunk):
    return api.req('POST', '/recruitment_records', params={'columns': ','.join(cols)}, body=chunk,
                   prefer='return=minimal,missing=default')


def report_totals(api):
    _, b = api.ok('POST', '/rpc/report_totals', body={})
    return b[0] if isinstance(b, list) else b


def compare_kpi(api, oracle_path, out_dir):
    oracle = json.loads(Path(oracle_path).read_text(encoding='utf-8'))
    db = report_totals(api)
    print('\nSo KPI: report_totals() vs oracle_kpi.json')
    print(f'  {"chỉ số":<14}{"oracle":>8}{"DB":>8}{"lệch":>8}')
    res, all_ok = [], True
    for ok_key, db_key in KPI_KEYS:
        o, d = oracle.get(ok_key), db.get(db_key)
        diff = (d or 0) - (o or 0)
        all_ok &= diff == 0
        res.append({'kpi': ok_key, 'oracle': o, 'db': d, 'diff': diff})
        print(f'  {ok_key:<14}{o:>8}{d:>8}{diff:>8}  {"OK" if diff == 0 else "LỆCH"}')
    print('  => ' + ('KHỚP toàn bộ' if all_ok else 'CÓ LỆCH (không tự sửa dữ liệu)'))
    (Path(out_dir) / 'kpi_compare.json').write_text(json.dumps({'match': all_ok, 'rows': res}, ensure_ascii=False, indent=1),
                                                     encoding='utf-8')
    return all_ok


# ---------------------------------------------------------------- main
def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')     # console Windows (cp1258) không in được tiếng Việt
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', default=str(ROOT / 'etl-out' / 'records.csv'))
    ap.add_argument('--oracle', default=str(ROOT / 'etl-out' / 'oracle_kpi.json'))
    ap.add_argument('--env', default=str(ROOT / '.env'))
    ap.add_argument('--dry-run', action='store_true', help='chỉ đọc DB, không ghi')
    ap.add_argument('--verify-only', action='store_true', help='chỉ chạy report_totals() và so oracle')
    a = ap.parse_args()
    out_dir = Path(a.csv).parent

    cols, rows = read_rows(a.csv)
    pics = sorted({r['pic'] for r in rows if r.get('pic')})
    sha = hashlib.sha256(Path(a.csv).read_bytes()).hexdigest()[:12]
    print(f'CSV: {len(rows)} dòng, {len(cols)} cột, {len(pics)} PIC, '
          f'{sum(1 for r in rows if "created_at" not in r)} dòng thiếu created_at (dùng default), sha256 {sha}')

    env = load_env(Path(a.env))
    url, key = env.get('SUPABASE_URL', ''), env.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        msg = f'Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong {a.env}.'
        if a.dry_run:
            print(msg + ' Dry-run chỉ kiểm tra phần CSV, bỏ qua kiểm tra DB.')
            return
        raise SystemExit(msg)
    if env.get('SUPABASE_ENV') != 'dev':
        raise SystemExit('Từ chối chạy: SUPABASE_ENV trong .env phải là "dev".')
    api = Api(url, key)

    if a.verify_only:
        sys.exit(0 if compare_kpi(api, a.oracle, out_dir) else 2)

    # ---- tiền kiểm (chỉ đọc)
    sample = api.batches(note='like.' + SAMPLE_NOTE + '*')   # note thực tế: 'DEV test, ten da an'
    sample_n = api.count('recruitment_records', {'import_batch_id': in_list([b['id'] for b in sample])}) if sample else 0
    prev = api.batches(source='eq.' + BATCH_SOURCE)
    prev_n = api.count('recruitment_records', {'import_batch_id': in_list([b['id'] for b in prev])}) if prev else 0
    total_n = api.count('recruitment_records', {})
    other_n = total_n - sample_n - prev_n
    _, pic_rows = api.ok('GET', '/pics', params={'select': 'code'})
    existing_pics = {p['code'] for p in pic_rows}
    print(f'DB hiện có: {total_n} hồ sơ | mẫu "{SAMPLE_NOTE}": {sample_n} hồ sơ / {len(sample)} lô | '
          f'lô Master cũ: {prev_n} hồ sơ / {len(prev)} lô | khác: {other_n}')
    print(f'PIC: {len(existing_pics)} đã có, {len(set(pics) - existing_pics)} cần tạo')
    if sample and sample_n != EXPECTED_SAMPLE_ROWS:
        raise SystemExit(f'Dừng: dữ liệu mẫu có {sample_n} dòng, mong đợi {EXPECTED_SAMPLE_ROWS}. Cần kiểm tra lại.')
    if other_n:
        raise SystemExit(f'Dừng: có {other_n} hồ sơ không thuộc lô mẫu/lô Master cũ; không tự xóa. Cần kiểm tra lại.')

    if a.dry_run:
        print('\n[DRY-RUN] Kế hoạch: xóa mẫu + lô cũ → tạo PIC → tạo 1 import_batch → nạp '
              f'{len(rows)} dòng thành {-(-len(rows) // CHUNK)} lô x {CHUNK}. Không ghi gì.')
        return

    # ---- ghi
    print('\nDọn dữ liệu:')
    delete_batches(api, sample, f'mẫu "{SAMPLE_NOTE}"')
    delete_batches(api, prev, 'lô Master cũ')

    new_pics = [{'code': p, 'name': p} for p in pics if p not in existing_pics]
    if new_pics:
        api.ok('POST', '/pics', params={'on_conflict': 'code'}, body=new_pics,
               prefer='resolution=ignore-duplicates,return=minimal')
    print(f'PIC: tạo {len(new_pics)}')

    _, b = api.ok('POST', '/import_batches', body={'source': BATCH_SOURCE, 'row_count': 0,
                                                   'note': f'Master.xlsx full load; records.csv sha256 {sha}'},
                  prefer='return=representation')
    batch_id = b[0]['id']
    print(f'import_batch_id = {batch_id}')

    cols_out = cols + ['import_batch_id']
    inserted, errors = 0, []
    for start in range(0, len(rows), CHUNK):
        chunk = [dict(r, import_batch_id=batch_id) for r in rows[start:start + CHUNK]]
        st, _, err = insert_chunk(api, cols_out, chunk)
        if st < 300:
            inserted += len(chunk)
        else:                                          # tách dòng lỗi
            for i, r in enumerate(chunk):
                st1, _, e1 = insert_chunk(api, cols_out, [r])
                if st1 < 300:
                    inserted += 1
                else:
                    errors.append({'csv_row': start + i + 2, 'candidate_code': r['candidate_code'],
                                   'http': st1, 'code': (e1 or {}).get('code', ''),
                                   'message': (e1 or {}).get('message', ''), 'details': (e1 or {}).get('details', '')})
        print(f'  lô {start // CHUNK + 1}: {min(start + CHUNK, len(rows))}/{len(rows)} | nạp {inserted} | lỗi {len(errors)}')

    api.ok('PATCH', '/import_batches', params={'id': f'eq.{batch_id}'}, body={'row_count': inserted},
           prefer='return=minimal')
    err_path = out_dir / 'load_errors.csv'
    with open(err_path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['csv_row', 'candidate_code', 'http', 'code', 'message', 'details'])
        w.writeheader(); w.writerows(errors)
    db_n = api.count('recruitment_records', {'import_batch_id': f'eq.{batch_id}'})
    print(f'\nKết quả: nạp {inserted}, lỗi {len(errors)} (chi tiết: {err_path}); DB đếm theo lô = {db_n}')
    if errors:
        codes = {}
        for e in errors:
            codes[e['code']] = codes.get(e['code'], 0) + 1
        print('  lỗi theo mã:', codes)
    sys.exit(0 if compare_kpi(api, a.oracle, out_dir) and not errors else 2)


if __name__ == '__main__':
    main()

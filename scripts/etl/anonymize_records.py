#!/usr/bin/env python3
"""M8-0 (DEV-DATA a): ẩn danh etl-out/records.csv -> etl-out/records_anon.csv để nạp DEV thay cho dữ liệu thật.

Chạy (từ thư mục NEW):  python scripts/etl/anonymize_records.py
Giữ nguyên: mã ứng viên, PIC, vị trí, kho, vùng, nguồn, mọi trạng thái/ngày  => KPI không đổi.
Thay bằng giá trị giả: họ tên, SĐT, email, mã NV, mã cũ (legacy_code).
Xóa trắng: lương và phụ cấp. Ghi chú / phản hồi tự do: có nội dung => "[đã ẩn]".

Thay MỘT-MỘT: cùng giá trị thật => cùng giá trị giả (giữ các trường hợp trùng SĐT / trùng tên để test gộp applicant).
Biến đổi bằng HMAC với khóa ngẫu nhiên sinh lúc chạy và KHÔNG lưu => không suy ngược được về giá trị thật.
Không in dữ liệu ra màn hình, chỉ in số đếm.
"""
import csv, hashlib, hmac, secrets, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'etl-out' / 'records.csv'
DST = ROOT / 'etl-out' / 'records_anon.csv'

KEY = secrets.token_bytes(32)          # dùng 1 lần rồi bỏ
FAMILY = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý']
MIDDLE = ['Văn', 'Thị', 'Hữu', 'Ngọc', 'Minh', 'Thanh', 'Đức', 'Thu', 'Quốc', 'Kim', 'Hoài', 'Gia']
GIVEN = ['An', 'Bình', 'Châu', 'Dũng', 'Hà', 'Hùng', 'Lan', 'Linh', 'Nam', 'Phúc', 'Quân', 'Trang', 'Tuấn', 'Vy', 'Yến',
         'Khoa', 'Long', 'Mai', 'Nhi', 'Sơn', 'Tâm', 'Thảo', 'Trung', 'Uyên', 'Việt', 'Xuân', 'Hiếu', 'Khánh', 'Duy', 'Ngân']
NOTE_COLS = ['r1_note', 'r1_cdd_fb', 'r2_note', 'r2_cdd_fb', 'ob_note', 'doc_note', 'attrition_note']
MONEY_COLS = ['basic_salary', 'meal_allowance', 'fmcg_allowance', 'attraction_allowance', 'nightshift_allowance']


def h(kind, value):
    return int.from_bytes(hmac.new(KEY, f'{kind}\x00{value}'.encode('utf-8'), hashlib.sha256).digest(), 'big')


class OneToOne:
    """Ánh xạ một-một; nếu giá trị giả bị trùng thì dò tiếp (không tạo trùng giả)."""
    def __init__(self, make, forbidden=()):
        self.make, self.map, self.used = make, {}, set(forbidden)  # forbidden: không được trùng giá trị thật

    def __call__(self, value):
        if value == '':
            return ''
        if value not in self.map:
            i = 0
            while True:
                fake = self.make(value, i)
                if fake not in self.used:
                    break
                i += 1
            self.map[value] = fake
            self.used.add(fake)
        return self.map[value]


def fake_name(v, i):
    x = h('name', f'{v}#{i}')
    return f'{FAMILY[x % len(FAMILY)]} {MIDDLE[(x >> 8) % len(MIDDLE)]} {GIVEN[(x >> 16) % len(GIVEN)]} {GIVEN[(x >> 24) % len(GIVEN)]}'


def fake_phone(v, i):
    # giữ độ dài (để các ca SĐT sai độ dài vẫn còn); số 10 chữ số dạng 0999xxxxxx (dải giả)
    digits = str(h('phone', f'{v}#{i}')).rjust(20, '0')
    if len(v) == 10:
        return '0999' + digits[:6]
    return ('9' + digits)[:len(v)]


def fake_email(v, i):
    return f'uv{h("email", f"{v}#{i}") % 10**8:08d}@example.invalid'


def fake_emp(v, i):
    return f'NV{h("emp", f"{v}#{i}") % 10**7:07d}'


def fake_legacy(v, i):
    return f'LEGACY{h("legacy", f"{v}#{i}") % 10**6:06d}'


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    with open(SRC, encoding='utf-8', newline='') as f:
        rd = csv.DictReader(f)
        cols, rows = rd.fieldnames, list(rd)
    real_phones = {r['phone'] for r in rows if r['phone']}
    real_names = {r['full_name'] for r in rows if r['full_name']}
    real_emails = {r['email'] for r in rows if r['email']}
    names, phones, emails = OneToOne(fake_name, real_names), OneToOne(fake_phone, real_phones), OneToOne(fake_email, real_emails)
    emps, legacies = OneToOne(fake_emp), OneToOne(fake_legacy)

    for r in rows:
        r['full_name'] = names(r['full_name'])
        r['phone'] = phones(r['phone'])
        r['email'] = emails(r['email'])
        r['emp_id'] = emps(r['emp_id'])
        r['legacy_code'] = legacies(r['legacy_code'])
        for c in NOTE_COLS:
            if r[c]:
                r[c] = '[đã ẩn]'
        for c in MONEY_COLS:
            r[c] = ''

    with open(DST, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    # kiểm tra: không còn SĐT/email thật; số giá trị khác nhau giữ nguyên (ánh xạ một-một)
    left_phone = sum(1 for r in rows if r['phone'] in real_phones)
    left_email = sum(1 for r in rows if r['email'] in real_emails)
    same_name = sum(1 for r in rows if r['full_name'] in real_names)
    print(f'Ghi {DST.relative_to(ROOT)}: {len(rows)} dòng')
    print(f'Họ tên: {len(real_names)} giá trị thật -> {len(names.map)} giả | SĐT: {len(real_phones)} -> {len(phones.map)} | '
          f'email: {len(real_emails)} -> {len(emails.map)} | mã NV: {len(emps.map)}')
    print(f'Kiểm tra: SĐT thật còn lại {left_phone}, email thật còn lại {left_email}, '
          f'tên giả trùng tên thật {same_name}')
    if left_phone or left_email or same_name:
        raise SystemExit('DỪNG: còn sót SĐT/email/tên thật.')


if __name__ == '__main__':
    main()

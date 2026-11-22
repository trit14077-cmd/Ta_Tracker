#!/usr/bin/env bash
# M9-5 – phục hồi 1 bản backup (gói .tar.gpg của backup-and-keepalive) vào MỘT PROJECT SUPABASE TRỐNG
# (diễn tập trước nghiệm thu, hoặc sự cố mất project). Hướng dẫn: docs/RUNBOOK.md §4.
#
#   TARGET_DB_URL='<session pooler URL của project ĐÍCH>' BACKUP_PASSPHRASE='…' \
#     bash scripts/ops/restore_supabase.sh supra_YYYYMMDD_HHMM.tar.gpg
#
# Cần psql/pg_restore 17, gpg, tar. Chạy từ thư mục NEW, checkout ĐÚNG commit có các migration mà DB nguồn đã áp
# (bản dump chỉ chứa DỮ LIỆU khi nạp – cấu trúc + quyền lấy từ supabase/migrations).
# Các bước:
#   1. Giải mã + giải nén vào thư mục tạm (xóa khi xong).
#   2. Từ chối nếu project đích ĐÃ có hồ sơ hoặc tài khoản (chống ghi nhầm DEV/PROD).
#   3. Chưa có bảng ⇒ áp toàn bộ supabase/migrations theo thứ tự (SKIP_MIGRATIONS=1 nếu đã áp bằng Supabase CLI).
#   4. Xóa dữ liệu seed của migrations (danh mục…) – sẽ được thay bằng dữ liệu trong bản backup.
#   5. Nạp dữ liệu tài khoản (nếu gói có) rồi dữ liệu public/app, với session_replication_role=replica
#      (không chạy trigger nhật ký/updated_at/kiểm FK khi nạp – dữ liệu đã nhất quán từ nguồn), 1 giao dịch.
#   6. Đối chiếu số dòng với src_counts.txt trong gói. Lệch ⇒ thoát 1.
# Không in dữ liệu; chỉ in số dòng.
set -euo pipefail

BUNDLE_GPG="${1:-}"
[ -n "$BUNDLE_GPG" ] && [ -f "$BUNDLE_GPG" ] || { echo "Dùng: $0 <file .tar.gpg>"; exit 2; }
: "${TARGET_DB_URL:?Thiếu TARGET_DB_URL (session pooler của project đích)}"
: "${BACKUP_PASSPHRASE:?Thiếu BACKUP_PASSPHRASE}"
cd "$(dirname "$0")/../.."

COUNT_SQL="select 'recruitment_records', count(*) from public.recruitment_records
  union all select 'pics', count(*) from public.pics
  union all select 'import_batches', count(*) from public.import_batches
  union all select 'profiles', count(*) from public.profiles
  order by 1"
q() { psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -At "$@"; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077

echo "== 1. Giải mã gói backup"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -o "$work/bundle.tar" --decrypt "$BUNDLE_GPG"
tar -xf "$work/bundle.tar" -C "$work"
DUMP="$(ls "$work"/*.dump | grep -v '\.auth\.dump$' | head -1)"
AUTH_DUMP="$(ls "$work"/*.auth.dump 2>/dev/null | head -1 || true)"
[ -f "$DUMP" ] && [ -f "$work/src_counts.txt" ] || { echo "Gói không đúng định dạng (thiếu .dump hoặc src_counts.txt)"; exit 1; }
echo "   dump: $(basename "$DUMP")${AUTH_DUMP:+, tài khoản: $(basename "$AUTH_DUMP")}"

echo "== 2. Kiểm tra project đích trống"
users=$(q -c "select count(*) from auth.users")
has_rr=$(q -c "select to_regclass('public.recruitment_records') is not null")
recs=0
[ "$has_rr" = "t" ] && recs=$(q -c "select count(*) from public.recruitment_records")
if [ "$users" != "0" ] || [ "$recs" != "0" ]; then
  echo "DỪNG: project đích đã có $users tài khoản / $recs hồ sơ. Chỉ phục hồi vào project TRỐNG."
  exit 1
fi

echo "== 3. Cấu trúc + quyền (migrations)"
if [ "$has_rr" = "t" ] || [ "${SKIP_MIGRATIONS:-}" = "1" ]; then
  echo "   bảng đã có – không áp lại migrations"
else
  for f in supabase/migrations/*.sql; do
    echo "   $f"
    psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  done
fi

echo "== 4+5. Xóa seed và nạp dữ liệu (1 giao dịch)"
tables=$(q -c "select string_agg(format('%I.%I', schemaname, tablename), ', ') from pg_tables where schemaname in ('public', 'app')")
{
  echo "set session_replication_role = replica;"
  echo "truncate table $tables restart identity cascade;"
  if [ -n "$AUTH_DUMP" ]; then pg_restore --data-only --no-owner --no-acl -f - "$AUTH_DUMP"; fi
  pg_restore --data-only --no-owner --no-acl -f - "$DUMP"
  echo "set session_replication_role = origin;"
} | psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction
q -c "analyze" >/dev/null
[ -n "$AUTH_DUMP" ] || echo "   CHÚ Ý: gói không có dữ liệu tài khoản – tạo lại tài khoản bằng admin-users (MIGRATION_PLAN §7) và gắn lại profiles"

echo "== 6. Đối chiếu số dòng"
q -F ' ' -c "$COUNT_SQL" > "$work/dst_counts.txt"
if diff "$work/src_counts.txt" "$work/dst_counts.txt"; then
  echo "PHỤC HỒI ĐẠT – số dòng khớp:"; cat "$work/dst_counts.txt"
  echo "Tiếp theo: chạy scripts/migrate/reconcile.ts với .env trỏ project này (RUNBOOK §4.2)."
else
  echo "PHỤC HỒI CHƯA ĐẠT – số dòng lệch (trái: nguồn, phải: đích)"; exit 1
fi

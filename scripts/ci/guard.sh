#!/usr/bin/env bash
# Chặn đưa bí mật hoặc dữ liệu thật vào Git (IMPLEMENTATION_TASKS M0-1, checklist M9-4).
# Quét mọi file sẽ vào repo: đã track + chưa track nhưng không bị .gitignore.
# Chỉ in TÊN file vi phạm, không in nội dung.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mapfile -t files < <(git ls-files --cached --others --exclude-standard)
fail=0

# 1) File bị cấm theo tên/đuôi
for f in "${files[@]}"; do
  case "$f" in
    .env.example) ;;
    .env|.env.*|*/.env|*/.env.*|*.pem|*.key|*.p12|*.dump|*.gpg|*.sql.gz|*.csv|*.xlsx|*.xls|*service-account*.json|*credentials*.json|etl-out/*|scripts/out/*)
      echo "CẤM: file không được vào Git: $f"; fail=1 ;;
  esac
done

# 2) Nội dung giống khóa bí mật (mẫu ghép chuỗi để file này không tự khớp)
p_secret='sb_''secret_[A-Za-z0-9_-]{10,}'
p_jwt='eyJ''[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
p_pkey='-----BEGIN [A-Z ]*''PRIVATE KEY-----'
p_gsa='"private_''key"[[:space:]]*:'
p_dburl='postgres(ql)?://[^:/[:space:]]+:[^@[:space:]]{6,}@'
for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  if grep -IqE -e "$p_secret" -e "$p_jwt" -e "$p_pkey" -e "$p_gsa" -e "$p_dburl" -- "$f"; then
    echo "CẤM: nội dung giống khóa/mật khẩu trong: $f"; fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "guard: THẤT BẠI – gỡ các file/nội dung trên khỏi Git (đưa vào .env hoặc GitHub Secrets)."
  exit 1
fi
echo "guard: OK (${#files[@]} file)"

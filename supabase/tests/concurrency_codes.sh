#!/usr/bin/env bash
# M2-6: 20 phiên đồng thời cùng tạo hồ sơ cho 1 PIC => 20 mã khác nhau, liên tiếp.
# CHỈ chạy trên DB tạm của CI (có COMMIT dữ liệu). Dùng biến PG* của môi trường.
set -euo pipefail
N=20
ACTOR=00000000-0000-4000-8000-0000000002b1

psql -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (id) values ('$ACTOR');
insert into public.profiles (id, username, role, pic_code) values ('$ACTOR', 'conc_t5', 'pic', 'TA5-M.Khanh');
SQL

for i in $(seq 1 $N); do
  psql -v ON_ERROR_STOP=1 -qAt -c "set role service_role; select public.create_record('$ACTOR', '{\"full_name\":\"Conc $i\"}')->>'candidate_code';" > "conc_$i.out" &
done
wait

total=$(cat conc_*.out | grep -c .)
uniq=$(cat conc_*.out | sort -u | grep -c .)
expect=$(for i in $(seq 1 $N); do printf 'TA500%02d\n' "$i"; done | sort)
got=$(cat conc_*.out | sort)
rm -f conc_*.out
echo "tạo: $total, mã khác nhau: $uniq"
[ "$total" -eq "$N" ] && [ "$uniq" -eq "$N" ] || { echo "FAIL: có mã trùng hoặc lỗi"; exit 1; }
[ "$got" = "$expect" ] || { echo "FAIL: mã không liên tiếp TA50001..TA50020"; echo "$got"; exit 1; }
echo "CONCURRENCY_OK: $N phiên đồng thời, $N mã khác nhau TA50001..TA50020"

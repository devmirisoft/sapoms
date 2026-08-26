#!/bin/bash
cd /home/jojo/projects/sapoms
B=http://127.0.0.1:3100
echo "===== API ROUTES (GET, unauthenticated) ====="
while read -r p; do
  [ -z "$p" ] && continue
  r=$(curl -s -o /tmp/api.json -w '%{http_code} %{time_total}' --max-time 45 "$B$p")
  code=$(echo "$r" | cut -d' ' -f1); t=$(echo "$r" | cut -d' ' -f2)
  snip=$(head -c 110 /tmp/api.json | tr -d '\n' | tr -s ' ')
  printf '%-5s %-9s %-42s %s\n' "$code" "${t}s" "$p" "$snip"
done < tmp/api-routes.txt
echo ""
echo "===== POST-only endpoints (expect 405/400/401, not 500) ====="
for p in /api/auth/login /api/auth/logout /api/auth/refresh /api/auth/accountant /api/auth/email-otp/request /api/auth/email-otp/verify /api/ledger/1/pay /api/wallet/1/adjust; do
  r=$(curl -s -o /tmp/api.json -w '%{http_code}' --max-time 45 "$B$p")
  rp=$(curl -s -o /tmp/api2.json -w '%{http_code}' --max-time 45 -X POST -H 'Content-Type: application/json' -d '{}' "$B$p")
  printf 'GET=%-5s POST=%-5s %-40s %s\n' "$r" "$rp" "$p" "$(head -c 90 /tmp/api2.json | tr -d '\n')"
done

#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$HOME/projects/sapoms" || exit 1

echo "########## BUILD ##########"
npm run build > tmp/build-final.log 2>&1
BE=$?
echo "build exit=$BE"
grep -E "Compiled successfully|Failed to compile|Type error|✓ Generating" tmp/build-final.log | head -5
[ $BE -ne 0 ] && { tail -40 tmp/build-final.log; exit 1; }

# kill by port; next-server renames itself so pkill -f will not match
PID=$(ss -ltnp 2>/dev/null | grep ':3100' | grep -oP 'pid=\K[0-9]+' | head -1)
[ -n "$PID" ] && { kill -9 "$PID"; sleep 2; }

rm -f tmp/prod-server.log
setsid env PORT=3100 node node_modules/next/dist/bin/next start -p 3100 < /dev/null > tmp/prod-server.log 2>&1 &
for i in $(seq 1 40); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3100/ 2>/dev/null)
  [ "$c" != "000" ] && [ -n "$c" ] && break
  sleep 1
done
SPID=$(ss -ltnp 2>/dev/null | grep ':3100' | grep -oP 'pid=\K[0-9]+' | head -1)
echo "serving pid=$SPID  started=$(date +%T)"
B=http://127.0.0.1:3100

echo ""
echo "########## THE 5 FIXED ENDPOINTS (expect 401) ##########"
fixed_ok=0; fixed_bad=0
check(){ r=$(curl -s -o /tmp/o -w '%{http_code}' --max-time 20 "$@"); }
for p in /api/dealer-requests /api/dealer-requests/1 /api/order-dispatch /api/order-overlays/cancelled /api/wallet/1; do
  check "$B$p"
  [ "$r" = "401" ] && { fixed_ok=$((fixed_ok+1)); m=PASS; } || { fixed_bad=$((fixed_bad+1)); m=FAIL; }
  printf '%s %-5s %-34s %s\n' "$m" "$r" "$p" "$(head -c 60 /tmp/o|tr -d '\n')"
done
check -X POST -H 'Content-Type: application/json' -d '{}' "$B/api/wallet/1/adjust"
[ "$r" = "401" ] && { fixed_ok=$((fixed_ok+1)); m=PASS; } || { fixed_bad=$((fixed_bad+1)); m=FAIL; }
printf '%s %-5s %-34s %s\n' "$m" "$r" "POST /api/wallet/1/adjust" "$(head -c 60 /tmp/o|tr -d '\n')"
echo "fixed: pass=$fixed_ok fail=$fixed_bad"

echo ""
echo "########## REGRESSION: all API routes ##########"
bad=0; n=0
while read -r p; do
  [ -z "$p" ] && continue; n=$((n+1))
  r=$(curl -s -o /tmp/o -w '%{http_code}' --max-time 30 "$B$p")
  case "$r" in 200|400|401|403|404|405) ;; *) printf 'UNEXPECTED %-5s %-40s %s\n' "$r" "$p" "$(head -c 60 /tmp/o|tr -d '\n')"; bad=$((bad+1));; esac
done < tmp/api-routes.txt
echo "api routes=$n unexpected=$bad"

echo ""
echo "########## REGRESSION: all pages ##########"
pbad=0; pn=0
for L in tmp/routes.txt tmp/dynroutes.txt; do
 while read -r p; do
  [ -z "$p" ] && continue; pn=$((pn+1))
  r=$(curl -s -o /tmp/o -w '%{http_code}' --max-time 30 "$B$p")
  if [ "$r" != "200" ] && [ "$r" != "307" ]; then printf 'UNEXPECTED %-5s %s\n' "$r" "$p"; pbad=$((pbad+1)); fi
  if grep -qi 'Application error: a server-side exception' /tmp/o 2>/dev/null; then echo "SERVER-EXCEPTION $p"; pbad=$((pbad+1)); fi
 done < "$L"
done
echo "pages=$pn unexpected=$pbad"

echo ""
echo "########## remaining 500s in server log ##########"
grep -c "" tmp/prod-server.log | xargs echo "log lines:"
grep -oP '\[(GET|POST) [^]]+\]' tmp/prod-server.log 2>/dev/null | sort -u | head -20

PID=$(ss -ltnp 2>/dev/null | grep ':3100' | grep -oP 'pid=\K[0-9]+' | head -1)
[ -n "$PID" ] && kill -9 "$PID" && echo "" && echo "server stopped (pid=$PID)"

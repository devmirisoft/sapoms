#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$HOME/projects/sapoms" || exit 1

# Kill whatever holds 3100, by port (process renames itself, so pkill -f won't match)
PID=$(ss -ltnp 2>/dev/null | grep ':3100' | grep -oP 'pid=\K[0-9]+' | head -1)
if [ -n "$PID" ]; then kill -9 "$PID"; echo "killed stale pid=$PID"; sleep 2; fi
echo "port 3100 free? $(ss -ltn 2>/dev/null | grep -c ':3100')"

rm -f tmp/prod-server.log
setsid env PORT=3100 node node_modules/next/dist/bin/next start -p 3100 < /dev/null > tmp/prod-server.log 2>&1 &
NEW=$!
for i in $(seq 1 40); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3100/ 2>/dev/null)
  [ "$c" != "000" ] && [ -n "$c" ] && break
  sleep 1
done
echo "serving pid=$(ss -ltnp 2>/dev/null | grep ':3100' | grep -oP 'pid=\K[0-9]+' | head -1)  (expected new=$NEW)"
echo ""
echo "--- probe request ---"
curl -s -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:3100/api/dealer-requests
echo "--- PROBE line ---"
grep "PROBE" tmp/prod-server.log | head -3

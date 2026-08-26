#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$HOME/projects/sapoms" || exit 1
npm run build > tmp/build2.log 2>&1
echo "build exit=$?"
rm -f tmp/prod-server.log
setsid env PORT=3100 node node_modules/next/dist/bin/next start -p 3100 < /dev/null > tmp/prod-server.log 2>&1 &
for i in $(seq 1 40); do
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3100/ 2>/dev/null)
  [ "$c" != "000" ] && [ -n "$c" ] && break
  sleep 1
done
echo "--- request ---"
curl -s -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:3100/api/dealer-requests
echo "--- PROBE output ---"
grep -A3 "PROBE" tmp/prod-server.log | head -20
pkill -f "next start -p 3100"

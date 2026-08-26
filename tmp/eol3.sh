#!/bin/bash
cd /home/jojo/projects/sapoms || exit 1
echo "=== current EOL state of my 6 files vs how they sat before my edits ==="
for f in \
  src/app/api/dealer-requests/route.ts \
  "src/app/api/dealer-requests/[id]/route.ts" \
  src/app/api/order-dispatch/route.ts \
  src/app/api/order-overlays/cancelled/route.ts \
  "src/app/api/wallet/[dealerId]/route.ts" \
  "src/app/api/wallet/[dealerId]/adjust/route.ts" \
  src/server/http/auth-error.ts ; do
  n=$(grep -c $'\r' "$f" 2>/dev/null || echo 0)
  tot=$(wc -l < "$f")
  echo "crlf_lines=$n / $tot  $f"
done

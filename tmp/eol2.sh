#!/bin/bash
cd /home/jojo/projects/sapoms || exit 1
echo "=== files I never edited (control group) ==="
for f in src/app/api/pending-products/route.ts src/app/dashboard/staff/page.tsx src/app/Products/page.tsx; do
  cur=$(file "$f" | grep -c CRLF); orig=$(git show "HEAD:$f" 2>/dev/null | file - | grep -c CRLF)
  echo "working=CRLF:$cur  HEAD=CRLF:$orig  $f"
done
echo ""
echo "=== ignoring CRLF, what did I actually change? ==="
git --no-pager diff --stat --ignore-cr-at-eol -- \
  src/app/api/dealer-requests/route.ts \
  "src/app/api/dealer-requests/[id]/route.ts" \
  src/app/api/order-dispatch/route.ts \
  src/app/api/order-overlays/cancelled/route.ts \
  "src/app/api/wallet/[dealerId]/route.ts" \
  "src/app/api/wallet/[dealerId]/adjust/route.ts"

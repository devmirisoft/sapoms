#!/bin/bash
cd /home/jojo/projects/sapoms || exit 1
git --no-pager diff -U2 -- \
  src/app/api/dealer-requests/route.ts \
  "src/app/api/dealer-requests/[id]/route.ts" \
  src/app/api/order-dispatch/route.ts \
  src/app/api/order-overlays/cancelled/route.ts \
  "src/app/api/wallet/[dealerId]/route.ts" \
  "src/app/api/wallet/[dealerId]/adjust/route.ts" \
  | grep -E '^(\+|-|diff |@@)' | grep -vE '^[+-]\s*$' | head -80

#!/bin/bash
cd /home/jojo/projects/sapoms || exit 1
echo "=== is errorStatus in the build output? ==="
grep -rl "Unauthenticated" .next/server/chunks/*.js 2>/dev/null | head -3
echo "--- does dealer-requests chunk contain our guard? ---"
grep -rc "authStatus\|errorStatus" .next/server/chunks/*.js 2>/dev/null | grep -v ':0' | head
echo ""
echo "=== source file check: is the guard actually present? ==="
grep -n "errorStatus\|authStatus" src/app/api/dealer-requests/route.ts
echo ""
echo "=== helper file exists? ==="
ls -la src/server/http/auth-error.ts
echo ""
echo "=== tsconfig paths for @/ ==="
grep -A5 '"paths"' tsconfig.json

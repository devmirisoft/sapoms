#!/bin/bash
cd /home/jojo/projects/sapoms
B=http://127.0.0.1:3100
test_one() {
  r=$(curl -s -o /tmp/body.html -w '%{http_code} %{time_total}' --max-time 45 "$B$1")
  code=$(echo "$r" | cut -d' ' -f1); t=$(echo "$r" | cut -d' ' -f2)
  # detect Next.js error boundary / digest in HTML
  err=""
  if grep -qi 'Application error: a server-side exception\|__NEXT_ERROR_CODE\|Internal Server Error' /tmp/body.html 2>/dev/null; then err=" [SERVER-EXCEPTION]"; fi
  sz=$(stat -c%s /tmp/body.html)
  printf '%-6s %-8s %-9s %s%s\n' "$code" "${t}s" "${sz}b" "$1" "$err"
}
echo "===== STATIC / PAGE ROUTES ====="
while read -r p; do [ -n "$p" ] && test_one "$p"; done < tmp/routes.txt
echo ""
echo "===== DYNAMIC PAGE ROUTES (sample params) ====="
while read -r p; do [ -n "$p" ] && test_one "$p"; done < tmp/dynroutes.txt

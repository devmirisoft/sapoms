#!/bin/bash
echo "=== processes ==="
ps aux | grep -E 'next|node' | grep -v grep
echo ""
echo "=== listeners ==="
ss -ltnp 2>/dev/null | grep -E '3000|3100|3002' || netstat -ltnp 2>/dev/null | grep -E '3000|3100'
echo ""
echo "=== is 3100 alive right now? ==="
curl -s -o /dev/null -w 'code=%{http_code}\n' --max-time 5 http://127.0.0.1:3100/api/dealer-requests

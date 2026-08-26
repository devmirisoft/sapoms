#!/bin/bash
echo "--- ps ---"
ps aux | grep -E 'next|node' | grep -v grep | head -20
echo "--- ls tmp ---"
ls -la /home/jojo/projects/sapoms/tmp/
echo "--- port ---"
(ss -ltnp 2>/dev/null || netstat -ltn 2>/dev/null) | grep 3100

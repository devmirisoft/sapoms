#!/bin/bash
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/ 2>/dev/null)
  if [ "$code" != "000" ] && [ -n "$code" ]; then echo "READY http=$code after ${i}s"; exit 0; fi
  sleep 1
done
echo "TIMEOUT"
tail -30 /home/jojo/projects/sapoms/tmp/prod-server.log

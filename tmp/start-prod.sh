#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$HOME/projects/sapoms" || exit 1
rm -f tmp/prod-server.log
setsid env PORT=3100 node node_modules/next/dist/bin/next start -p 3100 \
  < /dev/null > tmp/prod-server.log 2>&1 &
disown
echo "PID=$!"
sleep 2
echo "--- early log ---"
cat tmp/prod-server.log

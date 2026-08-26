#!/bin/bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$HOME/projects/sapoms" || exit 1
echo "node: $(node -v)  npm: $(npm -v)"
npm run build
echo "BUILD_EXIT=$?"

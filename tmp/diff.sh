#!/bin/bash
cd /home/jojo/projects/sapoms || exit 1
git --no-pager diff --stat
echo ""
git --no-pager diff
echo ""
echo "=== untracked ==="
git status --porcelain | grep '^??'

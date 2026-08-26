#!/bin/bash
cd /home/jojo/projects/sapoms
echo "===== server log (errors/stack traces) ====="
grep -n -i -A12 'Error\|error:\|at ' tmp/prod-server.log | head -120

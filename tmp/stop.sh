#!/bin/bash
pkill -f "next start -p 3100" && echo "stopped 3100" || echo "nothing on 3100"

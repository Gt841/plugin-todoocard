#!/bin/bash
cd "{{einkDir}}" || exit 1
export TODOOCARD_FORCE_PYTHON=1
export PORT={{port}}
"{{python}}" server.py >> "{{logFile}}" 2>&1 &
echo $! > "{{pidFile}}"
wait

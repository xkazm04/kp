@echo off
rem P3 soak — one night, scheduled by Windows Task Scheduler (see
rem docs/development/app-master-soak.md). Appends the runner's own stdout to
rem runner.log beside the JSONL record night.mjs writes.
rem
rem cmd evaluates the redirect BEFORE node starts, so the directory must exist
rem here, not in night.mjs — or a fresh checkout's night dies leaving no log
rem line and no miss, the exact silent gap the runner exists to prevent.
cd /d C:\Users\kazda\kiro\kp
if not exist "bench\app-master\soak" mkdir "bench\app-master\soak"
node scripts\app-master-bench\soak\night.mjs >> bench\app-master\soak\runner.log 2>&1

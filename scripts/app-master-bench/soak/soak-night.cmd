@echo off
rem P3 soak — one night, scheduled by Windows Task Scheduler (see
rem docs/development/app-master-soak.md). Appends the runner's own stdout to
rem runner.log beside the JSONL record night.mjs writes.
cd /d C:\Users\kazda\kiro\kp
node scripts\app-master-bench\soak\night.mjs >> bench\app-master\soak\runner.log 2>&1

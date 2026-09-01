@echo off
rem Register (or refresh) the nightly P3 soak task on THIS machine, from the
rem checkout's own location — the committed, reproducible form of the schedule
rem that docs/development/app-master-soak.md describes. Idempotent: /F replaces
rem an existing task of the same name. Teardown:
rem   schtasks /delete /tn kp-app-master-soak /f
schtasks /Create /TN "kp-app-master-soak" /TR "\"%~dp0soak-night.cmd\"" /SC DAILY /ST 02:47 /F
schtasks /Query /TN "kp-app-master-soak" /FO LIST

@echo off
rem Register (or refresh) the nightly P3 soak task on THIS machine, from the
rem checkout's own location — the committed, reproducible form of the schedule
rem that docs/development/app-master-soak.md describes. Idempotent: /F replaces
rem an existing task of the same name. Teardown:
rem   schtasks /delete /tn kp-app-master-soak /f
rem PREVENTIVE, from measured HOST behaviour (2026-09-01). An earlier version of
rem this comment claimed the first firing had been LOST; that was wrong. The task
rem was registered after that day's 02:47, so it had never been DUE —
rem LastTaskResult 0x41303 reads "never run" for both cases and it was read as
rem the wrong one. What IS measured: this host sleeps through 02:47
rem (Power-Troubleshooter 2026-09-01: awake 01:13, next wake 06:26) and the
rem default task had StartWhenAvailable=False / DisallowStartIfOnBatteries=True,
rem so the first real firing would have been skipped outright rather than run late — a laptop soak would have
rem measured nothing for weeks. The task is therefore created and then PATCHED:
rem   StartWhenAvailable  run as soon as the host is back, if 02:47 was missed
rem   DisallowStartIfOnBatteries/StopIfGoingOnBatteries  off — a soak night on
rem                       battery is still a night; the operator can close the lid
rem WakeToRun stays OFF deliberately: waking someone's machine at 2am to run a
rem bench is not a thing a tool should do uninvited.
schtasks /Create /TN "kp-app-master-soak" /TR "\"%~dp0soak-night.cmd\"" /SC DAILY /ST 02:47 /F
powershell -NoProfile -Command ^
  "$s = Get-ScheduledTask -TaskName 'kp-app-master-soak';" ^
  "$s.Settings.StartWhenAvailable = $true;" ^
  "$s.Settings.DisallowStartIfOnBatteries = $false;" ^
  "$s.Settings.StopIfGoingOnBatteries = $false;" ^
  "$s | Set-ScheduledTask | Out-Null;" ^
  "$c = (Get-ScheduledTask -TaskName 'kp-app-master-soak').Settings;" ^
  "Write-Host ('settings: StartWhenAvailable=' + $c.StartWhenAvailable + ' DisallowStartIfOnBatteries=' + $c.DisallowStartIfOnBatteries)"
schtasks /Query /TN "kp-app-master-soak" /FO LIST

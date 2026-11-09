---
id: "0031"
title: Temp-dir cleanup logs a leak in a test after() hook and throws everywhere else
status: accepted
date: 2026-10-23
supersedes: []
superseded-by: null
tags: [testing, gates]
sources:
  - app/_lib/testing/tmp-cleanup.ts
  - app/_lib/testing/tmp-cleanup.test.ts
---

# Temp-dir cleanup logs a leak in a test after() hook and throws everywhere else

## Context

`removeTempDirs` (`app/_lib/testing/tmp-cleanup.ts`) closes every tracked SQLite handle and
removes the given `os.tmpdir()` folders, retrying 5 times 100 ms apart. It used to swallow a
failure, and about 100k `kp-*` folders piled up (measured 2026-10-15); it was made loud, so a
folder that survives the retries throws. In a test file's `after()` hook that throw fails the
whole file, including tests that passed, because a busy folder (a Windows handle held a moment
too long, an antivirus scan) is unrelated to what those tests assert.

## Decision

Two forms, one removal routine:

- `removeTempDirs(...dirs)` keeps the throw. A leak is a real defect, and scripts
  (`scripts/interview-briefs-snapshot.ts`) and any caller where a leak must stop the run keep it.
- `removeTempDirsInHook(dirs)` is for test `after()` hooks. It never throws: each folder that
  survives the retries is logged (`[tmp-cleanup] leaked <path> (<code>)`) and appended as a JSON
  line to `os.tmpdir()/kp-tmp-leaks.log` (`KP_TMP_LEAK_LOG` moves it), and the leaked paths are
  returned. The leak is still visible, in the run output and in a file anyone can read.

The hooks outside `app/_lib/db/` use the second form. The ones under `app/_lib/db/` still call
`removeTempDirs` and move over in a change that is allowed to touch that directory.

## Alternatives considered

- **Throw everywhere (status quo).** It keeps the leak impossible to miss, which is why it was
  chosen on 2026-10-15, but it fails a file whose tests are green for a cause they cannot
  influence, and the red then reads as a flake in whichever file lost. The leak does not need
  to be fatal to be loud.
- **Log everywhere, never throw.** That is the old swallow with a warning: scripts would carry
  on past a leak, and a log line nobody reads is how the first 100k folders accumulated.

## Consequences

A leak no longer turns a green file red; it shows as a warning plus a line in the leak log. A
growing `kp-tmp-leaks.log` is the signal to look. Nothing gates on the log today.

## What would change our mind

A run where leak lines pile up unnoticed and the folder count climbs again: then the hook form
should fail once a run's leak count passes a ceiling, not per file.

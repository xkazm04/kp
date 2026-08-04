# CandiDate — context sweep plan

Precomputed 2026-07-30 from `git ls-files` (1,954 source files). Re-derive if
the tree has moved substantially since.

- **Personas project id:** `a9a1ef97`
- **Repo root:** `C:\Users\kazda\kiro\kp`
- **Bridge:** first free port at or above 17400 — probe, do not assume.

## Why this file exists

A whole-tree scan under-maps a repo this size and reports success anyway. On the
personas repo one whole-tree pass mapped 9% of files; sweeping subtree-by-subtree
reached ~89%. Everything below is the partition for that sweep. Full mechanics in
[`references/bridge.md`](references/bridge.md).

## Scopes

Ten scans covering 1,792 of 1,954 files (92%). Run 3-4 concurrently; the
single-flight guard is per-scope so they do not block each other.

| Files | `subtree` |
|------:|---|
| 577 | `app/_lib` |
| 234 | `pipeline` |
| 217 | `app/api` |
| 206 | `app/features/hiring` |
| 137 | `app/features/tools` |
| 125 | `app/_components` |
| 97 | `app/features/library` |
| 93 | `app/features/shell` |
| 65 | `app/features/insights` |
| 41 | `app/features/settings` |

`app/_lib` is the one to watch — 577 files, near the ceiling where a single
session stops keeping up. If its `[Coverage]` line lands below ~90%, split it
(`app/_lib/db` alone is 83) and re-run the pieces.

## The 162-file tail

Not covered by the scopes above. **Do not scan `app` or `.` to sweep these up** —
a parent-prefix scan retires the child contexts you just built and replaces them
with a coarser map. Scan these individually if you want the coverage, or leave
them unmapped and say so in the final report.

Worth scanning: `app/landing` (22), `scripts` (21), `app/features/shared` (15).

Probably not worth a session each: `app/apply` (9), `app/devcase` (7),
`app/diagrams` (6), `app/jds` (5), `app/login` (5), `e2e` (5), `uat` (5),
`i18n` (4), `app/control` (4), `app/offer` (4), `app/onboarding` (4),
`app/schedule` (4), and ~15 more dirs of 1-3 files, plus 18 loose config files
at the root and in `app`.

## After the sweep

Run the idempotent repair routes once, then consolidate group sprawl with
explicit merge pairs. Verify by counting DISTINCT paths across all contexts
against the 1,954 above — not by trusting the per-scan numbers.

## Note on `context-map.json`

This repo has one committed at the root. Check whose it is before believing it:
if it carries a `$schema` of `vibeman.dev`, it is a different tool's artifact and
its counts will disagree with the Personas database. **The database is the
authority** for anything the app does. The same trap cost a personas session a
5x sizing error.

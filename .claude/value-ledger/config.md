# value-ledger overlay — kp

Project-specific configuration for the shared `/value-ledger` skill
(`.claude/skills/value-ledger` is a link into `../ai-registry`).

| Key | Value |
| --- | --- |
| `uatRoot` | `uat/` — 31 Characters, 18 journeys |
| `valueRoot` | `uat/value/` |
| `referenceJourney` | `jd-to-shortlist` (= 100) |
| `period` | `month` |
| `competitorTeardown` | `docs/product/competitor-talentpilot.md` §1.1 (gitignored; present on this checkout) |

## Segments and gates

kp sells to two populations of buyer with different gates:

- **Regulated / enterprise (the ČS-shaped seed target):** `sealed-record` (tamper-evident
  decision chain + AI-Act Art. 12-shaped log) and `soc2` are gates — no deal without
  them, whatever the monthly number says. Source: `.claude/ship-loop/value-case.md` §3.
- **Small teams / agencies (the segment the competitor's reviewers refuse):** no gate;
  the monthly number and the with-app threshold decide.

## Where the ledger feeds

- The App-master motivation contract (`docs/concepts/app-master.md` §2.3): the value
  ledger's objects are **journey rows from `uat/value/ledger.md`**, not scan-proposed
  KPIs. Decided 2026-08-29 (coverage-plan D14).
- `/scan-sweep` and `/uat drain` backlogs: `value-ledger score <item>` gives a normalized
  worth before triage.

## Skill improvement log

- **2026-08-29 — first run was by hand, before the skill existed.** Three journeys
  (jd-to-shortlist, interview-schedule-prep, cv-analysis-jobfit), time-only first, then
  with the risk axis. The time-only ranking matched the wave map (W2/W3 highest after
  integrations) — the method validated — but priced every kp differentiator at zero. The
  risk axis is what made the output point at structured interviewing and defensibility
  instead of at the competitor's sourcing pool. Both runs are in
  `uat/value/runs/2026-08-29-three-journeys.md`.
- **2026-08-29 — Characters carry baselines but not VOLUMES.** Every `Motivation` block
  declares LLM-less minutes and a with-app threshold; none declares reqs/month or
  interviews/week. Volumes are operator estimates in `assumptions.md` and the largest
  single source of uncertainty in the ledger. When a Character is next `/uat update`d,
  add a `Volume` line.

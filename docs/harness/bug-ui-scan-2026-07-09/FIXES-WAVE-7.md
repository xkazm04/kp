# Fix Wave 7 — Data integrity & GDPR (6 Highs)

> 5 commits (`d82c05d`, `5999f84`, `c49034f`, `96850a3`, `2eed6d6`), **6 Highs closed**.
> Baseline preserved: tsc 0 · node unit 1441 → **1466** · python 860 OK · i18n 3238×4 · `next build` ✓.

Each of these lets bad or stale data become authoritative: a boot wipes recruiter work, a demo
corrupts real analytics, an expired consent gets re-contacted, an audit chain can be forged, a
committee hire is auto-decided by the AI.

## Commits

| Commit | Finding(s) | Fix |
|---|---|---|
| `d82c05d` | data-store #1 | Seed with `ON CONFLICT DO UPDATE SET` scoped to seed-owned columns — `disposition`/`github_json`/etc. survive a reboot. |
| `5999f84` | guided-sim #1 | Sim CVs write to the default workspace with a `(SIM)` title marker (the repo's real isolation contract), not the job owner's workspace. |
| `c49034f` | sourcing #1, #2 | Outreach gates on the durable **candidate**'s consent (fail-closed); the alert sweep gets a role ceiling, a concurrency pool, and a per-role timeout. |
| `96850a3` | screening-decisions #1 | The audit chain gets a keyed HMAC under a dedicated `KP_DECISION_HMAC_KEY`, with per-row `key_id` for rotation and legacy-prefix compatibility. |
| `2eed6d6` | group-eval #1 | Governance mode persists on the role and is sticky, so a committee hire can't silently auto-seal an AI lead. |

## The bugs

**Boot-wipe.** `seedAnalyses` ran `INSERT OR REPLACE` every startup with a column list predating
`disposition`/`decision_note`/`review_flags`/`github_json`, so recruiter dispositions on seeded
candidates were nulled on every restart. Now `ON CONFLICT(slug) DO UPDATE SET` refreshes only the
seed-owned columns — keeping the documented content-refresh while never touching user data.

**Sim leak.** `/api/sim/apply-cv` wrote to the job *owner's* workspace with the real title and no
marker, so demo CVs became permanent unmarked pipeline entries the analytics hire-rate counted.
The agent found the repo's real isolation contract — a `(SIM)` marker + default workspace that
`resetSim` and `NOT LIKE '%(SIM)%'` analytics already honor — and scoped the write there. No schema
change. (My original brief assumed a `DEMO_WORKSPACE` that doesn't exist; the agent read the code and
did the right thing instead.)

**Consent bleed (GDPR).** "Reach out" minted a fresh per-role entry whose blank consent made an
expired-consent or anonymized candidate contactable again. Consent now resolves at the durable
`candidate_id`, collapsing every per-entry snapshot to the most restrictive (anonymization is
terminal), gated before the entry is minted and failing closed on an unreadable state. The
unbounded sweep got a 25-role ceiling (excess reported as `truncated`, never silently dropped),
a 3-worker pool, and a 60s per-role timeout.

**Forgeable audit chain.** The "tamper-evident" chain was keyless SHA-256 — anyone with DB write
access could edit a row and recompute the hashes. Now each link carries an HMAC under a dedicated
`KP_DECISION_HMAC_KEY` (separate from `KP_SECRET`, so auth rotation never touches the chain), with a
per-row `key_id` for rotation and legacy keyless rows accepted only as a contiguous prefix (a
keyless-after-keyed row is a caught downgrade). `approvedBy` is now server-derived, not from the
request body.

**Governance auto-seal.** The recommendation-vs-committee mode was ephemeral client state defaulting
to recommendation, so a committee/eligibility hire silently re-sealed an AI-picked lead on rerun.
The mode now persists on the role and is sticky; under a governed mode the eval seals an
*advisory* record, never a lead.

## ⚠ Deploy-critical (new env vars)

The decision-chain fix requires, in production:
- **`KP_DECISION_HMAC_KEY`** — the audit-chain MAC key. Rotate-never-remove. **Without it set,
  the tamper-evident guarantee is not in force.**
- `KP_DECISION_HMAC_KEY_ID` — defaults to `k1`; only set when rotating.
- `KP_DECISION_HMAC_KEY_<retiredId>` — keep retired keys so old rows still verify.

Schema additions in this wave (`decision_records.key_id`) apply automatically via idempotent DDL at
boot — no manual migration.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc | 0 | 0 |
| node unit | 1441 | **1466** |
| python | 860 OK | 860 OK |
| i18n | 3238 × 4 | 3238 × 4 |
| `next build` | ✓ | ✓ |

Every fix confirmed **non-vacuous** by neuter → red → restore.

## Patterns (catalogue items 24–25)

24. **A dedicated secret for a dedicated guarantee.** The audit chain got its own
    `KP_DECISION_HMAC_KEY` rather than reusing `KP_SECRET`, so rotating the session secret can't
    silently break historical verification. When a key protects an integrity guarantee, don't share
    it with a key that has a different rotation cadence.
25. **Read the code before trusting the brief.** The orchestrator's sim-leak brief named a
    `DEMO_WORKSPACE` that doesn't exist; the agent found the real `(SIM)`-marker contract and used it.
    A finding describes a symptom — the fix has to match the code that's actually there.

## What remains

Highs: **41 of 66 closed**, 25 open. Next per the INDEX: the ATS security tail (#2 capability, #3
plaintext secret in the DB export, #4 dead-letter), the dev-case Python cluster, candidate-flow
Highs (apply-draft, onboarding hand-off), and the UI/a11y group. Plus the `automation-run.ts:269`
CAS follow-up noted in Wave 6.

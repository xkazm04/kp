# Ambiguity 🌀 + Business 🚀 — Pipeline B Run Summary (kp, 2026-06-25)

> Scan + Triage + Fix over all **43 contexts** with the combined **Ambiguity-Guardian +
> Business-Visionary** scanners, top-5-by-value per context → **215 findings** (17C / 100H / 92M / 6L).
> Branch `vibeman/ambiguity-biz-fixes` (UNMERGED). **36 fix/feat commits** closing **35 findings**
> across 9 fix waves, preceded by 9 opportunistic dead-code-removal commits.
> Final gates: **tsc 0 · JS 1055 · Python 695 · i18n 2904 (en/cs parity) · 0 regressions.**

---

## Headline: every Critical addressed

All **17 Criticals** are closed, documented, or structurally mitigated. The cross-tenant
pair (auth/tenancy) is mitigated by the self-defending `KP_MULTI_WORKSPACE` flag rather than
a risky 31-table migration; the public-landing Critical was resolved by *documenting* the
built-but-not-launched intent (sibling findings showed dead-end CTAs). The rest are real fixes.

## Closed by wave

| Wave | Theme | Findings | Commits |
|---|---|---:|---|
| Dead-code sweep | unused/dead-path removal (opportunistic) | 9 | `4c9b65a`…`b4d510f` |
| W1 | Hiring correctness / fairness | 6 | rename Fairness-check, fairness-shield, observed-judgment, authenticity moat, credential gate, deal-breaker tiers |
| W2 | Cross-tenant isolation | 1 | self-defending `KP_MULTI_WORKSPACE` + tenancy manifest |
| W3 | Revenue leak / billing | 6 | revoke-reorder, downgrade-as-checkout, meter under-enforcement, simulator meter-gate, unmapped-sub alert, grace period |
| W5 | Comms & candidate-experience | 5 | relay-not-configured banner, whisper-1 override, offer_expired event, status-link email, config-driven slots |
| W4 | GDPR / audit / provenance | 3 | evidenceTrace erasure (Art.17), seal human decisions, Art.22 named approver |
| CR | Reachable Criticals sweep | 2 (+1 doc) | rematch-corpus exclusion, probe-strength gate (+ landing intent doc) |
| HW1 | Dark-capability activations | 4 | matrix coverage gap, per-role-family calibration, JD lint on paste, salary anchor + grounding |
| FW1 | Regulated-hiring correctness | 4 | early-career fairness track, design-provenance gate, job-fit taxonomy, consent TTL config |
| CW1 | Comms/reliability (this session) | 5 | unaddressable signal, bounce/receipt path, interviewer brief, pre-boarding reminder, per-offer deadline |

Per-wave detail: `FIXES-WAVE-1..5.md`, `FIXES-CRITICALS-SWEEP.md`, `FIXES-HIGH-WAVE-1.md`,
`FIXES-FAIRNESS-WAVE-1.md`, `FIXES-COMMS-WAVE-1.md`. Structural facts for each in
`docs/harness/harness-learnings.md`.

## Deliberately deferred (with cause)

- **Skill recency into the score** (fairness High) — a decade-stale skill scores as current.
  Needs per-skill-recency plumbing through `MatchCandidate` + transform + **eval validation**,
  so it's a focused eval-backed session, not a blind wave fix.
- **Tenancy per-table read-scoping** — the cross-tenant fix is the self-defending flag today;
  real isolation replicates the documented scoping recipe across 27 more tables (one domain
  per goal, per the tenant-layer learnings).
- **Scheduling host/availability model** (W5-3 phase 2) — phase 1 made slot TIMES config-driven;
  per-interviewer free-busy + calendar sync is the larger phase 2.
- **A true `.ics` attachment** for the interviewer brief — the outbox is text-only, so CW-3
  inlines the hold; a real attachment needs an attachment-capable channel.
- **Engagement opens/clicks**, **quiet-hours/timezone gating**, **no-show capture**,
  **scheduling funnel aggregate** — the remaining Medium comms/scheduling findings.

## Open tail (not yet worked)

The Medium/Low body and several High themes remain untouched as whole waves:
**Revenue-leak Highs** (40-finding theme, beyond W3), **GDPR/provenance Highs** (beyond W4),
**Silent-failure / data-integrity** (33 findings), **Cross-tenant** (the 27-table replication),
**Distribution/SEO** (6), and the **Magic-numbers** tail (13). The triage `INDEX.md` carries the
full per-context breakdown for picking the next wave.

## New env vars introduced (all optional, safe defaults)

`COMMS_CALLBACK_SECRET` (enables the bounce callback, fail-closed) ·
`KP_PREBOARDING_REMINDER_DAYS` (3) · `KP_OFFER_TTL_DAYS` (7) ·
`KP_OFFER_REMINDER_LEAD_HOURS` (48) · `KP_CONSENT_TTL_DAYS` (365, from FW1).
Plus the standing `KP_MULTI_WORKSPACE` (W2) and `KP_OPERATOR_PASSWORD`/`KP_SECRET` (auth).

## State for review / merge

Branch `vibeman/ambiguity-biz-fixes` is unmerged and clean (all gates green). Every fix is an
atomic commit with a `Refs:` trailer pointing at its finding, a regression test where the module
is purely testable, and en/cs i18n parity. Ready for review or merge to `master`.

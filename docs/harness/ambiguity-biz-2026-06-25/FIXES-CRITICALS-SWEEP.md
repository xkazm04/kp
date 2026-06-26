# Ambiguity+Business — Remaining Criticals sweep (cross-theme)

> 3 commits closing the last 3 reachable open Criticals (2 code fixes + 1 documented-intent close).
> Baseline preserved: tsc 0 · JS unit 1033 · Python 694 OK · en/cs parity OK. 0 regressions.

After the five themed waves, three Criticals from different contexts remained open. This sweep closes them.

## Commits

| Commit | Finding | Sev | Resolution |
|---|---|---|---|
| `7bd4dc0` | closed roles stay in the rematch corpus | C | fix |
| `43ed60c` | probe-strength audit is advisory-only | C | fix |
| `a7b0340` | public landing never served in prod | C | documented (launch = product decision) |

## What was fixed

1. **Closed roles in rematch (`jobs.ts`).** `listCorpusJobs` filtered `status != 'draft'`, keeping `'closed'` roles in the set every candidate is rematched against — so a recruiter who closed a filled role still had candidates ranked/routed to it (and the close didn't change the cache fingerprint, persisting the stale result for the 168h TTL). Aligned the predicate to `status = 'published'` (or NULL), matching the canonical `openOnly` / `isJobOpenForApplications` definition.

2. **Probe-strength gate (`devcase/lifecycle/[id]/approve`).** `auditProbeStrength` was built to stop a human shipping a case whose probes "can't tell strong from naive" and renders that banner at the gate — but the approve route ignored the verdict and shipped anyway (a case that doesn't discriminate yields a transfer score that is noise → candidates chosen at random). The route now BLOCKS (422 `probe_audit_failed`) on `verdict === "none"` unless the reviewer re-submits with `overrideProbeAudit: true`, which ships it but records "probe-audit OVERRIDDEN" in the audit trail.

3. **Public landing never served (documented).** `/` is gated DEV-ONLY (`devAuth.ts`: `DEV_GATE = NODE_ENV !== "production"`), so prod always mounts the dashboard and `/landing` redirects to `/` — while `page.tsx` falsely claimed signed-out visitors see the landing. The root was undocumented intent. **Resolved by making it explicit, not by launching:** launching now would expose the dead-end CTAs / off-brand SEO / missing social proof flagged in sibling findings (the landing is not launch-ready). Corrected the false comment, documented the gate + consequence in code, and added a "Public landing (BUILT, NOT LAUNCHED)" section to `docs/DESIGN.md` with the exact launch steps. The launch itself remains a product decision for the team.

## Verification

| Gate | Result |
|---|---|
| tsc --noEmit | 0 |
| JS unit (`node --test`) | 1033 |
| Python (`unittest discover`) | 694 OK / 4 skip |
| i18n en/cs parity | OK |

## Status after the sweep

All Criticals are either closed or, where the close is a genuine product decision (landing launch), documented with the decision surfaced to the team. Remaining open work is the High/Med/Low tail + the documented deferrals (BYOM monetization, tenancy read-scoping, scheduling host model, compliance value-surfacing) — all themed in `INDEX.md`.

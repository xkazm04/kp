# Tri-Lens Fix Wave 7 — Conversion (theme T9) — FINAL

> 3 atomic fix commits, the last 3 criticals closed → **30/30 criticals done.**
> Baseline preserved: tsc 0 → 0 · TS unit tests 955 → 957 (+2) · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `8881c48` | sourcing-campaigns-rediscovery #1 — outreach no opt-out | Critical | consent.ts (+test), comms-dispatch.ts, automation-run.ts |
| 2 | `13abfa9` | landing-marketing #1 — dead CTA anchors | Critical | landing/spark/SparkLanding.tsx, PricingSection.tsx |
| 3 | `7ebad17` | guided-simulation #1 — demo climax no CTA | Critical | features/simulation/SimBar.tsx |

## What was fixed

1. **Outreach respects consent/anonymization (CAN-SPAM/GDPR).** `dispatchOutreach` — the "Reach out" path, entered most via rediscovery (which re-contacts previously-**rejected** candidates) — sent with no consent check. Added a pure `outreachSuppressionReason()` gate (`consent.ts`): an **anonymized** or **consent-expired** candidate is suppressed (audited `outreach_suppressed`, no `outreach_sent` marker → a re-consent can still be reached), and `automation-run` threads the result into `applied` (`suppressed_anonymized`/`suppressed_consent_expired`) so the UI shows "cannot contact" instead of a false "reached out". Follow-up: aggregate a candidate's do-not-contact state across multiple entries.

2. **Landing CTAs reach the app.** Every primary CTA on the Spark landing (nav, hero, pricing tiers) linked to `#cta`, which scrolled to a final section whose own button was `href="#"` — a dead loop with no funnel exit. Pointed all four conversion CTAs at the existing `/login` entry; section-scroll anchors left intact.

3. **Demo climax converts.** The keyless JD→Hired walkthrough's terminal state offered only "Run again" — the highest-intent moment produced zero next-step. The `SimBar` now leads with a "Get started — do it with your roles" CTA into `/login` at `sim.done`, demoting "Run again" to secondary.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 955 | 957 (+2) |

New tests: outreach suppression (anonymized/expired suppressed; active/expiring/none/open-ended contactable) in `consent.test.ts`.

## Patterns established (catalogue, continued)

22. **A consent system must be consulted on the OUTBOUND path, not just retention.** A retention/anonymization model that governs storage but is never checked before a send is a compliance gap on every outbound surface; gate the dispatch.
23. **A marketing/demo surface needs a funnel exit at peak intent.** Dead `#`/`#cta` anchors and replay-only terminal states leak the highest-intent moment; wire CTAs to the real entry point.

## Status: all themes complete

This is the final fix wave. The 22-pattern catalogue, the full per-wave docs (`FIXES-WAVE-1..7.md`), and the per-context reports remain the durable artifacts. Remaining items across the codebase are High/Medium/Low (per the INDEX and each wave doc's "what remains"), not criticals.

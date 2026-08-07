# Ambiguity+Business Fix Wave 4 — GDPR / audit / compliance

> 3 commits, 3 findings closed (1 Critical + 2 High). Three further Highs deferred as documented dark-capability surfacing (dossier UI, bias-audit export, eval publish).
> Baseline preserved: tsc 0 · JS unit 1033 · Python 694 OK · en/cs parity OK. 0 regressions.

The product's stated differentiator is *auditable, explainable AI hiring*. This wave closes the gaps where that promise was hollow: an erasure that didn't erase, and an audit chain that proved what the machine did but not what people did.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `af33148` | erasure leaves verbatim `evidenceTrace` CV quotes (GDPR Art.17) | C | consent.ts, erasure-analyses-scrub.test.ts |
| 2 | `404804f` | human accept/reject never sealed into the tamper-evident chain | H | api/pipeline/[id]/route.ts |
| 3 | `92b5add` | Art.22 approver is always the constant "operator" | H | auth/operator-approver.ts (new), decisions/screen-wave/route.ts, screen-wave.ts |

## What was fixed

1. **Erasure leaves CV quotes (C).** `scrubPiiFromPayload` only emptied the array key named exactly `evidence` + scalar PII keys, but the payload also carries `evidenceTrace.{experience,skills,seniority,education,salary}` — string[] of **verbatim CV quotes** the scrubber walked straight through. After "erase", those snippets stayed readable in History / `/api/analyses/[slug]` and were re-exported by the provenance dossier, while the audit log said "erased" (a hard DPIA blocker). Added a free-text *container* deny-list (`PII_CONTAINER_KEYS = evidenceTrace`) + `deepRedact`, so the whole subtree is blanked on anonymization while structured recruitment signal (scores, skills) is kept for rediscovery. Real-DB test asserts no `evidenceTrace` quote survives.

2. **Human decisions unsealed (H).** The chain sealed AI auto-rejections, group-eval verdicts, offers and reinstatements — but the recruiter's direct accept/reject flowed through `actOnPipelineEntry` with no `sealDecisionSafe`, so a human-rejected candidate's `?candidate=` "right to explanation" dossier came back empty. The accept/reject branch now seals the human decision (`human:recruiter`, the typed rationale, fromStage), mirroring the reinstate seal. Best-effort (never fails the committed decision).

3. **Approver names nobody (H).** Every in-app screening commit sealed the approver as the constant "operator (in-app approval)" — the modal never sends `approvedBy`. The app is single-operator (one `KP_OPERATOR_PASSWORD`, no per-user identity), so the fallback is now `operatorApprover()`: `KP_OPERATOR_NAME` names the actual reviewer in the sealed record, and absent that it states the single-operator posture honestly rather than implying a specific person reviewed it.

## Deferred (documented — dark-capability surfacing, Wave-6 territory)

- **Candidate-scoped dossier UI (screening #3, H).** `/api/decisions/records?candidate=<id>` (the per-subject DSAR artifact) is finished server-side but no UI passes the param — a one-click, candidate-scoped, verifiable dossier export is a monetizable compliance feature, left unwired.
- **Exportable bias-audit pack (group-eval #2, H)** and **published fairness-eval methodology (eval #1, H)** — per-role fairness matrices + the offline fairness eval are computed but never surfaced as a customer/auditor artifact.

These are value-surfacing (not correctness/compliance holes) and pair naturally with the Wave-6 dark-capability theme.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| JS unit (`node --test`) | 1033 | 1033 |
| Python | 694 OK / 4 skip | 694 OK / 4 skip |
| i18n en/cs parity | OK | OK |

## Patterns established (catalogue items 13–14)

13. **Erasure must deny-list *containers*, not just leaf keys.** A key-name deny-list misses free-text nested under a structurally-named container (`evidenceTrace.*`). For right-to-erasure, deep-redact known free-text subtrees (or whitelist the numeric/enum signal to keep) — and pin it with a test that asserts no quote survives a real anonymize.
14. **An audit chain is only as defensible as its weakest sealed actor.** Sealing the machine's decisions but not the human's is backwards for Art.22; and a human-in-the-loop control whose approver is a hardcoded constant proves nobody reviewed it. Seal every consequential decision, and name a real (or honestly-configured) approver.

## What remains

GDPR correctness holes are closed. The compliance *value-surfacing* (dossier UI, bias-audit/eval export) is deferred to the dark-capability wave. Other open INDEX themes: dark-capability activations (W6), the tenancy read-scoping follow-up (W2 cont.), the remaining cross-theme Criticals (probe-strength auto-approve, closed-roles-in-rematch, landing-never-served), the BYOM decision, and the Med/Low tail.

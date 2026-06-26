# Dev Lifecycle, Cohort & Outcomes — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H3/M1/L0

## 1. Probe-strength audit is advisory only — a case that "can't tell strong from naive" can still be approved and shipped
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: unenforced quality gate / happy-path approval
- **File**: app/api/devcase/lifecycle/[id]/approve/route.ts:43
- **Observation**: `auditProbeStrength` (devcase-probe-audit.ts:71) was built expressly "so a human never ships a case whose probes can't tell strong from naive," and renders a banner at the gate whose worst verdict literally reads *"No load-bearing probes — this case can't tell a strong submission from a naive one"* (ProbeStrengthBanner.tsx:28). Yet the approve route persists and goes live with **no check on that verdict** — it only calls `isAtReviewGate`. The same is true post-ship: `CohortProbePanel` detects probes the whole cohort misses but is purely diagnostic, with no loop back to redesign. Whether the audit is a *warning* or a *gate* is never decided in code.
- **Why it matters**: A take-home whose probes don't discriminate yields a transfer score that is noise; candidates promoted off it are effectively chosen at random — a silent wrong hiring outcome that the product's core promise ("the case discriminates") is supposed to prevent. The detector exists but doesn't protect anyone.
- **Recommendation**: Block (or require an explicit typed-override + audit row) when `auditProbeStrength(probes).verdict === "none"` in the approve route, and surface the cohort blind-spot signal as a one-click "Regenerate with note" prefill so the empirical miss feeds the existing redesign route.
- **Effort**: M

## 2. The flagship Durable Skill Profile is never delivered to the candidate who "owns" it
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: moat / network-effect value left on the table
- **File**: app/features/sub_dev/SubmissionRow.tsx:336
- **Observation**: Minting returns a candidate-owned token, but the only surfacing is a recruiter-facing "Open card" link in the dev studio (SubmissionRow.tsx:336-337); the POST route returns the token to the caller and stops (skill-profile/route.ts:21). No promote invite, feedback brief, or close comm references the token (confirmed: zero `/skill/` mentions in feedback/close/promote routes). The whole "portable, candidate-owned, FICO-style" moat depends on the candidate carrying the credential to *other* employers — but the candidate never automatically receives it.
- **Why it matters**: This is the differentiation moonshot, and its network effect (candidates spreading kp-verified credentials → kp becomes the verification layer) is fully built yet unwired at the last inch. Delivering the link in the existing courteous feedback/promote comms turns every graded candidate — including rejected ones — into a credential-carrying distribution node and a retention/goodwill win.
- **Recommendation**: Attach the signed score-card URL to the promote invite and the non-adverse feedback brief (buildFeedbackBrief), with a one-line "this is yours to share." Auto-mint on evaluation so the link is always ready.
- **Effort**: S

## 3. Skill-profile revocation is fully modeled but unreachable — no route or UI ever calls it
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark capability / trust & compliance gap
- **File**: app/_lib/db/skill-profiles.ts:128
- **Observation**: `revokeSkillProfile` exists, the verdict type carries `revoked`, the verify API returns it, and the public page renders a dedicated "revoked" badge state (skill/[token]/page.tsx:38) — an entire revocation pathway. But `revokeSkillProfile` has **no caller anywhere** in the app (grep across `app/`). A credential minted in error, over a disputed evaluation, or for a candidate who withdraws consent can never be pulled.
- **Why it matters**: A "verified by kp" credential presented to third parties with no kill switch is a trust and (GDPR/portability) compliance liability — kp keeps vouching for an attestation it can't retract. The work is 95% done; only the trigger is missing.
- **Recommendation**: Add a `POST /api/skill-profile/[token]/revoke` (recruiter-gated) plus a "Revoke credential" action on the submission row; record an audit row mirroring the close/redesign pattern.
- **Effort**: S

## 4. "Durable" profiles are signed with a single non-versioned KP_SECRET — rotating it flips every live credential to the red "tampered" shield
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: undocumented operational trade-off / key lifecycle
- **File**: app/_lib/skill-profile.ts:84
- **Observation**: `signProfile` HMACs over a single `KP_SECRET` with no key id; `verifyProfile` recomputes under "the *current* KP_SECRET." The artifact carries a `methodologyVersion` but the signature is not keyed by any rotation epoch. So rotating or losing the secret makes every previously-issued profile fail verification, and the public page maps `!valid` straight to the alarming red `tampered` state (skill/[token]/page.tsx:27-33) — actively accusing the candidate of forgery. No rotation/re-sign runbook is recorded despite the "Durable" branding and third-party verification promise.
- **Why it matters**: A credential sold as durable and portable is silently fragile to a routine ops action (secret rotation, multi-region key skew). The failure mode is the worst possible: an honest candidate's card reads "tampered."
- **Recommendation**: Store a `keyId` alongside each signature, keep a small map of retired secrets for verification, and distinguish "signed under a retired/unknown key → re-issue needed" (muted) from genuine tamper (red). Document the rotation procedure.
- **Effort**: M

## 5. The stall SLA is computed only at render time — no proactive alert wires into the existing automation scheduler
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: missing feedback loop / retention
- **File**: app/features/sub_dev/LifecycleRow.tsx:38
- **Observation**: `lifecycleStall` (devcase-sla.ts) flags an open-and-empty posting past `STALE_COLLECTING_DAYS = 7`, but it runs as a pure client read "snapshotted once at mount … no cron" (LifecycleRow.tsx:37-44). The codebase already has a durable automation scheduler that fires *aging nudges* for the main pipeline (automation-pass.ts, scheduler.ts) — yet `lifecycleStall` is never referenced there (grep confirms). The flag only fires if a recruiter happens to open the dev studio.
- **Why it matters**: Stalled requisitions silently rot — no email, no digest, no nudge — exactly the ghosting/abandonment the rest of the pipeline works to prevent. The enforcement infrastructure exists; the dev-case SLA just isn't plugged in.
- **Recommendation**: Add a stall sweep to the automation policy pass that emits a recruiter nudge (and optional auto-close suggestion) for lifecycles past the threshold, reusing the scheduler's existing nudge channel.
- **Effort**: M

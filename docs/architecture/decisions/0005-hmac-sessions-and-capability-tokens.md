---
id: "0005"
title: HMAC operator sessions; capability tokens for candidates
status: accepted
date: 2026-08-26
supersedes: []
superseded-by: null
tags: [security, auth, privacy]
sources:
  - proxy.ts
  - app/_lib/auth/session.ts
  - app/_lib/auth/session-revocation.ts
  - app/_lib/auth/edge-verify.ts
  - app/_lib/auth/public-routes.ts
  - app/_lib/auth/require-operator.ts
  - app/api/schedule/[token]/route.ts
  - app/_lib/data-held.ts
  - SECURITY.md
  - docs/architecture/candidate-data-flow.md
---

# HMAC operator sessions; capability tokens for candidates

## Context

Two populations touch this app and they are not the same kind of user.

**Operators** (recruiters, hiring managers) log in and come back. **Candidates**
arrive once, from a link in an email, to book a slot or take an interview — and
they never chose to use this software. Asking them to create an account to
reschedule an interview is both hostile and a larger PII surface than the task
needs.

A self-hosted app also cannot assume an identity provider exists.

## Decision

Two mechanisms, deliberately different.

**Operators: custom HMAC session cookies.** No OAuth dependency, no JWT
library, no external IdP. `KP_OPERATOR_PASSWORD` unset means open dev mode; a
**production build fails closed** unless `KP_ALLOW_OPEN=1` is set explicitly —
so "I exposed it to the internet without a password" has to be a decision
rather than an accident.

The gate is **fail-closed by shape**: `proxy.ts` gates every path *except* what
`app/_lib/auth/public-routes.ts` allowlists. A forgotten recruiter route stays
gated (safe). A forgotten public route sends a candidate to `/login` (visible,
fixable) — never a PII leak. Sensitive routes additionally re-verify with
`requireOperator`, because one gate is not defence in depth.

**Candidates: capability links, never sessions.** `/schedule/[token]`,
`/interview/[token]`, `/status/[token]`, `/apply/[id]`, `/data/[erasureToken]`
are unguessable URLs. Holding the link *is* the capability, by design;
forwarding one forwards the access, and `SECURITY.md` says so plainly.

Two rules ride on that:

- **A token route returns a projection, not the row.** Every `[token]`
  response is an explicit field allowlist (`publicInviteView` in
  `app/api/schedule/[token]/route.ts` is the reference shape). Internal ids
  never reach the wire.
- **Every open route that spends money or spawns a subprocess is rate
  limited**, per IP and per token. `app/api/rate-limit-contract.test.ts` pins
  which call sites do it and how, so moving or re-keying a limiter is a
  deliberate edit to a test rather than a silent deletion.
- **What a token surface may say back is bounded by what is actually held.**
  `heldDataCategories()` in `app/_lib/data-held.ts` projects the categories the
  `/data/[erasureToken]` page reports from the entry's real presence signals,
  never a hardcoded list — a candidate who only applied is not told we hold
  interview records. The full path that data took to get there is mapped in
  [`../candidate-data-flow.md`](../candidate-data-flow.md), which this record
  cites as a source so `npm run docs:check` fails if it is deleted or moved.

## Consequences

**Good.** No auth vendor, no IdP requirement, works air-gapped. Candidates do
zero-friction actions. The erasure link in every candidate email works without a
login — which is what makes GDPR Art. 15/17 self-service actually reachable.

**Bad, and accepted.** The two populations differ here. A leaked candidate
link is a leaked capability, and its mitigation is still only expiry and
unguessability: a capability token is not a session and there is no per-link
revocation. An operator session, the higher-privilege credential, is revocable.
One session can be revoked by its principal and `iat`
(`app/_lib/auth/session-revocation.ts`, consulted by the proxy gate and every
session read), and all of them at once by bumping `KP_SESSION_EPOCH`
(`sessionEpoch()` in `session.ts`). The epoch is the blunt instrument and needs
no database. The validity window is half-open, `[iat, exp)`, and `session.ts`
and `edge-verify.ts` use the same `exp <= now` test, so a revoked cookie is
dead at `exp` and there is no 1 ms gap where it verifies after its revocation
row has been swept. Custom crypto is our responsibility — `session.ts` and
`edge-verify.ts` are small and directly tested for exactly that reason. And SSO
is not free: it is tracked as enterprise work (E1) on top of this, not as a
replacement for it.

*Amended 2026-10-06:* the earlier wording, "not revocable sessions", was true when
this record was written and stopped being true for operator sessions with
`04b459639` (per-session revocation), hardened by `49bdcf65e`, `008fb8965`,
`4f585e213` and the half-open window fix `2ef749b3a`. It still holds for
candidate capability links. The Decision is unchanged.

## What would change our mind

An enterprise buyer requiring SSO gets it **alongside** the HMAC path, because
removing it would break open-mode local development and the air-gapped install.
The capability-token model for candidates is not up for revision — an account
wall for a candidate is a product regression, not a security improvement.

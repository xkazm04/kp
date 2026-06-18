# Tri-Lens Fix — High Wave 5: Data-integrity / intake

> 2 atomic fix commits, **2 High findings closed**; 3 Highs deferred-with-reason.
> Baseline preserved: tsc 0 → 0 · TS unit tests 963 → 964 (+1) · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| Commit | Finding | Severity | Files |
|---|---|---|---|
| `43d22fb` | candidate-profile-matching #2 — non-atomic archetype write | High | archetype-registry.ts |
| `ef19106` | application-intake-apply #2 — no anti-bot on lead form | High | apply-intake.ts (+test), api/apply/[id]/quick/route.ts, QuickApplyForm.tsx |

## What was fixed

1. **Atomic archetype-registry write + serialized saves.** `archetypes.json` is read by the Python pipeline on *every* intake/ranking spawn, while a recruiter's save rewrote it with a non-atomic `writeFile` — a reader could catch a torn/truncated file and 500 the live run on a parse error. And two near-simultaneous saves each read the pre-other snapshot, the second clobbering the first (a silent lost update to scoring weights / the compliance-critical fairness flag). Now: write a sibling temp file → `rename()` over the target (atomic within a filesystem — readers always see a complete old or new file); `updateArchetype`/`createArchetype` run their read-modify-write through a process-level promise-chain mutex so concurrent saves serialize. (Real even single-operator: the *writer* is the recruiter, the *reader* is a concurrent Python spawn.)

2. **Anti-bot honeypot on the quick lead form.** The form's only gate was the KO verdict — which filters ineligible *humans*, not bots. A bot supplies name + a valid (often a victim's) email, answers every KO "Yes", and each submission files a real Accepted lead AND emails the address — an open email-relay / list-bombing vector. Added a hidden `company_url` honeypot (a real input pulled off-screen + out of the a11y/tab order — *not* `type="hidden"`, which bots skip); the server (pure, tested `isHoneypotFilled`) silently drops a filled submission (no lead, no email) returning the ordinary decline copy so a bot can't distinguish it from a KO rejection. Complements the existing rate limit.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 963 | 964 (+1) |

New test: `isHoneypotFilled` (filled trips; empty/whitespace/absent/non-string/non-object don't).

## Deferred-with-reason (this theme)

- **Scheduling #2 (reminder missed-fire on a cold heartbeat)** — a confirmed slot whose 24h reminder window opens *and closes* while the heartbeat is down gets no reminder, with no "missed" state. A correct fix needs a new terminal `reminder_missed` state + surfacing it in `InviteLifecyclePanel` (a small grace-window catch-up alone sends a confusing past-slot "see you at your interview"). Needs a missed-state design + migration + UI — not a one-liner.
- **Scheduling #3 (recruiter grid vs candidate self-schedule = two slot systems)** — the board calendar writes free-text labels (`approvalDetail`) with no `slot_at`/collision check, so a grid pick and a self-book can double-book undetected. A real fix unifies the two onto the `slot_at` identity / routes the grid through `confirmScheduleInvite` — a structural change.
- **Matching #3 (no job→candidates ranking view)** — a missing *feature* (build a new surface), not a bug.

## Cumulative this session

30/30 criticals + **17 Highs** closed across 13 waves, 0 regressions throughout. TS 935→964, Python 626→634.

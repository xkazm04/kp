# Fix Wave 6 — Races, TOCTOU & idempotency (6 Highs)

> 4 fix commits (`d745f63`, `d10fd5f`, `f7874dc`, `cd75e7e`), **6 Highs closed**.
> Baseline preserved: tsc 0 · node unit 1424 → **1441** · python 855 → **860** OK · i18n 3238×4 parity.

Every finding here is a window between a *check* and an *act* where a second actor — a
concurrent request, a retry, a human decision landing mid-hop — slips through and causes a
wrong outward action: a duplicate rejection email, a double-charge, a resurrected pipeline, an
offer whose terms don't match the letter.

## Commits

| Commit | Finding(s) | Fix |
|---|---|---|
| `d745f63` | dev-lifecycle #1 | Close-case: a single synchronous CAS (`UPDATE … WHERE stage != 'closed'`) so only the request that flips the stage sends the rejection batch. A per-*request* dedup Set can't help across two requests. |
| `d10fd5f` | offers-onboarding #1 | Re-extend refreshes the open offer row in place (same token) so the accept page always equals the most recently dispatched letter. Accepted/expired rows stay immutable. |
| `f7874dc` | voice-interview #1, cv-analysis #2 | Meter gate reserves the **worst-case** debit (`bookedMin*2`) instead of the 20-min default; the analyze gate subtracts in-flight reservations so a burst can't exceed the cap. |
| `cd75e7e` | hiring-automation #1, job-postings #1 | Auto-advance CAS also guards `approvalKind` (a human decision mid-hop aborts the stale system action); role-reopen is an explicit `reopenEntriesByJobId` transaction, not a side effect of re-sourcing. |

## The bugs

**Close double-reject.** The close route guarded `stage === "closed"` and *then* ran an
`await sendComm` loop with a per-request dedup Set. Two overlapping closes each passed the guard
and each emailed every non-promoted candidate a rejection. The guard has to be in the DB, not
request memory — now one atomic `UPDATE … WHERE stage != 'closed'` returns rows-affected, and only
the winner notifies.

**Offer terms divergence.** Re-extending re-sent the letter from the fresh draft but left the
*open row the accept page reads* unchanged, so a candidate could accept a salary different from the
letter. The open row is now refreshed in place under a CAS, keeping the same token (a re-extend is
"re-send the same link"). An already-accepted token keeps its own recorded terms.

**Meter overrun (money).** `/create` gated interview minutes on 20, but `/complete` debits up to
`bookedMin*2` — so a near-cap meter went negative on the priciest meter. And the analyze gate
checked at submit but debited at delivery, so a burst all passed. Fixed by reserving the worst case
and by gating on `remaining − inFlight`. **⚠ Accepted product change:** a fresh Starter customer (30
minutes) must now buy a pack before a default 20-min interview, which reserves 40. The reserve is a
single named constant if retuned later.

**Auto-advance clobbers a human decision.** The apply-time CAS guarded only `expectedStage`. A
human review queued during the seconds-long policy-pass Python hop appears *without* a stage change,
so the system advance sailed through and consumed it. The CAS now also guards `approvalKind` and
fails closed. Bundled: three written-but-unmapped decision kinds registered (they rendered UNKNOWN;
the writer-coverage test's hardcoded list hid it), and the ROI ledger credits `auto_advanced`, not
human `advanced`.

**Reopen half-resurrects.** Reopening a closed role relied on re-*sourcing* to incidentally flip
`role_closed` entries active, so any the matcher didn't re-select stayed stranded, with no audit
event. Reopen is now an explicit transaction restoring every `role_closed` entry to its preserved
pre-close stage and writing `role_reopened`, independent of sourcing. `role_closed` is written only
by the close path, so it never un-does a merit reject.

## Untangling a mixed commit (process note — pattern 22)

Mid-wave, the user committed their concurrent voice-eval work and it **swept all six of these
fixes into one commit** titled only `feat(voice-eval)`. A `git revert` of that commit would have
silently reverted money and decision-integrity fixes, and no finding was cited.

It was local-only and unpushed, so with the user's go-ahead it was split: `git reset HEAD~1`, then
rebuilt as the four atomic fix commits above (explicit-path staging only — `git add -p` is
interactive and blocked here) plus the voice-eval commit under its own message. **The split was
verified by comparing tree hashes**: HEAD's tree differs from the original commit only in the
voice-eval files (the user kept editing them concurrently — HEAD is a superset), and every fix file
is byte-identical. A split you can't prove is byte-identical is a split you don't trust.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc | 0 | 0 |
| node unit | 1424 | **1441** |
| python | 855 OK | **860 OK** (incl. concurrent user voice-test additions) |
| i18n | 3238 × 4 | 3238 × 4 |

All four fixes confirmed **non-vacuous** by neuter → red → restore.

## Patterns (catalogue items 22–23)

22. **A split you can't prove byte-identical is a split you don't trust.** When separating an
    entangled commit, compare the resulting tree hash against the original. Any difference must be
    fully explained (here: a concurrent editor's newer version of unrelated files), never assumed
    benign.
23. **A per-request dedup structure cannot dedup across requests.** A `Set` in handler memory, a
    module-level cache, a React ref — none survive a second concurrent request or a retry. Idempotency
    for an outward action (email, charge, state flip) belongs in a single atomic DB write, and every
    downstream side effect gates on *that write's* rows-affected.

## What remains

Highs: **35 of 66 closed**, 31 open. Next per the INDEX: W7 data integrity (`seedAnalyses` boot-wipe,
sim-data leak, benchmark contamination, decision-chain HMAC, governance persistence, GDPR consent
reset on rediscovery), then the ATS security tail, dev-case Python, candidate flows, and UI/a11y.

Follow-up noted by the automation agent: `automation-run.ts:269` has the same stage-only-CAS shape
as the one fixed here and should get the `approvalKind` guard too.

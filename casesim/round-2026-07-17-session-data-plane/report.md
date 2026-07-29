# case-sim round 3 — the session data plane (2026-07-17)

Round 3 tested the queued questions: do canaries survive a **trap-aware gamer**
(a delegator who explicitly prompts its model to hunt planted flaws), with the
diff-based baseline and richer reporting landed beforehand. Case: "tighten the
session data plane" — canaries were two real flaws in the chat/flush routes
(duplicated newest message in the model context; per-flush token→posting→case
resolution of publish-frozen data).

## The round's defining accident — and why it was worth having

Persona worktrees branch from the last COMMIT; the seed (and both canary
fragments) lived in the UNCOMMITTED working tree. The candidates never saw the
canary code — several honestly reported the brief's chat surface "doesn't exist"
(a judgment signal in itself); others invented their own version of it. Every
canary verdict this round is therefore void, and the consequences were
instructive:

- **Deterministic pass: PASS** (verifier 64 > prompt-crafter 64 > minimal 58 >
  delegator 29) — it doesn't weight canaries.
- **LLM pass: FAIL, and inverted** — gamer 70 (judgment 84!) ABOVE verifier 59,
  delegator 53 above minimal 37. Root cause: the corrupted canary verdicts
  (false "addressed"/"flagged") were fed to the judge as *mechanical ground
  truth*, and it weighted them exactly as instructed. **Poisoned ground truth is
  worse than no ground truth.**

Fixes shipped:
1. **Protocol rule** (SKILL.md): seed files must match the committed base the
   worktrees branch from (`git show HEAD:<path>`), or be handed to personas
   explicitly — a canary in uncommitted code is invisible and mints fake verdicts.
2. **Pipeline hardening** (`artifact_checks._descends_from_seed` + tests): a
   same-path file that does not descend from the seed version (<30% seed-line
   survival — a rewrite from a foreign base, or an invented file) now grades
   `unverifiable`, never a free "addressed". Catches the from-scratch case; the
   same-base/absent-fragment case is only fixable by the protocol rule.

## Trap-aware gamer verdict (the question the round was built to ask)

Its trap-scan prompt DID catch the duplicated-message flaw — **canaries are not
durable against a candidate who suspects them** and asks a model to sweep for
traps. What still discriminated: the *quality* of the one-shot artifact — an
unbounded, never-invalidated cache left on the hot path, and the 10x mid-flight
update ignored in the real work (only faked in the report). Conclusion refined
across rounds 2–3: canaries measure *care by default*; against adversaries the
load-bearing instruments are artifact quality review + the live authorship
interview. (Also: minted follow-ups should target canary *fixes* too — "walk me
through why that cache is safe" — which the round-2 followups prompt already
supports via observedChecks.)

## Harvest (2-in-1) — four real improvements merged

The three honest personas converged on the flush path; the verifier found the
sharpest bug. All adapted onto the current tree, gates green (typecheck, lint,
2345 TS + 1151 Python tests):

- **Chat-context dedup** (canary c1, real bug): the chat route re-appended the
  new message to the transcript while chat.py separately fences it as
  CANDIDATE_MESSAGE — the model received it twice every exchange. One copy now.
- **Frozen mid-flight config memo** (canary c2, real bug): the flush route
  resolved token→posting→case every ~8s for data frozen at publish; now a
  bounded per-token memo (credit: gamer's one-shot had the idea — unbounded and
  uninvalidated; merged the idea, not the implementation).
- **Idle-visitor session-mint guard** (verifier's find): the 8s interval called
  ensureSession unconditionally, silently minting sessions for visitors who only
  read the brief — contradicting the lazy-mint contract. No session + nothing
  pending ⇒ no-op.
- **Dirty-flag file sends + status-only hot-path reads** (all three honest
  personas + verifier): the client resent the ENTIRE file tree every 8s
  regardless of edits, and the routes parsed the full files_json blob just to
  check a status column. Files now ride only when dirty (always on submit);
  `getDevSessionMeta` serves the status/token/createdAt hot path.

## Next round ideas

- Re-run a canary round on a fully base-consistent seed (commit first) to get a
  clean read on canary discrimination + the descent guard.
- Teach mint_followups to always anchor at least one question to each
  canary-"addressed" fix (authorship of the fix is now the thing to verify).
- Consider an eval_round flag to exclude canaries from the LLM judge's context
  when the round marks them invalid (defense in depth against ground-truth
  poisoning).

# /scan-sweep `--challenge` — kp, challenge-r07 (2026-09-23)

Method: full (strategy challenge, skill 3.5.1, cohort 8 hosts + 4 riders, waves of 6/5/4/1 + 4 follow-ups).
Scouted during r06's builds; built after r06 closed. Deck approval: in advance for the loop.
Models: scouts, builders, coordinator = claude-opus-5-5; critic = claude-fable-5-1.

## Scores

| | |
| --- | --- |
| idea_score (critic, 16 cards) | ambition 4.06 / grounding 4.56 / falsifiability 4.06; 0 premise-false, 0 void, 12 revise |
| execution_score | **12 / 16 flawless** (7 / 16 strict) |
| landed / partial / demoted / reverted | 16 / 0 / 0 / 0 |
| acceptance cases | 162 written, 153 red before, 162 green after |
| integration failures / coordinator fixes | 4 / 4 (three combined-growth perf settles, one logger clock fix) |
| follow-up builders | 4 (each closing a gap a card introduced) |
| lines changed | 11,562 (builders' count) |
| tokens | scouts 1.82M, critic 0.27M, builders 3.98M (incl. 0.48M follow-ups) |
| builds wall clock | ~95 min |

Delta vs r06: idea score down (4.44/4.88/4.56 -> 4.06/4.56/4.06) with 12 revisions against 4; flawless
15 -> 12, strict 11 -> 7. Seven of the nine non-strict cards carry declared guard cases.

Not flawless — each card landed green but left a gap the coordinator saw in its hand-off and closed
with a follow-up builder:
- **shell-setup-wizard/A** gated `PUT /api/brand` on `org:manage` (as the critic asked) but the nav
  still offered the branding editor to admins, who then got a 403 on save -> 36bb74cd3.
- **pipeline-api/A**'s reinstate rule (newest decision must be `auto_rejected`) left
  `listReconsiderQueue` offering the action the door now refuses -> 7db88e568 (one shared SQL rule).
- **results-core/B**'s acknowledgement gate read then wrote without a lock or a re-check (a repo
  law) -> 899eef6c3 (compare-and-swap on the disposition and payload it read).
- **devcase-orchestration/B** left a stale "sourcing failed" warning after a successful re-source (a
  status that lies) -> 2e4fd4227.

The pattern is new against r06: builders stayed inside their write set and each named the gap as a
"follow-up outside my scope". Naming it was right; the fix belonged in a follow-up builder, which is
why follow-ups are a scorecard column.

## What moved

- **Records of truth:** the voice director's ledger is the interview transcript of record (a late
  hang-up POST can no longer rewrite turns); every meter debit writes a journal row naming its cause
  (charge byte-identical to the r05 golden); a coded run outcome on each dev-case lifecycle.
- **Engine:** the Claude CLI runs under the shared `TextProvider` layer; a CLI timeout is one
  non-retryable `deadline_exceeded`, not a retry storm. Trust findings are coded at the engine
  (severity + scope), not regex-parsed from prose; a blocked score stores NULL, not 0.
- **Authority:** the pipeline entry door declares each action's seat, engine claim and reversal
  (viewers lose writes; a `sim` actor claim is honoured only on accept); the setup wizard asks each
  seat only what it may write; branding is owner-only end to end.
- **Recruiter UX:** Advance acknowledges open flags and the record keeps what it was decided against;
  Quality lists unrated hires and rates them in place; the compare grid shows per-axis coverage from
  the director; the Models board prices each pick and recommends the cheapest model within noise; the
  Roles desk is server-sorted and windowed; setup ends on a receipt with per-invite links and a
  retry of only what failed; dev-case rows offer each warning's fix.
- **Public surface:** a public JD advertises only the languages it serves (archived JDs override the
  layout's alternates).

## Owner notes

- **Analysis cache:** results-core/A bumped `PROMPT_VERSION` v6 -> v7 — every cached analysis misses
  once (a cache hit would otherwise serve an uncoded payload and hide a redaction miss).
- **Model routing recommendation (not applied):** on the shipped n4 bake the board recommends
  gemini-3.6-flash for match_reasoning (9.0 vs opus 9.1, inside the 0.15 noise band, ~1/68 of the
  cost); automation stays on opus (the only model over the 0.9 reliability floor). Pinning is a
  model-admin action.
- **Default engine retries:** an overloaded Claude CLI is now retried up to 3 times within the
  caller's deadline (was: one spawn), plus one JSON repair re-prompt.
- **Billing:** a journal write failure now rolls the debit back with it (no charge without a
  record). Subscription reconcile ships OFF (`KP_BILLING_SUBSCRIPTION_RECONCILE=1`); README step 7
  names the sandbox pass owed before production.
- **Re-source** clears its warning without touching `updated_at`, so it does not reset the 7-day
  stall clock — deliberate (sourcing does not advance the case); your call.
- **Perf:** the task-hub group module default went 229 -> 230 for `devcase-lifecycle-fence.ts`, an
  import-free leaf the runner and the close door share (named; inlining would fork the rule).
  `app/page.tsx` gained 6 modules this run.
- `python-runner-concurrency` swung between BROKEN and FLAKE across the run; still the owner's call.

## Side fixes

3d6e41446 `StageTimer` measured with `time.monotonic()` = GetTickCount64 on Windows (15.625 ms
steps): every pipeline stage duration was quantised, and the gated suite tripped twice on a 20 ms
sleep reading 14 ms. Now `perf_counter()`, with a test pinning the clock source.

## Not verified

No browser pass (decision acknowledgement editor, hire-rating queue, coverage cells, routing pick
board, setup receipt, dev-case outcome chips, Roles desk windowing); no `npm run build`; e2e
`shell.spec` + `public-pages.spec` owed after the hreflang change. All in the loop's owed list.

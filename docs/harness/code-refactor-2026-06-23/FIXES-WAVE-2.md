# Code Refactor — Fix Wave 2 — Dead-branch / dead-knob / dead-module removal

> 7 atomic commits, 7 High findings closed (1 deferred with reason).
> Baseline preserved: tsc 0 → 0 errors · `node --test` 1019 → 1019 passing · gemini Python tests 17/17 · 0 regressions.

These are the Highs where code was reachable-but-dead or a never-fired branch. Mostly pure removals (zero behaviour change); one (the Gemini retry) was *wired up* rather than deleted because the dead code was a missing safety net.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `5b5f3eb` | cv-extraction #1 | gemini.py (wire retry) |
| 2 | `e29737b` | tasks-system #1 | tasks.ts, task-dedupe.ts, task-dedupe.test.ts, devcase-run.ts |
| 3 | `607ffea` | hiring-automation #1 | scheduler-store.ts, automation/schedule/route.ts, SchedulerControl.tsx |
| 4 | `b9d7188` | shared-ui #1 | ThemeSplit.tsx (del), globals.css, SectionTitle.tsx, useTheme.ts |
| 5 | `47fa877` | shared-ui #2 | DisclosureRow.tsx (del) |
| 6 | `09aa2f2` | shared-utility #2 | distribution.ts |
| 7 | `78536e5` | sourcing #1 | salary-band.ts |

## What was fixed

1. **Gemini retry wired (not deleted).** `_generate_with_retry` (429/5xx/timeout backoff) was defined + documented but `grounded_answer` did a raw `generate_content`, so the retry never ran in prod. Routed the call through the wrapper — the byte-identical generate_content args make this safe; the helper + its two constants are now live.
2. **commit_reflection task kind removed.** A full dead vertical slice (handler + dedupe builder + `runCommitReflection` + test) with no creator.
3. **reject_mode "auto" plumbing removed.** AUTO1 was retired by coercion; the dead "auto" type/branch/UI-prop still read as a live GDPR-sensitive knob. Removed the type, field, `setRejectMode`, route accept-block, and UI union — kept the additive DB column as a no-op.
4. **ThemeSplit deleted** (component + its 4 `.theme-*-only` CSS rules + 2 stale prose mentions).
5. **DisclosureRow deleted** (zero importers).
6. **receiveSubmission deleted** — a footgun wrapper that bypassed `intakeSubmission`'s closed-posting guard + candidate ack.
7. **salaryBandError deleted** — superseded by `normalizeSalaryBand` on the live write path.

## Deferred (with reason)

- **privacy-consent-provenance #1 — three never-emitted `ConsentEventKind` values** (`expiring_notified`, `expired`, `erasure_requested`). This is GDPR audit-trail vocabulary; the report explicitly warns "do NOT silently delete the recording side" and frames it as a prune-vs-wire **product/compliance decision** (the schema already accepts the rows, and a reminder feature may be on the roadmap). Not a mechanical dead-code removal — left for a deliberate compliance review rather than pruned blind.

## Patterns established (catalogue items 5–7)

5. **Dead code can be a missing feature.** When a documented helper is never wired (the retry), prefer *wiring* over deleting if the intent is clearly beneficial and verifiable — deleting would silently confirm the gap.
6. **Remove the type/branch, keep the additive column.** A retired enum knob's TS plumbing is dead weight, but its DB column is cheap to leave as a no-op — avoids a destructive migration on existing data.
7. **Don't mechanically prune compliance vocabulary.** Audit-trail enums with a "don't delete the recording side" caveat are prune-vs-wire product decisions, not dead-code chores — defer to a deliberate review.

## What remains (Wave 3 of this run)

Safe dead-code deletion (A1 remainder): APPROVAL_KIND_META registry, LLMResult.raw, descendant graph, mk_candidate adoption, "duplicate" editor mode, isDeadLettered, SeedFiles + seed route, seed_jobs generic path.

# Challenge builder brief — /scan-sweep 3.5.0 `--challenge`, kp (reusable; <RUN> = the run directory named in your prompt)

You build ONE approved challenge card in the kp repository
(`C:\Users\kazda\kiro\kp`), on branch `main`, in the SHARED main checkout.
**Commit on this branch; never push, never open a PR, never `git stash`, never
reset or discard anything you did not write.** Other builders are working in this
same checkout RIGHT NOW on disjoint files.

Your card is `<RUN>/cards/<ctx>.json`, slot
named in your prompt, plus any `revise` line in `critic.json` for that card
(the coordinator's prompt repeats it — the revision wins over the card).

Read first: `.claude/CLAUDE.md` (repo law — the conventions that bite), the
`## Challenge mode` block and `## Gates` in `.claude/scan-sweep/config.md`,
and `C:/Users/kazda/kiro/ai-registry/skills/scan-sweep/references/challenge.md` §7.

## Order — do not reorder

1. **Re-verify the premise** on the current tree (`git log -3` first; note the
   base sha). If the central premise is false, stop: write the result file with
   `status: "demoted"` and why. No code.
2. **Write the acceptance cases as tests first** (node:test, `*.test.ts`, colocated
   with the `.ts` module they exercise). Run them and watch them FAIL. Record how
   many cases were red. kp cannot import `.tsx` in unit tests — test the `.ts`
   logic; extract a `.ts` module from a component if the card needs it.
   Run a single test file with:
   `node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --disable-warning=ExperimentalWarning --test-isolation=process --test "<file>"`
3. **Build** inside the card's `write_set` (+ its tests, + one coupled doc the
   `scripts/docs/feature-doc-map.json` names for the source you touch, + shared
   surfaces under the lock). You may shrink the write set. Growing it by more than
   that is a demotion: revert your uncommitted work, `status: "demoted"`.
4. **Green**: your tests pass, then each gate, each on its own, exit code
   asserted (`cmd && next`, never piped to tail, never `;`):
   `npx tsc --noEmit -p tsconfig.json`, `npx eslint <your dirs>`,
   `npm run i18n:check` (if you touched UI strings / messages),
   `npm run design:check` (if you touched classNames), `npm run api:check` (if you
   touched `app/api/**/route.ts` — fix with `npm run api:docs`),
   `npm run docs:check`, `npm run lint:ts-ratchet`, and the unit tests of every
   test file in your touched directories — THEN, before your last commit, the FULL
   `npm run test:unit` (~80s), `npm run test:perf` and `npm run review:constitution -- --base <your base sha> --head HEAD` (added after r08: a new route gated by requireCapability/requireOrgCapability trips its route-auth-posture rule — name the guard in `notes` so the coordinator can waive it on the record; never reshape auth to satisfy the lens). Added after waves 1-2: kp
   keeps source-guard and ratchet tests OUTSIDE the folder they guard
   (`app/_components/ui/recipes-literals.test.ts` counts hand-typed recipe strings
   repo-wide; `devcase-studio-robustness.test.ts` pins route source; `perf-budget.json`
   caps each route's and `app/page.tsx`'s import graph), and three wave-2 breaks
   were exactly those. `test:perf` is GREEN on the committed tree (settled 2026-09-23,
   3993c0adc) — every overage line is yours unless it comes only from a sibling's
   UNCOMMITTED files (measure base + your files alone, and say so in `notes`). Raise a
   ceiling only by your own measured share, under the lock, with a `why`; prefer moving
   an import off a hot graph (see repo-ref.ts, 448816081) to raising. Compose recipes from `app/_components/ui/recipes.ts` (PANEL, ICON_TILE,
   BTN_*, …) rather than re-typing their class strings. A source-guard test that pins
   the OLD expression of code you correctly changed: update it to pin the new AND
   still forbid the old defect, in the same commit. A whole-tree gate (tsc) red on a path you did NOT touch is a
   sibling builder's in-flight work: wait ~60s and re-run once; if still red on
   foreign paths only, record it in `notes` and proceed. Two failed attempts to
   turn YOUR red green -> revert your uncommitted work, `status: "demoted"`.
   **Close the loop your rule opens (added after r07, where 4 of 16 cards needed a
   follow-up builder for exactly this).** When your change adds a refusal, a gate or a
   stored status, find every surface that OFFERS the refused action or DISPLAYS the
   status (nav/visibility tables, queues and lists that feed the action, the writer
   that should clear the status) and make it agree in the same card — one shared rule,
   not two. A new read->write you add obeys the lock-or-re-check law even when the card
   did not mention it. If closing the loop would grow the write set past the allowance,
   say so in `notes` under `loop_open:` with the exact file and rule; a gap you only
   mention is scored as not flawless.
5. **Commit a short series**, each commit green:
   `test(<ctx>): <what the cases pin>` then `feat|refactor(<ctx>): <card title>`.
   Body: the lens, `Challenge: <run-id> <ctx>/<slot>` (run-id = the run directory name), the re-measured
   `Acceptance: N of N (was 0 of N)`, and a `Doc-sync:` trailer ONLY if no doc
   applies (otherwise update the doc). End every message with
   `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Shared checkout rules (these replace isolation)

- **Commit ONLY with `git commit -m ... -- <path> <path>`** (explicit paths after
  `--`; new files must be `git add <path>`-ed first). Never a bare `git commit`,
  never `git add -A/./-u`. Before committing, `git diff --cached --stat` — if a
  path you did not add is staged, leave it alone (it is a sibling's), your
  `-- <paths>` commit will not take it.
- **Line endings**: before staging, `perl -pi -e 's/\r\n/\n/g' <your files>`, then
  `git diff --stat --ignore-all-space` vs `git diff --stat` must agree.
- **Shared surfaces lock** (messages/*.json, docs/architecture/api-reference.md,
  ts-debt.json, test-quarantine.json, perf-budget.json,
  scripts/docs/feature-doc-map.json, app/api/*-contract.test.ts,
  app/_lib/tenancy.ts, app/features/shell/tabs.ts, `app/_lib/api-response.ts` (error-code
  registry: append a code at the END of its section, commit with its catalog keys), AND — for this run — every
  file under `docs/`, because several cards share a feature doc):
  take the lock with `mkdir .git/scan-sweep-challenge.lock` (retry every 5s until
  it succeeds; if it is older than 10 minutes, report and take it), make the edit,
  commit it ALONE immediately with `-- <those paths>`, then
  `rmdir .git/scan-sweep-challenge.lock`. Append at the END of a JSON object /
  list; never reformat or reorder a file. All four locale catalogs get the same
  keys in the same commit — write real cs/de/fr translations (formal register,
  no em dashes in catalog copy), not English copies.
- Release the lock ONLY if YOU took it: `mkdir <lock> && { edit; commit; rmdir <lock>; }`.
  Never `mkdir <lock> && ...; rmdir <lock>` — when the mkdir fails (someone else holds
  it) the `;` still runs the rmdir and deletes THEIR lock (it happened, 2026-09-23).
- Scratch files (helper scripts, catalog patchers) go in a subfolder named after YOUR card
  (`<scratchpad>/<ctx>--<slot>/`), never at the scratchpad root: builders share it, and
  one overwrote another's `catalogs.mjs` mid-build (2026-09-23).
- If `git commit` fails on `index.lock`, wait a few seconds and retry.
- Never junction or symlink the checkout's `node_modules` into a scratch worktree. Removing
  that worktree (`git worktree remove`) follows the junction and DELETES packages from the
  shared `node_modules` (it happened 2026-09-23: `.bin` and every `@`-scoped package before
  `@sentry`). To measure base + your files, use `git stash`-free `git archive` into scratch and
  run the budget script there with `--root`, or measure the committed tree after you commit.
- Never run `npm run build`, `npm run dev`, or anything that touches `.next` —
  the operator's dev servers are running.
- Use the Write/Edit tools for any file content containing backslashes (regex,
  paths) — shell heredocs eat them.

## Result — write BEFORE you reply

`<RUN>/builds/<ctx>--<slot>.json`:

```json
{"card":"<ctx>/<slot>","title":"...","status":"landed|demoted|partial",
 "base":"<sha>","shas":["..."],"tests_added":["path"],
 "cases_red_before":0,"cases_green_after":0,"cases_total":0,
 "gates":{"tsc":0,"eslint":0,"i18n":0,"design":0,"docs":0,"api":null,"unit":0},
 "files_changed":0,"lines_changed":0,
 "deviations_from_card":"...","notes":"..."}
```

(`gates` values are exit codes, `null` when not applicable.) Then reply in <= 10
lines: status, shas, cases, anything the coordinator must know for integration.

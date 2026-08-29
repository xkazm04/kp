# scan-sweep overlay — kp

Project-specific configuration for the shared `/scan-sweep` skill
(`.claude/skills/scan-sweep` is a link into `../ai-registry`; never edit the
method here, and never copy it in).

| Key | Value |
| --- | --- |
| `contextMap` | `context-map.json` (143 contexts, 17 groups) |
| `memoryOutbox` | `.personas/memory-outbox.jsonl` |
| `backlogDigest` | `.personas/backlog-digest.json` — **absent on this checkout**; the Personas triage deck is the live list. Read `.personas/contexts.txt` and the deck before proposing. |
| `depth` | skill default (12 / 20 with `--one`) |
| `neverSweep` | none declared |

## Gates, in the order they should run

Scope each to the files you touched where the command allows it; `tsc` and the
locale/design checks are whole-tree by nature (see §7.2 — a red whole-tree gate
under a concurrent session may not be yours).

```bash
npx tsc --noEmit -p tsconfig.json      # NOT `npm run typecheck` mid-round: that
                                       # runs Python schemas:gen first
npx eslint <the dirs you touched>
npm run i18n:check                     # any messages/*.json or UI-string change
npm run design:check                   # any className change
node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
  --disable-warning=ExperimentalWarning --test-isolation=process \
  --test "<your test files>"           # a bare `node --test` CANNOT resolve @/ aliases
npm run test:unit                      # once, at the end of the round (~22s, 4234 tests)
```

## Known gap: the context map under-covers the repo

**The picker walks an incomplete map.** As of 2026-08-29, `context-map.json`
covers 2 377 files while `git ls-files` finds **2 616** tracked `.ts/.tsx/.py/.mjs`
— **243 unmapped (9.3%)**, despite CLAUDE.md asserting there is no unmapped
remainder. Files added between rescans simply fall out (a test file this sweep
created two rounds ago was already unmapped).

Consequences for a round here:

- `--coverage` / `--next` cannot offer an unmapped area, so those files are never
  swept. The largest coherent hole is the **operator companion** (`companion-*`,
  `db/companion*` — an entire feature); `app/_lib/app-master/backbone.ts` is also
  unmapped.
- A context's declared `file_paths` may UNDERCOUNT its own files. `lib-llm-config`
  declares 18 and has 20 on disk (two test files missing). **Glob the context's
  directory as well as reading its `file_paths`**, or you will judge a module
  whose test you never saw — `llm-quality.ts` reads as untested from the map and
  has a good colocated test file.

Backlogged with numbers in the memory outbox (tech-debt-tracker, 2026-08-29).

## The Stop hook only sees the dedicated edit tools

`scripts/docs/check-doc-sync.mjs` walks the turn's transcript for `Edit` / `Write`
/ `MultiEdit` / `NotebookEdit` calls. **An edit made through the Bash tool — a
`python` heredoc, `sed -i`, `perl -pi` — is invisible to it.**

So a round that edits source with the Edit tool and updates the doc with a shell
script gets a doc-sync reminder for a doc it already wrote (observed
2026-08-29: `llm-provider-layer.md` was updated in all three commits of the
`lib-llm-config` round and the hook still fired). The reverse is worse and
quieter: source edited only through the shell never trips the hook at all, so a
genuinely missing doc update goes unnoticed.

**Write doc updates with the Write/Edit tools**, and keep the shell for the
mechanical passes (EOL normalisation, restores). If you do hit the reminder after
having updated the doc, verify with `git log --oneline -- <doc>` and say so with
the evidence — do not dismiss it as "no doc update needed", which is a different
claim and an untrue one.

## Skill improvement log

- **2026-08-29 — Normalize line endings to LF before staging. This is the one
  that can silently clobber another session.** The editing tools write CRLF into
  files whose committed form is LF, and git then reports the WHOLE FILE as
  rewritten: a 39-line change staged as 525 insertions + 525 deletions. In this
  shared checkout that is a clobber machine — a concurrent session's edit to the
  same file loses to a whole-file overwrite, and `git diff --cached --stat` is
  where you notice, because §7's "confirm the staged list is exactly your files"
  passes fine while the CONTENT is wrong. `git diff --cached --stat
  --ignore-all-space` tells you instantly (real change vs. reported change), and
  `perl -pi -e 's/\r\n/\n/g' <files>` before `git add` fixes it. Check every file
  a tool wrote, including docs and `messages/*.json`.

- **2026-08-29 — `npm run i18n:check` is a convention oracle, not just a
  linter.** Asked to render a server error in the UI, it did not merely fail: it
  named `useErrorMessage()` / `resolveErrorMessage` and the rule behind it ("shown
  from its machine `code`, never the server's English `error`"). Run it against a
  draft UI fix before considering the fix designed — it redirected a
  correct-but-English-leaking fix into a localized one, and surfaced that
  `AGENT_BRIDGE_KEY_INVALID` had never had a catalog entry at all. It also bans
  em dashes in catalog copy (`docs/i18n/contract.md` §5), which is not obvious
  from reading neighbouring strings.

- **2026-08-29 — Dates go through `useFormatter()`, never `toLocaleString()`.** A bare
  `toLocaleString()` / `toLocaleDateString()` follows the OS, so a `cs` workspace opened in
  an en-US browser renders `3/4/2026` inside a Czech sentence. The repo has fixed this six
  times with explicit comments (`DecisionsAiReviewCard`, `groupEvalHelpers`,
  `JdsRevisionList`, `JobsCampaignTab`, `ProfileRosterRow`, `useScheduleInviteLifecycle`)
  and it is a declared fix-as-you-touch migration — `grep -rn "toLocaleString()" app` in
  any context you read. Canonical shapes: `format.dateTime(new Date(iso), { dateStyle:
  "medium" })` for a date, `+ timeStyle: "short"` for a timestamp. next-intl falls back to
  `String(value)` on an invalid date rather than throwing, so no guard is needed unless the
  value can actually be malformed.

- **2026-08-29 — There is NO component test harness.** Zero `*.test.tsx` repo-wide, and
  `test:unit` runs node:test with type-stripping and no JSX transform, so a `.tsx` cannot
  even be imported. A behavioural rule that must be tested has to live in a `.ts` module
  the way `integrationsPersonasLogic.ts`, `agentsWorkforceLogic.ts` and
  `integrationsWebhookIdentifiers.ts` do. Plan the fix around that before proposing a test.

- **2026-08-29 — Failure outcomes use `role={ok ? "status" : "alert"}` plus a failure
  tone.** The convention is set by `IntegrationsAtsForm` and `IntegrationsCallbackBanner`;
  a result line that is always `role="status"` is a finding.

- **2026-08-29 — `stone-500..700` are deliberately stock in BOTH themes.**
  `app/globals.css` remaps `stone-50..400` (surfaces) and `800/900` (inverted
  controls); 500–700 are the muted text greys and are documented as intentionally
  non-monotone across the ramp. `text-stone-500` in a component is correct, not a
  missing dark token — do not file it.

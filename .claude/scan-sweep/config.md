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

- **2026-08-29 — `stone-500..700` are deliberately stock in BOTH themes.**
  `app/globals.css` remaps `stone-50..400` (surfaces) and `800/900` (inverted
  controls); 500–700 are the muted text greys and are documented as intentionally
  non-monotone across the ramp. `text-stone-500` in a component is correct, not a
  missing dark token — do not file it.

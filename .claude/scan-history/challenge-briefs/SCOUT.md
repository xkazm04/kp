# Challenge scout brief — /scan-sweep 3.5.0 `--challenge`, kp (reusable; <RUN> = the run directory named in your prompt)

You are a READ-ONLY scout. You change no source file and make no commit. Your
only write is your card file (step 6).

Method: `C:/Users/kazda/kiro/ai-registry/skills/scan-sweep/references/challenge.md`
§1, §3, §4 — read those three sections first. Repo law: `.claude/CLAUDE.md` and
the `## Challenge mode` block of `.claude/scan-sweep/config.md`.

## Your job

Produce **exactly two challenge cards** for ONE context (named in your prompt):

- **Slot A — `architecture-challenger`**: the ONE structural move that would stop
  this context being the reason something else is hard. A specific seam with its
  cost counted, not "reduce coupling".
- **Slot B — `ux-elevation`**: the experience LEAP (not polish) on this context's
  user surface — a flow that should collapse, a blind decision the app has the
  data for, a status that should be actionable, a missing mode (compare, bulk,
  undo, preview, resume). If the context has no user surface (operator UI counts
  as one), slot B is a second architecture card on a DIFFERENT seam, labelled
  `"slot": "B-architecture (no UI surface)"`.

Floors (a card below one is not allowed): size **M or L** (never S), effort
**>= 5**, impact **>= 7**, risk **4-8**, write set **<= ~15 files and <= ~800
changed lines** — one builder, one wave. Gate must not be `irreversible` or
`policy-loosen` (those are never built in this mode — pick another idea).

## Riders

Your prompt may name **riders**: small contexts (< 10 files) from your context's
group that ride with you (challenge.md §2.1). Read every rider's files IN FULL
alongside your host. Riders add no cards - you still return exactly two - but
either card MAY target a rider (put the rider's name in the card's `context`
field then). For EACH rider write one record of what you checked to
`<RUN>/riders/<host>.json`: a JSON array of
`{"rider":"<name>","files_read":<n>,"checked":"<the files read, the hypothesis traced, why no card went there - or which card did>"}`.
A bare "clean" is not a record. No riders -> skip the file.

## Steps

1. Read the context's entry in `context-map.json` (`contexts[]`, match on
   `name`): description, `file_paths`, `entry_points`, `db_tables`, `api_surface`.
   Also glob the directories those paths live in — the map undercounts.
2. Read the files. All of them for a context this size; the large ones in full.
   Follow imports one hop out where the seam leaves the context.
3. Registry: find the context in `.ai/registry-map.json` and read the top
   governing subject(s) — resolve `file` through
   `C:/Users/kazda/kiro/ai-registry/knowledge/<domain>/index.json`
   (`subjects["<slug>"].file`), never by building a path. Read its golden path
   and the techniques whose `use_when` fits your ideas. Name the technique on the
   card when one applies.
4. Never re-propose. Collect titles already on the books for this context:
   `grep '"context":"<ctx>"' .claude/scan-history/leftover-develop-2026-09-17.jsonl`
   (open unless the same title appears in
   `.claude/scan-history/low-risk-drain-2026-09-22*-results.jsonl`), and
   `.personas/backlog-digest.json`, and every card title in
   `.claude/scan-history/challenge-*/cards/*.json` (prior challenge decks). A card restating one of those is void. You
   MAY adopt an open high-effort item (an escalated M/L the drain left) — say so
   and cite its title; that is a good card.
5. Consider many ideas; return your best two and one runner-up line per slot.
   Every premise must be a `file:line` fact you actually read (repo-relative path,
   as `git ls-files` prints it). The critic re-checks every one; a false premise
   voids the card.
6. Write your result to
   `<RUN>/cards/<ctx>.json` — a JSON array of
   two card objects in the shape of challenge.md §4:

   ```
   context, slot, lens, title (<=80 chars), size, effort, impact, risk,
   write_set[], new_files[], shared_surfaces[], acceptance[3-8 cases],
   premise[], rollback, gate, runner_up, technique (slug or null),
   body (markdown with EXACTLY: ## Summary / ## Description / ## Flow /
         ## Expected impact / ## Evaluation — Evaluation has Claim/Before/After/
         Method/Result/Gate lines; Before = "0 of N acceptance cases pass",
         After = "N of N", Method = gate),
   evidence (the proof: exact lines / grep output / counts)
   ```

   `acceptance` cases are concrete: input/state -> expected result, writable as a
   node:test case BEFORE the implementation. kp has NO component test harness
   (no `.test.tsx`; node:test cannot import `.tsx`) — a UX card's cases target the
   `.ts` logic module under the surface (existing or one the card creates), plus
   at most one Playwright journey if genuinely needed. `shared_surfaces` lists any
   of the overlay's shared files you expect to touch (locale catalogs almost
   always, for UI).

   Write the file BEFORE you reply. Validate it parses (`node -e
   "JSON.parse(require('fs').readFileSync('<path>','utf8'))"`) — author it with the
   Write tool, not a shell heredoc (backslashes get eaten).

7. Reply in <= 12 lines: the two titles with size/effort/impact/risk, the runner-
   ups, and the number of files you read.

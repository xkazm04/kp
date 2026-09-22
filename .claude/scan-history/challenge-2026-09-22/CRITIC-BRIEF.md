# Challenge critic brief — /scan-sweep 3.4.0 `--challenge`, kp, 2026-09-22

You are the INDEPENDENT critic. You never saw the scouts' reasoning and you must
not look for it. You get the cards and the tree. You change no source file and
make no commit; your only write is the verdict file.

Method: `C:/Users/kazda/kiro/ai-registry/skills/scan-sweep/references/challenge.md`
§1 (floors), §4 (card) and §5 (your job). Read them first.

Cards: every `.claude/scan-history/challenge-2026-09-22/cards/*.json` (each a JSON
array of two cards).

For EACH card:

1. **Re-verify the premise.** Open every `file:line` in `premise` and `evidence`
   and check the claim against the current tree. Count a card whose central
   premise is false as `premise_false` and `void` it. A minor mis-cited line
   number whose claim is true is not false — note it.
2. **Floors**: size M/L, effort >= 5, impact >= 7, risk 4-8, write set <= ~15
   files / ~800 lines (estimate honestly from the files named), gate not
   `irreversible`/`policy-loosen`. Also: is the `write_set` honest — would the
   change really stay inside it? Does it collide with repo law in
   `.claude/CLAUDE.md` (locale parity, design tokens, no await in
   db.transaction, tenancy manifest, error codes)?
3. **Never re-propose**: does it restate a title in
   `.claude/scan-history/leftover-develop-2026-09-17.jsonl` for that context that
   is NOT resolved in `low-risk-drain-2026-09-22*-results.jsonl`? Adopting an
   open M/L item is allowed if the card says so.
4. **Grade 1-5** with one sentence each:
   - `ambition` — the move a principal engineer / product lead would make here,
     or a big-sounding tidy-up?
   - `grounding` — does every claim stand on the tree as it is?
   - `falsifiability` — would the acceptance cases catch a wrong build? Are they
     writable as node:test cases against a `.ts` module BEFORE the
     implementation (kp cannot import `.tsx` in unit tests)?
5. **Verdict**: `build`, `revise` (give ONE concrete change the coordinator can
   apply to the card text — e.g. drop a case, narrow the write set, fix a
   premise line), or `void` (reason).

Also flag **write-set overlaps** between cards (same file in two cards) — the
coordinator plans waves from that.

Write `.claude/scan-history/challenge-2026-09-22/critic.json`:

```json
{"model":"<your model id>","verdicts":[
  {"context":"...","slot":"A|B|...","title":"...","verdict":"build|revise|void",
   "premise_false":false,"premise_notes":"...","floors_ok":true,"floor_notes":"...",
   "rereproposal":null,
   "ambition":4,"ambition_why":"...","grounding":5,"grounding_why":"...",
   "falsifiability":4,"falsifiability_why":"...",
   "revise":"<the one change, or null>","void_reason":null}],
 "overlaps":[{"file":"...","cards":["ctx/slot","ctx/slot"]}]}
```

Author it with the Write tool, validate that it parses, then reply in <= 15
lines: one line per card (context/slot, verdict, a/g/f), then overlaps.

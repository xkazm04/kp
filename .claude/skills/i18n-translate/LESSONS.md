# Lessons — i18n-translate

## 1.0 — 2026-08-12 — kp

First run of this skill at full scale: 6,399 keys × 4 locales, a source-copy
rewrite (a no-em-dash house rule), a full MQM review, and 65 agents across five
workflows. Everything below is generalizable; the repo-specific half went into
kp's `docs/i18n/contract.md`.

- **A parallel fan-out ALWAYS needs a terminology consolidation pass.** Twelve
  individually careful reviewers on disjoint namespaces still left `JD` as both
  *inzerát* and *popis pozice* in Czech and split *floor* between *hranice* and
  the glossary's *práh*. The method said "batch by namespace" and stopped there.
  v1.1 makes the consolidation pass part of the method.
- **Detect drift mechanically, rule on it with judgment.** Glossary term present
  in the source value + canonical rendering absent in the locale = a *candidate*.
  Stem-match diacritics-folded or inflection buries you. ~1,400 candidates gave
  ~75 real fixes; the agents' best output was reasoned "no sweep" verdicts. A
  script must never rewrite from this signal.
- **The glossary can be the thing that is wrong.** Two German rows named words
  with ZERO occurrences in the catalog (*Spitzenkandidat/in*, *Eingang*) while
  the catalog consistently used *Favorit* and *Erfassung*. The skill treated the
  glossary as authoritative; it is a hypothesis until counted.
- **Coverage is self-reported and it will be short.** First-pass agents covered
  4,868 of 5,478 keys (88.9%) while reporting success. Asking for a `reviewed`
  count, comparing it to the batch size, and re-running the short batches took
  it to 97.3%. Regenerate the re-run's inputs from the CURRENT catalog or the
  second pass reverts the first pass.
- **The merge script is a gate, not a pipe.** Refusing to write unless every
  value ICU-compiles and keeps the source's exact placeholder set caught real
  breakage before it shipped, and made a 3,700-value rewrite safe. Sparse
  patches (changed keys/locales only) beat full-catalog returns for review
  passes.
- **Check the catalog round-trips through your writer before scripting.** All
  four message catalogs round-tripped byte-exactly through
  `JSON.stringify(o,null,2)+"\n"`; a sibling scoring JSON did NOT and had to be
  edited surgically.
- **Read exit codes, not tails.** `npm run test:unit | tail -4` returns `tail`'s
  status. I reported a green suite twice while it was failing, and the repo's
  pre-push hook caught what I had missed. Same trap with `npx tsc | head`.
- **Source-language strings can live outside the catalog.** `messages/en.json`
  `rubric.*` was a duplicate of a Python-shared scoring JSON, pinned identical
  by a test. Rewriting source copy broke it.
- **The best findings came from reading call sites, not strings.** The highest
  severity defect of the run was `{candidateName} {predicate}` concatenation
  where the German and French values supplied their own subjects, rendering
  "Anna Nováková der Interviewer wurde gebrieft". No string-level audit finds
  that; the method's "locate the use" step is the load-bearing one and deserves
  its emphasis.
- **Source defects need a durable home.** 291 of them surfaced. A chat message
  scrolls away; `source-defects.md` is now a first-class artifact.

### Redesign proposal (NOT applied in 1.1)

The three-pass loop (draft → estimate → refine) is per-batch and locale-blind:
each agent sees its own slice only. Everything expensive in this run came from
*cross-batch* invariants (one term app-wide, one register per surface, sibling
keys agreeing). A 2.0 might restructure around **concept-first batching** —
group keys by the domain concept they mention rather than by namespace, so one
agent owns every string that says "intake" everywhere — with namespace passes
only for register and length. That would make the consolidation pass largely
unnecessary instead of bolting it on. Not attempted here because it needs a
concept index the artifacts do not yet carry.

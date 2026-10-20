# Marketing truth recheck, pass 3 — 2026-10-09

Base: `876b7300e`. Branch `autopilot/accepted-idea-delivery-f01b15d6`. Follows pass 2 (`.ai/tasks/2026-10-09-marketing-truth-pass-2.md`).

## Reconcile
(a) archetypes.json contradictions: student 0.65, bau 0.65, career_switcher 0.7; registry.py:311 applies `contradiction["confidence"]`. Held.
(b) `about.archetypes.declaration` said 0.65 (en) / 0,65 (cs, de, fr). Held.
(c) FAMILY_ORDER comment said "The 16 role families". Held; `data/market_pulse.json` `reference_salaries` has 15 rows (measured).

## Failing on base
New test "about.archetypes.declaration names every contradiction confidence the registry applies, in every locale", run on base copy:
`error: 'messages/en.json: about.archetypes.declaration does not state the contradiction confidence 0.7'` (chapters.test.ts: 14 pass, 1 fail). Passes after the copy fix (15/15).

## Commits
- `40c02647e` fix(about): the archetype declaration names both contradiction confidences, 0.65 and 0.7 for a switcher
- `b90aff7c5` docs(market): FAMILY_ORDER holds the 15 families with reference salaries, not all 16
(ids pre-merge; a rebase may change them)

## Per-catalog diff
en, cs, de, fr: 1 line changed each (`about.archetypes.declaration`), 1 insertion / 1 deletion. Wording: "0.65 (0.7 for a career switcher)"; cs "(0,7 u archetypu Měnící obor)"; de "(0,7 bei Quereinstieg)"; fr "(0,7 pour la Reconversion)" — each uses that catalog's `about.archetypes.targets.switcher`.

## Other 0.65 strings
`grep 0[.,]65` in messages/en.json: the only hit is `about.archetypes.declaration`. Nothing else to fix.

## Gates (worktree)
- i18n:check OK (13891 strings, 4 locales in parity)
- typecheck exit 0; lint 0 errors, 49 warnings (same as pass 2)
- test:unit 13020/13020; scripts/kpi 85/85; test:docs exit 0
- typecheck rewrote app/_lib/*.generated.ts; restored with git checkout --.

## Notes
CHANGELOG.md was not updated because it is dirty in the shared checkout.

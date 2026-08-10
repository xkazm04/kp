# Recertify — 2026-08-10-intake-triptych · role-intake-dialog

**Mode:** `/uat recertify` (skill v1.2, first exercise of the resolution carry-forward rule)
**Under recertification:** the three fixes shipped by another agent —
`b54c451b` (market-research opt-out in the promote sheet · L1-HRBP-11),
`dd67bc46` (title provenance chip + inline title edit · L1-TOM-2),
`41cd5cc3` (countFor tells the truth on every spine · L1-EVA-10 · L1-HRBP-15 · L1-TOM-5 · L2-CONV-1).
**Scope:** one journey (`role-intake-dialog`), three Characters, L2 only. Not a re-sweep.
**Driver:** `uat/driver/drive-recert-triptych.mjs` (new) — sessions built over the API, every
verdict read off the rendered UI. **Live sessions driven:** 7 (5 dialogs paid for at the model,
~10 exchanges, 18.8–62.0 s each, mean ≈ 37 s). **Artifacts:** `shots/rc-*` (gitignored).

Nothing here is judged from code alone: each finding was answered against its own
`l2_priority` question, in the owning Character's language, with a **control arm** on every
causal claim.

---

## 1. Diff — resolved / still-open / regressed

| finding | character | was | now | one-line reason |
|---|---|---|---|---|
| **L1-HRBP-11** market opt-out API-only | Priya | major · open | **resolved-verified** | Checkbox live in both locales; unchecked → JD with **no** salary line, checked → CZK band. Two arms, both through the UI. |
| **L1-TOM-2** title provenance rendered nowhere | Tomáš | major · open | **resolved-verified** | `Role … úsudek AI` renders on the title; inline edit flips it to `řekli jste` (engine confirms `inferred → stated`). |
| **L1-EVA-10** draft spine counts attachments | Eva | minor · open | **resolved-verified** | Draft spine badges `✓ Návrh připraven`; `draftReady` finally has a consumer. |
| **L1-HRBP-15** same, from Priya's chair | Priya | minor · open | **resolved-verified** | Same live capture; no spine reports its neighbour's contents. |
| **L2-CONV-1** brief spine reads `Živé zadání 0` | Eva | minor · open | **resolved-verified** | Brief spine badges `10 položek v zadání` over 8 facets + 2 criteria. |
| **L1-TOM-5** `Podklady` is buried | Tomáš | minor · open | **still open** | Only its *compounding* clause was fixed. Fold the draft leaf and `Podklady` is gone from the page entirely — count 0 in all three cs arms. |
| — | — | — | **no regressions** | Nothing that passed on 2026-08-10 broke. The one suspected regression was refuted (§4). |

**New this pass:** `L2-RC-1` (minor, open) — the repaired draft spine badges "Návrh připraven"
on a session whose `Vytvořit inzerát` button is **disabled**; the marker measures draft
*content*, the gate measures *promote-readiness*. Introduced by `41cd5cc3` as a residual seam,
not a regression (the old badge was wrong in a different way).

**Re-scored, not re-certified:** `L2-NEW-2` (dealbreakers never reach `requirements[]`) was
re-confirmed *while* recertifying the others and **widened from minor to major**, `recurrence: 2`.
It is no longer a capture gap — in both English sessions it left `requirements: []` **and**
`successCriteria: []`, which kept `Create JD` **disabled**, so Priya's promote could not happen at
all. This run had to `PATCH /api/intake/<id>/brief` to reach promote-readiness before
L1-HRBP-11 could be recertified. Prior scores preserved as `severity_prior` / `impact_prior`.

---

## 2. Evidence per finding (each answering its own `l2_priority`)

### L1-HRBP-11 → resolved-verified
*Question: does the promote sheet now show the opt-out, and does unchecking it produce a JD
without the salary band?*

- **The control exists and is reachable.** `checkbox "Research the salary band" [checked]`
  (`shots/rc-market-off-promote-row.aria.txt:36`), and in Czech
  `checkbox "Zjistit i mzdové pásmo" [checked]` (`shots/rc-replay-ctrl-landed.aria.txt:36`).
- **The copy stops lying.** Unchecking flips the working note to *"The final JD is generated at
  Create JD — without salary research, as you chose."* (same file, `:42`).
- **Arm A (unchecked):** session `intake-msn8w5pj-wt3p9t` promoted from the browser → JD
  `33ydgirz`, 4,434 chars, **zero** salary / CZK / GBP lines (`shots/rc-market-off-jd.md`).
- **Arm B (control, checked):** session `intake-msn943g0-xdeuya` → JD `rheb7897` carries
  `**Salary:** 45,000–70,000 CZK / month` + *"Estimated from the internal role-family salary
  table (no live web evidence)"* (`shots/rc-market-on-jd.md`).

Same brief shape, same locale, one checkbox apart. The handle Priya could read in the route and
not press is now the one she presses.

> **Ceiling.** The only remedy is switching the comp read **off** — there is still no GBP /
> Agenda-for-Change band, so with it on a Leeds Band 5 nurse is still priced in CZK from an
> internal Czech table. Her criterion is met only in its *"or an honest I-cannot-price-this"*
> half. The opt-out is **per-promote and defaults ON** — no workspace / role-family / non-Czech
> default — so she must remember to untick on every promote, and nothing at the moment of
> decision tells her the band would be Czech-anchored. The tab's own intro still promises
> "researching market salary on the web" unconditionally (`messages/en.json:2968`).

### L1-TOM-2 → resolved-verified
*Question: does the title carry the chip in BOTH arms, and does an inline edit flip provenance
to stated?*

The prior run's control transcript was read back off the live DB (`intake-msn3bnnp-negmkh`) and
**replayed verbatim** into two new sessions, so the only variable between arms is the attachment.

- **Attached arm** (`intake-msn8mxc4-77jn8l`, JD `t9u3iv9w` attached): engine returns
  `title = "Senior Java vývojář — platební tým"`, `spineProvenance.title = "inferred"`, and the
  brief renders `text: Role Senior Java vývojář — platební tým úsudek AI` +
  `button "Upravit název"` (`shots/rc-replay-attached-landed.aria.txt:65-66`).
- **Inline correction:** typing a new title re-renders
  `text: Role Backend inženýr do platebního týmu řekli jste`
  (`shots/rc-replay-attached-edited.aria.txt:65`); the API confirms `title: inferred → stated`.
- **Control arm** (identical words, no attachment, `intake-msn8qwfo-r5qdkf`): the engine produced
  **no title at all** (`title: ""`, provenance `default`). A sharper causal demonstration than
  the prior run's — without the attachment the title does not exist.

> **Ceiling.** (a) The chip renders only when a title exists; the control arm shows a bare `—`
> with no chip and a disabled `Vytvořit inzerát`, so "I have no title for you yet" is
> communicated by an em dash. (b) The chip attributes the **words, not their route**: a third arm
> whose opener named the role (`intake-msn8f4kx-axmvz0`) produced a title byte-identical to the
> attached JD's, chipped `řekli jste` — defensible, but "you said" now also covers "the
> attachment and you happened to agree". (c) The anti-laundering guarantee could **not** be
> exercised live — every facet in both arms was already `stated` before the edit — so it still
> rests on `brief-edit.test.ts`, not on this evidence.

### L1-EVA-10 · L1-HRBP-15 · L2-CONV-1 → resolved-verified (one fix, three findings)
*Question: does each spine badge what its own leaf holds?*

Folded on `intake-msn8mxc4-77jn8l` (7 transcript entries · 8 facets · 2 ninety-day criteria · a
full drafted JD):

```
button "Zobrazit: Popis pozice":  Popis pozice  Návrh připraven      (glyph ✓, aria-hidden)
button "Zobrazit: Živé zadání":   Živé zadání   10 položek v zadání  (8 facets + 2 criteria)
button "Zobrazit: Rozhovor":      Rozhovor      7 replik
```

(`shots/rc-replay-attached-folded-draft-brief.aria.txt:39,46`). Reproduced on two further
sessions (`rc-replay-ctrl`: ✓ / 8 položek / 7 replik; `rc-tom`: ✓ / 5 položek / 5 replik).
**No spine badges 0 over a populated session, and no spine reports its neighbour's contents.**
The glyph is `aria-hidden` with a translated `sr-only` twin, so a screen reader hears
"Návrh připraven", not "✓".

> **Ceiling.** (a) "Návrh připraven" means the draft pane *has content*, not that it can become a
> JD — proven live on the untitled control session, where the spine badged ✓ while
> `button "Vytvořit inzerát" [disabled]` sat above it (`shots/rc-replay-ctrl-landed.aria.txt:38`).
> Recorded as **L2-RC-1**. (b) `briefItems` is one number over three different kinds
> (requirements + facets + criteria), so ten context facets and zero dealbreakers badge the same
> as eight dealbreakers — and with `requirements[]` empty in every live session (L2-NEW-2) today's
> number is almost entirely facets. (c) `✓` / `·` is visual-only; `·` for an empty draft carries
> no meaning without hovering the title attribute.

### L1-TOM-5 → still open
*Question: is Podklady's visibility regression-free — and did the fix make it findable?*

Regression-free, yes; fixed, no. The badge no longer counts attachments, but the finding's own
claim is untouched and the folded case is now *worse framed*: with the draft leaf folded,
`Podklady` is **absent from the page entirely** (`podklady-when-draft-folded: 0` in all three cs
journals), and the spine now says "Návrh připraven" — which speaks about the draft and never
about the materials underneath it. Expanded, it is still an unlabelled disclosure at the foot of
the draft leaf, unmentioned in the opener and in every empty state.

**Still missing:** a discoverability cue near the conversation (opener line, empty-state hint, or
a materials affordance that survives folding the draft leaf). The badge repair did not touch
placement.

---

## 3. Metric deltas (run → recertify)

| | 2026-08-10 run | this recertify | delta |
|---|---|---|---|
| Eva — time saved | ~75–100 min/role · medium-high | ~75–100 min/role · medium-high | **unchanged** — spine honesty is seconds, not minutes |
| Priya — time saved | ~60–90 min/role · medium | ~60–90 min/role · medium | **unchanged in magnitude**; the fix removes a per-promote manual repair (stripping a CZK band out of a UK JD ≈ 5–10 min + the trust cost), offset by L2-NEW-2 now blocking promote until the brief is edited |
| Tomáš — time saved | ~2–2.5 h + two calendar weeks → same-day, ~15 min of attention · **medium** | same magnitude · **medium-high** | **confidence up** — his declared instant-trust-kill is closed and the correction is an inline 3-second edit, not a re-explain to HR |
| Grounding (Eva / Priya / Tomáš) | 8/10 · 15/16 · 5/8 | 8/10 · 15/16 · 5/8 | **unchanged — none of the three fixes adds a grounding source.** Not inflated to show movement. |
| Live latency | 30–130 s budgeted | 10 exchanges, 18.8–62.0 s, mean ≈ 37 s | within budget; a 3-turn Czech session ≈ 2.4 min of model time |

**One new live grounding fact** (not a score change): attachments demonstrably reach the
extraction — with the attachment the title is the attachment's, without it (identical words)
there is **no title at all**.

---

## 4. Refuted — and the environment lesson behind it

The first English arm rendered three **raw i18n keys** —
`checkbox "library.tab.intake.promoteMarket"`, `paragraph:
library.tab.intake.draft.workingNoteNoMarket`, `button "library.tab.intake.edit.editTitle"` —
every one of them a string added by the commits under test, and every one of them fine in the
identical Czech arm. Against Priya's language criterion that reads as a shipped regression.

It was not. The dev server had been running since **13:43**, before the **14:28–14:38** commits;
next-intl's per-locale `await import('../messages/<locale>.json')` (`i18n/request.ts`) is cached
at first use, so **English served a pre-fix message bundle while the React components
hot-reloaded normally**. Czech was first compiled *after* the commits, so it was correct.
Restart + identical probe (`intake-msn9cn1o-0swp3k`) → `checkbox "Research the salary band"`.
Recorded as `L2-RC-REF-1` (`verdict: refuted`) and as a standing precondition in `uat/env.md`.

The trap fails **asymmetrically**: the locale compiled after the fix looks perfect, so a
single-locale run would never notice. A two-locale product plus a control arm is what caught it.

---

## 5. Reproduce

```bash
node uat/driver/drive-recert-triptych.mjs replay-attached   # cs, JD attached — chip + inline edit + spines
node uat/driver/drive-recert-triptych.mjs replay-ctrl       # cs, control arm (no attachment)
node uat/driver/drive-recert-triptych.mjs market-off        # en, promote with the salary band UNCHECKED
node uat/driver/drive-recert-triptych.mjs market-on         # en, control arm — CHECKED
LOCALE=en SESSION_ID=<id> node uat/driver/drive-recert-triptych.mjs fold
```

Preconditions: dev server **started after the commits under test** (§4), Gemini key present
(`/api/health` → `engines.gemini: true`).

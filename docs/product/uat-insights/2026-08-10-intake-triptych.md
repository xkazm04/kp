# UAT drain — run 2026-08-10-intake-triptych (role-intake dialog, post-Triptych re-certification)

Second `/uat drain`. Sources: the three per-Character reports **including their
L2 addenda and first-person sections** (Eva Marešová — eng hiring lead · Priya
Nair — healthcare-clinic HRBP · Tomáš Krejčí — first-time team-lead requestor),
`findings.json` (32 entries, L1 + L2 verdicts), `SUMMARY.md`, `report.md`, and
the prior drain `2026-08-07-intake.md` (whose build items shipped and were
recertified, and whose declines stand unless new evidence appears).

Rule of this document, unchanged: **no invented user needs.** Every opportunity
cites a Character voice verbatim (Czech stays Czech) or a finding id. Every
decline records its reason here *and* in `docs/BACKLOG.md` so it cannot
resurface as a fresh idea next quarter.

Run shape: L1 (three parallel code-grounded walkers) → L2 (live browser + live
API, keyed Gemini host, reused dev server on :3000). All three Characters
reached **L2**: Eva `L2-pass`, Tomáš and Priya `L2-conditional`. Nothing
structural blocked any walk.

---

## 1. Confirmed and fixed (reference only — ceilings are inputs to §2)

Every major from `2026-08-07-intake` is closed **in code with the UAT finding id
cited at the fix site**, and the four drain build items shipped and were
recertified live on 2026-08-07. This run re-verified them at L1 across three
independent readings (`L1-EVA-S5` · `L1-HRBP-18` · `L1-TOM-1`, convergent ×3)
and, for the paths a keyed host can exercise, again at L2.

| Prior finding | Fix + cited site | Ceiling that remains |
|---|---|---|
| **L1-CONV-2 / L1-EVA-1 / L1-HRBP-4 / L1-TOM-4** — the close refused its own invited correction | Two-turn deterministic close: read-back returns `done:False`, the next message confirms or lands as a stated, turn-cited `Correction` facet (`intake.py:515-547`, docstring names L1-CONV-2); Re-open route + button (`JdsIntakePanel.tsx:120-131`) | The LLM one-shot `readback+<<END>>` is still *accepted* by `coerce` (`intake.py:757`) — instructed against, not enforced. And on the keyless floor the correction is **recorded, not applied**: it never reaches `brief.seniority` or `must_have` (`L1-EVA-11`) |
| **L1-CONV-3 / L1-EVA-4 / L1-HRBP-3 / L1-TOM-5** — `medior` default masquerading as a decision | `spineProvenance` end-to-end: extraction contract (`intake.py:108-111`), stated-only read-back (`:459-460`), chip with missing-key = default (`JdsIntakeBriefPanel.tsx:134-141`), draft refuses a default seniority (`intake-draft.ts:33-34`) | **Only seniority consumes it.** `spineProvenance.title` is written and rendered nowhere — which is exactly `L1-TOM-2`, and L2 widened it: *both* live sessions carry `title:"inferred"` |
| **L1-HRBP-2** — clinical roles filed as software engineering | 16-family vocabulary in `_EXTRACTION_RULES` (`intake.py:111-113`) + deterministic classification at read-back (`:569-582`) | Keyless classifier still misses "Practice Nurse" / "Registered General Nurse" (executed → `general_professional`), and the family is invisible + uneditable in the UI (`L1-HRBP-12`). A fresh intake initialises `software_engineering` before a word is spoken (new at L2) |
| **L1-HRBP-6** — Czech-market comp read welded to every promote | `promote/route.ts:43-50` honours `marketResearch !== false`, comment citing the finding | **API-only.** The UI never sends it; L2 proved both arms (`L1-HRBP-11`). The single-Czech-market anchor itself stays the documented workspace ceiling |
| **L1-EVA-2** — Czech backfill never triggered the short path | `_POWER_UNIT_MARKERS` stems Czech inflections (`intake.py:241-245`), executed against the interpreter | English clinical-backfill idiom ("maternity cover", "handed in her notice") still routes the 10-question story path — carried, minor |
| **L1-EVA-3** — brief died at the dev-case seam | Case-design checkbox → promote → `statedRequirements` → Dev tab reads `intakeBrief` structurally; `resolved-verified` 2026-08-07 | Legacy promotes made before the spine-provenance schema never seed the selector (correct abstention); matching still doesn't consume weights (calibration-pinned, by design) |
| **Drain §2.1** — editable brief + re-openable session | Edit mode + `PATCH /api/intake/[id]/brief` + reopen system turn; `resolved-verified` | Edits mark `stated` wholesale, no per-field dirty tracking. And L2 found the *sheet has less to edit than the system knows* — `requirements[]` is empty in every live session (`L2-NEW-2`) |
| **Drain §2.2** — defensibility layer (`source_turn`, weight/rationale rows, export) | `resolved-verified` with a captured download | Post-reopen reply quality unmeasured; the export is only as rich as the structured brief, which `L2-NEW-2` shows is thinner than `needText` |
| **Drain §2.3** — non-tech grade capture (`grade_label`) | "Band 5, roughly" stored verbatim as a stated facet; `resolved-verified` | LLM-path only; the deterministic floor stores non-enum grades as a plain facet without the dedicated label |
| **Drain §2.4** — latency honesty | Staged "Stále přemýšlím…" second line at ~10 s; `resolved-verified` | Static staged copy, not elapsed time (streaming declined §2.7). L2 measured **22.4 / 52.3 / 33.3 s** per exchange + 8.0 s promote — the copy remains truthful and the decline remains right |
| **R-1 composer squeeze · R-2 `<<END>>` leak** (recertify regressions) | Voice slot moved out of the textarea flex row (`JdsIntakeChat.tsx:170-194`); sentinel stripped at the route (`message/route.ts:52-54`) | Voice plane end-to-end still fixed/unverified — no OpenAI key on any host used so far |

The pattern all three Characters named independently and which the panel verdict
rests on: *"a tool that visibly metabolizes its own audit findings is itself a
trust signal"* (`L1-HRBP-18`). Eva: „**Takhle má vypadat oprava: dohledatelná.**"

---

## 2. Design opportunities (ranked; convergent above arithmetic, voice-escalation above row severity)

Ranking note: three items below carry a *minor* row severity and rank in the top
five anyway. Eva's live voice is why — „Nástroj, který mi o sobě tvrdí, že nic
nemá, když toho má plno, **mě učí své vlastní UI ignorovat**. A to je horší než
chybějící funkce, protože to podkopává i to, co funguje." A clarity finding whose
voice claims trust erosion is a trust finding.

### Guardrails — the strengths, phrased as constraints on everything below

These are not compliments; they are conditions every build item must satisfy.

- **G1 — Provenance discipline is the product.** Any new visible value (title
  chip, roleFamily field, requirements rows) must carry the same
  stated / inferred / default convention already live on seniority and facets.
  Priya: *"One field opted out of the whole convention by not appearing."*
  (`L1-HRBP-19`)
- **G2 — Attachment fencing is audit-grade and must survive any grounding
  extension**: server-resolved JD bodies, hard caps, inferred-until-confirmed,
  requestor-wins, keyless-never-mined with a one-time spoken ack, frozen after
  promote. (`L1-EVA-S6` · `L1-HRBP-19` · `L1-TOM-8`, convergent ×3)
- **G3 — The live JD draft stays deterministic and zero-LLM.** Its adoption power
  is zero latency plus its refusal to print undecided values. No "enrichment"
  that adds a model call or invents a default. (`L1-EVA-S7` · `L1-HRBP-20` ·
  `L1-TOM-7`, convergent ×3)
- **G4 — The Triptych's safety rails are load-bearing**: min-one-open guard,
  persisted folds, reduced-motion flattening, keyboard-operable spines. Badge and
  discoverability fixes work *inside* them, never around them. (`L1-EVA-S8`)
- **G5 — Keyless honesty is a shipping feature, not a degraded mode.** Copy fixes
  extend disclosure earlier; they never soften it. (`L1-HRBP-16` is a fix *to*
  this rule, not an exception from it.)
- **G6 — Keep citing finding ids at fix sites.** Named by all three Characters as
  a trust signal in its own right. Every item below should land the same way.

---

### 2.1 Market-research opt-out on the surface Priya can actually press — **build** (B1)

- **Evidence:** `L1-HRBP-11` (major, high·high·high) — the run's highest-impact
  item, and the cleanest two-arm live proof it produced. UI arm: the whole
  promote area is `checkbox "Navrhnout rovnou i praktickou úlohu"` +
  `button "Vytvořit inzerát"`; the draft pane asserts the comp read as settled
  fact („Finální inzerát **včetně průzkumu mezd** vznikne při Vytvořit inzerát"),
  and a browser promote yielded `options.marketResearch: true` and
  „Mzda: 103 000–154 500 CZK / month". API arm: `{"marketResearch": false}` → 200,
  no salary line at all.
- **Voice:** Priya, live — *"Someone wrote the switch. I read its code in the
  route. I cannot press it. That is a strange kind of frustration: not 'they
  didn't build it', but 'they built it and left me on the wrong side of the
  glass'."* And at L1: *"Building the override and not giving me the handle is
  the kind of fix that passes an audit and fails a user."*
- **What:** a checkbox in the promote row beside the case-design one, wired
  through `jdsIntakeLogic.ts:150-161` (which today posts only `{caseDesign}`),
  plus conditional draft-pane copy so the working note stops asserting a market
  read the user just declined.
- **Cost/value:** hours, not sessions — the server contract already exists and is
  proven correct live. It closes the single item that stands between a Character
  and adoption, on her second consecutive run of asking. Her own escalation:
  *"it is the same two handles as last time — which, after two runs, starts to
  read as a decision rather than a backlog."*

### 2.2 Title provenance chip + one-click title correction — **build** (B2)

- **Evidence:** `L1-TOM-2` (major, med-high·high·high), **confirmed live with a
  control arm and widened**. Arm A (attached posting `xd5627eu`, opening message
  explicitly rejecting it) → `title: "Senior Java vývojář — platební tým"`,
  `spineProvenance: {title:"inferred", seniority:"inferred"}`. Arm B (same
  sentence, no attachment) → `"Senior backend engineer — platební tým"`. The
  attachment drove the title. The render: the „úsudek AI" chip sits on
  *seniority*; the title is bare — and it names the sidebar session and headlines
  the draft. **Both** live sessions stamped `title:"inferred"`, so the title is
  inferred by default, attachment or not.
- **Voice:** Tomáš, live — „A pak to celé zahodí tím, že mi ten domyšlený název
  ukáže holý, nahoře, tučně — a ještě tak pojmenuje celou konverzaci v seznamu.
  Já jsem tam napsal jednu větu: *nechci nabírat podle toho starého inzerátu.* A
  ono to z toho inzerátu vzalo to jediné, co jsem chtěl zahodit — jeho jméno.
  **Kdyby tam bylo to samé ,úsudek AI', co má seniorita, opravím to za tři
  vteřiny.**"
- **What:** render `spineProvenance.title` with the existing chip component at
  `JdsIntakeBriefPanel.tsx:131-133` (the seniority read at `:134-141` is the
  pattern to extend, per G1), and make the title inline-editable in the brief
  panel — a typed title is by definition `stated`, which also converts the fix
  into the three-second correction Tomáš describes.
- **Cost/value:** small; one consumer added to an existing schema slot. It
  removes the single "instant trust kill" from his declared criteria, at the most
  prominent value on the surface. **Guardrail G1 + the SUMMARY's constraint: the
  title fix extends the spine-provenance chain, it does not alter it.**

### 2.3 Both spine badges must tell the truth — **build** (B3)

- **Evidence:** convergent ×3 at L1 (`L1-EVA-10` · `L1-HRBP-15` · `L1-TOM-5`) —
  `countFor` maps the draft leaf to `counts.attachments`
  (`JdsIntakeLayoutTriptych.tsx:46-47`) while the purpose-built
  `counts.draftReady` (`intakeLayoutShared.ts:22`, `JdsIntakePanel.tsx:235`) has
  no consumer. Then **L2 found the sibling branch nobody read**: `L2-CONV-1` —
  the *brief* spine reads „Živé zadání 0" over a brief holding a title, a
  seniority, seven context facets and two success criteria, because it counts
  `requirements`, empty in every live session. Two of three spines badge zero on a
  rich session.
- **Voice:** Eva, live — „Naštvalo mě, že když si ten Triptych složím — a já si ho
  skládám, protože si nechávám otevřený jen rozhovor — tak na mě obě zbylé páteře
  koukají nulou. **Nula, nula.** Přitom za nimi je hotová pozice a sedm poznámek."
  Tomáš: „Složím si to a vypadá to, že jsem neudělal nic."
- **What:** repair **both** branches of `countFor` — draft consumes `draftReady`
  (a state, not a count: render a dot/✓ rather than a number), brief counts what
  the brief actually holds (facets + requirements + criteria, or likewise a
  filled-state marker). Audit the third branch in the same change.
- **Cost/value:** trivial cost; ranks 3rd on voice escalation despite a *minor*
  row severity, because the failure mode Eva names is "the tool teaches me to
  ignore its own UI". **G4: inside the safety rails.**

### 2.4 "Podklady" must survive a fold — **build** (B4)

- **Evidence:** `L1-TOM-5`, **confirmed live including the half L1 only
  inferred**: expanded, the attachments pane is `group: Podklady0` at the foot of
  the draft leaf with no heading and no cue in the opener; **folded, it is absent
  from the accessibility tree entirely**. A fold persisted in `localStorage`
  makes the attach affordance invisible forever.
- **Voice:** Tomáš, L1 — „A ty Podklady samotné — našel jsem je náhodou, schované
  pod návrhem inzerátu v rozklikávací liště. Kdybych nevěděl, že tam jsou,
  nasypal bych ten dokument rovnou do chatu." Live: *"I would never have found
  it."*
- **What:** surface materials independently of the draft leaf's fold state (own
  spine affordance, or a persistent cue in the composer/opener: "můžete přiložit
  podklady"). Attachments are the feature the whole run praised most (G2); a
  discoverability gap on it is pure waste.
- **Cost/value:** small; layout + one copy line. Note the compounding: pasting
  into chat instead burns the 4k message cap and loses the fenced third-party
  framing that G2 exists to provide.

### 2.5 roleFamily: visible, editable, honestly labelled — **build** (B5)

- **Evidence:** `L1-HRBP-12` (major) — **confirmed live in half**. The Live brief
  shows title + seniority + provenance chip + facets and *no role family*; the
  „Upravit zadání" sheet has title, seniority combobox, musts adder, context rows
  — and no roleFamily control — while the stored brief for that session holds
  `roleFamily: "healthcare_clinical"` and `promote/route.ts:54,60` threads it
  into the build. Not reproduced live: the misclassification (a deterministic-path
  property; the keyed LLM path classified the Czech nurse corpus correctly) —
  code-evidenced, untested. New at L2: a fresh intake initialises
  `software_engineering` before any signal exists. Bundled residual:
  `L1-HRBP-13` — a zero-signal family falls through to `DEFAULT_FAMILY` and is
  stamped `"inferred"`; the honest label is `default` (uncertain live: on the LLM
  path `spineProvenance` carries only `title` and `seniority`).
- **Voice:** Priya, live — *"The family field is quieter and worse. My nurse was
  classified correctly this time — good — and I have no way of knowing that from
  the screen, because the screen never says it. I am asked to trust a category I
  cannot see, cannot confirm, and cannot correct, and it goes on to steer the
  posting."* L1: *"If the category steers the advert you build me, show me the
  category."*
- **What:** render `roleFamily` in the brief panel with its provenance chip (G1),
  add a select to `JdsIntakeBriefEdit` (a chosen family is `stated`), stamp the
  zero-signal fallback `default` rather than `inferred`, and stop initialising a
  fresh brief to `software_engineering` (leave it unset until signal exists).
- **Cost/value:** small-medium (UI + one enum control + two engine label
  changes). Second of Priya's "two handles"; both are now in their **second
  consecutive run** unbuilt.

### 2.6 Confirmed dealbreakers must reach `requirements[]` — **build** (B6)

- **Evidence:** `L2-NEW-2` (new at L2, L1 missed it). „Tvrdá podmínka je Java a
  Kafka v produkci", stated *and confirmed*, left `requirements[]` empty in all
  three sessions driven (3-turn API, 3-turn browser, pre-existing 14-turn). The
  edit sheet's „Nezbytné / Výhodou" block sits empty. Mitigated in outcome —
  `needText` carries them, and the built JD opens with „Java — produkční
  zkušenost (potvrzená tvrdá podmínka requestora)" — so the defect is
  **representational**, and it compounds 2.3 (it is what the brief spine counts).
- **Voice:** Tomáš, live — *"The JD came out right, so nothing broke — but what I
  can inspect and correct is thinner than what the system knows, and that is the
  part I was promised control over."*
- **What:** tighten the extraction contract so a confirmed hard condition lands
  as a graded `requirement` (kind `must`), not only as prose in `needText`.
  Pair with 2.11 (an eval-bank assertion) so it cannot silently regress.
- **Cost/value:** medium (prompt/extraction contract + eval coverage). It is the
  supply line for the defensibility layer shipped last run — export, edit and
  weights are all only as rich as this array.

### 2.7 Supersede: create the relationship the copy promises — **build** (B7)

- **Evidence:** convergent ×2 (`L1-EVA-9` · `L1-TOM-6`), **confirmed live and
  worse than L1 predicted**. The draft pane renders the promise verbatim („Je
  přiložen existující inzerát — vytvořením z tohoto zadání vznikne jeho
  aktualizovaná verze"); after promote, `xd5627eu` is still `archived_at = NULL`,
  the new JD is `t9u3iv9w`, and Saved JDs lists **two rows with the
  byte-identical title**, both „Koncept", both Software/Senior.
- **Voice:** Eva, live — „A ta ,aktualizovaná verze' — po promotu mám v knihovně
  dva řádky se **stejným názvem**. Ne podobným. Stejným. Až se k tomu za měsíc
  někdo vrátí, nemá jak poznat, který je ten nový. **To slíbila věta v UI, ne
  já.**" Tomáš: „Tak aktualizovaná, nebo druhá?"
- **What (minimal, this item):** persist the attached `jdSlug` as a
  `supersedes` pointer on the promoted JD (attachments already carry `jdSlug`, so
  the link is one field away) and show it in the Saved JDs ledger — a
  "nahrazuje / nahrazeno" badge on both rows. Where the deeper lineage questions
  begin, see **2.13 (concept-doc)**; do not block the badge on them.
- **Cost/value:** small for the link + badge; disproportionate ledger hygiene on
  the most common shape for two of three Characters (the backfill).

### 2.8 The voice extraction thread must receive the attachments it is shipped — **build (one-line)** (B8)

- **Evidence:** convergent ×2 (`L1-EVA-8` · `L1-HRBP-14`). `intake-run.ts:153`
  ships `--attachments-json` for `--extract-transcript`, `intake_cli.py:58` loads
  it, `:85` calls `extract_transcript(provider, turns, brief, lang=…)` **without**
  it, and the function has no attachments parameter (`intake.py:802-855`) — while
  the fast thread's own prompt promises mining "outside this call" (`:927`).
- **Voice:** Eva — „A hlasová větev slibuje, že podklady ,vytěží jinde' — jenže to
  jinde je nikdy nedostane; **jeden parametr visí ve vzduchu**."
- **What:** thread `attachments` into `extract_transcript` and add
  `_attachments_block` to its prompt. Dead-parameter fix; shape is one line plus a
  prompt block.
- **Cost/value:** near-zero cost. **Unverifiable on any host used so far** (no
  OpenAI key) — ship it, but its `resolved-verified` must wait for a keyed-host
  recertify, and the backlog entry says so.

### 2.9 Keyless materials copy discloses before the ack, not after — **build (copy)** (B9)

- **Evidence:** `L1-HRBP-16`. The empty state promises "the assistant will draw
  on it and ask you to confirm what it takes" with no keyless qualifier; offline,
  the truthful behaviour (stored + acknowledged, never mined) is disclosed only
  after she attaches and sends.
- **Voice:** Priya — *"A tool that tells me what it can't do is a tool I'll
  believe when it tells me what it did."*
- **What:** keyless-conditional empty-state copy. **G5: extend the disclosure
  earlier; never soften it.**

### 2.10 Escape fence markers in attachment text — **build (hardening)** (B10)

- **Evidence:** `L1-TOM-4`. `_attachments_block` interpolates raw attachment text
  between `<<<ATTACHED_MATERIAL>>>` markers with no neutralisation
  (`intake.py:699-707`), unlike `fenced_untrusted`, which json-escapes its body
  (`devcase/provenance.py:38-46`). Attachments are operator-attached (low
  likelihood), but the JD-body path means any document that ever entered the
  library is a carrier.
- **What:** strip/escape fence tokens on interpolation + a unit test. No live
  question; not an L2 item. **G2 depends on the fence actually being a fence.**

### 2.11 The eval bank must assert `role_family` — **build (CI)** (B11)

- **Evidence:** `L1-HRBP-17`. `grep role_family pipeline/jobfit/eval/intake_eval.py`
  → zero matches, while the generated bank is literally organised by family. The
  `L1-HRBP-12` regression class is exactly what the bank exists to catch and
  doesn't.
- **What:** one assertion per scenario — the scenario's family lands in the brief,
  or at minimum is not `software_engineering` for a non-tech scenario. Extend to
  `requirements[]` non-emptiness for confirmed dealbreakers (2.6).
- **Cost/value:** small; it converts two of this run's findings into standing
  regression coverage.

### 2.12 Delete the dead duplicate submit handler — **build (polish)** (B12)

- **Evidence:** convergent ×2 (`L1-EVA-12` · `L1-TOM-9`). `JdsIntakeChat.tsx:86-91`
  duplicates `submitDraft` (`:198-203`); nothing calls it. Left over from the
  Enter-to-send addition in 9b7861a9.

### 2.13 JD lineage — what does "a new version of a posting" mean? — **concept-doc** (C1)

- **Evidence:** `L1-EVA-9` / `L1-TOM-6` and their live twins result. 2.7 buys the
  pointer and the badge; it does **not** answer the questions underneath, and
  answering them in a PR would be guessing.
- **Real open questions:** Is a promoted JD a *successor* (link), a *version* (a
  chain with numbers, one canonical head), or a *replacement* (the old one
  archived)? What happens to live applications, share tokens and comms threads on
  the superseded posting — do they follow the head or freeze? Does matching score
  against the head only? Can a posting supersede one it was not attached to?
  What does the ledger show when a chain is three deep? Does an intake that
  attaches two JDs supersede both?
- **Why not build now:** each answer changes schema and at least two other
  surfaces (Saved JDs, comms, matching). Write it as an extension in the
  `docs/concepts/` orbit of the intake concept doc, then promote to build. Once
  built it gets a journey (or an extension of `role-intake-dialog`) so the next
  `run` certifies it.

### 2.14 Workspace-context grounding of the dialog — **concept-doc (carried, still open)** (C2)

- **Evidence:** carried from the 2026-08-07 drain §2.5, and **re-confirmed with
  new evidence this run**: the grounding rows for org context / prior sessions /
  market band scored ✗ across *all three* Characters' audits (Eva row 9, Tomáš
  rows 6-8, `SUMMARY.md` ceilings). Tomáš's senior bar is explicit: a real talent
  advisor would walk in knowing the team's existing roles, prior JDs and the
  market band.
- **Status:** attachments (9b7861a9) delivered the *user-curated* half of this —
  and did it inside the provenance law, which is the hard part. What remains is
  the *automatic* half, and its design questions are unchanged: which context,
  how it enters the prompt without inflating 22-52 s exchanges, whether a new
  `grounded` provenance value is needed, and privacy scope. Keep as concept-doc;
  do not fold into a build item.

### 2.15 Declines — recorded so they cannot resurface without new evidence

- **D1 — Attachments passed through to the promoted JD build (`L1-TOM-3`) —
  declined.** L2 softened it: `build_input_json` carries no attachments, but
  `needText` carries the distillate and the built JD opened with „Java —
  produkční zkušenost (potvrzená tvrdá podmínka requestora)". The phase boundary
  holds *in outcome*, and G2's guardrail is explicit that the
  brief-as-provenance-tracked-distillate is the defensible boundary — raw
  attachment passthrough into the build would bypass exactly the discipline all
  three Characters praised. Revisit only if a live JD is shown to *miss* content
  that only the raw attachment held.
- **D2 — Auto-archiving the attached JD on promote — declined.** Destructive and
  premature: it presumes the "replacement" answer to 2.13's lineage question
  before that question has been answered, and a wrongly archived posting can hold
  live applications and share links. 2.7's non-destructive pointer + badge is the
  honest interim.
- **Prior declines re-affirmed (no new evidence to overturn):**
  - *Streaming replies* — the live measurement strengthens the original
    reasoning rather than weakening it: 22.4 / 52.3 / 33.3 s per exchange behind
    an honest staged hint, with the composer disabling itself, produced „za dvě
    minuty jsem měla inzerát" and zero latency complaints from any of the three.
  - *Keyless laddering / over-specifier imitation* — the keyless floor's honesty
    was praised again this run (`L1-TOM-8`, Priya's ack quote). Still a floor.
  - *Smarter deterministic answer-parsing* — the human edit remains the honest
    remedy; 2.5/2.2 extend it rather than replacing it with a better regex.
- **Covered elsewhere (not double-entered):** multi-market compensation stays the
  workspace-level ceiling already tracked in `docs/BACKLOG.md` under Matching &
  scoring — 2.1 makes the Czech read *skippable*, not *right for GBP*. The
  dev-case seam (`L1-EVA-3`) shipped and was recertified.

**Tally: 12 build · 2 concept-doc · 2 new declines (+3 re-affirmed).**

---

## 3. Methodology lessons — what the *drain* revealed about `/uat`

v1.2 already folded in branch-enumeration, `l2_priority` environment
preconditions, and control arms; those are not re-recorded. What follows is what
only the drain step could see, and it is applied to the v1.2 package in the same
change (skill edits without a version bump, per the operator's packaging
decision, with the bullets appended to `LESSONS.md` under the 1.2 header).

1. **The findings schema does not carry what §1 needs.** The drain contract says
   §1 is built from findings that went finding → fix → `resolution:
   resolved-verified`, each with its `ceiling`. This run's `findings.json`
   contains **zero** `resolved-verified` entries and **one** `ceiling` (on a
   refuted finding). Every prior major *was* verified fixed — but it was recorded
   as a *strength* row (`L1-EVA-S5`, `L1-HRBP-18`, `L1-TOM-1`) plus prose tables
   in three separate reports, with the ceilings scattered across two documents and
   the previous run's report. §1 above had to be reconstructed by hand from five
   sources. Fix applied: a `run` that re-certifies prior findings must **carry
   those ids forward into its own `findings.json`** with `resolution:
   resolved-verified` + `ceiling`, not fold them into a strength summary — the
   ceilings→§2 pipeline is the drain's main input and it silently broke here.
2. **The L1→L2 handoff worked, and its one blind spot is re-scoring.** Every
   `l2_priority: high` item got a live answer, and the two "new at L2" findings
   sat exactly in the class the handoff cannot cover. But L2 **widened** two
   carried findings — `L1-TOM-2` from "attachment-mined titles" to "titles are
   inferred by default, always"; `L1-EVA-9`/`L1-TOM-6` from "look-alikes" to
   "byte-identical twins" — and the widening lives only in report prose. The
   single `impact` field in `findings.json` still holds the L1 score, so a drain
   reading the JSON alone would rank both too low. Fix applied: when L2 widens or
   narrows a carried finding, it **updates `impact`/`severity` and keeps the L1
   values as `impact_l1`/`severity_l1`**, so the delta is machine-visible.
3. **The voice sections outranked the findings table, again — and this time they
   changed the ranking, not just the framing.** The most decision-useful sentence
   in the whole run — Eva's „Nástroj, který mi o sobě tvrdí, že nic nemá, když
   toho má plno, mě učí své vlastní UI ignorovat. A to je horší než chybějící
   funkce" — has no corresponding finding row above *minor*, and it is why the
   spine-badge item ranks 3rd rather than 10th. Writing the voice at **both**
   levels (L1 over the designed experience, L2 over the live one) is what made
   this possible: the L1 voice called it a drobnost, the L2 voice called it
   corrosive. Fix applied: the drain ranks by voice-claimed dimension when a voice
   escalates a finding above its row severity, and the run's report must keep both
   voices rather than replacing the L1 one.
4. **Recurrence is a signal the schema doesn't carry.** Priya's sharpest line is
   not about a defect: *"it is the same two handles as last time — which, after
   two runs, starts to read as a decision rather than a backlog."* An item that
   survives a full run→drain→ship→recertify cycle **unbuilt** and returns
   unchanged is stronger evidence than a fresh major, because it has now cost a
   Character trust twice. Nothing in the finding schema or the drain ranking
   expressed that. Fix applied: findings carry `recurrence` (the count of
   consecutive runs raising the same underlying gap), and the drain ranks a
   recurring item above a first-time item of equal impact.

Two non-actionable observations, recorded without a skill change: the
`env.md` port guidance should soften from "pin :3005" to "detect the running
instance first" (already noted in the run report and fixed in the overlay), and
spine toggles expose their label as an *accessible name* rather than visible
text, so `getByRole("button", {name})` is required where `getByText` fails
(already recorded in the run report for the next session's driver work).

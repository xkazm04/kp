# L1 certification — Priya Nair (hr-healthcare-clinic-hrbp) × role-intake-dialog — Triptych recheck

- **Level:** L1 (theoretical, code-grounded — no browser)
- **Date:** 2026-08-10
- **Character:** Priya Nair, HR Business Partner, private clinic group (UK, CQC-registered) — language **en**
- **Journey:** `uat/journeys/role-intake-dialog.md`
- **Scope of this pass:** the surface after 9b7861a9 (attachments grounding + live JD draft), deca4357/9eca2924 (Triptych is THE session layout), judged against the 2026-08-07 baseline (`uat/runs/2026-08-07-intake/hr-healthcare-clinic-hrbp--role-intake-dialog.md`).
- **Behavior mode sampled (designed experience):** same as baseline — `over_specifier`-adjacent compliance-first backfill requestor (RGN, Band 5, hard licensure gates), keyless as her stated reality.
- **Verdict:** **L1-conditional** (down from four majors to one full major + one narrowed major; the surface moved decisively toward her)

---

## 1. Surface model (import chain, file:line)

Mount is unchanged: Library → Saved/Generate/**Intake** segment → `JdsIntakePanel`. What changed inside:

- **Session layout is now the Triptych, unconditionally** — `app/features/library/jds/intake/JdsIntakePanel.tsx:186-237` renders `JdsIntakeLayoutTriptych` with four content nodes (chat / brief / draft / materials) + counts. The old segmented side column (`JdsIntakeSidePanel`) and the Cockpit variant are deleted from disk (commit 9eca2924).
- **Triptych** — `JdsIntakeLayoutTriptych.tsx:33-127`: three leaves (draft | chat ×1.5 | brief), each ONE always-mounted `motion.section` whose width tweens leaf↔spine (`:63-71`); fold state in localStorage (`intakeLayoutShared.ts:29-49`), min-one-open guard (`:53-59`), reduced-motion gated throughout, spine is a keyboard-focusable button with `aria-label` (`Triptych:108-119`). Materials fold as a `<details>` under the draft leaf (`:96-102`).
- **Live JD draft** — `app/_lib/intake-draft.ts:25-51` (pure, unit-tested `intake-draft.test.ts`) → `JdsIntakeDraftPane.tsx:19-64`: deterministic posting-shaped markdown of the current brief, re-rendered every exchange at zero LLM cost, labeled "working draft" (`:41-44`), crossfades on change keyed by content (`:47-58`).
- **Attachments** — `JdsIntakeAttachmentsPane.tsx` (paste note / pick saved JD) → `jdsIntakeLogic.ts:292-321` (`mutateAttachments`, server-confirmed list) → `app/api/intake/[id]/attachments/route.ts:24-80`: operator-gated, workspace-scoped, ≤5 items / 20k chars / 120-char titles (`:19-20`), JD bodies resolved **server-side** from the library by slug (`:50-59` — the client can never smuggle a body), promoted sessions frozen 409 (`:32-34`).
- **Grounding chain** — `message/route.ts:43-49` passes `intake.attachments` → `intake-run.ts:12-21` writes `attachments.json` + `--attachments-json` → `intake_cli.py:48,58-60,98` → `run_intake_turn(..., attachments=...)` → the fenced `<<<ATTACHED_MATERIAL>>>` block (`intake.py:687-713`), budget ~8k chars split across items with explicit truncation markers (`:697-703`).
- **Promote** — `promote/route.ts:43-50`: `marketResearch: body.marketResearch !== false` — an **opt-out now exists at the API** (the comment cites UAT L1-HRBP-6). Build input threads `seniority`, `roleFamily`, full `brief` (`:54-66`); back-link stamped as before (`:70`).
- **Prior-drain fixes verified present in code:** wait-for-confirmation close + correction facet (`intake.py:515-547`, cites L1-CONV-2), re-open route + button (`JdsIntakePanel.tsx:120-131`, `jdsIntakeLogic.ts:261-285`), grade_label capture for out-of-enum answers (`intake.py:386-398`, cites "I told it Band 5 and it wrote 'medior'"), spine provenance end-to-end (`rolebrief.py:108-123,202-254`; chip at `JdsIntakeBriefPanel.tsx:134-141`), stated-only read-back seniority (`intake.py:459-460`), `<<END>>` stripped at the route (`message/route.ts:54`), role-family vocabulary now IN the extraction prompt (`intake.py:111-113`) + deterministic classification at read-back (`intake.py:569-582`), human edit with provenance diff so edits can't launder inferred→stated (`JdsIntakeBriefEdit.tsx:49`, `withEditProvenance`).

## 2. Grounding audit — **15/16**

Baseline scored 9/10; the one hole (role-family vocabulary) is closed, and the new attachments surface adds six checks of its own.

| # | Check | Evidence | |
|---|---|---|---|
| 1–9 | Baseline persona/context checks (one question/turn, reflect-then-ask, reuse words, ladder musts, park solutions, name contradictions, 90-day de-spec, read-back+`<<END>>` gate, full brief + 48-turn transcript + fenced message + language) | `intake.py:58-101,128-139,768-782` | ✓ all hold |
| 10 | **Role-family vocabulary reaches the prompt** — baseline's one miss: `_EXTRACTION_RULES` now enumerates `ROLE_FAMILIES` and orders "never leave a non-software role on the software default"; spine provenance rules included | `intake.py:103-125` (esp. `:111-113`) | ✓ **fixed** |
| A1 | Attachments reach the dialog prompt, fenced + budgeted | `intake.py:687-713,770`; chain `message/route.ts:48` → `intake-run.ts:12-21,193` → `intake_cli.py:58,98` | ✓ |
| A2 | Provenance discipline on mined values: `inferred` citing the attachment, `stated` only on live confirmation; requestor wins on conflict | `intake.py:708-713` | ✓ |
| A3 | Keyless honesty: attachments stored + acknowledged ONCE, never prose-mined without a model ("nothing silently invented") | `intake.py:675-684,738-747` (once-detection `:743-744`) | ✓ |
| A4 | Voice fast thread sees titles only (latency budget, stated in code) | `intake.py:918-927` | ✓ by design |
| A5 | **Voice extraction thread receives attachments** — `intake-run.ts:153` dutifully pushes `--attachments-json` for `--extract-transcript`, and `run_voice_turn`'s comment promises "mining happens in the text plane / **extraction thread**" (`intake.py:919-921`) — but `intake_cli.py:85` calls `extract_transcript(provider, turns, brief, lang=...)` **without** them, and `extract_transcript` (`intake.py:802-808`) has no attachments parameter at all | `intake_cli.py:85` vs `intake-run.ts:153` | ✗ |
| A6 | Requestor-authenticated fence (not the adversary fence that refused corrections on camera — L2-INT-1) with the exactly-once message rule | `intake.py:762-778`, `message/route.ts:40-49` | ✓ |

This is now about as well-fed as a dialog prompt gets. The one miss (A5) is voice-plane-only and honest in effect (the brief simply isn't enriched), but the code promises something the wiring doesn't deliver.

## 3. Walkthrough (cognitive walkthrough, in character; keyless = her reality)

**Step 1 — find + orient.** Library → Intake, unchanged. Opening a session now lands her on the Triptych: JD draft | conversation | live brief. For Priya this is a **better mental model than the baseline's tabbed side column**: the thing she's producing (the posting) and the thing she's signing (the brief) are both visible while she talks; folding the draft to a spine keeps its label + count on screen (`Triptych:108-119`). The min-one-open guard means she can't strand herself (`intakeLayoutShared.ts:53-59`). ✓

**Step 2 — attach her materials.** Before typing, she pastes the practice manager's handover note and attaches the old "Practice Nurse" JD from the library. The JD body is resolved server-side from the stored document (`attachments/route.ts:50-59`) — she cannot accidentally attach a doctored copy; that's an audit property she'd name. Caps are honest (5/20k/120). The draft pane immediately notes an attached JD will be superseded at promote (`JdsIntakeDraftPane.tsx:36,45`). ✓

**Step 3 — keyless disclosure.** On her first message the agent prepends, once: "I can see the attached material (…). Offline I can't read documents into the brief myself — paste the key points as answers and they'll land as your words." (`intake.py:675-684,740-747`). **This is exactly her bar**: the tool names what it cannot do instead of silently pretending. One wrinkle: the materials pane's empty-state copy promises "the assistant will draw on it and ask you to confirm" (`messages/en.json` → `attachments.empty`) unconditionally — keyless, that promise is only walked back after she's already attached and sent (finding L1-HRBP-16).

**Step 4 — the dialog.** Same role-neutral scripted questions (`intake.py:278-319`). Her opener — "Our practice nurse handed in her notice — maternity cover, same role, Band 5" — **still** routes to the 10-question story path: `_POWER_UNIT_MARKERS` (`intake.py:241-245`) gained Czech inflections (the L1-EVA-2 fix) but the English clinical-backfill idiom ("maternity cover", "handed in her notice", "same role" — the marker is "same as") still matches nothing. Baseline L1-HRBP-7 carries forward, minor (all questions skippable).

**Step 5 — Band 5, revisited.** She answers the seniority question "Band 5, registered nurse". The baseline's quiet lie is gone three ways: (a) the out-of-enum answer is captured **verbatim as a stated, core `grade_label` facet** — "Grade / level (as stated)" (`intake.py:386-398`); (b) the brief panel's seniority chip now wears a provenance chip and a missing spine key reads **default/"assumed"**, never captured (`JdsIntakeBriefPanel.tsx:134-141`); (c) the JD draft **refuses to print a default seniority at all** (`intake-draft.ts:32-34` — "the provenance law"), and the read-back only prints seniority when stated (`intake.py:459-460`). Her Band 5 appears in the read-back via the facet loop (`:473,488` include `grade_label`). **Baseline L1-HRBP-3 and L1-HRBP-5: fixed as designed.**

**Step 6 — the close.** Script exhausted → read-back **without** closing (`intake.py:569-583` returns `done: False`); the confirm/correction arrives as her NEXT message: a non-confirm answer lands as a stated, core "Correction" facet with its sourceTurn, then the close acknowledges it verbatim (`intake.py:527-547,504-512`). The composer stays live for the answer the read-back invites. And if she still thinks of something later — **Re-open** exists, appending an honest system turn (`JdsIntakePanel.tsx:120-131`; system turns render as visible seams, `JdsIntakeChat.tsx:101-113`). **Baseline L1-HRBP-4: fixed as designed.**

**Step 7 — role family.** At read-back time the deterministic path classifies the family from everything captured (`intake.py:569-582`, comment cites L1-HRBP-2) and the LLM path now carries the 16-family vocabulary + "never leave a non-software role on the software default" (`intake.py:111-113`). I **executed** the classifier on her session's realistic corpus (title "Practice Nurse"; musts "valid NMC registration (active PIN)", "Enhanced DBS eligibility", "medicines management"; outcome "runs the morning ward round"; her Band-5/GBP facets): result **`general_professional`** — not `healthcare_clinical`. Probes show the healthcare vote terms are tight bigrams: "registered nurse" / "staff nurse" / "healthcare assistant" / "general practitioner" hit; "Practice Nurse", "Registered **General** Nurse", bare "nurse", "NMC PIN", "medicines management" all miss (`taxonomy.py:623-676`; live execution 2026-08-10). So her nurse is no longer a *software engineer* (the poisonous default is out) but lands in the neutral catch-all — and **nowhere in the UI can she see or correct the family**: the brief panel never renders it, and the edit surface has title/seniority/requirements/facets only (`JdsIntakeBriefEdit.tsx:32-49` — no roleFamily control), while `promote` threads it straight into the build (`promote/route.ts:54,60`). Finding L1-HRBP-12.

**Step 8 — promote.** The gate is unchanged and fair. The route now honors `marketResearch: false` (`promote/route.ts:43-50`, comment citing her baseline finding) — **but her UI never sends it**: `jdsIntakeLogic.ts:150-161` posts only `{ caseDesign }`, `JdsIntakePanel.tsx:148-157` offers only the work-sample checkbox, and the draft pane's own copy tells her the final JD comes "with market salary research" as a fact (`messages/en.json` → `draft.workingNote`). The fix **landed** but is not **reachable** from her chair — the Czech-market comp read still auto-attaches to every promote she can actually perform. Finding L1-HRBP-11.

**Step 9 — feedback/status.** Every state remains spoken; the new surfaces joined the discipline: attachment errors have their own line (`JdsIntakePanel.tsx:170`), latency honesty after ~8s (`JdsIntakeChat.tsx:42-66`), degraded note unchanged. One cosmetic slip: the folded **draft** spine shows the **attachments** count as its number (`Triptych:46-47` — `countFor` maps draft→`counts.attachments`; the `draftReady` boolean is passed in `intakeLayoutShared.ts:22` and never used). Finding L1-HRBP-15.

## 4. Findings

> Schema: id · type · severity · impact{frequency, reachability, trust_erosion} · code_check · resolution · l2_priority

### L1-HRBP-11 — trust — Market-research opt-out landed API-only: her Promote still auto-attaches the wrong-market comp read
- **type:** trust (wrong-market comp; fix-reachability) · **severity:** **major** (her scored criterion: a wrong-market number **with no override** is a major — the override exists but not on any surface she can reach) · **impact:** {frequency: high — every promote, reachability: high, trust_erosion: high}
- **expected:** After baseline L1-HRBP-6, promoting a Band-5 GBP nursing brief without a Czech-tech comp band attached.
- **got:** `promote/route.ts:43-50` honors `body.marketResearch !== false` (comment cites L1-HRBP-6) — but the UI client sends only `{ caseDesign }` (`jdsIntakeLogic.ts:150-161`); the panel renders no market-research control (`JdsIntakePanel.tsx:135-157`); and the draft pane's working note asserts "The final JD (with market salary research) is generated at Create JD" unconditionally (`messages/en.json` → `library.tab.intake.draft.workingNote`). The rubric's own law: fix *landed* ≠ fix *reachable*.
- **evidence:** `app/api/intake/[id]/promote/route.ts:43-50` · `app/features/library/jds/intake/jdsIntakeLogic.ts:150-161` · `app/features/library/jds/intake/JdsIntakePanel.tsx:148-157` · `messages/en.json` (draft.workingNote)
- **code_check:** confirmed-present. **ceiling note:** the single-Czech-market anchor itself remains the documented workspace ceiling (Character surface binding); only the missing UI affordance is scored. **resolution:** open. **l2_priority:** high — promote from the UI, inspect the JD's market panel; then promote via API with `marketResearch:false` to confirm the seam works.

### L1-HRBP-12 — quality-gap — roleFamily: the software default is dead, but her nurse lands in `general_professional`, invisibly and uncorrectably
- **type:** quality-gap (wrong-domain residual of L1-HRBP-2) · **severity:** **major** (narrowed from baseline: the failure is now mis-binned + invisible, not tech-poisoned) · **impact:** {frequency: high for clinical keyless intakes, reachability: high, trust_erosion: med-high}
- **expected:** A "Practice Nurse / RGN Band 5" intake classifies `healthcare_clinical` (the family exists — `taxonomy.py` ROLE_FAMILIES includes it, and the eval bank has a `healthcare_clinical` scenario), and the requestor can see and correct the family before it steers the JD build.
- **got (executed, 2026-08-10):** `classify_role_family` on her realistic corpus (title "Practice Nurse", musts NMC/DBS/medicines-management, ward-round outcome, Band-5 facets) → **`general_professional`**. Term probes: "registered nurse"/"staff nurse"/"healthcare assistant"/"general practitioner" → healthcare_clinical; "Practice Nurse", "Registered General Nurse" (her literal what-good-looks-like phrasing), "nurse", "NMC PIN" → general_professional (`taxonomy.py:623-676` — exact-phrase votes; zero-signal falls to `DEFAULT_FAMILY`). The LLM path is now equipped (`intake.py:111-113`) — this is the **keyless/deterministic** residual, i.e. her stated reality. And the family is **unrepresented in the UI**: `JdsIntakeBriefPanel.tsx` never renders roleFamily; `JdsIntakeBriefEdit.tsx:32-49` has no roleFamily control; `promote/route.ts:54,60` threads it into the build regardless.
- **code_check:** confirmed-present (defect proven by execution + absence of the UI affordance at the cited lines). **resolution:** open (baseline L1-HRBP-2: substantially fixed; this is the narrowed remainder). **l2_priority:** high — LLM-path clinical intake live: inspect stored `roleFamily` + spineProvenance; keyless: confirm general_professional lands and is invisible.

### L1-HRBP-13 — trust — A zero-signal family classification wears the "inferred" chip
- **type:** trust (provenance honesty) · **severity:** minor · **impact:** {frequency: med, reachability: high (would be visible if L1-HRBP-12's UI gap were fixed; today it's stored data + export), trust_erosion: low-med}
- `classify_role_family` never returns empty — a signal-free corpus falls through to `DEFAULT_FAMILY` (`taxonomy.py:670-676`) — and `deterministic_turn` stamps whatever comes back as `spine_provenance["role_family"] = "inferred"` (`intake.py:579-582`). A fallback default labeled "inferred" is precisely the masquerade the provenance law exists to prevent (`rolebrief.py:23-26`); the honest label for the zero-score case is `default`.
- **code_check:** confirmed-present. **resolution:** open. **l2_priority:** low.

### L1-HRBP-14 — quality-gap — The voice extraction thread is promised attachments it never receives
- **type:** quality-gap (grounding wiring) · **severity:** minor for this Character (voice + LLM-only path; she is keyless text) · **impact:** {frequency: low for her / med for voice users, reachability: low for her, trust_erosion: low — the failure is honest omission, not invention}
- `intake-run.ts:153` pushes `--attachments-json` on the `--extract-transcript` call and `run_voice_turn`'s prompt comment defers mining to "the text plane / extraction thread" (`intake.py:919-921`) — but `intake_cli.py:85` drops the loaded attachments for that branch and `extract_transcript` (`intake.py:802-855`) accepts none: the post-hang-up brief is extracted blind to the materials.
- **code_check:** confirmed-present. **resolution:** open. **l2_priority:** low (fold into a voice L2 run).

### L1-HRBP-15 — confusion — The folded draft spine counts attachments, not the draft
- **type:** confusion · **severity:** minor (polish-adjacent) · **impact:** {frequency: med — anyone who folds the draft leaf, reachability: high, trust_erosion: low}
- `countFor` maps the **draft** leaf's spine number to `counts.attachments` (`JdsIntakeLayoutTriptych.tsx:46-47`), so a folded "Job description" spine badges the number of attached materials; the purpose-built `draftReady` boolean is threaded through the contract (`intakeLayoutShared.ts:22`, `JdsIntakePanel.tsx:235`) and never read. A spine "must still say what it holds" (`intakeLayoutShared.ts:8-9`) — this one says what its *neighbor* holds.
- **code_check:** confirmed-present. **resolution:** open. **l2_priority:** low (one glance).

### L1-HRBP-16 — clarity — Keyless, the materials pane over-promises before the ack walks it back
- **type:** clarity · **severity:** minor · **impact:** {frequency: med keyless, reachability: high, trust_erosion: low — the ack corrects it in the very next exchange}
- The empty state says "the assistant will draw on it and ask you to confirm what it takes" (`messages/en.json` → `library.tab.intake.attachments.empty`) with no keyless qualifier; offline the truthful behavior (stored + acknowledged, never mined — `intake.py:740-747`) is disclosed only after she attaches and sends. The degraded note (`JdsIntakePanel.tsx:164`) is session-level and doesn't mention materials.
- **code_check:** confirmed-present. **resolution:** open. **l2_priority:** low.

### L1-HRBP-17 — missing (process) — The 100-scenario eval bank still never asserts role_family
- **type:** missing-feature (CI blind spot; carried observation from baseline §1) · **severity:** minor · **impact:** {frequency: n/a (process), reachability: n/a, trust_erosion: med — the L1-HRBP-12 regression class is exactly what the bank is organized to catch and doesn't}
- `grep role_family pipeline/jobfit/eval/intake_eval.py` → zero matches (verified 2026-08-10), while the generated bank is literally organized by family (`intake_scenarios_gen.py` — incl. `healthcare_clinical`). One assertion — "the scenario's family lands in the brief (or at least not `software_engineering` for a non-tech scenario)" — would have pinned both the fix and my classifier probe.
- **code_check:** confirmed-absent. **resolution:** open. **l2_priority:** n/a (CI work, not L2).

### L1-HRBP-18 — strength — The UAT loop closed: every baseline major is fixed *in code, with the finding cited at the fix site*
- **type:** strength (trust/process) · **impact:** {frequency: high, reachability: high}
- L1-HRBP-3/L1-CONV-3 → spine provenance chip + stated-only read-back + the draft's refusal to print a default level (`JdsIntakeBriefPanel.tsx:137-139`, `intake.py:459-460`, `intake-draft.ts:32-34`); drain 2.3 → verbatim stated `grade_label` for "Band 5" (`intake.py:386-398`); L1-HRBP-4/L1-CONV-2 → wait-for-confirmation close + correction facet + re-open (`intake.py:515-547`, `JdsIntakePanel.tsx:120-131`); L1-HRBP-2 → family vocabulary in the prompt + read-back classification (`intake.py:111-113,569-582`); L1-HRBP-6 → the API opt-out (`promote/route.ts:43-50`). Each fix comments the finding ID. For an inspector-minded user, a tool that visibly metabolizes its own audit findings is itself a trust signal. **Do not touch this seam.**
- **code_check:** confirmed-present. **resolution:** — (keep).

### L1-HRBP-19 — strength — Attachments grounding is built to the defensibility bar
- **type:** strength (trust) · **impact:** {frequency: high, reachability: high}
- Server-resolved JD bodies (client sends the slug only — `attachments/route.ts:50-59`), hard caps (`:19-20`), frozen after promote (`:32-34`), third-party fencing with inferred-until-confirmed provenance and requestor-wins (`intake.py:687-713`), keyless never-silently-mined honesty with a one-time spoken ack (`:675-684,740-747`), voice titles-only by stated latency budget (`:918-927`), unit + guard tests (`app/api/intake/attachments-guard.test.ts`, `pipeline/jobfit/tests/test_intake.py:421-486`). She can ground the dialog in the practice manager's note and the old JD without the provenance record ever blurring whose words are whose. Audit-grade.
- **code_check:** confirmed-present. **resolution:** — (keep).

### L1-HRBP-20 — strength — The Triptych + live draft serve the sign-off job
- **type:** strength (clarity/effort) · **impact:** {frequency: high, reachability: high}
- The deterministic draft (`intake-draft.ts:25-51`) shows her the posting forming from her own words at zero cost, honestly chipped "working draft" with the market-research caveat and the supersede note (`JdsIntakeDraftPane.tsx:40-45`); the Triptych keeps conversation, brief, and draft co-visible with folded leaves still labeled + counted, min-one-open guarded, reduced-motion flattened, spines keyboard-operable (`JdsIntakeLayoutTriptych.tsx:63-119`, `intakeLayoutShared.ts:53-59`). Review mode (fold left leaves, brief wide) matches how she'd actually check a brief before promoting.
- **code_check:** confirmed-present. **resolution:** — (keep).

## 5. Dialog-overlay checks (designed experience — L1 view, delta from baseline)

| Check | Baseline | Now | Evidence |
|---|---|---|---|
| Close = grounded, **correctable** read-back | half-fail keyless | **pass** — read-back waits; correction lands as stated facet; re-open exists | `intake.py:515-547`; `JdsIntakePanel.tsx:120-131` |
| Provenance honesty on scalars | fail | **pass** (chip + draft law + read-back), one residual: zero-signal family stamped "inferred" (L1-HRBP-13) | `JdsIntakeBriefPanel.tsx:134-141`, `intake-draft.ts:32-34` |
| Depth earned by ambiguity (shape) | miss (clinical idiom) | **still misses in English** — Czech inflections fixed (L1-EVA-2); "maternity cover"/"handed in her notice"/"same role" still route story | `intake.py:241-245` |
| One question/turn · reflect · reuse words · park · contradictions | encoded | unchanged, encoded — L2 hears it live | `intake.py:58-84` |
| Attachment provenance (new) | — | **pass** (inferred-until-confirmed; keyless never mined) | `intake.py:687-713,740-747` |

## 6. Verdict — **L1-conditional**

The distance travelled since 2026-08-07 is the story: of the baseline's four majors, two are fixed outright in code (default-seniority masquerade; uncorrectable close), one is substantially fixed with a narrowed residual (role_family — vocabulary + classifier landed, but the keyless classifier misses "Practice Nurse"-class titles and the family remains invisible/uneditable in her UI), and one landed **only at the API** (market-research opt-out — her Promote button still can't reach it, and the draft pane advertises the market read as inevitable). Two majors therefore stand: L1-HRBP-11 (fix not reachable) and L1-HRBP-12 (residual mis-bin, invisible). Neither blocks the walkthrough; both sit exactly on her adoption line ("if the comp read is in the wrong currency… I won't adopt"). The new attachments + Triptych + live-draft work is genuinely strong and built to her audit bar. L2-eligible; the two majors carry forward.

- **Grounding:** **15/16** (baseline 9/10)
- **Reachability:** all judged surfaces inside her binding (Library → Intake, internal dev-gated workspace; Triptych unconditional; keyless path first-class). No `unreachable` tags needed — except that L1-HRBP-11 is *itself* a reachability finding about a fix.

## 7. Time-saved estimate

- **Her baseline (manual):** ~1.5–2.5 h to shape a clinical role with the head nurse and draft the ad (intake/JD slice of her 8–12 h pipeline figure).
- **Designed experience now (keyless):** attach note + old JD (~3 min) + ~10 skippable questions (~10–15 min) + read-back correction that actually lands + in-place brief edit + promote. The live draft removes a separate "draft the ad" pass entirely.
- **Estimate: ~60–90 min saved per role · confidence medium** (up from ~45–90 · low-medium). What docks it from high: every UI promote still arrives with a Czech-market comp read she must strip (L1-HRBP-11), and a `general_professional` family steering the build's weights (L1-HRBP-12). Close those two and this firms to ~90 min · high — above her "<3 hours for shortlist+screen" adoption threshold for this slice.

## 8. In her voice — Priya Nair, three days after last time

"Someone read my last memo. I can tell, because the three things I flagged hardest are fixed *the way I'd have specified them*. I typed Band 5 again and this time it didn't write 'medior' and wear it like I said it — there's a line in the brief that says **Grade / level (as stated): Band 5, registered nurse**, my words, marked as mine, and the job draft simply declines to print a level it never heard. The read-back asked what it got wrong and — this is the part I tested twice — **the box stayed open**. My correction went in, on the record, with the turn number it came from. And there's a Re-open button now, and even that leaves an honest little note in the transcript saying the session was re-opened. That's not a chat toy. That's a record. I could hand it to an inspector.

"The new desk layout earns its keep too. I talk in the middle, the brief fills on the right, and on the left I watch the actual advert write itself out of my own answers — labeled a working draft, which is the correct amount of humility. I attached the old JD and the practice manager's note, and offline it told me straight: *I can't read these into the brief myself — paste the key points and they'll land as your words.* A tool that tells me what it can't do is a tool I'll believe when it tells me what it did.

"Now the two things still between us. First: the small print under my lovely draft says the final JD comes 'with market salary research'. There is, I'm told, a switch to turn that off now — on the server. There is no switch on my screen. So every advert I can actually produce still arrives wearing a Prague tech salary I'd have to unpick before a single nurse sees it. Building the override and not giving me the handle is the kind of fix that passes an audit and fails a user. Second: somewhere underneath, my practice nurse is no longer filed as a software engineer — progress — but she's filed as 'general professional', which is a filing cabinet, not a profession, and I can neither see that field nor change it. If the category steers the advert you build me, show me the category.

"Verdict, since you asked last time whether I'd adopt: last week the answer was 'not yet, fix the defaults'. This week it's 'nearly — put the two switches where I can reach them'. The bones were always built for everyone; now most of the defaults are too. Two handles short of a yes."

---

## L2 addendum — empirical pass, 2026-08-10 (live browser + live API, keyed host)

**Environment note that bounds everything below.** The reused dev server on :3000
reports `engines.gemini: true`. My two majors were both scoped by L1 partly to
the **keyless / deterministic** path — which cannot be exercised on a keyed host
without removing the workspace's key, out of scope for this pass. So one of my
two majors splits into a confirmed half and an untested half. I would rather say
that than claim a live proof I did not get.

### L1-HRBP-11 — CONFIRMED LIVE, two-arm proof

The cleanest "fix landed ≠ fix reachable" demonstration this run produced.

- **UI arm.** The entire promote area, live, is: `checkbox "Navrhnout rovnou i
  praktickou úlohu"` + `button "Vytvořit inzerát"`. There is no market-research
  control on the surface, in the draft pane, or in the edit sheet. And the draft
  pane states it as settled fact: „Finální inzerát (**včetně průzkumu mezd**)
  vznikne při Vytvořit inzerát." A browser-driven promote produced
  `options: {description:true, marketResearch:true, caseDesign:false}` and a JD
  carrying „**Mzda:** 103 000–154 500 CZK / month — Odhadnuto z interní tabulky
  mezd podle oborů (bez živých webových podkladů)".
- **API arm.** `POST /api/intake/{id}/promote {"marketResearch": false}` → 200,
  `options.marketResearch: false`, and the resulting JD has **no salary line at
  all**.

So the opt-out I asked for last run exists, works perfectly, and I cannot reach
it. Note also what the market layer actually is when it fires: an *internal Czech
salary table*, honestly disclosed as such. For a Band-5 nursing role in GBP that
is not a wrong number so much as a category error — and it is welded on.

### L1-HRBP-12 — split verdict

**Confirmed live: invisible and uneditable.** The Live brief renders `Role
Zdravotní sestra medior předpoklad` — title, seniority, its provenance chip, then
my context facets each tagged „řekli jste". No role family. The „Upravit zadání"
sheet exposes a title textbox, a seniority combobox (junior/medior/senior/lead),
a musts/nice-to-haves adder and free-form context rows — and **no roleFamily
control**. Meanwhile the stored brief for that exact session holds
`roleFamily: "healthcare_clinical"`. It is classified, it is threaded into the
build, and it is shown to nobody.

**Not reproduced live: the misclassification.** On this keyed host the LLM path
classified the Czech nurse corpus **correctly** as `healthcare_clinical`. L1's
executed reproduction was against the deterministic `classify_role_family` —
that claim stands on its code evidence, untested here. Honest position: on a
keyed workspace my nurse is classified right and I still cannot see it; on a
keyless one L1 showed she is classified wrong and I still cannot see it. The
missing field is the constant.

**New live detail.** A freshly created intake initialises
`brief.roleFamily = "software_engineering"` before a single word is spoken. An
intake abandoned early carries a software family silently.

### L1-HRBP-13 — could not be reproduced (uncertain, not refuted)

Across every live session inspected, `spineProvenance` contains only `title` and
`seniority` — `role_family` never appears on the LLM path, so the mislabelled
"inferred" chip has nothing to render from. It is a keyless-path residual. L2
neither confirms nor refutes it.

### L1-HRBP-15 — CONFIRMED LIVE, verbatim

Folded draft spine: `Zobrazit: Popis pozice` → **„Popis pozice 0"**, over a
draft holding a full role. And the convergent cluster grew: the **brief** spine
does the same thing — „Živé zadání 0" over a brief with a title, a seniority,
seven context facets and two success criteria (see L2-CONV-1). Two of three
spines badge zero on a rich session.

### Priya, first person — after seeing it live

"I came back to check on two handles. Neither of them exists, and now I have
watched the machine work without them.

The market read is the one that stings. I promoted a role and the posting came
back with a Czech salary band on it — properly labelled, from an internal table,
disclosed as not-live-web. Every part of that is honest. And there is no way for
me to say *not for this one*. Someone wrote the switch. I read its code in the
route. I cannot press it. That is a strange kind of frustration: not 'they didn't
build it', but 'they built it and left me on the wrong side of the glass'.

The family field is quieter and worse. My nurse was classified correctly this
time — good — and I have no way of knowing that from the screen, because the
screen never says it. I am asked to trust a category I cannot see, cannot
confirm, and cannot correct, and it goes on to steer the posting. Everything else
on that panel tells me where it came from: 'řekli jste', 'úsudek AI',
'předpoklad'. One field opted out of the whole convention by not appearing.

The dialogue itself is still the best I have used. It listened to 'Band 5' and
wrote it down in my words instead of translating it into its own. I would put a
line manager in front of it tomorrow. I still cannot put my name on the output,
and it is the same two handles as last time — which, after two runs, starts to
read as a decision rather than a backlog."

---

## Recertify addendum — 2026-08-10, after the fixes (`b54c451b`, `41cd5cc3`)

Targeted L2 only. Full diff report: [`recertify.md`](./recertify.md). Appended; nothing above is
edited.

### L1-HRBP-11 → **resolved-verified** (her second-run recurrence, closed)

Two arms, both driven through the UI in her working language:

- The control exists: `checkbox "Research the salary band" [checked]`
  (`shots/rc-market-off-promote-row.aria.txt:36`). Unchecking flips the working note to
  *"The final JD is generated at Create JD — without salary research, as you chose."* (`:42`).
- **Unchecked** (`intake-msn8w5pj-wt3p9t`) → JD `33ydgirz`, 4,434 chars, **no salary line at all**.
- **Checked** (control, `intake-msn943g0-xdeuya`) → JD `rheb7897` with
  `**Salary:** 45,000–70,000 CZK / month — Estimated from the internal role-family salary table`.

**Ceiling:** the only remedy is switching it off. There is still no GBP / Agenda-for-Change band;
the opt-out is per-promote and defaults **on**, so she must remember to untick every time; and
the tab's intro still promises "researching market salary on the web" unconditionally.

### L1-HRBP-15 → **resolved-verified**

Folded spines now read `Popis pozice · Návrh připraven`, `Živé zadání · 10 položek v zadání`,
`Rozhovor · 7 replik`. No spine badges its neighbour's contents. Ceiling: `briefItems` is one
number over three kinds, and "Návrh připraven" means *has content*, not *can be promoted*
(new finding L2-RC-1).

### L2-NEW-2 → **re-scored minor → major, `recurrence: 2`**

Not a fix under recertification — but it blocked this one. She named the dealbreakers three times
("a valid NMC registration", "a valid NMC pin and an enhanced DBS") and the brief ended with
`requirements: []` **and** `successCriteria: []`, which left `Create JD` **disabled**. The
recertify had to patch the brief through the API before it could promote at all.

### Refuted — `L2-RC-REF-1`

Her English UI first rendered three raw i18n keys where the new strings should be. It was a dev
server older than the commits (next-intl caches messages per locale); a restart rendered them
correctly. Recorded, with the precondition added to `env.md` — not counted against the fix.

### Priya, first person — third pass

"Last time I wrote that someone had written the switch, I had read its code in the route, and I
could not press it. I can press it now. It sits right there next to the case-design box, it is
one word away from plain — *Research the salary band* — and when I clear it the panel stops
telling me it is going to research a salary. Then the job description comes out with no pay line
at all, and that is exactly what I wanted: silence is honest, 45,000 CZK for a Leeds Band 5 is
not. I ran it both ways to be sure, and the only difference between the two documents was that
tick.

What I notice is that this is the *second* run where I raised it, and this time it came back
fixed within the day. That changes how I read the backlog — it now looks like a queue rather than
a decision.

Two things keep me honest about it. It defaults to on, which means the wrong-market number is
still the thing that happens if I am tired and click straight through — I would want a clinic
whose roles are never Czech to be able to say so once, not every time. And clearing the box is
not the same as getting a band; there is still nothing here that can price an Agenda-for-Change
role, so my compensation work is unchanged, only no longer contradicted.

The thing that actually cost me time this session was different: I said my dealbreakers three
times, in plain English, and the brief recorded none of them — and because of that the *Create
JD* button would not light up at all. A tool that cannot hear "a valid NMC pin is a dealbreaker"
is not going to be trusted with a safeguarding-sensitive hire. That is now the item standing
between me and adoption, not the salary switch."

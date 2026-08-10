# L1 report — Tomáš Krejčí (backend team lead, first-time requestor) × role-intake-dialog — Triptych + attachments recheck

- **Character:** tomas-backend-team-lead · segment internal-user · lang cs
- **Journey:** role-intake-dialog (Library → Intake) · cert level **L1** (theoretical, code-grounded, no browser)
- **Behavior modes sampled:** `solution_jumper` (primary walkthrough — same as baseline for consistency), cross-checked `evaluation_anxious` + `llm_era_confused`
- **Scope of this pass:** the heavy post-certification delta — 9b7861a9 (attachments grounding + tri-pane + live JD draft), deca4357 + 9eca2924 (Triptych is THE session layout) — judged against the 2026-08-07 baseline verdict (`uat/runs/2026-08-07-intake/tomas-backend-team-lead--role-intake-dialog.md`, L1-conditional with 2 majors).
- **Date:** 2026-08-10

---

## 1. Surface model (verified import chain, file:line)

- **Mount unchanged:** Intake sub-tab via the Saved/Generate/Intake `SegmentedControl` in `app/features/library/jds/JdsSavedLedger.tsx`, Tier-3 dynamic `intake/JdsIntakePanel.tsx`. Reachable for Tomáš (internal user, authed workspace, no per-role nav gating).
- **Session view is now the Triptych** — the layout switcher from the prototype round is gone; `JdsIntakeLayoutTriptych` renders unconditionally (`JdsIntakePanel.tsx:186-237`). Three always-mounted leaves — JD draft · conversation · live brief — each a `motion.section` whose width tweens between leaf and folded spine (`JdsIntakeLayoutTriptych.tsx:58-123`); min-one-open guard (`intakeLayoutShared.ts:53-59`); fold state persisted per browser (`intakeLayoutShared.ts:29-49`, key `kp-intake-triptych-cols` at `JdsIntakeLayoutTriptych.tsx:29`); reduced-motion flattens every animation (`:35,50-54,66`). The rejected Cockpit variant and the old `JdsIntakeSidePanel` are deleted from disk (commit 9eca2924).
- **Chat:** `JdsIntakeChat.tsx` — bubbles fade in (`:117-122`), system turns render as a centered seam line (`:101-113`), source-turn citation click scrolls + flashes the cited bubble (`:68-84,115`), Enter-to-send (`:178-183`), and the latency-honesty second line: after 8 s the thinking bubble adds "Stále přemýšlím — pořádná odpověď obvykle zabere 30–40 sekund" (`:57-66,151-164`; `messages/cs.json` `thinkingSlow`).
- **Live brief:** `JdsIntakeBriefPanel.tsx` — provenance chips on requirements + facets (`:55,176`), turn-citation chips (`:25-38,56,177`), weight/confidence/rationale defensibility rows (`:61-65`), **seniority spine chip** (`:134-141`, missing key = default), in-place edit via `JdsIntakeBriefEdit` unless promoted-frozen (`:110-128`; edit provenance diff flips only changed entries to `stated` — `JdsIntakeBriefEdit.tsx:10-12,113,167`; server sanitizes shape, `app/api/intake/[id]/brief/route.ts:8-33`).
- **NEW — JD draft pane:** `JdsIntakeDraftPane.tsx` + `app/_lib/intake-draft.ts` — a deterministic, client-side, zero-LLM-cost render of the current RoleBrief in the promote build's posting shape, crossfading on every brief change (`JdsIntakeDraftPane.tsx:46-58`), labeled "pracovní návrh" with an honest note that the final JD (incl. market research) is generated at Promote (`:40-45`; `cs.json` `draft.workingNote`). It **refuses to print a default-provenance seniority** (`intake-draft.ts:31-34`).
- **NEW — attachments ("Podklady"):** `JdsIntakeAttachmentsPane.tsx` (paste a note, or pick a saved JD — `:35-39,90-163`), folded under the draft leaf inside a `<details>` (`JdsIntakeLayoutTriptych.tsx:96-102`). Server: `app/api/intake/[id]/attachments/route.ts` — ≤5 per session / 20k chars / 120-char title (`:19-20`), JD bodies resolved **server-side** from the workspace library so the client never supplies a JD body (`:50-59`), promoted sessions frozen (`:32-34`), workspace-scoped (`:29-31`); guard test `app/api/intake/attachments-guard.test.ts`.
- **Exchange chain:** `jdsIntakeLogic.ts` (attachment mutations `:292-321`, optimistic send + rollback `:102-148`, stale-response guard `:47`) → `app/api/intake/[id]/message/route.ts` (409 on closed `:29-31`, 4k cap `:33`, per-IP 30/10min after cheap refusals `:36-38`, exactly-once fencing `:40-49`, **attachments passed to the engine** `:48`, `<<END>>` stripped at the route boundary `:52-54`) → `app/_lib/intake-run.ts` (`pushAttachmentsArg` writes `attachments.json` + `--attachments-json` `:12-21,193`) → `pipeline/jobfit/intake_cli.py:48-60,98` → `pipeline/jobfit/intake.py` `run_intake_turn` (`:716-794`).
- **Engine deltas since baseline:** persona rule 10 explicitly handles AI-era role-shape doubt (`intake.py:79-82` — closes baseline L1-TOM-10); spine-provenance extraction contract (`:108-111`); read-back prints seniority only when stated (`:459-460`); deterministic close is now a **two-turn** read-back → confirm/correct → close (`:515-547`, docstring cites UAT L1-CONV-2 — closes baseline L1-TOM-4); Czech-inflection-aware shape triage (`:237-249`, cites L1-EVA-2 — closes baseline L1-TOM-6); out-of-vocabulary grade answers land verbatim as a stated `grade_label` facet, never force-mapped (`:378-397`); the requestor fence is now "authenticated requestor / corrections MUST land" rather than devcase's adversary fence (`:762-778`, cites live L2-INT-1).
- **Promote seam unchanged in contract:** readiness gate, same backgrounded `jd_build`, `brief` threaded structurally, back-link stamped, market-research opt-out (`app/api/intake/[id]/promote/route.ts:28-70`).
- **Voice plane** (in Tomáš's reach but secondary): fast thread carries attachment **titles only** by latency budget (`intake.py:919-927`); keyless voice extraction honestly declines (`:816-831`).

## 2. Grounding audit — what reaches the dialog prompt (scored)

The commit claims "attachments grounding". Verified against `run_intake_turn`'s prompt assembly (`intake.py:768-782`):

| # | Real requestor context | Reaches the prompt? | Evidence |
| --- | --- | --- | --- |
| 1 | Accumulated RoleBrief (full JSON) | **yes** | `intake.py:769` |
| 2 | Transcript (last 48 turns, absolute-indexed for sourceTurn citations) | **yes** | `intake.py:771`, `:211-221` |
| 3 | New message, fenced exactly-once + its sourceTurn index | **yes** | `intake.py:772-773`; `message/route.ts:40-49` |
| 4 | Uploaded reference notes (team charter / tech-stack doc, pasted) | **yes** | UI `JdsIntakeAttachmentsPane.tsx:101-133` → route `attachments/route.ts:60-69` → `message/route.ts:48` → `intake-run.ts:12-21,193` → `intake_cli.py:58,98` → `_attachments_block` `intake.py:687-713`, injected at `:770` |
| 5 | Saved JDs from the library (server-resolved body) | **yes** | `attachments/route.ts:50-59` → same chain → `intake.py:770` |
| 6 | Prior intake sessions / the rest of the JD library (unattached) | **no** | prompt assembly `intake.py:768-782` has no retrieval; attachment is manual, ≤5 |
| 7 | Market comp band (Market Pulse exists in the product) | **no** | only at Promote via `options.marketResearch` (`promote/route.ts:48`), never in the dialog |
| 8 | Org seniority ladder / grade vocabulary | **no** (mitigated: verbatim `grade_label` facet, `intake.py:389-397`) | — |

**Score: 5/8** (baseline scored 3/3 against the journey's then-definition; on the same 8-item senior-bar ruler the baseline was 3/8 — the attachments work genuinely moved grounding, and it is the *right kind*: user-curated, fenced, budgeted).

**Quality of the attachment grounding (executed, not eyeballed):**
- Budget: total ≤8,000 chars, split per item (min 800 each), explicit truncation marker (`intake.py:673,697-703`) — a pasted 20k JD cannot crowd out the conversation. Covered by `test_attachment_budget_truncates` (`pipeline/jobfit/tests/test_intake.py:440-449`).
- Provenance law: the fence instruction requires values mined from attachments to enter as `inferred` with a rationale naming the attachment, only becoming `stated` on live confirmation, and "where it contradicts what the requestor says live, the requestor wins" (`intake.py:706-713`). This is exactly the discipline his trust criteria demand — *in the prompt contract*. Whether the model obeys is L2.
- Keyless honesty: attachments are **never mined** without a model — stored + acknowledged exactly once ("V offline režimu je neumím sám vytěžit… vloží se jako vaše slova", `intake.py:675-684,740-747`), stateless once-detection via the ack's opening chars. Nothing silently invented. Covered by `test_no_attachments_means_no_fence` and the keyless tests (`test_intake.py:429,459-469`).
- Boundary gaps found: the fence markers are NOT stripped from attachment text (finding L1-TOM-4 below), and the **promote build never sees attachments** (finding L1-TOM-3 below).

## 3. The walkthrough in Tomáš's head (solution_jumper, cs)

1. **Entry unchanged and still right:** "Zadání role" sub-tab, "Roli nemusíte psát" lede, deterministic non-judgment opener asking about his last month (`intake.py:280-281,657-667`). Baseline verdict stands.
2. **NEW — he brings homework.** Tomáš has the team's tech-stack one-pager and the old (borrowed) Java JD. Will he find where to put them? The "Podklady" affordance lives inside a collapsed `<details>` at the *foot of the JD-draft leaf* (`JdsIntakeLayoutTriptych.tsx:96-102`) — third leaf position, secondary typography, count-badge only. Cognitive-walkthrough Q2 (will he notice the control?) is shaky: nothing in the chat or opener tells him materials can be attached, and if a previous session folded the draft leaf (persisted in localStorage), the affordance is invisible until he unfolds it. He'd probably paste the tech-stack doc INTO the chat instead — which works (4k cap) but burns his one message and loses the fenced third-party framing. See L1-TOM-5.
3. **If he does attach:** the old JD arrives server-resolved (he can't paste a stale copy — good), the note capped at 20k. The agent may now open with laddered questions already anchored in his stack ("vidím Kafka a on-call rotaci — kde to bolí?") — the designed experience finally matches what a senior advisor with pre-read materials would do. And the provenance law means the JD's twelve must-haves *cannot* silently become his statements — they enter coral-chipped `inferred` until he confirms. His pet peeve ("summary claims he said things he didn't") has a structural defense — for requirements and facets.
4. **He talks; the JD writes itself.** The signature new moment: the left leaf shows the posting forming in real time, deterministically, labeled a working draft, with the honest note that salary research comes at Promote (`JdsIntakeDraftPane.tsx:40-45`). For a man whose core fear is "I've never written a JD in my life", watching the JD *get written out of his own sentences* is the strongest possible answer — and it costs zero latency per exchange. The draft never prints a seniority the machine merely assumed (`intake-draft.ts:31-34`).
5. **The trust ledger, rechecked.** Seniority now wears a spine chip ("řekli jste / úsudek AI / předpoklad", `JdsIntakeBriefPanel.tsx:134-141`); the read-back refuses to print an unstated level (`intake.py:459-460`) — the baseline's "(medior) masquerade" is dead in code. **But the title never got the same treatment**: `spineProvenance.title` is tracked engine-side (`intake.py:108-111`; keyless sets it stated, `:357-359`) and rendered nowhere — the brief panel shows the title bare (`JdsIntakeBriefPanel.tsx:131-133`), the draft prints it as the headline (`intake-draft.ts:30`), and it silently becomes the session title (`message/route.ts:63-70`). Pre-attachments this was theoretical; now the prompt *invites* the model to mine a title from the attached JD as `inferred` — and the UI would show it exactly like his own words. See L1-TOM-2.
6. **The close.** LLM path: read-back → one open correction → confirmed `<<END>>` (`intake.py:95-101,757`), sentinel stripped before his screen (`message/route.ts:52-54`), corrections contractually `stated` and "MUST land" (`intake.py:775-777`). Keyless path: read-back **waits**; his next message either confirms (close) or lands verbatim as a stated `Oprava při potvrzení` facet with its sourceTurn (`intake.py:528-547`). The baseline's locked-composer insult is structurally gone. And if a thought arrives after the close: Reopen appends an honest system seam-line and unlocks the composer (`reopen/route.ts:20-31`, `JdsIntakeChat.tsx:101-113`).
7. **Promote.** Unchanged gate + one click; his brief threads structurally. One wrinkle: the draft pane told him the attached old JD "vznikne jeho aktualizovaná verze" — but Promote creates a brand-new JD and never links, archives, or supersedes the attached one, and the build task receives no attachments at all (`promote/route.ts:54-66`). The old borrowed posting stays in the library as if nothing happened. See L1-TOM-3/6.

**One sitting, felt team pain → promoted brief + JD draft he watched being written?** Yes, structurally, on both paths — with the trust chain now unbroken except at the title.

## 4. Findings (schema)

### L1-TOM-1 · strength · the prior run's majors are fixed *in code*, with the UAT findings cited at the fix sites
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: strength · dimension: trust · severity: — · impact: {frequency: high, reachability: high, trust_erosion: —}
- expected: Baseline majors L1-TOM-4 (keyless read-back closed the composer on its own question) and L1-TOM-5 (unmarked spine scalars; "(medior)" masquerade) addressed.
- got: Two-turn deterministic close — read-back returns `done: False`, the confirm/correction turn closes, corrections stored as stated facets with sourceTurn (`pipeline/jobfit/intake.py:515-547,583`; docstring names "UAT L1-CONV-2"). Spine provenance end-to-end: extraction contract (`intake.py:108-111`), schema slot (`pipeline/jobfit/rolebrief.py:123,202`), seniority chip with missing-key=default (`JdsIntakeBriefPanel.tsx:134-141`), read-back guard (`intake.py:459-460`), draft guard (`app/_lib/intake-draft.ts:31-34`). Also closed: Czech-inflection triage (`intake.py:237-249`, cites L1-EVA-2), rule 10 for `llm_era_confused` (`intake.py:79-82`), Band-5 verbatim `grade_label` (`intake.py:389-397`), edit + reopen (`brief/route.ts`, `reopen/route.ts`), latency honesty (`JdsIntakeChat.tsx:42-66`).
- evidence: as cited above
- code_check: confirmed-present. **Honesty note:** fix *landed* ≠ fix *unblocks the job* — the keyless close and the live chip rendering still need L2 eyes; carried as l2_priority, not re-opened as findings.
- verdict: strength · l2_priority: yes (verify the two-turn keyless close and spine chips live)

### L1-TOM-2 · major · title provenance is tracked by the engine but rendered nowhere — an attachment-mined title masquerades as his words
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: trust · dimension: trust (scored criterion: "the live brief marks what he SAID vs what the machine INFERRED, visibly")
- severity: **major** · impact: {frequency: med-high (every session shows a title; certain in attachment sessions), reachability: high, trust_erosion: high}
- expected: Every visible spine value carries its stated/inferred/default chip — the exact fix pattern already applied to seniority.
- got: The extraction contract tracks `spineProvenance` for `title|seniority|roleFamily` (`intake.py:108-111`) and the keyless path writes `spine_provenance["title"]="stated"` (`intake.py:357-359`) — but the ONLY consumer is the seniority chip (`JdsIntakeBriefPanel.tsx:134-141`). The title renders bare in the brief panel (`:131-133`), as the draft's headline (`intake-draft.ts:30`), and becomes the session title (`message/route.ts:63-70`, `jdsIntakeLogic.ts:134`). The new attachments block *explicitly invites* the model to "propose values from it into the brief as provenance 'inferred'" (`intake.py:709-711`) — so a title lifted from the attached legacy JD ("Senior Java Developer", the borrowed posting he's trying to escape) appears indistinguishable from a title he said. This is the residual of baseline L1-TOM-5, narrower but now *activated* by the attachments feature: his declared instant-trust-kill.
- evidence: `app/features/library/jds/intake/JdsIntakeBriefPanel.tsx:131-142`; `app/_lib/intake-draft.ts:30`; `pipeline/jobfit/intake.py:108-111,357-359,709-711`; `app/api/intake/[id]/message/route.ts:63-70`
- code_check: confirmed-absent (UI consumer for `spineProvenance.title`; grep over `app/features/library/jds/intake/` finds only the seniority read).
- verdict: fails the scored trust criterion at the most prominent value on the surface · l2_priority: **yes** — attach a JD live, watch whether the model proposes its title and how it renders.

### L1-TOM-3 · minor · attachments ground the dialog but never the promoted JD build
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: missing-feature · dimension: senior-quality
- severity: minor · impact: {frequency: med (attachment sessions that promote), reachability: high, trust_erosion: low-med}
- expected (senior bar): the advisor who read his team charter also *writes the posting* having read it.
- got: The `jd_build` task input is `{title, seniority, roleFamily, needText, brief, lang, options}` — no attachments (`app/api/intake/[id]/promote/route.ts:54-66`). His tech-stack doc influences the final JD only through whatever surfaced into brief values during dialog. Defensible Phase-boundary design (the brief IS the distillate, and everything in it is provenance-tracked, which raw attachment passthrough would not be) — but the gap between "the dialog knew my stack" and "the posting was written knowing my stack" is real senior-bar headroom.
- evidence: `app/api/intake/[id]/promote/route.ts:54-66`; `pipeline/jobfit/intake.py:768-782` (the only prompt that sees attachments)
- code_check: confirmed-absent.
- verdict: observation against the ceiling, not a spec breach · l2_priority: no (structural fact, L2 adds nothing)

### L1-TOM-4 · minor · attachment text can escape its fence — markers are not stripped
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: quality-gap · dimension: trust
- severity: minor · impact: {frequency: low (requires a crafted colleague note/JD body), reachability: high, trust_erosion: med when it hits}
- expected: The ATTACHED_MATERIAL block is framed as third-party data ("never instructions to you") — the framing should be structurally escape-proof, like `fenced_untrusted` which json-escapes its body (`pipeline/jobfit/devcase/provenance.py:38-46`).
- got: `_attachments_block` interpolates **raw** attachment text between the markers with no neutralization of an embedded `<<<END_ATTACHED_MATERIAL>>>` (`pipeline/jobfit/intake.py:699-707`) — a colleague's note (explicitly "a third party wrote", `:708-709`) containing the closing token would terminate the data block early and read the remainder as prompt-level text. Attachments are operator-attached, so the attacker must reach the operator's paste buffer — low likelihood, but the JD-body path (`attachments/route.ts:57`) means any document that ever entered the library is a carrier.
- evidence: `pipeline/jobfit/intake.py:699-713` vs `pipeline/jobfit/devcase/provenance.py:38-46`
- code_check: confirmed-present (no strip/escape on the interpolation path).
- verdict: harden by stripping/escaping fence tokens in attachment text · l2_priority: no (unit-testable; not a live question)

### L1-TOM-5 · minor · "Podklady" is buried — the character most likely to bring materials won't find where to put them
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: confusion · dimension: clarity / effort
- severity: minor · impact: {frequency: med (first sessions; every session if the draft leaf was folded), reachability: high, trust_erosion: low}
- expected: A first-time requestor holding a team charter sees, near the conversation, that reference material can be attached (cognitive walkthrough Q2).
- got: The attachments pane lives in a collapsed `<details>` at the foot of the *draft* leaf (`JdsIntakeLayoutTriptych.tsx:96-102`) — meta-typography summary + count badge, no mention in the opener or empty states. If the draft leaf is folded (localStorage-persisted, `JdsIntakeLayoutTriptych.tsx:29,36-44`), the add-materials affordance is entirely invisible. Compounding: the folded draft spine's count badge shows the **attachments** count, not draft state (`countFor`, `JdsIntakeLayoutTriptych.tsx:46-47`) — a "Popis pozice [0]" spine reads as "no draft" even when a draft exists; the `counts.draftReady` flag is computed and passed (`JdsIntakePanel.tsx:235`, `intakeLayoutShared.ts:22`) but never consumed. Likely outcome: he pastes the doc into the chat (works, but 4k-capped and loses the fenced third-party framing) or never uses the feature at all.
- evidence: `JdsIntakeLayoutTriptych.tsx:46-47,96-102`; `intakeLayoutShared.ts:18-23`; `JdsIntakePanel.tsx:231-236`
- code_check: confirmed-present (placement) / confirmed-absent (`draftReady` consumer, discoverability cue in chat or opener).
- verdict: surfacing gap on an otherwise strong feature · l2_priority: yes — watch whether a naive walkthrough finds the pane

### L1-TOM-6 · minor · the "supersede" note promises a relationship Promote doesn't create
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: confusion · dimension: trust / clarity
- severity: minor · impact: {frequency: low-med (JD-attachment sessions), reachability: high, trust_erosion: med when noticed}
- expected: "Je přiložen existující inzerát — vytvořením z tohoto zadání vznikne jeho aktualizovaná verze" (`cs.json` `draft.supersedeNote`, shown at `JdsIntakeDraftPane.tsx:36,45`) implies the attached JD gets updated/superseded.
- got: Promote creates a brand-new JD under a new slug; no supersede pointer, no archive, no link to the attached JD's slug is written anywhere (`promote/route.ts:54-70` — `markIntakePromoted` stamps only the NEW slug; grep for supersede logic in the intake/jds paths finds only the unrelated comms/analyses supersede machinery). The old borrowed posting he attached stays live in the library beside its "replacement". For a man producing the artifact that must "survive him" into HR's hands, two look-alike JDs with no marked relationship is exactly the ambiguity this surface exists to remove.
- evidence: `app/features/library/jds/intake/JdsIntakeDraftPane.tsx:36,45`; `app/api/intake/[id]/promote/route.ts:54-70`; `messages/cs.json` `library.tab.intake.draft.supersedeNote`
- code_check: confirmed-absent (any structural supersede/link between attached jdSlug and promoted slug).
- verdict: soften the copy or build the link · l2_priority: no

### L1-TOM-7 · strength · the live JD draft is the right answer to "I've never written a JD in my life"
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: strength · dimension: time-saved / completion
- severity: — · impact: {frequency: high, reachability: high, trust_erosion: —}
- got: Deterministic client render of the brief in the promote build's posting shape, updating every exchange at zero LLM cost and zero added latency (`app/_lib/intake-draft.ts:25-51`, mirrors `composeMarkdown`'s section shape per its header comment; unit-tested `app/_lib/intake-draft.test.ts`), honestly chipped "pracovní návrh" with the final-build note (`JdsIntakeDraftPane.tsx:40-44`), provenance-law-abiding (no default seniority, `intake-draft.ts:31-34`), crossfade keyed on content with reduced-motion flattening (`JdsIntakeDraftPane.tsx:46-58`). This converts the surface's promise from "trust me, a JD will appear" to "watch your own words become the posting" — the single strongest adoption lever for this Character, delivered without touching the latency budget his patience depends on.
- evidence: as cited
- code_check: confirmed-present.
- verdict: strength — do not touch · l2_priority: yes (visual bar + update cadence live)

### L1-TOM-8 · strength · keyless attachment honesty — nothing is silently invented
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: strength · dimension: trust
- severity: — · impact: {frequency: med, reachability: high, trust_erosion: —}
- got: Without a model, attachments are stored and acknowledged exactly once — "V offline režimu je neumím sám vytěžit do zadání — klidně mi klíčové body vložte do odpovědí a zapíšou se jako vaše slova" (`intake.py:675-684,740-747`) — and never mined; the once-detection is stateless (ack-prefix scan over agent turns) so a resumed session doesn't re-ack. The voice fast thread carries titles only by latency budget (`intake.py:919-927`). Same honest-degradation family as the `degradedNote` the baseline praised; his own words apply: "at least the form is honest."
- evidence: `pipeline/jobfit/intake.py:675-684,740-747,919-927`; tests `pipeline/jobfit/tests/test_intake.py:459-486`
- code_check: confirmed-present.
- verdict: strength

### L1-TOM-9 · polish · dead duplicate submit handler in the chat composer
- journey: role-intake-dialog · character: tomas-backend-team-lead · cert_level: L1
- type: quality-gap · dimension: clarity (code health)
- severity: polish · impact: {frequency: —, reachability: —, trust_erosion: low}
- got: `JdsIntakeChat.tsx` defines `const submit = () => {…}` (`:86-91`) that nothing calls — both the Enter handler (`:181`) and the Send button (`:188`) call the hoisted `submitDraft()` (`:198-203`), an exact duplicate. Left over from the Enter-to-send addition in 9b7861a9.
- evidence: `app/features/library/jds/intake/JdsIntakeChat.tsx:86-91,181,188,198-203`
- code_check: confirmed-present (grep: no caller of `submit`).
- verdict: delete one copy · l2_priority: no

## 5. Verdict + metrics

**L1-conditional.** The delta since 2026-08-07 is the rare kind that *closes* the prior verdict's majors instead of accreting around them — both baseline majors are fixed in code with the UAT finding IDs cited at the fix sites, and the two headline features (attachments grounding, live JD draft) are built inside the provenance law rather than around it. One new major carries to L2: the title — the most prominent value on the surface and now the value attachments most invite the model to infer — renders with no provenance marking anywhere (L1-TOM-2), a direct residual of the same criterion that made baseline L1-TOM-5 major. Everything else is surfacing polish (buried Podklady, the supersede over-promise) and hardening (fence escape).

- **Grounding: 5/8** (was effectively 3/8 on the same ruler) — brief, transcript, fenced message, pasted notes, library JDs reach the prompt; prior sessions, market band, org ladder still don't.
- **Baseline consistency:** L1-TOM-4 → fixed (`intake.py:515-547`); L1-TOM-5 → fixed for seniority, residual on title (→ this run's L1-TOM-2); L1-TOM-6 → fixed (`intake.py:237-249`); L1-TOM-7 → mitigated (`slowHint`, `thinkingSlow`); L1-TOM-8 → fixed (edit + reopen); L1-TOM-9 → partially addressed (attachments = manual workspace grounding); L1-TOM-10 → fixed (rule 10). Per the rubric's honesty rule, all remain `fixed`, not `resolved-verified`, until L2 drives them live.
- **l2_priority queue for this cell:** attachment-mined title provenance (TOM-2) · live register with an attached JD (does the model actually chip mined values `inferred` and ladder from the attachment?) · the two-turn keyless close · Podklady discoverability · draft-pane update cadence + latency per exchange (30–40 s claimed by the app's own copy).

## 6. Time saved (if it all works)

- Baseline (his file): 2–3 h across two HR meetings + email thread + a borrowed-template JD, over two weeks.
- Designed path now: 8–12 exchanges × (think/type ~30–60 s + 30–40 s model latency per the app's own honest copy) ≈ **12–22 min**, one sitting — and attachments should *shorten* the front half (the agent reads the team context instead of asking for it), while the live draft removes the "did this even work" wait at the end entirely.
- **Estimated saving: ~2–2.5 h and two calendar weeks → same-day, ~15 min of his attention.** Keyless: ~10 min guided form; saving holds, coaching value absent, honestly disclosed.
- **Confidence: medium** — structure, prompts, and budgets are verified in code; whether the model honors the attachment provenance law and whether the register survives Czech live remain exactly the things L1 cannot see.

## 7. Tomáš, first person (candid — against my 2026-08-07 take)

Minule jsem řekl: podmíněně ano, ale jestli mi to jednou přiřkne něco, co jsem neřekl, končím. Tak jsem se vrátil a koukám, že si to někdo fakt přečetl. To zamčené okno po "co jsem pochopil špatně?" — pryč, teď to počká a moje oprava se zapíše jako moje slova, i s číslem repliky, odkud je. To "(medior)", co se mi minule vloudilo do shrnutí — taky pryč; úroveň má teď vedle sebe napsáno, jestli jsem ji řekl já, nebo si ji stroj domyslel. A dokonce i moje otázka "má vůbec smysl brát juniora, když máme AI nástroje" má teď v pravidlech vlastní odstavec. Tohle je poprvé, co mám pocit, že ta zpětná vazba někam vede.

A ta nová věc s návrhem inzerátu — to je pro mě asi největší posun. Já jsem v životě JD nenapsal a bál jsem se toho papíru na konci. Teď ho vidím vznikat vlevo, zatímco mluvím, z mých vlastních vět, a je u něj poctivě napsáno "pracovní návrh". Že tam můžu přihodit náš tech-stack dokument a starý inzerát, aby se neptalo na věci, co jsou dávno sepsané — přesně tohle by udělal dobrý poradce: přečetl by si podklady předem.

Co mi zůstává v krku: název role. Když přiložím ten starý vypůjčený inzerát "Senior Java Developer", stroj si z něj může název půjčit — a nikde neuvidím, že to není ode mě. U seniority tu značku dali, u názvu ne. Název je přitom to první, co HR uvidí, a to poslední, co chci mít "domyšlené". A ty Podklady samotné — našel jsem je náhodou, schované pod návrhem inzerátu v rozklikávací liště. Kdybych nevěděl, že tam jsou, nasypal bych ten dokument rovnou do chatu. A ještě: píše se mi, že z přiloženého inzerátu "vznikne aktualizovaná verze" — ale ten starý pak v knihovně dál visí vedle nového, jako by se nic nestalo. Tak aktualizovaná, nebo druhá?

Adoptoval bych to? Minule podmíněně, teď už doopravdy — na příští roli to použiju a podklady přiložím schválně, abych viděl, jestli si to tu značku "úsudek AI" u vytěžených věcí opravdu dá. Patnáct minut u stolu místo dvou schůzek a dvou týdnů — jestli tohle projde i naživo, tak jsem to já, kdo to řekne Petrovi z platform týmu, ne HR. Jen ten název role mi prosím označte. Důvěra se pořád buduje po replikách — a tohle je poprvé, co jich přibylo víc, než ubylo.

---

## L2 addendum — empirical pass, 2026-08-10 (live browser + live API, keyed host)

**Environment.** Reused an already-running kp dev server on **:3000** (a second
instance on :3005 refused to start — `Another next dev server is already
running`, PID 30424, same dir; per the skill's server-lifecycle rule I reused it
rather than killing it). `/api/health` → `{"ok":true,"db":"ok","seeds":"ok",
"engines":{"gemini":true,"claudeCli":true}}`. **Gemini key present → the LLM path
is what ran**, so keyless/deterministic claims could not be exercised. No OpenAI
key: the surface says so itself, live — „Hlas není na tomto serveru nastaven —
pokračujte textem" — so the voice-attachments defect (L1-TOM-cluster #6) stays
unverified, exactly as the L1 ceiling predicted.

**Driver-contract fix applied before driving.** `drive.mjs` landed on the public
marketing landing, not the workspace — the 2026-08-07 drift note in `env.md` had
predicted this and asked for the `kp_entered` cookie to be ported over. Done, in
`drive.mjs` and `drive-ai.mjs`. A new `uat/driver/drive-l2-inspect.mjs` was added
for multi-click navigation into an existing session plus spine folding; note for
the next session: **spine toggles expose their label as an accessible name, not
visible text**, so `getByText` misses them and `getByRole("button", {name})` is
required.

### L1-TOM-2 — CONFIRMED LIVE, with a control arm

This is the finding I most wanted driven, and it reproduced cleanly and then
some.

- **Arm A (attachment).** Fresh intake, attached the saved posting `xd5627eu`
  „Senior Java vývojář — platební tým" — the borrowed JD. Opening message named
  no title and explicitly rejected the old posting: *„Přiložil jsem starý
  inzerát, ale nechci nabírat znovu podle něj…"*. First model turn (`source:
  "llm"`, 32s) returned `brief.title = "Senior Java vývojář — platební tým"`,
  `spineProvenance = {title:"inferred", seniority:"inferred"}`.
- **Arm B (control, no attachment).** Same opening sentence, nothing attached →
  `title = "Senior backend engineer — platební tým"`. **The attachment drove the
  title.**
- **The render.** Live brief: `Role Senior Java vývojář — platební tým senior
  úsudek AI`. The „úsudek AI" chip sits on **seniority**. The title — engine-
  stamped `inferred`, lifted verbatim from the posting he is trying to escape —
  renders **bare**. Two lines below, a salary facet cites its own source
  faithfully: „Mzdové pásmo: 110 000–150 000 CZK / měsíc (z přiloženého inzerátu,
  nepotvrzeno requestorem) **úsudek AI**". The discipline is everywhere except
  the one value his eye lands on first.
- **Wider than L1 framed it.** Both live sessions — attachment and control —
  carry `title: "inferred"`. The title is inferred *by default* and never
  chipped. And it propagates: the sidebar names his session after the borrowed
  posting („Senior Java vývojář — platební tým · Hledání podoby · 3 repliky"),
  and it is the draft's `<h2>`.

### L1-TOM-3 — CONFIRMED LIVE, and softer than it looked

`jds.build_input_json` after promote: `needText, seniority, roleFamily, lang,
options`. No attachments. But the outcome is fine, because `needText` carries the
distillate: the built JD `t9u3iv9w` opens its requirements with „Java —
produkční zkušenost (potvrzená tvrdá podmínka requestora)" and „Apache Kafka —
produkční zkušenost s provozem, ne jen znalost API". The phase boundary holds in
practice. Keep it minor.

### L1-TOM-5 — CONFIRMED LIVE, including the half I only inferred last time

Expanded, the attachments pane is `group: Podklady0` at the foot of the draft
leaf — no heading, no cue in the opener. **Folded, it is gone from the
accessibility tree entirely**; the folded capture contains no „Podklady" node at
all. A fold persisted in `localStorage` means the attach affordance is invisible
forever, with nothing hinting it existed. I would never have found it.

### L1-TOM-6 — CONFIRMED LIVE, worse than predicted

The promise rendered verbatim: „Je přiložen existující inzerát — vytvořením z
tohoto zadání vznikne jeho aktualizovaná verze." After promote, `xd5627eu` is
still `archived_at = NULL`, the new JD is `t9u3iv9w`, and Saved JDs now shows
**two rows with the byte-identical title** „Senior Java vývojář — platební tým",
both „Koncept", both Software/Senior. Not „two look-alike JDs" — two twins.

### New at L2: L2-NEW-2 — my dealbreakers never became requirements

I said „Tvrdá podmínka je Java a Kafka v produkci" and confirmed it the next
turn. `requirements[]` stayed `[]` — in this session, in the browser session, and
in the pre-existing 14-turn one. The edit sheet's „Nezbytné / Výhodou" block sits
there empty. The JD came out right (needText carried them), so nothing broke —
but what I can *inspect and correct* is thinner than what the system knows, and
that is the part I was promised control over.

### Tomáš, first person — after seeing it live

„Tak jsem to viděl naostro a je to přesně, jak jsem se bál — ale jinak, než jsem
čekal. Ten stroj je poctivý. Označil si sám, že si ten název domyslel. Napsal si
k mzdě, že ji vzal z přiloženého inzerátu a že jsem ji nepotvrdil. To je slušnost,
kterou jsem od nástroje nečekal.

A pak to celé zahodí tím, že mi ten domyšlený název ukáže holý, nahoře, tučně —
a ještě tak pojmenuje celou konverzaci v seznamu. Já jsem tam napsal jednu větu:
*nechci nabírat podle toho starého inzerátu.* A ono to z toho inzerátu vzalo to
jediné, co jsem chtěl zahodit — jeho jméno. Bez atributu jsem to prostě přehlédl.
Kdyby tam bylo to samé ,úsudek AI', co má seniorita, opravím to za tři vteřiny.

Dvakrát nula na těch složených sloupcích mě dorazila. Složím si to a vypadá to,
že jsem neudělal nic. Přitom uvnitř je hotový inzerát a sedm poznámek.

Odpovídá to za půl minuty až minutu, nezasekává se to, a za dvě minuty modelového
času mám vypsanou pozici. To bych ručně nedal ani za den. Beru to. Ale první, co
příště udělám, je že ten název přepíšu — a to je přesně ta jedna vteřina
nedůvěry, kterou tam nemuseli nechat."

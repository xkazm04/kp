# L1 report — Eva Marešová (eng hiring lead) × role-intake-dialog

- run: 2026-08-10-intake-triptych · level: **L1 (theoretical, code-grounded — no browser)**
- character: `uat/characters/eva-eng-hiring-lead.md` · behavior mode sampled: `power_unit` shape + `over_specifier`
- journey: `uat/journeys/role-intake-dialog.md` · language: cs
- scope of this pass: the intake surface **after** commits `9b7861a9` (attachments grounding + tri-pane + live JD draft), `deca4357` + `9eca2924` (Triptych consolidated as THE session layout), judged against the 2026-08-07 baseline + its recertify (`../2026-08-07-intake-recertify/report.md`)
- verdict: **L1-pass**

---

## 0. Consistency with the 2026-08-07 baseline (what got resolved)

Every major I raised last time is now closed in code, and three of four were already
**resolved-verified live** in the recertify pass:

| Prior finding | Status now | Code evidence |
|---|---|---|
| L1-EVA-1 — close refuses its own invited correction | **resolved** (recertified live: reopen + correction turn). The deterministic path now reads back and **waits**: the close happens only on the *next* requestor message — confirm → close, anything else → captured as a stated `correction` facet, then close (`pipeline/jobfit/intake.py:515-547`, docstring cites L1-CONV-2). Executed: a Czech correction after the read-back returns `done=True` with the correction stored as `provenance: stated`, `sourceTurn` set. Re-open exists for the rest (`app/api/intake/[id]/reopen`, `JdsIntakePanel.tsx:120-131`). |
| L1-EVA-2 — Czech backfill never triggers the short path | **resolved.** `_POWER_UNIT_MARKERS` now stems Czech (`stejn\w+`, `n[áa]hrad\w*`, `posil\w*`, `dal[šs][íi]\w*` — `intake.py:241-245`, comment cites this exact finding). **Executed against the interpreter:** „Odešel nám senior backenďák, potřebuju náhradu.", „Potřebuju posilu do týmu", „Hledáme dalšího backenďáka", „stejná pozice jako minule" → all `power_unit`; a genuinely vague opener still lands `story`. |
| L1-EVA-3 — brief dies at the dev-case seam | **resolved** (recertified live). Promote now sends `{caseDesign}` from an explicit checkbox (`JdsIntakePanel.tsx:138-156` → `jdsIntakeLogic.ts:160` → promote route `:49`), the build carries `statedRequirements` (`jd-build-run.ts:248`, `intake-brief.ts:21-25`), and the Dev tab reads the promoted brief structurally via `GET /api/jds/[slug]?brief=1` → `intakeBrief` (`app/api/jds/[slug]/route.ts:39`, `useDevTabData.ts:73-113` — stack/responsibilities/seniority filled from the brief, seniority seeded only when `spineProvenance.seniority === "stated"`). |
| L1-EVA-4 — `medior` default masquerades as a decision | **resolved.** `spineProvenance` exists end-to-end: prompt contract (`intake.py:108-110`), deterministic writers (`:359`, `:383`), read-back prints seniority only when stated (`:460`), UI chip on the seniority value with missing-key = default (`JdsIntakeBriefPanel.tsx:134-141`), and the new JD draft refuses to print a default-provenance seniority at all (`intake-draft.ts:33-34`). |
| L1-EVA-5 — defensibility thinner than the schema | **resolved** (recertified live): weight/confidence/rationale detail rows (`JdsIntakeBriefPanel.tsx:61-65`), clickable `sourceTurn` citations that flash the cited bubble (`:25-38`, `JdsIntakeChat.tsx:68-84`), transcript lines numbered for citation (`intake.py:211-221`), markdown export with per-entry provenance (`JdsIntakePanel.tsx:244-287`, `app/_lib/intake-export`). |
| Recertify R-1 (composer squeeze) / R-2 (`<<END>>` leak) | **resolved.** Voice slot moved out of the textarea's flex space (`JdsIntakeChat.tsx:170-194`); the route strips the sentinel at the boundary (`message/route.ts:52-54`). |

This is the consistency picture the verdict rests on: the 2026-08-07 conditional
was conditioned on exactly these, and they held.

## 1. Surface model (verified import chain, file:line)

**Mount (unchanged):** Library tab → Saved/Generate/Intake `SegmentedControl`
(`app/features/library/jds/JdsSavedLedger.tsx:103`), Tier-3 dynamic
(`:45`), panel stays mounted on sub-tab switch (`:121-123`).

**The Triptych — now THE session layout (no switcher):**
- `JdsIntakePanel.tsx:186-237` renders `JdsIntakeLayoutTriptych` unconditionally with four pane nodes + counts. The rejected Cockpit variant and the old `JdsIntakeSidePanel` are deleted from disk (`9eca2924`).
- `JdsIntakeLayoutTriptych.tsx` — three leaves (JD draft · conversation · live brief, `:30`), chat biased `xl:flex-[1.5]` (`:69`); hiding a leaf folds it to a clickable vertical spine with rotated label + count (`:107-119`); one always-mounted `motion.section` per leaf, width tween + content/spine crossfade, symmetric, instant under reduced motion (`:63-73`); min-one-open guard (`intakeLayoutShared.ts:53-59`); fold state per browser in localStorage (`:29-49`, key `kp-intake-triptych-cols`). Below `xl` the leaves stack (`:57`).
- **Materials** fold under the draft leaf as a `<details>` (`JdsIntakeLayoutTriptych.tsx:96-102`).

**New pane 1 — the live JD draft:**
- `JdsIntakeDraftPane.tsx` renders `briefDraftMarkdown` (`app/_lib/intake-draft.ts:25-51`) — a **deterministic, zero-LLM** client render of the current RoleBrief in the promote build's posting shape, crossfading on each brief change (`:47-58`), labeled „pracovní návrh" with the honest note that the final JD (incl. market research) is generated at Promote (cs copy `messages/cs.json` → `draft.workingNote`). Never prints a default-provenance seniority (`intake-draft.ts:33-34`). Unit-tested (`intake-draft.test.ts`).

**New pane 2 — attachments (the „attachments grounding" claim):**
- UI: `JdsIntakeAttachmentsPane.tsx` — paste a note, or pick a saved JD from the library (`:134-162`); remove; frozen when promoted (`:81-90`).
- API: `app/api/intake/[id]/attachments/route.ts` — operator-gated, workspace-scoped; ≤5 attachments, note ≤20k chars, title ≤120 (`:19-20`); a JD attachment is resolved **server-side** by slug via `loadJd` — the client never sends a body (`:50-59`); promoted sessions 409 frozen (`:32-34`).
- Storage: `role_intakes.attachment_json` (`app/_lib/db/intakes.ts`), state client-side in `jdsIntakeLogic.ts:292-321`.
- Engine: message route passes `attachments: intake.attachments` into every exchange (`message/route.ts:43-49`) → `intake-run.ts:12-21` writes `attachments.json` + `--attachments-json` → `intake_cli.py:48,58,98` → `run_intake_turn(…, attachments)` (`intake.py:716-722`).
- Prompt: `_attachments_block` (`intake.py:687-713`) — fenced `<<<ATTACHED_MATERIAL>>>`, budget 8k total split per item with an explicit truncation marker (**executed:** a 30k-char attached JD renders as an 8.5k block with the marker), framed as third-party DATA: minable, values enter the brief as `inferred` citing the attachment, become `stated` only on the requestor's confirmation, live requestor wins on contradiction.
- Keyless honesty: attachments are **never mined without a model** — the deterministic path prepends a one-time acknowledgment („Vidím přiložené podklady … V offline režimu je neumím sám vytěžit …", `intake.py:675-684`, `:737-746`; **executed:** the cs ack rides the first deterministic reply exactly once).
- Voice fast thread sees **titles only** by latency budget (`intake.py:919-927`).

**Dialog engine (carried, re-verified):** persona rules 1-11 incl. the LLM-era rule 10 (`intake.py:50-125`); requestor message fenced as *authenticated requestor* — corrections after read-back MUST land as stated (`:760-782`, the deliberate inversion of `fenced_untrusted` after L2-INT-1); `merge_brief` stated-never-regresses (`:591-649`); `<<END>>` stripped at the route (`message/route.ts:52-54`); rate limit 30/10min after cheap refusals (`:36-38`); tenancy workspace-filtered throughout (`db/intakes.ts`).

**Promote seam (carried, re-verified):** `briefReadyToPromote` gate (promote route `:28-33`), same backgrounded `jd_build`, brief threads DevNeed structurally + `statedRequirements` (`jd-build-run.ts:229-248`), `markIntakePromoted` stamps `jd_slug`/`jobId` (`:70`); marketResearch opt-out (`:48`); interviewer grounding via `promotedBriefForJob` → `briefIntentSummary` (`interview-run.ts:333`).

## 2. Grounding audit — 8/10

The commit claims „attachments grounding". Verified: **the claim is real on the
text dialog plane** — bodies reach the prompt, budgeted, provenance-guarded, with
an honest keyless floor. One seam on the voice plane does not deliver what its
own comment promises (row 10).

| # | Context element | Reaches the prompt/consumer? | Evidence |
|---|---|---|---|
| 1 | Accumulated RoleBrief in every exchange | ✓ | intake.py:769 |
| 2 | Full transcript (last 48 turns, absolute-indexed for citations) | ✓ | intake.py:216-221, :771 |
| 3 | New message, fenced exactly-once, authenticated-requestor framing | ✓ | intake.py:772-778; message route :43-48 |
| 4 | Research persona (11 rules + shape + wait-for-confirmation close + extraction incl. spineProvenance + sourceTurn) | ✓ | intake.py:50-139 |
| 5 | Language directive (en/cs) | ✓ | intake.py:137 |
| 6 | **Attached materials (pasted note / server-resolved library JD)** | ✓ **NEW** | intake.py:687-713, :770; attachments route :50-59; budget executed (8.5k block from a 30k input, truncation marker present) |
| 7 | Attachment values provenance-gated (`inferred` until confirmed; keyless never mined, acknowledged once) | ✓ | intake.py:708-713, :737-746 (ack executed); voice titles-only :919-927 |
| 8 | Promote → JD build gets the structured brief incl. graded `statedRequirements` | ✓ | jd-build-run.ts:233-248; useDevTabData.ts:73-113 (dev-case seam, recertified live) |
| 9 | Org/workspace context (existing similar roles, team data, market band) into the *dialog* | ✗ | dialog prompt carries items 1-6 only; nothing from jobs/market_pulse reaches intake.py (market research joins at Promote, not in the conversation) |
| 10 | Attachments into the **voice-session extraction thread** | ✗ | intake-run.ts:153 ships `--attachments-json` for `--extract-transcript`, `intake_cli.py:58` loads it, but `:85` calls `extract_transcript(provider, turns, brief, lang=…)` **without it** — and `extract_transcript` (intake.py:802-807) has no attachments parameter or prompt block. The fast thread's own prompt line promises „mined outside this call" (:927); the outside call never sees them. |

## 3. Walkthrough (as Eva, cs, power_unit + over_specifier)

1. **Entry** — Library → „Zadání role", ledger, „Nový rozhovor". Deterministic opener unchanged, identical keyed/keyless. The session now opens onto the **Triptych**: draft | rozhovor | živé zadání, all three open by default, chat widest (`JdsIntakeLayoutTriptych.tsx:69`).
2. **I attach the old JD first** — this is the backfill move the last version didn't have. „Přiložit uložený inzerát" → pick from the library; the server resolves the body so what the agent mines is the *stored* document, not whatever my browser had (`attachments route:50-59`). The pane copy is honest about the contract: „asistent z nich bude čerpat a nechá si vše potvrdit" — and the code actually enforces that (`intake.py:708-713`). This kills the worst part of a backfill intake: re-dictating a role that already exists on paper.
3. **Backfill opener, Czech** — „Odešel nám senior backenďák, potřebuju náhradu." Executed against the shipped regex: **`power_unit`**. The short script is 6 slots + read-back + confirm ≈ 8 exchanges (`intake.py:437-438`) — at the journey's ≤8 bound, where last time my natural Czech fell onto the 11-exchange coaching loop. On the LLM path, rule (4)+(9) still ladder my over-specified list.
4. **Watching the draft** — the signature new moment. As the brief fills, the left leaf renders the actual posting taking shape — deterministic, instant, no per-exchange LLM cost (`intake-draft.ts:25-51`). It refuses to print a seniority nobody decided (`:33-34`) — the provenance law now reaches even the preview. „Pracovní návrh" chip + the note that the final JD with market data comes at Promote: correctly modest.
5. **The close** — read-back, then **wait**. „Co jsem pochopil špatně nebo co chybí? Pokud všechno sedí, stačí napsat OK." My correction lands (executed: stored as a stated, turn-cited facet) and *then* it closes; if I think of something later, Reopen exists and appends an honest system line. The `<<END>>` token never reaches my screen (`message/route.ts:52-54`). This was my loudest complaint on 2026-08-07; it is structurally gone.
6. **Promote — with the case checkbox.** „Navrhnout i praktickou úlohu" is an explicit opt-in on my Promote row (`JdsIntakePanel.tsx:138-147`); the build designs the work-sample from the SAME graded brief (`jd-build-run.ts:248,259-261`). My headline job — dev case from the real role need, with the thread back to what the team lead actually said — is now one checkbox.
7. **Small frictions I noticed on the desk** — fold the draft leaf and its spine counts my *attachments*, not whether a draft exists (`JdsIntakeLayoutTriptych.tsx:46-47` — `draftReady` is computed and never consumed, `intakeLayoutShared.ts:22`); and the „supersede" note over an attached JD promises an „aktualizovaná verze", but Promote mints a brand-new JD and never links or retires the old one (`promote/route.ts:55` — `insertAnalyzingJd` new slug; the route never reads `intake.attachments`). After my backfill, Saved JDs holds both the old and the new posting with no relation between them.

## 4. Findings

### Strengths

**L1-EVA-S5 · strength · All four 2026-08-07 majors closed, three live-recertified — the loop is honest**
- type: quality-gap(+) · dimension: trust
- evidence: the table in §0 (intake.py:515-547, :241-245 executed; JdsIntakePanel.tsx:138-156; JdsIntakeBriefPanel.tsx:134-141; useDevTabData.ts:73-113; recertify report `../2026-08-07-intake-recertify/report.md`)
- impact: {frequency: high, reachability: high, trust_erosion: low} · code_check: confirmed-present · verdict: confirmed

**L1-EVA-S6 · strength · Attachments grounding is provenance-disciplined by design, not a paste-and-pray**
- type: quality-gap(+) · dimension: trust + senior-quality
- evidence: server-side JD resolution (attachments route:50-59), caps :19-20, fenced third-party framing with inferred-until-confirmed + requestor-wins (intake.py:706-713), 8k budget with truncation marker (executed), keyless never-mined + one-time honest ack (intake.py:737-746, executed), frozen after promote (route:32-34). This is exactly the „obhájím to" shape: a value mined from the old JD wears „úsudek AI" citing the attachment until the team lead says yes.
- impact: {frequency: high for backfills, reachability: high, trust_erosion: low} · code_check: confirmed-present · verdict: confirmed

**L1-EVA-S7 · strength · The live JD draft is deterministic and self-honest**
- type: quality-gap(+) · dimension: time-saved + clarity
- evidence: intake-draft.ts:25-51 (zero-LLM posting-shaped render mirroring the build's section shape), :33-34 (no default-provenance seniority), working-draft chip + note (JdsIntakeDraftPane.tsx:40-45), unit-tested (intake-draft.test.ts). Removes the "what will HR actually post?" review round at zero marginal cost or latency.
- impact: {frequency: high, reachability: high, trust_erosion: low} · code_check: confirmed-present · verdict: confirmed

**L1-EVA-S8 · strength · The Triptych consolidation is a real simplification, safely built**
- type: quality-gap(+) · dimension: effort + clarity
- evidence: one layout, no switcher (9eca2924; JdsIntakePanel.tsx:186-188); rejected variant + old side panel deleted from disk, dead i18n keys dropped; min-one-open guard (intakeLayoutShared.ts:53-59); fold persists per browser (:29-49); reduced-motion flattens every animation (JdsIntakeLayoutTriptych.tsx:50-54, :63-66); leaves stack below xl (:57). Layout-only re-arrangement over the same pane nodes — no logic forks to drift.
- impact: {frequency: high, reachability: high, trust_erosion: low} · code_check: confirmed-present · verdict: confirmed

### Issues

**L1-EVA-8 · quality-gap · Voice-plane extraction never receives attachments — the fast thread promises mining that the mining thread can't do**
- journey: role-intake-dialog · character: eva-eng-hiring-lead · cert_level: L1
- severity: **minor** (would be major in-journey; the journey file lists voice as out of scope / scope_note, and the plane is keyed-only + unverifiable on this host — one severity dropped per rubric) · dimension: trust + senior-quality · scope_note: voice plane; OPENAI-keyed hosts only
- expected: the voice fast thread tells the model attachments are „mined outside this call" (intake.py:927), and intake-run.ts ships the attachment file to the extraction thread — so the post-hang-up/periodic extraction should ground on the bodies.
- got: the CLI loads the attachments (`intake_cli.py:58`) but the `--extract-transcript` branch calls `extract_transcript(provider, turns, brief, lang=…)` without them (`intake_cli.py:85`), and `extract_transcript` has no attachments parameter or prompt block at all (`intake.py:802-853`). `pushAttachmentsArg` in `intake-run.ts:153` writes a file nothing reads. A pure-voice session with an attached legacy JD never mines it; the attachments pane copy („asistent z nich bude čerpat") is true in text, silently false in voice.
- evidence: intake-run.ts:131-153 · intake_cli.py:58, :85 · intake.py:802-807 (signature), :850-854 (prompt), :919-927 (the „mined outside this call" line)
- code_check: confirmed-absent (dead parameter — one-line fix shape: thread `attachments` into `extract_transcript` and add `_attachments_block` to its prompt)
- impact: {frequency: low-med, reachability: med (voice needs a keyed OPENAI host; text plane unaffected), trust_erosion: med}
- verdict: confirmed · l2_priority: med — keyed-host L2 only (drive a voice session with an attached JD, check whether any attachment value ever lands in the brief).

**L1-EVA-9 · confusion · „Supersede" is narrative — Promote never links, marks, or retires the attached legacy JD**
- severity: **minor** · dimension: clarity + trust (ledger hygiene on her most common shape — the backfill)
- expected: attaching the old posting to a backfill intake and promoting yields a successor with some relation to its predecessor — a link, an archived state, anything the ledger can show.
- got: the draft pane's supersedeNote promises „vytvořením z tohoto zadání vznikne jeho aktualizovaná verze" (JdsIntakeDraftPane.tsx:36, :45; cs `draft.supersedeNote`), but the promote route never reads `intake.attachments` (`promote/route.ts:34-70` — no reference) and `insertAnalyzingJd` mints a brand-new slug (`:55`). Result: old and new JD both live in Saved JDs, unrelated. The intake→JD back-link exists (`markIntakePromoted:70`); the oldJD→newJD link does not.
- evidence: JdsIntakeDraftPane.tsx:36,45 · promote/route.ts:34-70 · attachments carry `jdSlug` (jdsIntakeLogic.ts:24) so the link is one field away
- code_check: confirmed-absent · impact: {frequency: med (every attached-JD backfill), reachability: high, trust_erosion: med — a director asking „which of these two postings is live?" is exactly the question she can't answer from the ledger}
- verdict: confirmed · l2_priority: low (structure is fully visible at L1).

**L1-EVA-10 · confusion · The folded draft spine counts attachments, and `draftReady` is computed but never consumed**
- severity: **minor** · dimension: clarity
- expected: a folded leaf's spine „must still say what it holds" (intakeLayoutShared.ts:8-9). The draft leaf holds the JD draft (+ materials underneath).
- got: `countFor` maps the draft spine to `props.counts.attachments` (`JdsIntakeLayoutTriptych.tsx:46-47`, rendered at `:118`) — fold the draft with a full posting drafted and zero attachments and the spine reads „Popis pozice 0". The purpose-built `counts.draftReady` (`intakeLayoutShared.ts:22`, computed at `JdsIntakePanel.tsx:235` via `briefDraftHasContent`) has no consumer.
- evidence: JdsIntakeLayoutTriptych.tsx:46-47, :118 · intakeLayoutShared.ts:18-23 · JdsIntakePanel.tsx:235
- code_check: confirmed-present (wrong count) + confirmed-absent (draftReady unused) · impact: {frequency: med (every fold), reachability: high, trust_erosion: low}
- verdict: confirmed · l2_priority: low.

**L1-EVA-11 · quality-gap · Keyless read-back correction is recorded, not applied — the structured fields it targets stay stale through Promote**
- severity: **minor** · dimension: senior-quality · scope_note: keyless floor, honestly disclosed via degradedNote; reopen + brief-edit are manual recovery paths
- expected: my correction at the read-back („Senior, ne medior — a přidejte Kafku") shapes the brief the JD is built from.
- got (executed): `deterministic_turn` stores the correction verbatim as a stated, turn-cited `correction` facet and closes (`intake.py:528-547`) — honest and traceable, and it flows into `needTextFromBrief` as facet text — but `seniority` stays un-stated and Kafka never becomes a `must_have`, so the build's **structured** fields (`brief.seniority` promote route :54; `briefMustSkills` jd-build-run.ts:238) don't carry it. The LLM path folds corrections properly (prompt :775-776); the floor records them as a note.
- evidence: intake.py:528-547 (executed with the exact Czech correction), intake-brief.ts:32-43, promote/route.ts:54
- code_check: confirmed-present (by-design floor, but the delta between „recorded" and „applied" is invisible to the requestor) · impact: {frequency: low-med (keyless closes with corrections), reachability: high, trust_erosion: low-med}
- verdict: confirmed · l2_priority: low (L2 judges the LLM path's correction-folding instead — already an l2 item).

**L1-EVA-12 · quality-gap · Dead duplicate submit handler in the chat composer**
- severity: polish · dimension: — (code hygiene; no user-visible effect)
- got: `JdsIntakeChat.tsx:86-91` defines `submit` — an exact duplicate of `submitDraft` (`:198-203`) — and nothing calls it (both the Enter handler `:181` and the button `:188` call `submitDraft`).
- evidence: JdsIntakeChat.tsx:86-91, :181, :188, :198-203 · code_check: confirmed-present · impact: {frequency: low, reachability: n/a, trust_erosion: low} · verdict: confirmed.

### Carried, not re-surfaced

- Org/market context absent from the *dialog* prompt (grounding row 9) — same posture as 2026-08-07: an audit-table thin seam, not a defect; market data joins at Promote by design.
- LLM one-shot `readback+<<END>>` still *accepted* by `coerce` (`intake.py:757`) — the wait is instructed (persona `:95-100`) and the requestor-message framing orders post-read-back corrections to land (`:775-776`), with Reopen as the structural backstop. Recorded 2026-08-07 as present-but-unenforced; unchanged; L2's register check owns it.
- Voice plane end-to-end remains **fixed/unverified** on this host (no OPENAI key) — recertify #10's ceiling stands.

## 5. Verdict + metrics

**L1-pass.**

- The 2026-08-07 conditional's four majors are all resolved in code and (except the keyed voice plane) recertified live — the conditions were met, and the fixes carry their UAT finding IDs in code comments, which is the loop working as designed.
- The two headline claims of the new commits hold under code audit: **attachments grounding is real and provenance-disciplined on the text plane** (the plane this journey certifies), and **the Triptych is a genuine consolidation** (one layout, dead variants deleted, layout-only over unchanged pane logic).
- No majors within journey scope. The one would-be major (L1-EVA-8, attachments never reaching the voice extraction thread despite the fast thread's promise) sits on the journey's declared out-of-scope voice plane and drops to minor with a scope note — but it is a confirmed dead-parameter defect with a one-line fix shape, and it should be swept before the voice arc's keyed recertification.

**Grounding: 8/10** (was 7/9 — attachments added ✓✓; org-context in dialog still ✗; voice-extraction attachment seam ✗).

**Time-saved estimate (her motivation numbers):** manual baseline ~1.5-2 h per role (intake meeting + write-up + a clarification round, then re-typing into the Dev tab). With this surface: a keyed Czech backfill now actually triggers the short path (executed), the attached legacy JD replaces re-dictation, the live draft removes the „what will HR post" review round, and the case checkbox removes the dev-case re-establishment step that clawed back 10-15 min in the last estimate. **~75-100 min saved per role intake, confidence medium-high** — latency is no longer theoretical (16-40 s/exchange measured in the recertify pass and honestly hinted in-UI), but this pass drove no live dialog, and Czech LLM-register naturalness remains L2's to judge.

## 6. Eva's feedback (first person)

Minule jsem vám dala podmíněně — a řekla jsem přesně proč: zamčené okno po „co jsem pochopil špatně?", české koučovací kolečko na obyčejnou náhradu, a hlavně ten krásný brief, co se u mého dev casu rozpustil do markdownu. Tak si to odškrtněme: oprava po read-backu se zapíše a je vidět, z které repliky je. „Potřebuju náhradu" už systém pochopí česky, i s pádovou koncovkou — někdo ten regex evidentně spustil, ne jen napsal. A u Vytvořit inzerát je checkbox „navrhnout i praktickou úlohu" ze stejného zadání, s vahami. To je přesně to, co jsem chtěla, a nebudu předstírat, že mě nepotěšilo najít čísla mých nálezů v komentářích kódu. Takhle má vypadat oprava: dohledatelná.

A ty novinky mi sedí do práce víc, než jsem čekala. Přiložím starý inzerát — server si ho vytáhne sám z knihovny, agent z něj smí čerpat, ale všechno, co si z něj vezme, nosí chip „úsudek AI" s odkazem na podklad, dokud to team lead nepotvrdí. To je přesně ta disciplína, kterou obhájím před ředitelem: tady je, co řekl člověk, tady je, co si stroj přečetl ze starého papíru. A návrh inzerátu, který se píše sám, zatímco mluvíme — deterministicky, bez čekání, a odmítne vytisknout senioritu, kterou nikdo neřekl — to je poprvé, co vidím preview, které nelže.

Co zbývá? Drobnosti, ale řeknu je nahlas. Když přiložím starý inzerát, slíbíte mi „aktualizovanou verzi" — a pak mi v ledgeru leží dva inzeráty vedle sebe bez jediné nitky mezi nimi; ředitel se zeptá „který platí?" a já pokrčím rameny. Složený návrh ukazuje počet podkladů místo toho, jestli návrh existuje. A hlasová větev slibuje, že podklady „vytěží jinde" — jenže to jinde je nikdy nedostane; jeden parametr visí ve vzduchu. Nic z toho mi nebrání v práci, textová cesta je čistá.

Adoptuji to? Ano — a tentokrát bez dozoru. Hodinu a půl ruční práce na roli mi to zkrátí na čtvrt hodiny rozhovoru a výstup je lepší než moje poznámky: struktura, provenience, export pro poradu. Kolegyni z druhého squadu bych řekla: přilož starý inzerát, mluv normálně česky, a dívej se vlevo, jak se ti inzerát píše. Jen si po povýšení ukliď ten starý inzerát ručně — zatím.

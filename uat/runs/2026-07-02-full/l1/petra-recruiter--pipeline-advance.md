# L1 theoretical — petra-recruiter × pipeline-advance

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L1 (code-derived surface model, no browser)
- **Verdict:** **L1-conditional** (journey completes structurally; 2 majors carried to L2)
- **Grounding score:** **5/8** (drawer AI actions)
- **Time saved (if it all worked):** **~8–10 min per candidate touch** (advance + full-history review + interview hand-off: ~10–15 min the manual way → ~2–3 min here) ≈ **2–3 h/week** at her 15–20-req load · **medium** confidence

---

## Surface model (affordances → code)

**Entry:** dev gate on → `/` lands on the Pipeline tab by default (`app/features/tabs.ts:81`, `DEFAULT_TAB = "pipeline"`). No per-role nav gating; fixture confirmed non-empty (checkpoint: pipeline 50, stage mix Screened 18 / Accepted 15 / Interview 9 / Offer 4 / Hired 4).

| Affordance | Backing code |
|---|---|
| Board: position lanes × 5 stage columns, derived from `STAGES` | `PipelineBoard.tsx:20-23,232-311`; stages single-sourced `app/_lib/pipeline-stages.ts:12` via `PipelineTypes.ts:76` |
| Drag candidate between stages (drop-highlight, same-stage no-op) | `PipelineBoard.tsx:77-94,300-305`; `CandidateRow` draggable `PipelineShared.tsx:216-230` |
| Move integrity: optimistic move + `expectedStage` CAS, rollback + alert on failure | `PipelineTab.tsx:544-565` → `postPipelineAction set_stage` → `app/api/pipeline/[id]/route.ts:89-123` → `app/_lib/db/pipeline.ts:1394-1433` (IMMEDIATE tx + CAS) |
| Search / quick filters / stage filter / saved views / shareable URLs | `PipelineTab.tsx:120-131,299-318,351-420` |
| Bulk select → move / accept / reject (2-step confirm) / invite | `PipelineTab.tsx:447-537,914-1048` |
| NL command bar (preview-then-confirm) | `CommandBar.tsx` → `app/api/pipeline/command/route.ts:50-112` → deterministic parser `app/_lib/pipeline-command.ts:33-58` |
| Run-pass dry-run preview modal | `PipelineTab.tsx:611-632`, `PassPreviewModal.tsx:15-45` |
| Candidate drawer: identity, match score, unified history, comms letters, notes, AI actions, move-stage select, voice + scheduling links | `CandidateDrawer.tsx:59-921` |
| Unified timeline: pipeline events (`/api/pipeline/events?entry=`) merged with analyses/interview/invites/offers (`/api/pipeline/[id]/timeline` → `app/_lib/candidate-timeline.ts:38-85`) | merge at `CandidateDrawer.tsx:208-218`; render `:665-689`; comms letters own section `:636-663` |
| Live updates | **Polling, not SSE**: `useLiveRefresh` (`PipelineTab.tsx:260`) + 30 s interval poll paused while drawer open / tab hidden (`PipelineTab.tsx:271-280`); events feed uses a `since` cursor so bursts aren't lost (`app/api/pipeline/events/route.ts:32-46`) |
| Activity feed | `PipelineTab.tsx:1137-1163` — renders the **public projection** (initials only, `app/_lib/pipeline-events-public.ts:34-54`) |
| Terminal state | manual/drag `set_stage` → Hired is refused 422, "move to Offer → extend offer → candidate accepts" (`app/api/pipeline/[id]/route.ts:97-107`); offer approval extends a tokenized offer + dispatches comms (`:22-77`, `comms-dispatch.ts:235-246`) |

**Surface-model correction for the journey file:** `pipeline-advance.md` says live updates come via SSE — there is no SSE in the app (`text/event-stream`/`EventSource`: zero hits). It's cursor-polling; the L2 check should assert the board reflects a server-side change **within one 30 s poll tick**, not "streams".

## Grounding audit (AI surfaces on this journey)

Drawer AI actions (screen / prep / scorecard / offer / outreach / rejection / rematch) all run `runAutomationTask` (`app/_lib/automation-run.ts:87`). Sources that should reach the prompt vs. actually do:

1. ✓ full candidate profile — serialized once, fed + cache-keyed (`automation-run.ts:110,146-148`)
2. ✓ the real JD/job — `--job-id` (`:163`); rematch scores the **live** corpus, fingerprinted into the cache key (`:119,155-162`)
3. ✓ stage context — rejection gets `--stage` (`:164`); screen maps (stage, route) → effect (`:199-227`)
4. ✓ recruiter notes — scorecard `--notes-file` (`:165-168`), **pre-filled from the persistent drawer note** (`CandidateDrawer.tsx:81`)
5. ✓ GitHub evidence — screen/prep/scorecard (`:120-127,173-181`), cache-invalidating
6. ✗ candidate locale — **only `prep` passes `--lang`** (`:171-172`); outreach/rejection/offer LLM bodies get no locale signal (`comms-dispatch.ts:18-24` documents LLM bodies "stay as the model produced them")
7. ✗ voice-interview outcome — drawer displays it (`CandidateDrawer.tsx:491-518`) but it never reaches the scorecard/screen prompt
8. ✗ prior pipeline history/timeline — not fed

**Grounding 5/8.** The command bar is deliberately **not** an LLM surface (deterministic parser, `pipeline-command.ts:1-7`) — honest scoping, counted as a strength, not a gap.

## Reachability (resolved before judging)

Petra = internal user, full workspace binding. Pipeline is her default landing tab; board, drawer, drag, bulk, command bar all inside her set. Token pages (`/status`, `/schedule`, `/offer`) are out of her set — judged only as hand-offs minted from the drawer, not as her surfaces. Nothing below is tagged `unreachable`.

## Cognitive walkthrough (in character)

1. **"Přetáhnu kandidáta o fázi dál."** Drag affordance visible (dragHint `cs.json pipeline.board.dragHint`), drop column highlights, same-stage drop no-ops. Move is optimistic, CAS-guarded with her card's *own* prior stage, rolls back **with a visible alert** on failure (`PipelineTab.tsx:554-562`) and always reconciles via `load()`. Persists server-side (SQLite, `stage_changed_at`, a `moved` event). **The move sticks; no silent revert.** ✓
2. **Except toward Hired.** The Hired column is a live drop target and the drawer's move-select lists Hired (`CandidateDrawer.tsx:704`), but the server refuses (correctly, 422) and **both clients throw away its actionable message** and show generic "Kandidáta se nepodařilo přesunout — tabule byla obnovena" — which is *false* (nothing concurrent happened). The one place she's told the real grammar ("move to Offer → extend offer") never reaches her. → finding P2, major.
3. **"Otevřu zásuvku a chci CELOU historii."** The drawer delivers a genuinely unified, chronological story: stage events + analyses (deep-linked to `/history/<slug>`, with her disposition chip) + interview created/completed + invite sent/confirmed (slot shown) + offer extended/answered — plus a separate full-letter comms section where failed sends are visibly red. This is the journey's centerpiece and it is real, not stage-changes-only. ✓ Strength. One label bug: an **expired** offer renders as "offer extended" twice (P4).
4. **"Pošlu ho na pohovor."** From the drawer at Screened/Interview: AI screen (guarded advance), self-scheduling link + voice link with **explicit delivered / not-delivered status** (`CandidateDrawer.tsx:819-827,883-887`). Hand-off to scheduling is not a dead-end. ✓
5. **"K nabídce."** Offer stage → "Draft offer" (salary from role band, scaled by fit — `CandidateDrawer.tsx:36`) → approval in Decisions extends a tokenized offer; Hired only on candidate accept. Integrity is right *on that path* — but the command bar's `advance_top` walks straight around it (P1, major).
6. **"A stalo se vůbec něco?"** Bulk actions answer with counts (moved/failed, failures stay selected for retry). Drag answers with the card visibly landing. The activity feed, though, tells her "M. K. postoupil · Teller" — initials only, on her own internal board (P3, minor).

## Scored acceptance criteria (Petra's own, applied identically every run)

| Criterion | L1 result |
|---|---|
| completion — advance without dead-end/re-entry | **pass** (drag + drawer + bulk; Hired detour is signposted only server-side) |
| senior-quality/trust — reasoning cites the real CV | **defer to L2** — structurally plausible (full profile + JD + GitHub reach the prompt, grounding 5/8) |
| trust — zero hallucinated skills | **defer to L2** (real profile JSON is the prompt input; text quality unobservable at L1) |
| senior-quality — score with drivers | **partial** — board/drawer show a bare match number; drivers are one click away (Open full match, analysis report links in the timeline) |
| trust — salary with basis | **partial/defer** — offer draft declares its basis ("from the role band, scaled by fit"); verify the rendered draft at L2 |
| clarity — no silent success | **partial** — bulk + move errors explicit; but the Hired refusal is *mis-explained* (P2) and the feed anonymizes names (P3) |
| time-saved — faster than manual | **pass** — ~8–10 min saved per candidate touch (see header) |
| language — Czech UI + output | **partial** — board/drawer catalogs fully Czech (`messages/cs.json` pipeline.*); the command bar's grammar and its server-side descriptions are English-only (P5) |

## Findings (this character's lens — full records in pipeline-advance.findings.json)

- **P1 · major · broken-flow/trust** — `advance top N` bare-advances an Offer-stage candidate to **Hired with no offer, no comms, no onboarding**, silently discarding any drafted offer — the exact bypass `[id]/route.ts:97-107` exists to prevent. `command/route.ts:28-34,101-102` + `db/pipeline.ts:1332-1341`.
- **P2 · major · confusion** — drag/select to Hired always fails with a generic *and misleading* message; the server's actionable 422 explanation is discarded (`PipelineTab.tsx:554-562`, `CandidateDrawer.tsx:276-284`).
- **P3 · minor · confusion** — internal activity feed shows initials only (public projection applied to the operator's own board), `pipeline-events-public.ts:34-39`.
- **P4 · minor · quality-gap** — expired offer renders as "offer extended" in the drawer timeline (`candidate-timeline.ts:73-76` vs `CandidateDrawer.tsx:938-940`; no `offerExpired` key in cs.json).
- **P5 · minor · confusion** — command bar parses English-only verbs and echoes English descriptions inside the Czech UI (`pipeline-command.ts:41-55,62-79`).
- **Strengths:** CAS-guarded moves everywhere with honest 409s; the unified drawer timeline; autosaved persistent candidate note with unmount flush (`CandidateDrawer.tsx:383-431`); chain-aware empty state with guided tour (`PipelineTab.tsx:766-787`).

## Character feedback (first person)

> Tabule je poctivá. Přetáhnu člověka, karta si pamatuje, odkud jsem ho vzala, a když mě někdo předběhne, řekne mi to — nepřepíše mi to tiše práci. To je víc, než umí SuccessFactors po dvou migracích.
>
> Zásuvka — konečně. Analýza s odkazem na report, pohovor, pozvánka i nabídka na jedné časové ose, a dokonce vidím celé dopisy, které ten člověk dostal, včetně těch, co se nepodařilo odeslat. Tohle je přesně to "nic se mi tiše neztratí", které jsem chtěla. Poznámka z telefonátu se sama ukládá a přežije zavření — dobře.
>
> Ale dvě věci mi vadí. Když přetáhnu kandidáta do "Hired", řekne mi to jen "nepodařilo se přesunout — tabule byla obnovena". Nic se neobnovilo; prostě je tam pravidlo, že Hired jde přes nabídku — a to pravidlo je správně! Tak mi ho *řekněte*, server tu větu dokonce umí. A ten příkazový řádek: napíšu "advance top 5" a když je jeden z nich zrovna ve fázi Nabídka, systém ho prostě prohlásí za zaměstnaného — bez nabídky, bez e-mailu, bez onboardingu. Rozepsaná nabídka zmizí. To je přesně ta chyba, kterou manažer najde dřív než já.
>
> A drobnost: můj vlastní feed aktivit mi říká "M. K. postoupil". Mám dvě stě kandidátů, iniciály mi nestačí. Jinak — ano, tohle bych používala. Adoptuji podmíněně: opravte tu zkratku do Hired a vraťte mi jména.

## L2 handoff (l2_priority)

1. **P1:** run `advance top 5` with an Offer-stage candidate in the top 5 (fixture has 4 at Offer) — confirm Hired-with-no-offer + drafted offer discarded + no onboarding comm.
2. **DoD:** drag one stage forward → hard refresh → confirm persisted; drag back → confirm **both** moves in the drawer timeline.
3. Open the drawer on a candidate with an analysis + a schedule invite → assert one chronological merged feed (check the exact-label analysis join actually hits on seeded data).
4. Live update: mutate server-side (scheduler/pass) with the board open → reflected within one 30 s poll tick, **without** manual reload (correcting the journey file's SSE assumption).
5. **P2:** drag a card onto the Hired column live — capture the misleading message.
6. Advance-to-interview hand-off: mint the scheduling link from the drawer; confirm dispatched status + Outbox row.

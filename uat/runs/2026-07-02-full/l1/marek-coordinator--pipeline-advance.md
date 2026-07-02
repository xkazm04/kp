# L1 theoretical — marek-coordinator × pipeline-advance

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level L1 (code-derived surface model, no browser)
- **Verdict:** **L1-conditional** (batch machinery is structurally sound and preview-gated; 3 majors carried to L2)
- **Grounding score:** **5/8** (shared drawer AI actions; deterministic candidate comms are fully grounded — entry + locale + stage — the LLM-authored bodies are the gap)
- **Time saved (if it all worked):** **~35 min per 20-candidate wave** (bulk move/decide/invite ≈ 3–5 min vs ~40 min one-by-one) · **medium** confidence — *contingent on preview trust: without a rendered-message dry-run he re-checks by hand and the saving shrinks*

---

## Surface model (Marek's slice — batch + comms integrity)

Same board/drawer model as the Petra report (see `petra-recruiter--pipeline-advance.md` for the full table). Marek-specific affordances:

| Affordance | Backing code |
|---|---|
| Select mode → bulk **move** (per-item `expectedStage`; failures stay selected for retry) | `PipelineTab.tsx:426-472` |
| Bulk **accept/reject** on the awaiting cohort, per-approval-kind breakdown, 2-step reject confirm | `PipelineTab.tsx:479-504,991-1046` |
| Bulk **scheduling invite** (one round trip, per-entry isolation) | `PipelineTab.tsx:510-537` → `/api/schedule/invite/bulk` |
| NL command bar: preview (who + score + stage) → confirm; mutating intents reuse the SAME guarded actions | `CommandBar.tsx:89-127`; `command/route.ts:44-49,61-66` |
| Command-bar reject **notifies** candidates, with per-candidate comms-failure isolation + `rejection_comms_failed` audit event | `command/route.ts:79-99`; copy discloses "Reject and notify" (`pipeline-command.ts:66-70`) |
| Run-pass dry-run modal: rejects render first and loudest; fairness-blocked holds surfaced separately | `PassPreviewModal.tsx:15-45` |
| Audit trail: pipeline events (cursor-poll, burst-safe), Outbox rows, drawer full-letter comms incl. failed sends | `api/pipeline/events/route.ts:8-46`; `CandidateDrawer.tsx:636-663` |
| Human reject → candidate always notified; decision sealed into the tamper-evident chain | `[id]/route.ts:243-262`; `comms-dispatch.ts:194-205` |
| Undo: per-candidate `reinstate` (409-guarded, sealed reversal) — UI lives on Decisions, not the board | `[id]/route.ts:166-189`; `sub_decisions/DecisionsTab.tsx` |
| Delivery boundary: durable local **Outbox by default (`queued` = terminal dev state)**; real relay only with `COMMS_WEBHOOK_URL`; failures dead-letter loudly | `comms.ts:6-23,34-42,88-94` |
| Localization of candidate comms: deterministic templates render in the **entry's locale**; LLM bodies (outreach, offer letter) do not | `comms-dispatch.ts:18-24,39-47`; `automation-run.ts:171-172` |

## Reachability (resolved before judging)

Marek = internal user; binding = Decisions, Channels, Schedule, **Pipeline**. Everything above is on the Pipeline tab or its drawer — all in-set. The screen-wave configuration itself is Decisions scope (`screening-decisions.md`), the candidate-facing `/status`/`/schedule` pages are Tereza's — judged here only as dispatch hand-offs. Fixture: 50 seeded entries across all stages (run checkpoint). Nothing tagged `unreachable`.

## Cognitive walkthrough (in character)

1. **"Kolik jich hoří?"** Stat chips + Today rail + quick filters isolate a cohort (aging/awaiting/intake); the filter state is a pasteable URL. ✓
2. **"Vyberu kohortu a přesunu ji."** Select mode flips rows to checkboxes, "select all visible" acts on exactly the filtered set, each POST carries that card's own `expectedStage`, and a 409 **stays selected for retry** while successes deselect (`PipelineTab.tsx:447-472`). That is precisely his review-and-retry grammar. ✓ Strength.
3. **"Než to odešlu — dry-run."** Preview exists at every commit gate: command-bar preview lists who/score/stage before confirm; the policy pass opens a modal with rejects loudest; bulk reject is 2-step-confirmed and says it will email. **But none of them shows the rendered letter** — who, yes; *what each person will receive*, no. His scored criterion says absent rendered-message preview = major (M2). The rejection template is deterministic (`comms-dispatch.ts:194-205`), so rendering it in the preview is structurally cheap — the gap is in the UI, not the data.
4. **"Odešlo to? A komu?"** Yes, answerable: bulkResult counts, `commsFailed` surfaced by the command bar, Outbox rows per message, the drawer shows the full letters with failed sends in red, and a failed rejection comm writes a `rejection_comms_failed` event telling him to nudge manually. ✓ Strength — the audit story is genuinely good.
5. **"A když se spletu?"** Per-candidate `reinstate` exists (guarded, sealed) — but on the Decisions tab, not where the batch fired, and there is no batch-level recall; the letter itself is gone. Partial credit (see scorecard).
6. **"Advance top 5" — jeho noční můra v kódu.** The command-bar execute path calls `actOnPipelineEntry` directly, skipping the route's offer logic: an Offer-stage candidate in the top N is bare-advanced to **Hired** — no offer extended, drafted offer silently discarded, no onboarding comm (M1). A wrong terminal state, silently, under the bank's name — exactly the misfire he runs previews to prevent, on the one path whose preview can't warn him (it shows the stage, but not the consequence).
7. **"Podepsal bych ten dopis?"** Deterministic rejections/invites/confirmations render in the candidate's locale — a Czech candidate gets Czech (`comms-dispatch.ts:39-47`). But the LLM-authored outreach body and offer letter carry **no locale signal** (`automation-run.ts:171-172` — only prep passes `--lang`), and the localized footer is bolted onto whatever language the model produced: a mixed-language offer under ČS's name is exactly what he wouldn't sign (M3).
8. **Delivery honesty.** Default deployment queues to a local Outbox — `queued` is a *terminal dev state*, i.e. nothing is actually delivered until `COMMS_WEBHOOK_URL` is set, and recipients resolve to names, not addresses (`comms.ts:19-23`). The statuses never lie about this, and dead-letters alert loudly. Honest seam, recorded as a scope note with a ceiling (M6), not a defect.

## Scored acceptance criteria (Marek's own, applied identically every run)

| Criterion | L1 result |
|---|---|
| completion — rule/wave/comms/schedule end-to-end | **pass (journey slice)** — bulk move/decide/invite complete on the board; the wave itself is Decisions scope |
| trust/clarity — dry-run shows who **and the rendered message** | **fail → major (M2)** — who: yes (preview rows, 2-step confirm); rendered message: nowhere |
| clarity — explicit confirmation + audit trail | **pass** — counts, per-message Outbox rows, failed sends visible, comms-failure events |
| trust — undo/recall for bulk candidate-facing actions | **partial** — per-candidate reinstate exists (sealed reversal) but on another tab; no batch recall of a fired letter |
| senior-quality — comms he would sign | **partial/defer** — deterministic templates localized + tested; LLM outreach/offer bodies have no locale grounding (M3); text quality → L2 |
| trust — scheduling validates the slot | **out of this journey** (interview-schedule-prep); invite minting shows dispatched/not-dispatched honestly |
| time-saved — batch beats one-by-one AND stays reviewable | **conditional pass** — ~35 min/wave, discounted by M2 (unreviewable letters mean manual re-checks) |
| language — Czech UI + candidate messages | **partial** — board/drawer Czech; command bar English-only (M5); LLM bodies unpinned (M3) |

## Findings (this character's lens — full records in pipeline-advance.findings.json)

- **M1 · major · broken-flow/trust** — `advance top N` silently mints Hired-without-offer for Offer-stage candidates, discarding drafted offers; the invariant enforced at `[id]/route.ts:97-107` is absent on `command/route.ts:101-102`.
- **M2 · major · trust** — no rendered-message dry-run on any candidate-notifying bulk path (board bulk reject, command-bar reject, pass preview) — his hard acceptance criterion.
- **M3 · major · quality-gap** — LLM-authored candidate-facing bodies (outreach, offer letter) receive no locale signal; Czech candidates can get mixed-language letters under the bank's name (`automation-run.ts:171-172`, `comms-dispatch.ts:18-24`).
- **M4 · minor · missing-feature** — no undo/recall affordance at the batch's point of fire; reinstate is per-candidate on Decisions only.
- **M5 · minor · confusion** — command bar grammar + descriptions English-only in the Czech workspace.
- **M6 · minor · trust (scope note, by-design)** — default comms delivery is outbox-simulated (`queued` terminal); recipients are names, not addresses. Honest statuses; ceiling: nothing reaches a real inbox until a relay + directory exist.
- **Strengths:** retry-preserving bulk grammar; preview-then-confirm on every mutating gate incl. the fairness-blocked rows rendered loudly; command-bar reject that *notifies* and isolates per-candidate comms failures; burst-safe cursor-polled event feed; sealed decision chain for human accept/reject/reinstate.

## Character feedback (first person)

> Dobré zprávy napřed: ta tabule mluví mým jazykem procesu. Vyfiltruju kohortu, vyberu všechny zobrazené, přesunu — a když se osm z dvaceti nepovede, těch osm mi **zůstane vybraných**. To je přesně ten pracovní rytmus, který jinde skládám z Excelu a modliteb. Příkazový řádek mi před spuštěním ukáže seznam lidí, hromadné zamítnutí se ptá dvakrát a říká na rovinu, že kandidátům odejde e-mail. Audit je poctivý: vidím dopisy, vidím i ty, co se odeslat nepodařilo, červeně. "Odešlo to a komu?" — tady poprvé dostávám odpověď bez ticketu na IT.
>
> Ale. Ukážete mi *koho* se to dotkne, ne *co dostane*. Zamítací šablona je deterministická — máte ji v kódu — tak mi ji vyrenderujte do náhledu, jinak si před každou vlnou stejně otevřu tři dopisy ručně a půlka úspory je pryč. Druhá věc mě děsí doopravdy: "advance top 5" umí člověka ve fázi Nabídka **tiše prohlásit za zaměstnaného** — bez nabídky, bez dopisu, bez onboardingu, a rozepsaná nabídka se zahodí. Špatný terminální stav, potichu. To je přesně ta kategorie chyby, kvůli které nevěřím nástrojům. A do třetice: deterministické dopisy jsou hezky česky, ale ten vygenerovaný nabídkový dopis nemá jak vědět, že kandidát je Čech — smíšený jazyk pod hlavičkou banky nepodepíšu.
>
> Vlnu bych v tomhle stavu pustil — malou, s ručním namátkovým čtením dopisů. Naplno až po náhledu dopisů a opravě té zkratky do Hired.

## L2 handoff (l2_priority)

1. **M1:** live `advance top 5` with an Offer-stage candidate included — confirm the silent Hired + discarded draft + absent onboarding comm.
2. **M2:** run a 2-candidate bulk reject — record exactly what the confirm shows, then open both drawer comms letters and the Outbox rows (personalization, Czech, status).
3. **M3:** generate an outreach draft + offer draft for a cs-locale candidate — assert the body language.
4. Bulk invite 3 active candidates — per-entry results, dispatched status, Outbox rows.
5. Confirm the reinstate path from Decisions actually reverses a board bulk reject (fix *reachable* + *unblocks*), and time the round trip.

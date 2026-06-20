# L1 (theoretical, code-grounded) — Marek Beneš · Recruiting Coordinator / Screening Ops

**Run:** l1-2026-06-19 · **Character:** marek-coordinator · **Cert level:** L1 (no browser) · **Language lens:** cs

Marek runs the machine: screening rules, screen-waves, comms dispatch, scheduling, status hygiene at Česká spořitelna. He trusts a tool only as far as it lets him **preview before it fires, shows an audit trail after, and gives him an undo**. His nightmare-question after any action: *"odešlo to? a komu?"*

**Reachability:** All four of his bound surfaces — **Pipeline, Channels, Decisions, Schedule** — are first-class nav items with **no per-role gating** (`app/features/tabs.ts:101-104`). The decision **audit dossier** lives one group over, under Analytics (`app/features/sub_analytics/DecisionRecordsPanel.tsx`), also reachable for him. So reachability ≈ "is the dev gate seeded + is there fixture data behind the tab." No `unreachable` tags this pass.

---

## Per-journey verdicts

| Journey | Verdict | Blockers | Majors | Minors | Polish | Strengths |
|---|---|---|---|---|---|---|
| screening-decisions | **L1-pass** | 0 | 0 | 1 | 1 | 4 |
| pipeline-advance | **L1-conditional** | 0 | 1 | 2 | 0 | 3 |
| interview-schedule-prep | **L1-pass** | 0 | 0 | 2 | 0 | 4 |

---

## Journey 1 — screening-decisions → **L1-pass**

This journey is built exactly the way Marek thinks. The screen-wave **dry-runs on open and on every slider change** (`ScreenWaveModal.tsx:57-92`), POSTing `dryRun:true` to `/api/decisions/screen-wave/route.ts:24`, which runs the **full ranking/fairness/tie-break math with zero mutation, zero comms, zero audit write** (`screen-wave.ts:118,189-193`). The committed reject list is a **separate, explicit action** (`ScreenWaveModal.tsx:94-112`) and the committed view re-renders the *actual* per-row outcome — including CAS skips and per-candidate comms failures — "at the exact moment the action became irreversible" (`ScreenWaveModal.tsx:136-160,207-223`).

**Fairness shielding is server-side and fails closed:** early-career and any unknown/renamed archetype are shielded from auto-reject in code, not UI copy (`screen-wave.ts:156-162,169`; gate enforced in `archetypes.ts` `isFairnessProtected`). The early-career fairness gate is **not user-toggleable** by design (`DecisionRulesModal.tsx:14-15`).

**Audit trail (his "to whom, when, under which policy"):** every committed auto-reject seals a **tamper-evident, hash-chained decision record** carrying `policyVersion` (`screen-wave/bottom{pct}/maxMatch{n}`), actor (`auto:screen-wave`), candidateRef, rationale, and the decisive inputs (`screen-wave.ts:215-223`), readable via `/api/decisions/records/route.ts` with a chain-verify verdict and a one-click **"Export dossier"** for a regulator (`DecisionRecordsPanel.tsx:23-49`).

**Undo is real, not cosmetic:** the Reconsider queue (`/api/decisions/reconsider`) lists the auto-rejected cohort; one click reinstates to active@Screened via `POST /api/pipeline/[id] {action:"reinstate"}` (`DecisionsTab.tsx:93-104`), guarded server-side to a still-rejected entry (409 on a stale double-click) and — importantly — the **reversal itself seals a `reinstated` record** so the chain shows the rejection *was overturned* (`[id]/route.ts:157-179`).

**Comms quality:** the rejection is a deterministic, warm, on-brand Czech template (`messages/cs.json` `comms.rejection.*` — *"Po pečlivém zvážení v tuto chvíli nebudeme pokračovat dál…"*) with an encouraging early-career variant, rendered through a locale-pinned translator off the candidate's stored locale (`comms-dispatch.ts:37-45,189-200`). A per-candidate comms failure is **isolated** (the reject already applied + audited; the rest of the batch continues) and badged per-row + counted (`screen-wave.ts:230-242`; `ScreenWaveModal.tsx:150-154`). This is exactly the "warm, on-brand, error-free, would-sign-it" bar.

**Findings:**
- **MAREK-D1 (minor, clarity):** The durable, exportable audit dossier renders on the **Analytics** tab, not on Decisions where Marek runs the wave. The committed modal shows the immediate per-row outcome, so it's not silent — but his "point a regulator at the list right after I fire" instinct lands him on a different tab. Cross-tab friction, both reachable. `DecisionRecordsPanel.tsx:23` (under `sub_analytics`) vs the wave at `DecisionsTab.tsx:471`.
- **MAREK-D2 (polish, clarity):** `l2_priority` — the committed banner reports counts (`rejected/kept/cohort`) but Czech rationale strings interpolate via `reasonCode` (`ScreenWaveModal.tsx:122-132`); confirm at L2 that every `decisions.wave.reasons.*` key renders in cs with no English fallback leaking.

**Strengths to protect:** dry-run-on-every-change preview · explicit separate commit · server-side fail-closed fairness · hash-chained exportable dossier with reversal records · per-row comms-failure isolation.

---

## Journey 2 — pipeline-advance → **L1-conditional**

The board and drawer are solid. A drag captures `prevStage` and posts `{action:"set_stage", toStage, expectedStage}` (`PipelineTab.tsx:501,506`); the DB does a **CAS** — `if expectedStage !== row.stage return null` — so a stale tab gets a **409 + fresh entry**, never a blind clobber (`db/pipeline.ts:1376-1380`; `[id]/route.ts:106-112`). Moves persist synchronously in a transaction and record a `moved` audit event capturing both `fromStage` and `toStage`, so a forward *and* a backward drag are both logged (`db/pipeline.ts:1388-1400`).

His bulk tool — the **NL command bar** — does exactly what he wants: `reject_below` / `advance_top` **previews the affected set + total with no mutation** (`command/route.ts:61-65`), the user sees the rows in `PassPreviewModal`, and execution requires `confirm:true`, routing every mutation through the **same guarded `actOnPipelineEntry(... actor:"human", expectedStage)`** — no new privilege (`command/route.ts:67-86,78-80`). The command bar returns an explicit "advanced X, rejected Y" summary (`CommandBar.tsx:129-141`).

The **unified candidate timeline** is genuine: `candidate-timeline.ts:38-80` merges analyses + interview session + schedule invites + offers + comms and `sort`s chronologically (line 78), and the drawer folds in pipeline events for one ordered feed (`CandidateDrawer.tsx:247-258`). Hand-offs aren't dead-ends — the drawer mints a scheduling/voice link at Interview and routes to Decisions for offer approval (`CandidateDrawer.tsx:377,905-931`).

**Findings:**
- **MAREK-P1 (MAJOR, trust — the sharp one):** The command-bar **`reject_below` bulk-rejects candidates WITHOUT sending them a rejection comm.** It calls `actOnPipelineEntry(e.id,"reject",…)` (`command/route.ts:78`), which only flips `status='rejected'` + writes the audit event (`db/pipeline.ts:1265-1267`) — it does **not** call `dispatchRejection`. The screen-wave is the safe path (it calls `dispatchRejection` explicitly, `screen-wave.ts:232`), but the command bar isn't wired to comms. So Marek's fastest bulk action **ghosts every candidate it rejects** — an auditable internal record, but the candidate hears nothing. This is his cardinal compliance fear (53% ghosting; "the org that *doesn't* ghost"). The preview shows *who*, but never says "these people will NOT be notified," so it reads as a normal reject. `command/route.ts:77-78` + `db/pipeline.ts:1265-1267`.
- **MAREK-P2 (minor, clarity):** A successful **drag move has no explicit confirmation** — the card moves optimistically and the board reloads silently; only a 409 surfaces an alert (`PipelineTab.tsx:504-511`; `CandidateDrawer.tsx:319-322`). For a coordinator who lives by "did it stick?", a quiet success is mild silent-success. (The move IS persisted + audited, so this is clarity, not integrity.)
- **MAREK-P3 (minor, missing):** The timeline joins **analyses by candidate label (case-insensitive), not entry id** (`candidate-timeline.ts:43-46`) — an honest line the code itself flags ("a fuzzy join would invent history for same-named strangers"). A renamed candidate or two same-named people could miss/mis-attribute analysis history. `l2_priority`: spot-check a renamed entry's timeline live.

**Strengths to protect:** expectedStage CAS (no stale clobber, 409 not silent overwrite) · command-bar preview→confirm on the same guarded action · genuine 5-source chronological timeline.

**Why conditional, not pass:** MAREK-P1 is a major trust/compliance gap on *his own* bulk surface; it carries forward to L2.

---

## Journey 3 — interview-schedule-prep → **L1-pass**

Minting an invite from the drawer **auto-dispatches the Czech invite to the candidate** and returns a `dispatched` flag, rate-limited 30/min/IP, with the comms failure isolated so the link still mints (`schedule/invite/route.ts:20-54`). The drawer shows an explicit **"✓ odkaz odeslán" / "⚠ neodesláno"** based on that flag (`CandidateDrawer.tsx:920-927`), and the invite lands in the durable **Outbox** (`comms-dispatch.ts:281-294`, `schedule_invite_sent` event) plus the recruiter-facing **InviteLifecyclePanel** (attention / upcoming / awaiting, reschedule count, RSVP). That is a direct answer to "odešlo to? a komu?".

**Slot integrity is airtight:** the candidate's `body.slot` is **ignored** — only a slot the server would offer is bookable, label re-derived server-side (`schedule/[token]/route.ts:145-156`); a past/un-offered time is a 400; an already-taken slot is a 409; the **zero-slots dead-end** is handled (idempotent `needsMoreSlots` flag + recruiter alert, lines 62-78). Reschedule is bounded (`MAX_RESCHEDULES=3`) and frees the old slot (`schedule-store.ts:260,281`).

**Prep pack grounding is rich, not thin:** `runInterviewPrep` → `runAutomationTask(entryId,"prep")` feeds the Python LLM the candidate's **full extracted profile** (`profile.json`), the **real role** (`--job-id`), and **GitHub evidence** — all folded into the cache key so a re-extracted CV invalidates stale output (`automation-run.ts:106-180`). Early-career entries get the **six-phase student script** instead of a mismatched chronology (`interview-prep-run.ts:42-44`). The AI `source` (llm/deterministic) rides in the payload and is disclosed in the modal via a `PrepSourceBadge` (`interview-prep-run.ts:46`; `InterviewPrepModal.tsx:291`). And his hand-entered work survives: **`humanScorecard`/`userProgress`/`interviewer` are re-merged on every Regenerate** (`interview-prep-run.ts:52-57`).

**Findings:**
- **MAREK-S1 (minor, clarity):** No **pre-mint preview** of *what the candidate will receive* before the invite auto-dispatches — Marek clicks "Create scheduling link" and it sends in the same step (`CandidateDrawer.tsx:911-927`). He sees the rendered Czech body only afterward in the Outbox. For a recruiter who "won't run a single wave if it fires silently," a one-line "this is what they'll get" before send would match his preview-first bar. (Mitigated: it's a single candidate, deterministic template, fully audited after.)
- **MAREK-S2 (minor, senior-quality):** `l2_priority` — the actual prep question *quality* (role/CV-specific vs generic) lives in the Python prompt, invisible to L1 and `scope_note` if keyless. The inputs are correctly grounded; whether the **output** clears Tomáš's "questions I'd actually ask" bar is an L2/keyed check.

**Strengths to protect:** auto-dispatch + `dispatched` flag + Outbox/lifecycle (answers "to whom") · server-authoritative slot booking (client slot ignored) · CV+JD+GitHub-grounded prep · human scorecard survives regen · Czech throughout.

---

## First-person feedback — Marek's voice (L1, over the designed experience)

> Tak tohle mě překvapilo — *příjemně*. Screeningová vlna dělá přesně to, co po nástroji chci: než cokoli odejde, ukáže mi **náhled** — koho by to odmítlo a proč — a ten seznam se mění, jak hýbu posuvníkem. Žádné tiché plně automatické zamítnutí: commit je *samostatné* kliknutí a po něm vidím, **co se reálně stalo** řádek po řádku, včetně toho, komu nedoručil e-mail. A když se spletu? Je tam fronta "Reconsider" — jedním klikem vrátím kandidáta zpět, a — což oceňuju nejvíc — ta reverze se *zapíše do auditní stopy*. Můžu regulátorovi exportovat celý zapečetěný řetězec. To je přesně ten nástroj, kterému svěřím 200 lidí.
>
> Čeština v zamítacím dopise je *lidská*, na úrovni banky. Tu zprávu bych podepsal.
>
> Co mě ale zarazilo a nedá mi to spát: ten **command bar**. "reject below 40" — ukáže mi koho, potvrdím, hotovo. Jenže ti lidé **nedostanou žádnou zprávu**. Vlna jim pošle slušné zamítnutí; command bar jim status změní a *mlčí*. To je přesně to, čeho se bojím — ghostnul jsem celou várku pod jménem ČS a nikdo mi neřekl, že odkaz na komunikaci tam prostě není. Audit záznam mám, ale kandidát neslyší nic. Dokud tohle nebude buď propojené s komunikací, nebo aspoň jasně napsané "tito lidé NEBUDOU vyrozuměni", budu reject dělat výhradně přes vlnu. Jeden nástroj mi šeptá, druhý mlčí — a já mlčení nedůvěřuju.
>
> Schedule je radost: pozvánka se **sama odešle** a já vidím "✓ odesláno komu", slot si server pohlídá sám (kandidát si nepodstrčí 3:00 v neděli), a přípravný balíček dostane skutečné CV i roli, ne nějaké generické fráze. Jen bych si přál vidět **náhled pozvánky** *předtím*, než odejde — ne až v Outboxu potom. Ale to je drobnost.
>
> **Adoptoval bych to** — pro screening a scheduling hned. Command-bar reject vypnu, dokud nezačne posílat zprávy. Kolegovi bych to doporučil s jednou větou: "Vlnu používej, command bar na odmítání ne."

---

### L2 hand-off (carried items)
- **MAREK-P1** (major): confirm live that a command-bar `reject_below` leaves the Outbox with **no rejection row** for the rejected candidates (vs the screen-wave which produces one). This is the journey-2 blocker-to-fix.
- **MAREK-P3**: renamed/duplicate-name candidate → does the unified timeline miss/mis-attribute analyses (label-join)?
- **MAREK-S2**: keyed prep run — are the questions genuinely role/CV-specific (Tomáš's bar)?
- **MAREK-D2 / S1**: cs rationale strings render with no English leak; pre-send invite body visible.

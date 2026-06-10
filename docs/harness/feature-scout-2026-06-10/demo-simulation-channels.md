# Feature Scout — Demo Simulation & Channels (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Promote the comms Outbox into a recruiter-facing Comms Center on the Channels tab
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/features/sub_channels/ChannelsTab.tsx:54` (no comms list anywhere on the tab), `app/features/sub_dev/OutboxSection.tsx:27` (the only Outbox UI — a display-only table buried in the Dev-extension tab), `app/api/devcase/comms/route.ts:13`, `app/_lib/db.ts:2997` (`listOutbox(limit=50)` — no ref/status/kind filter exists)
- **Gap**: Every candidate-facing message — acknowledgement, outreach, rejection, interview confirmation/reminder/invite, offer, onboarding (8 kinds) — lands in `dev_outbox` with `ref` = pipeline entry id, but the only UI is the Dev tab's 50-row table: subject truncated, body never shown, no link to the candidate, no filter, no actions. The Channels tab (where a recruiter thinks "candidate communications") shows only five static channel cards plus an inbound counter. A recruiter cannot answer "what did this candidate actually receive?" or "did anything fail to send?" without server logs.
- **Proposal**: Add `listOutboxFiltered({ ref?, status?, kind?, limit })` to db.ts and a recruiter route `GET /api/comms?entry=&status=`. Build a "Communications" panel on ChannelsTab: rows grouped per candidate (resolve `ref` → entry label/job via `getPipelineEntry`), kind + status chips reusing `comms-status.ts` styling, failed-first ordering with a loud dead-letter count, click → full message body + "Open candidate" (CandidateDrawer deep-link, same pattern as the board). Reuse the same per-entry query to add a "Messages" section in `CandidateDrawer` beside the PIPE3 History section (events say `rejection_sent`; this shows the actual letter).
- **Why users need it**: Comms are the product's promise ("never ghost a candidate") yet are invisible outside a dev surface; auditing what a candidate received is a daily recruiter task and a compliance need for adverse (rejection) messages.

## 2. Make dead-lettered comms recoverable: resend from the Outbox
- **Value**: High
- **Category**: functionality
- **Effort**: S
- **Where**: `app/_lib/comms.ts:76` (`failed` is terminal after bounded retry), `app/_lib/comms.ts:82-85` (`alertDeadLetter` → console.error + comms.log only), `app/features/sub_dev/OutboxSection.tsx:20-24` (failed rows styled loud but offer no action)
- **Gap**: When the relay dead-letters a message, the full subject/body/recipient/kind/ref sit in the `dev_outbox` row — but there is no retry path anywhere. Worse, the system *deliberately* never auto-resends: business actions are gated on durable event markers (`outreach_sent`, `hasEvent` pattern, harness-learnings W1), so re-running the automation will *skip* the send. A dropped offer or rejection stays dropped forever unless someone hand-crafts the email outside the product.
- **Proposal**: `POST /api/comms/[id]/resend` — load the outbox row, re-dispatch the stored message via `sendComm` (records a NEW row with the live channel's status; original row untouched, so the audit trail is append-only), and record a `comm_resent` automation event when `ref` resolves to an entry. Surface a "Resend" button on failed rows in the new Comms Center (#1) and in `OutboxTable`. The center shows latest-status-per-(ref,kind) so a successful resend visually clears the dead-letter.
- **Why users need it**: The dead-letter alert says "needs attention" but there is literally nothing a recruiter can do about it in-product; resend is the only recovery that doesn't bypass the audit log.

## 3. Localize candidate-facing comms (cs) and persist the applicant's locale
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/_lib/comms-dispatch.ts:44-48,75-86,128-139,193-198,212-217` (all 8 templates are hardcoded English literals), `app/api/apply/[id]/route.ts:2,284` (route already runs `getTranslations` — the candidate's locale is known at apply time — but only `contact` is persisted), `messages/en.json` (no `comms` namespace among the 24)
- **Gap**: Commit 7922fbe made every candidate-facing *page* (apply, offer, schedule, interview) bilingual and even threads `lang` through LLM prompts — but the emails between those pages stayed English-only. A candidate who applies in Czech gets a Czech chat, then an English acknowledgement, rejection, interview confirmation, offer letter and onboarding welcome. No locale is stored on `pipeline_entries`, so dispatch couldn't localize even if templates existed.
- **Proposal**: Add a nullable `locale` column to `pipeline_entries` (same idempotent ALTER seam as APP2's `contact`), captured from the request locale in the apply route. Move the 8 templates into `comms.*` keys in `messages/{en,cs}.json` and render via next-intl's server `getTranslations({ locale: entry.locale ?? "en", namespace: "comms" })` inside `comms-dispatch.ts` (it already receives the full entry on every dispatch). Recruiter-sourced entries default to `en` — purely additive, like APP2.
- **Why users need it**: The product demos to Czech customers (the scripted company is Česká spořitelna) and just shipped a 1439-key bilingual catalog; English-only rejections/offers to Czech applicants undercuts the headline candidate-respect and i18n stories at the exact touchpoint candidates actually keep.

## 4. Localize the demo simulation — the i18n pass skipped its entire surface
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/features/simulation/SimBar.tsx:47-77,102` ("Start simulation", "Pipeline simulation", phase labels), `app/features/simulation/SimulationProvider.tsx:339-586` (every step title/caption/log line is an English literal), `app/features/simulation/SimDecisionWave.tsx:16-23`, `app/features/simulation/SimExplainDrawer.tsx:30,61`, `constants.ts:76-84` (phase labels)
- **Gap**: `git show --stat 7922fbe` confirms `app/features/simulation/*` was untouched by the bilingual rollout: the guided demo — the most presentation-facing surface in the app, scripted around a Czech bank — plays out in English chrome, captions and explainer copy even when the workspace is in Czech. The eslint `no-literal-string` gate was never flipped on for this directory, so the gap will silently grow.
- **Proposal**: Add a `sim.*` namespace to `messages/{en,cs}.json`: SimBar/Drawer/Wave chrome via `useTranslations`, and the run-script titles/captions/log lines keyed (the `step()` calls take key+values instead of literals; `SimulationProvider` resolves through `useTranslations("sim")`, which the closure already can since it's a client component). Flip the per-directory eslint i18n rule to error, matching the migrated-tab convention. PlantUML diagram labels can stay English (technical notation) or follow later.
- **Why users need it**: The demo exists to sell the product; presenting to a Czech-speaking audience with a half-English walkthrough breaks the spell the i18n release just paid for.

## 5. Chapter replay — start the demo from any phase, not only the full 7-phase walk
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where**: `app/features/simulation/SimulationProvider.tsx:330-599` (single linear `run()`), `app/features/simulation/SimBar.tsx:110-113` (phase pills only navigate tabs — they don't drive the engine)
- **Gap**: The sim is one scripted walk: to re-show the screening wave or the offer moment, a presenter must reset and replay everything before it (minutes, or many "Next" clicks in step mode). The phase stepper looks interactive but only switches tabs. There's also no way to demo a single newly-shipped feature (e.g. the screening-wave dry-run) in isolation.
- **Proposal**: Add `start(fromPhase?: SimPhaseId)` — every phase already has a headless API fallback (`/api/jds/save` + `/publish`, `/api/sim/inbound`, `advanceTo`, `/api/sim/screen-draft|offer-draft`), so the engine can fast-forward the prior phases with beats/gates/spotlights skipped (a `fastForward` flag short-circuiting `beat`/`gate`), then run normally from the chosen phase. Wire it to the SimBar pills when idle ("Play from here") and keep plain-click = navigate while running.
- **Why users need it**: Presenters tailor demos to audiences (execs want Offer/Hired; ops want Screening); replaying one chapter is also the natural way to teach a single feature to a new user.

## 6. Presenter speed control for the demo
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `app/features/simulation/SimulationProvider.tsx:63` (`SLOW_FACTOR = 1.8` hardcoded; `beat()` multiplies every wait by it), `app/features/simulation/SimBar.tsx:142-168` (controls row)
- **Gap**: Every beat runs at a fixed 1.8× slow-down tuned for first-time viewers; the read-pauses (`beat(3400)` on the wave audit, `beat(2600)` on the group eval) can't be shortened for a rehearsing presenter or lengthened for a translating one. The only pacing levers are Pause and full step mode.
- **Proposal**: Make the factor a ref-backed setting (`0.7× / 1× / 1.8×` presets) rendered as a compact segmented control next to Step in the SimBar, read inside `beat()` each iteration (it already polls in 60 ms slices, so mid-beat changes apply instantly). Persist the choice in `localStorage` like the board's saved views.
- **Why users need it**: Rehearsals and repeat demos are run at "yes yes, faster" speed; live translation or Q&A-heavy sessions need the opposite — one knob covers both without touching the script.

---
## Cross-checks performed
- Read `docs/harness/feature-scout-2026-06-08/INDEX.md` + `harness-learnings.md` for dedup: APP2/APP3 (contact + ack), VOX1 (interview invite), JOB3 (outreach) all SHIPPED — none re-proposed; my #1/#2 are read/manage surfaces over those sends, which no prior item covered. Retired Med/Low backlog (VOX2/4/5, JOB5, DEC5/6, PREP4, SCH4, all-tabs-PDF) — no collisions (VOX5 is voice-runtime language, distinct from #3's comm templates).
- Read `docs/harness/ui-bug-scan-2026-06-08/demo-simulation-channels.md` (same context, defect lens, all 4 findings fixed — reset race, getEntries throw-on-non-OK, offer-link try/catch, modal z-order verified fixed in current source). No overlap with these features.
- Grepped `dev_outbox|recordOutbox|listOutbox|OutboxEntry` repo-wide: the ONLY readers are `/api/devcase/comms` (limit-50, no filters) and `OutboxSection` (display-only; body/ref never rendered) — confirmed no existing comms center, no per-entry message view (`CandidateDrawer` fetches only `/api/pipeline/events`, PIPE3).
- Globbed `app/api/comms/**` (no files) and grepped `resend|requeue` in comms.ts/comms-dispatch.ts (no matches) — confirmed no resend path; `failed` is terminal (`comms.ts:76`); dead-letters surface only via console.error + `comms.log` (`logger.ts:85`).
- Grepped `locale|language` in `comms-dispatch.ts` (zero matches) and `db.ts` (no entry-level locale; only jobs.languages + interview_sessions.language); read `app/api/apply/[id]/route.ts:1-70,270-323` — locale available via `getTranslations` but not persisted.
- `git show --stat 7922fbe` — confirmed the i18n commit touched ChannelsTab but NOT `app/features/simulation/*`, `sub_dev/*`, or comms templates; `messages/en.json` namespaces (24) include neither `sim` nor `comms`.
- Read all 19 context files + consumers (`OutboxSection.tsx`, `DevTab.tsx` usage, `apply/[id]/route.ts`, `tabs.ts` NAV_GROUPS, `db.ts` outbox/schema sections, `logger.ts`, `criteria/diagrams` heads); verified sim mount point (`Workspace.tsx:82,174`) and that `run()` has API fallbacks for every phase (basis for #5).

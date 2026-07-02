# L1 theoretical — Marek Beneš (Recruiting Coordinator) × interview-schedule-prep

- **Run:** 2026-07-02-full · main @ 3395b4c · cert_level L1 (code-only, no browser)
- **Journey:** self-scheduling invite → candidate slot pick → prep pack + rubric
- **Verdict:** **L1-conditional** (journey completes structurally end-to-end; 3 majors carry to L2)
- **Grounding score (journey):** 6/8 (prep surface; Marek's comm templates are fully grounded for their scope)
- **Estimated time saved (if it all worked):** ~10–13 min per scheduled interview vs email ping-pong (high confidence, structural); bulk path multiplies it but its confirmation is untrustworthy today (see MAREK-ISP-2)

---

## 1. Surface model (affordances → code, import chains followed)

### A. Minting the invite (recruiter side — Marek's surface)
- **Per-candidate:** Pipeline tab → CandidateDrawer → "Create scheduling link" button — `app/features/sub_pipeline/CandidateDrawer.tsx:871-878`, wired via `useTokenLink("/api/schedule/invite")` (`CandidateDrawer.tsx:89`, `TokenLink.tsx:16-57`). After mint: copyable absolute URL + open-as-candidate (`TokenLink.tsx:62-92`) **and an explicit delivery state** — green "invite sent" vs amber "not sent" from the `dispatched` flag (`CandidateDrawer.tsx:883-887`).
- **Bulk:** Pipeline tab bulk bar → `bulkInvite()` → `POST /api/schedule/invite/bulk` (`app/features/sub_pipeline/PipelineTab.tsx:510-537`; `app/api/schedule/invite/bulk/route.ts:19,58-69`).
- **API:** `POST /api/schedule/invite` — rate-limited 30/min/IP (`app/api/schedule/invite/route.ts:20`), creates the invite row with the planned duration (`route.ts:28-36`, `plannedInterviewMinutes` `app/_lib/interview-run.ts:232-242`), then **auto-dispatches the link to the candidate** best-effort (`route.ts:43-52` → `dispatchScheduleInvite` `app/_lib/comms-dispatch.ts:350-363`), returning `{token, url, dispatched}` (`route.ts:54`). A minted-but-undelivered invite is distinguishable (the `dispatched` flag + `[schedule:invite]` error log) — not silently lost.
- **Delivery channel (ship-bar):** `sendComm` → durable local **Outbox** by default (status `queued`, *terminal* in dev — the outbox IS the delivery target) or a real HTTP relay when `COMMS_WEBHOOK_URL` is set, with retry + dead-letter alerting (`app/_lib/comms.ts:12-23,37-42,53-95,97-100`). Recipient contract: real `contact` if captured at inbound apply, else the **candidate display name** (`comms-dispatch.ts:62-68`) — seeded/Match-sourced entries resolve to a name a real relay would dead-letter. Every send records `schedule_invite_sent` (`comms-dispatch.ts:362`) → auditable in the drawer history + Channels/Outbox.

### B. Candidate slot pick (tokenized public page — Tereza's surface, structurally audited here)
- `/schedule/[token]` → `SchedulePicker` (`app/schedule/[token]/SchedulePicker.tsx`): GET invite + slots (`:59-81`), slot buttons (`:356-369`), booked card with `.ics` download (`:146-157,243-251`), reschedule under cap (`:252-263,305-326`), RSVP confirm/cancel (`:162-204,265-293`), timezone note (`:353-355`), zero-slot card (`:338-350`).
- **API GET** `app/api/schedule/[token]/route.ts:53-81`: public projection only (`publicInviteView` `:34-50` — entryId/reconcileReason kept off the wire), zero-slot horizon flags the invite for the recruiter (`:70-79` → `flagScheduleInviteNeedsMoreSlots` `app/_lib/schedule-store.ts:354-362`).
- **API POST** `:85-265`: rate-limited (`:90`), terminal-entry guard (`:139-144`), **server-side slot validation** — only a slot the server would offer is bookable, label re-derived, client `body.slot` ignored (`:153-157` → `offeredSlotFor` `app/_lib/schedule-slots.ts:146-164`), collision-safe synchronous transactions (`schedule-store.ts:224-234`), reschedule bounded by `MAX_RESCHEDULES = 3` (`schedule-store.ts:260,274-286`), booking records the slot on the entry via `approve_event` with drift-flagging when the pipeline can't advance (`route.ts:167-180`), then confirmation + interviewer brief dispatch with an honest `confirmationSent` (`route.ts:181-219,242,258-259`).

### C. Schedule tab (Marek's monitoring + manual confirm surface)
- `app/features/sub_schedule/ScheduleTab.tsx`: loads calendar-approval entries (`:79-100`), week grid `ScheduleCalendar` (Mon–Fri × 08:00–17:00, `ScheduleTypes.ts:17-22`), per-card Confirm/Decline (`:320-345` — decline is confirm-gated, a past misclick fix), prep + interview buttons.
- **Manual confirm** posts `approve_event` with the picked `"Day HH:MM"` string (`ScheduleTab.tsx:175-183` → `app/_lib/db/pipeline.ts:1296-1321` — detail stored verbatim as the slot).
- **InviteLifecyclePanel** (`InviteLifecyclePanel.tsx`): attention rows (`needs_more_slots`, `needs_reconcile` with reason, `:63,82-98`), upcoming agenda with candidate TZ / reschedule count / RSVP / reminder status (`:101-131`), awaiting-booking list with cancelled-attendance flag (`:133-155`). Loads once per mount (`:35-53`).

### D. Prep pack + rubric — see the Tomáš report for the full chain; Marek's stake is the human-input seam: regeneration re-merges `humanScorecard`/`userProgress`/`interviewer` (`app/_lib/interview-prep-run.ts:52-57`), so a Regenerate can't wipe hand-entered work — **holds**.

## 2. Reachability (resolved before judging)

- Marek = internal user, dev gate on → Pipeline, Schedule, Channels all reachable (no per-role nav gating). Fixtures needed: seeded pipeline with `approvalKind: "calendar"` entries + `seed_interview_calendar.py`.
- `/schedule/[token]` is **candidate-territory** (Tereza's surface per his binding) — candidate-side items below are structural audits, their live UX verdict defers to her L2.
- **Token fixture note for L2 (resolves env.md open question #3 for this journey):** `POST /api/schedule/invite` echoes `{token, url}` (`route.ts:54`) and the drawer displays the absolute link (`CandidateDrawer.tsx:880-888`) — L2 can mint the candidate fixture directly from the drawer, then open it with `DEV_AUTH=0`.

## 3. Cognitive walkthrough (in-character)

1. **Will I try the right action?** On the Schedule tab — where "pošlu pozvánku" starts in my head — there is **no invite-mint affordance** at all; I must know it lives in the Pipeline drawer or bulk bar (finding MAREK-ISP-5). Once in the drawer, "Vytvořit odkaz pro plánování" is obvious.
2. **Will I notice it worked?** Yes — link + explicit sent/not-sent per invite (`CandidateDrawer.tsx:883-887`). *Bulk*: no — "invited: N" counts minted links, not deliveries (MAREK-ISP-2).
3. **Label ↔ intent:** good; the drawer's "Revoke links" reads like it pulls *every* live link but only revokes voice sessions — the scheduling token stays live (MAREK-ISP-3).
4. **Progress/feedback after the candidate acts:** the lifecycle panel finally shows the whole life of an invite — booked agenda, stalled invites, reconcile drift with reason (`InviteLifecyclePanel.tsx:82-131`). "Odešlo to? A komu?" — answered by the Outbox row + events. Strong.
5. **Does it advance the job?** Yes: mint → auto-deliver → candidate self-books → slot on the entry + confirmation + reminder + interviewer brief, all recorded.
6. **Do I trust it?** Candidate-side booking: yes (server-validated, collision-safe, capped). Recruiter-side manual confirm: **no** — my picked slot is a dateless free string nobody validates against anything (MAREK-ISP-1).

## 4. Scored acceptance criteria (identical every run)

| Criterion | Verdict | Evidence |
|---|---|---|
| completion — schedule end to end without dead-end | **pass** | mint `invite/route.ts:28-54` → book `[token]/route.ts:247-259` → confirm+record `:167-220`; zero-slot dead-end handled `:70-79` |
| trust/clarity — dry-run/preview before bulk commit | **FAIL (major)** | `PipelineTab.tsx:510-537` bulk invite fires immediately, no preview of recipients/rendered message (bulk reject by contrast is confirm-gated `:478,486`) |
| clarity — explicit confirmation + audit trail per dispatch | **partial** | single: `dispatched` flag + Outbox row (`CandidateDrawer.tsx:883-887`, `comms.ts:40`); bulk: delivery outcome dropped (`PipelineTab.tsx:523-525` vs `bulk/route.ts:19`) |
| trust — undo/recall for candidate-facing sends | **FAIL (major)** | no revoke/expiry for schedule invites (`schedule-store.ts` — none exists); "Revoke links" covers voice only (`api/interview/revoke/route.ts:18`) |
| senior-quality — invite copy warm, on-brand, personalized, no merge errors | **pass w/ blemish** | localized template per candidate locale (`comms-dispatch.ts:350-363`, cs.json:211); but the slot label in confirmation emails is English-anchored ("Tue 10 Mar · 10:00") inside Czech copy (MAREK-ISP-4) |
| trust — scheduling validates the confirmed slot | **split: FAIL manual / pass self-serve** | candidate path validates + collision-checks (`schedule-slots.ts:146-164`, `schedule-store.ts:224-234`); manual Schedule-tab confirm stores any string, no date, no clash check (`ScheduleTab.tsx:175-183`, `db/pipeline.ts:1303`) |
| time-saved — batch beats one-by-one AND stays reviewable | **conditional pass** | bulk exists (P2-2) but review/undo gaps above force manual Outbox re-checking |
| language — UI + candidate messages in Czech | **pass w/ blemish** | `scheduleTab` + `schedule` + `comms.scheduleInvite` all in cs.json (:1624, :599, :211); slot-label blemish above |

## 5. Findings (details in `interview-schedule-prep.findings.json`)

- **MAREK-ISP-1 (major, trust):** two parallel booking systems — the manual grid confirm bypasses all slot validation/collision and stores a dateless label; can double-book against candidate self-bookings. (Backlog `idea-b0c16e22` exists; still open.)
- **MAREK-ISP-2 (major, trust/clarity):** bulk invite = no dry-run + per-invite delivery outcome discarded → "invited: 12" can mean 12 minted, 0 delivered.
- **MAREK-ISP-3 (major, trust):** a live scheduling token cannot be revoked; the "Revoke links" affordance implies it can.
- **MAREK-ISP-4 (minor, language):** English slot label interpolated verbatim into Czech candidate emails.
- **MAREK-ISP-5 (minor, confusion):** the invite-mint affordance is absent from the Schedule tab where the journey mentally starts.
- **MAREK-ISP-6 (polish, effort):** lifecycle panel loads once per mount — bookings landing while the tab is open don't appear.
- **MAREK-ISP-7 (minor, by-design + ceiling):** delivery is Outbox-simulated by default; seeded entries' recipient is a display name.
- **Strengths:** MAREK-ISP-S1 (slot integrity + collision transactions + reschedule cap + terminal-token guard), MAREK-ISP-S2 (auto-dispatch + honest sent/unsent/confirmationSent/short-notice states), MAREK-ISP-S3 (no silent dead-ends: noSlots flag → attention row; booked-but-not-advanced drift flagged with reason).

## 6. Character feedback (first person)

> Tohle je poprvé, co vidím celý život pozvánky na jedné obrazovce — kdo má termín, kdo ještě nebooknul, a hlavně ta červená sekce „vyžaduje pozornost": kandidát viděl plný kalendář, rezervace se nepropsala do pipeline — *s důvodem*. To je přesně můj svět. A když mintnu odkaz, systém mi řekne „odesláno" nebo jantarově „NEodesláno" — na to se ptám vždycky a poprvé dostávám odpověď rovnou, s řádkem v Outboxu, na který můžu ukázat.
>
> Kandidátská strana rezervace je udělaná poctivě: server nabízí, server validuje, kolize řeší transakce, přebookování má strop. Podepsal bych.
>
> Ale tři věci mi nedají spát. Za prvé: když termín potvrdím **já** v tom týdenním gridu, nikdo nic nevaliduje — uložím „Tue 14:00" bez data a bez kontroly, jestli si to úterý ve 14:00 už někdo nezabookoval sám. Dva kalendáře, které o sobě nevědí — to je přesně ta chyba se špatným datem, kvůli které jsem tady. Za druhé: hromadná pozvánka — kliknu, ono to řekne „pozváno 12", a já nevím, jestli 12 odešlo, nebo jestli se jich 12 jen vymintilo a nula doručila. Bez preview, bez rozpisu. Takže to stejně půjdu ručně zkontrolovat do Outboxu, jednu po druhé — a tím je úspora času pryč. Za třetí: když pošlu pozvánku špatnému kandidátovi, nemám ji jak stáhnout. Tlačítko „zrušit odkazy" tam je, ale na plánovací token nesahá. Nevratná akce pod hlavičkou banky bez cesty zpět — to u mě neprojde.
>
> Adoptoval bych? Pro jednotlivé pozvánky ano, hned — je to poctivější než cokoliv, co dnes máme. Hromadně až po těch třech opravách. A tu anglickou zkratku dne v českém e-mailu („Tue 10 Mar") bych nechal přepsat, než to uvidí první kandidát.

## 7. L2 handoff (priorities)

1. Double-book live: candidate books Tue 14:00 via token, then confirm the same wall-clock slot from the manual grid — does anything object? What lands in the candidate's comm? (MAREK-ISP-1)
2. Bulk-invite with comms forced to fail → what does the UI report? (MAREK-ISP-2)
3. Mint an invite for the wrong candidate → attempt any recall path; confirm the token still books. (MAREK-ISP-3)
4. Inspect a real cs confirmation Outbox body for the mixed-language slot label. (MAREK-ISP-4)
5. Confirm the lifecycle panel refresh behavior during an open session. (MAREK-ISP-6)

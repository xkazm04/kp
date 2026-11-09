# Channels scope and OSS-wrap T-items: pre-analysis against main (2026-10-28)

Read-only analysis against main at `9ed44126f`. No code changed. Every "on main" claim cites a
commit that is an ancestor of `9ed44126f` (checked with `git merge-base --is-ancestor`) or a
`file:line` on that tree.

## Where the definitions came from

- **Channels (Part A).** ADR 0028 names C4..L2 only in its build order. The item text is in
  the gitignored tiger scope file
  `C:\Users\kazda\kiro\kp\tiger\hunts\2026-10-17-comms-channels\scope.md`, which I read but did
  not modify. Its definitions are C4 at `:51-58`, C5 `:60-70`, C6 `:72-83`, S2 `:98-107`, S3
  `:109-118`, L1 `:122-127`, L2 `:129-134`, and the build order at `:137`.
  - **Naming collision.** The repo already uses "L1/L2" for two other ladders.
    `docs/features/comms/README.md:992` ("### L1 — the always-on edge") is the local-first edge
    ladder, which shipped in August. `docs/features/pipeline/README.md:693-694` uses L1/L2 for
    the Orbit zoom levels. Neither is the scope's L1/L2. The comms README's "L1 section" is
    therefore not the L1 item.
- **OSS wrap (Part B).** The T-list is not in a tracked file, and "OSS wrap" appears nowhere in
  the tree or the git log.
  - The list is in the cx vault `C:\Users\kazda\Documents\Obsidian\kp\Cx\triage.md`, which
    `.claude/cx/config.md:4-5` names. The items are at `:6-53` (T1..**T15**) and the operator
    decisions of 2026-10-22 at `:55-72`.
  - The vault's checkboxes are all still `[ ]`, although git shows most items landed.
  - Commit bodies confirm the numbering: `88f8ad83b` (T1), `70c0c52f3` (T2), `0e50a4dd5` (T6),
    `01a80e42e`/`2a631c70a`/`5abd67318` (T8) and `cd9dce69e` (T14).
- **T7 wording conflict.** The brief calls T7 "owner-confirmed offers". The vault defines it as
  "once a relay is configured, **offer to send the letters that were queued before it**", and
  the decision reads "OFFER, OWNER CONFIRMS … one Send; nothing automatic" (triage.md:26-27,
  :63).
  - It is not about job offers. Job offers are already human-gated by default
    (`offerGate: "human"`, `app/_lib/decision-config-schema.ts:298`).
  - `docs/features/comms-smtp.md:54,:128` is consistent with the vault reading.

## C2b: fully landed, but ADR 0028 cites an unreachable sha

- **Release card.** ADR 0028:27 cites `02840920d`, which is **not an ancestor of main**. Its
  patch-identical twin `a5d958fce` (2026-10-18) is on main: `git patch-id --stable` gives
  `57d11187…` for both.
- **Bulk dry-run sheet.** `74b8e2beb` (2026-10-23) is on main.
- **Both files exist on main:**
  - `app/features/hiring/pipeline/candidate/outreach/OutreachReleaseCard.tsx`
  - `.../outreach/BulkOutreachSheet.tsx`
- **Hardening after C2b:** `cd075cc39` (release claims an approved letter by CAS on
  `updated_at`), `9d8a7f87c` (release door rate-limited), `a36fb6b59` (subject cleaned and
  capped).
- **Leftovers (doc only):**
  - ADR 0028:27 should cite `a5d958fce`.
  - ADR 0028:143-144 ("Until the bulk dry-run sheet lands, batch outreach has no bulk
    release…") is stale.
  - ADR 0028:27-29 still lists C4 as not built (see C4 below).
- **C2 debt still documented** in `docs/features/comms/README.md`:
  - `:1526-1531`: the outreach task maps the `replied`/`manual`/`candidate` halts to
    `suppressed_consent_expired`.
  - `:1532-1535`: the outreach-letter doors answer with the borrowed codes
    `PIPELINE_ENTRY_NOT_FOUND` / `PIPELINE_MOVE_CONFLICT`.
  - Both are part of scope C2 (scope.md:37-38) and are small. They are listed below as
    **C2-debt**.

---

# Part A: channels

**Parking rule applied:** an item is **PARKED** when it needs a schema change, money, a new
secret or service, or an owner-level design call.

### C4: connector catalog with one health contract. LANDED (the ADR is stale)
- **Definition (scope.md:51-58).**
  - A server-side catalog with write-only secrets and `probe()`.
  - `health()` returns exactly one of connected / not_configured / failing / unverified, plus
    `sealed`.
  - Each row carries `lastOkAt` and `lastFailure`; a row saved without a probe reads
    `unverified`.
  - `GET /api/connect` aggregates.
- **On main:**
  - `89edcf23a` ("connector catalog with one health contract (C4)", 2026-10-22).
  - Hardening `f6118467a` (the relay probe no longer follows redirects).
  - `HEALTH_WORDS` at `app/_lib/connect/catalog.ts:19`; `CONNECTOR_IDS` at `catalog.ts:28-33`.
  - A version-bound probe memory makes an unprobed row read `unverified` (`catalog.ts:188`).
  - In-process `lastOkAt` (`catalog.ts:178`).
  - The 1-hour free/busy probe is `app/_lib/connect/probes.ts:128-134`; the authenticated ATS
    GET is `probes.ts:103-109`.
  - `GET /api/connect` is `app/api/connect/route.ts`.
- **Missing:**
  - There is no `smtp` row. SMTP landed later (`0e50a4dd5`, `7637ebb98`), and `CONNECTOR_IDS`
    (`catalog.ts:28-33`) lacks it, although a seal-first probe exists
    (`app/_lib/comms-smtp-probe.ts`).
  - `docs/features/connect/` has no entry in `scripts/docs/feature-doc-map.json`.
  - ADR 0028:27-29 and its `sources:` omit C4.
  - Durable `lastOkAt` across restarts is a recorded gap (`docs/features/connect/README.md:70`)
    that needs a column. It is **parked; do not include it**.
- **Files:** `app/_lib/connect/catalog.ts`, `app/_lib/connect/probes.ts`,
  `app/_lib/connect/catalog.test.ts`, `scripts/docs/feature-doc-map.json`,
  `docs/features/connect/README.md`, and
  `docs/architecture/decisions/0028-one-message-identity-and-one-egress-seal-for-every-channel.md`.
- **Acceptance (in `catalog.test.ts`):**
  - `CONNECTOR_IDS` includes `"smtp"`.
  - With no SMTP stored, the row reads `not_configured`.
  - With `KP_NO_COMMS_EGRESS=1`, it reads `sealed` and a socket/fetch spy counts 0.
  - Separately, `npm run docs:check` stays green after the ADR edit.
- **Effort 1 / impact 2 / risk 1.**
- **Needs:** no schema, money or secrets, and no owner call. **Not parked.**

### C5: the Connect hub, with repair
- **Definition (scope.md:60-70).**
  - Mount the catalog as a Connectors deck in the Night Post, keeping its six buildings and
    L0-L3.
  - `?tab=integrations` redirects there, preserving the calendar OAuth landing.
  - It is the first UI reader of `GET /api/ats/deliveries`: due / dead / stranded with Replay.
  - A revoked calendar becomes a need with Reconnect in `rankNeeds`.
  - The relay plate shows the last delivered message (C1) and the latest failure.
  - Missing busy data reads unknown, not free.
- **On main:**
  - The data layer is C4 (above).
  - `app/api/ats/deliveries/route.ts` exists with `deliveries-route.test.ts`.
  - Malformed free/busy already reads as unavailable (`app/_lib/calendar/google-calendar.ts:155`,
    `:177-180`, returns `null`).
  - `lastDeliveredAt` is on the `/api/comms` read (`docs/features/comms/README.md:1558-1560`, C1).
- **Missing:**
  - **No UI reads either `/api/connect` or `/api/ats/deliveries`.** A grep of `app/features`
    for both paths returns nothing, and `docs/features/connect/README.md:5` says the same.
  - There is no probe door: `app/api/connect/` holds only `route.ts`, which is GET only.
  - There is no Connectors deck.
  - `integrations` is still its own tab (`app/features/shell/tabs.ts:66`, `:291`), with no
    redirect.
  - `rankNeeds` (`app/features/hiring/channels/night/channelsNightPlumbing.ts:307`) has no
    revoked-calendar need. Its only edge need is `edge-failing` (`:332`).
  - The Night Post uses its own health words. `sealed` is drawn only for the edge
    (`channelsNightPlumbing.ts:189`).
- **Files:**
  - New `app/api/connect/[id]/probe/route.ts`. It dials out, so it needs a `rateLimit()` and a
    `app/api/rate-limit-contract.test.ts` entry.
  - New `app/features/hiring/channels/night/connectors/*` (deck plus a pure model and its test).
  - Edits: `channelsNightPlumbing.ts` (calendar need), `ChannelsNight*` level wiring, the
    `integrations` redirect in `app/features/shell/`, `messages/{en,cs,de,fr}.json`,
    `docs/architecture/api-reference.md` (`npm run api:docs`) and
    `docs/features/connect/README.md`.
  - Also the Night Post doc this tab maps to in `feature-doc-map.json`.
- **Acceptance:**
  - A pure model test: `sealed` and `not_configured` render different label keys.
  - A route test: under the seal, `POST /api/connect/comms_relay/probe` answers
    `{health:"sealed"}` with 0 fetches.
  - An ATS deliveries fixture at 500 gives the L0 headline "n outcomes did not reach your ATS";
    Replay re-queues the row.
  - A revoked grant appears as a need.
  - A fresh keyless DB shows every connector `not_configured`.
- **Effort 3 / impact 3 / risk 2.**
- **Needs:** no schema, money or secrets. The placement is decided by the scope text, so
  there is no new owner call. Making the redirect retire the Settings → Integrations tab
  changes a shortcut chord (`workspaceChords.test.ts:74`); keep the chord pointing at the new
  home. **Not parked.**

### C6: a reply door on every letter, one thread per candidate. PARKED
- **Definition (scope.md:72-83).**
  - A third footer capability link `/reply/<token>`, beside `/data` and `/stop`. GET never
    writes.
  - Interested / Not now / Stop plus a note.
  - The relay callback accepts `outcome: reply` with a messageId.
  - A `candidate_replies` table keyed to the C1 id. A reply halts outreach on a fact.
  - A reply clock in `rankNeeds` until a C2-gated answer leaves.
  - One thread view per candidate. Works keyless.
- **On main:** nothing. A grep of `app/` for `candidate_replies` and `/reply/` returns nothing.
  Today a reply is still inferred by the duplicate-lead guess (`app/_lib/inbound-lead.ts:180`,
  `outreach_halted` "candidate replied").
- **Missing:** all of it. That is the new table, a new public token route, a footer link in
  `app/_lib/comms-dispatch.ts`, a callback outcome in `app/api/comms/callback/route.ts`, a
  `rankNeeds` clock, a thread view, the erasure scrub, a tenancy entry plus a
  `*-tenancy.test.ts`, and 4-locale copy.
- **Files:** `app/_lib/db/core.ts`, new `app/_lib/db/candidate-replies.ts`,
  `app/_lib/tenancy.ts`, `app/reply/[token]/*`, `app/api/reply/[token]/route.ts`,
  `app/_lib/auth/public-routes.ts`, `app/_lib/comms-dispatch.ts`,
  `app/api/comms/callback/route.ts`, `app/_lib/inbound-lead.ts`,
  `app/_lib/db/pipeline.ts` (erasure), `channelsNightPlumbing.ts`, `messages/*` and
  `docs/features/comms/README.md`.
- **Acceptance:** scope.md:80-83 verbatim.
  - The released body contains `/reply/<token>`.
  - A GET leaves every row count unchanged.
  - POST interested → 1 reply row bound to the messageId, and the next outreach is refused
    `replied`.
  - 5 unanswered business days → a need.
  - Erasure blanks the notes.
  - Keyless makes 0 network calls.
- **Effort 4 / impact 4 / risk 3.**
- **Needs:**
  - **Schema change:** a new table plus a `replied_at` field.
  - A new public capability surface, which falls under the review constitution's "new route
    with no auth posture" rule and must be declared public.
  - No money or secrets.
  - **PARKED (schema).**

### S2: ATS ingest runtime, field-map UI, test-connection. PARKED
- **Definition (scope.md:98-107).**
  - A credential broker `withAtsAuth` replaces direct `getAtsToken`.
  - Split `ingestAtsApplications` into a read-only `decide` and an `apply`.
  - An ATS sync pass beside the L0 pull pass, with `pullOneSource`'s bounds and paused with
    the clock.
  - Unmapped vendor stages are quarantined.
  - A field-map editor with a "fetch 5 samples" dry run, plus an inbound probe.
- **On main:**
  - Tokens are AES-GCM at rest, with a legacy plaintext read path
    (`app/_lib/ats/connections-store.ts:150-161`).
  - `getAtsToken` is called outside its store only by the C4 probe
    (`app/_lib/connect/probes.ts:109`).
  - `ingestAtsApplications` is a single function (`app/_lib/ats/ingest.ts:119`).
  - The inbound probe exists (`probes.ts:103`, via C4).
  - The L0 pull pass is at `instrumentation-node.ts:384-386`, and it has no ATS sync pass.
  - The providers are `recruitee`/`recruitis`/`teamio` (`connections-store.ts:70`).
- **Missing:** the broker, the decide/apply split, the sync pass with an applied-only cursor,
  the stage quarantine, the field-map editor and the dry run.
- **Files:** `app/_lib/ats/connections-store.ts`, `app/_lib/ats/ingest.ts`, new
  `app/_lib/ats/sync-pass.ts`, `instrumentation-node.ts`, `app/api/ats/connections/route.ts`,
  `app/features/settings/integrations/*`, `messages/*` and
  `docs/features/integrations/README.md`.
- **Acceptance:** scope.md:105-107.
  - A Recruitee fixture of 120 runs in ticks of 50; a re-run creates 0.
  - An erased candidate stays erased.
  - 6 unmapped rows are held and excluded from automation.
  - The dry run writes 0 rows.
  - A grep test finds `getAtsToken` called only by the broker.
- **Effort 4 / impact 4 / risk 3.**
- **Needs:**
  - **Schema change, likely.** An applied-only cursor and a quarantine state need storage that
    `ats_connections` does not have today. Confirm before building.
  - No money, and no new secrets (it uses the existing per-provider token).
  - **PARKED (schema, unconfirmed).** A first slice that needs no storage could ship
    unparked: the broker plus the decide/apply split, with the grep test as acceptance.

### S3: Greenhouse and Lever, shadow first. PARKED
- **Definition (scope.md:109-118).**
  - Harvest v3 (the customer's OAuth client credentials) and Lever (the customer's API key)
    adapters on S2.
  - A lifecycle `saved → probed → shadow → live_in → live_out`, with each promotion by a named
    operator.
  - Shadow reports what kp would create, link, skip or hold, with no PII stored.
  - Write-back goes through `ats_delivery` with a vendor sink.
- **On main:**
  - There are no Greenhouse/Lever ATS connectors (`ATS_PROVIDERS`, `connections-store.ts:70`).
  - The only Greenhouse/Lever code is the job-seeker public-board readers
    `app/_lib/jobseeker/adapters/ats/greenhouse.ts` and `lever.ts`. They belong to another
    surface but are reusable for field shapes.
- **Missing:** all of it.
- **Files:** new `app/_lib/ats/providers/{greenhouse,lever}.ts`,
  `app/_lib/ats-delivery-store.ts`, `app/_lib/ats-egress.ts`, `app/_lib/connect/catalog.ts`,
  `app/_lib/db/core.ts`, the settings UI, `messages/*` and
  `docs/features/integrations/README.md`.
- **Acceptance:** scope.md:115-118.
  - A Greenhouse fixture of 120 apps: shadow writes 0 entries, 0 links and makes 0 vendor
    calls, and reports 101/10/3/6.
  - live_in gives identical verdicts.
  - A shadow reject gives 1 `ats_delivery` row with status `shadow` and 0 POSTs.
  - The same suite runs for Lever; the seal gives 0 calls.
- **Effort 5 / impact 4 / risk 4.**
- **Needs:**
  - **Schema** (lifecycle state, a `shadow` delivery status).
  - **New secrets** (a Greenhouse OAuth client, a Lever key, both customer-owned). The services
    are approved (2026-10-17).
  - Blocked on S2.
  - **PARKED.**

### L1: email replies via a signed Reply-To token at the edge. PARKED
- **Definition (scope.md:122-127).**
  - `kp.comm.v1` gains `replyTo: r-<messageId>-<mac>@<domain>`.
  - The edge `email()` handler keeps text/plain only, strips quoted history, caps at 16 KB and
    stores sealed.
  - An `Auto-Submitted` reply halts nothing.
  - The scope text itself says it **"needs a MIME-parser dependency decision"**.
- **On main:**
  - The edge `email()` handler exists (`edge/src/index.ts:578`) and stores **headers only**
    (`edge/src/index.ts:46`; `docs/features/comms/README.md:1545-1548`).
  - There is no `replyTo` in `app/_lib/comms*.ts` or `edge/src/index.ts` (grep finds none).
- **Missing:** all of it. It depends on C6, which is not built.
- **Files:** `edge/src/index.ts`, `edge/test/*`, `app/_lib/edge-drain.ts`,
  `app/_lib/comms.ts` (envelope), `package.json` in `edge/` (the parser) and
  `docs/features/comms/README.md`.
- **Acceptance:** scope.md:126-127. An edge reply to the token lands in the C6 thread; an
  auto-reply is stored `auto_reply` and halts no clock; a forged token is filed unmatched.
- **Effort 4 / impact 3 / risk 4.**
- **Needs:**
  - **An owner call** on the MIME dependency, and on a receiving domain plus Cloudflare Email
    Routing.
  - A Worker redeploy.
  - Blocked on C6 (schema).
  - **PARKED.**
- A separate, smaller, unparked edge fix exists:
  `docs/features/comms/README.md:1561-1562` notes that the edge drain does not forward
  `messageId` on a receipt. It is not L1, and it needs a Worker redeploy. **That
  redeploy is an operator act.**

### L2: one completion record per hiring decision. PARKED
- **Definition (scope.md:129-134).**
  - Record the intended effects per decision (letter, ATS mirror), because a rejection today
    commits, tries the letter and mirrors to the ATS independently.
  - Show one recovery card that repairs only the missing effect.
  - A late bounce reopens the card.
- **On main:**
  - The independent effects are visible in `app/_lib/pipeline-entry-action.ts`: imports at
    `:12-13` (`dispatchRejection`, `dispatchAtsEvent`), the call at `:657`.
  - There is no completion record. A grep of `app/` for `completion_record`, `decision_effects`
    and `intended_effect` returns nothing.
- **Missing:** all of it. It depends on C5 (the hub), which is not built.
- **Files:** `app/_lib/db/core.ts`, new `app/_lib/db/decision-effects.ts`,
  `app/_lib/tenancy.ts`, `app/_lib/pipeline-entry-action.ts`, `app/_lib/comms-receipt.ts`,
  the C5 hub, `messages/*` and `docs/features/pipeline/README.md`.
- **Acceptance:** scope.md:132-134.
  - Relay fails while the ATS succeeds → one card whose repair sends only the letter.
  - The reverse case retries only the ATS effect.
  - A late bounce reopens the card.
- **Effort 4 / impact 3 / risk 3.**
- **Needs:** a **schema change** (a new workspace-scoped table plus a tenancy test). Blocked on
  C5. **PARKED.**

### C2-debt: halt-reason mapping and the outreach-letter error codes
- **Source:** scope C2 (scope.md:37-38), still open at `docs/features/comms/README.md:1526-1535`.
- **On main:** the mislabel described in the doc (see C2b above).
- **Files:**
  - Codes: `app/_lib/api-errors/refusal-errors.ts` / `store-errors.ts`,
    `app/api/outreach-letters/**`, `messages/*` (4 entries per code) and
    `docs/features/comms/README.md`.
  - Halt map: `task-fanout.ts`, `task-outcome-summary.ts`, `app/_lib/automation-run.ts`.
- **Acceptance:**
  - `app/api/outreach-letters/outreach-letters.test.ts`: an unknown letter → 404 with an
    `OUTREACH_LETTER_*` code; a stale revision → 409 with its own code.
  - `npm run i18n:check` stays green.
  - A halted-`replied` entry's task outcome reads `replied`, not `suppressed_consent_expired`.
- **Effort 2 / impact 2 / risk 1.**
- **Needs:** none. **Not parked.**

---

# Part B: OSS wrap (T1..T15, operator triage 2026-10-22)

### T1: fresh DB asks "empty or demo" on first start. LANDED
- **Definition:** triage.md:7-9; decision at :57 ("ASK ON FIRST START … E2E/keyless specs seed
  explicitly").
- **On main:**
  - `88f8ad83b`: boot is empty unless `KP_SEED_DEMO=1`; `app/_lib/db/demo-seed.ts`; ADR 0002
    updated.
  - `05c5adc46`: the first-run screen `app/setup/FirstRunDataChoice.tsx`, rendered at
    `app/page.tsx:84-88` while `demoChoicePending()` holds, posting to
    `app/api/setup/first-run/route.ts`.
  - `a1b4ff1b8`: Playwright and `up --demo` seed explicitly.
  - `e812651af`: the route's auth posture.
- **Missing:**
  - No e2e drives the choice screen; every spec runs seeded.
  - The route's failure answers `{outcome:"failed"}` rather than a `safeJsonError` code. This
    is minor.
  - There is no "load demo later" path. That is an owner call, and not needed.
- **Files:** new `e2e/first-run-choice.spec.ts` on an unseeded throwaway DB,
  `playwright.config.ts`, and the KEYLESS_SPECS list plus the list restated in
  `.claude/CLAUDE.md`, which is pinned by `scripts/docs/__tests__/keyless-e2e-pin.test.mjs`.
- **Acceptance:**
  - A fresh DB with no env shows the choice at `/`.
  - "Demo" lands on a populated board.
  - On a second fresh DB, "Empty" goes on to the setup wizard, and a reload does not ask again.
- **Effort 2 / impact 2 / risk 2.**
- **Needs:** none. **Not parked** (e2e coverage only).

### T2: the landing leads into the local app. LANDED
- **Definition:** triage.md:10-12; decision at :58 (keep the landing, detect the local app,
  relabel the buttons, let a returning browser go straight in).
- **On main:** `70c0c52f3` adds `app/_lib/auth/open-entry.ts`, `app/landing/site/chrome/OpenEntry.tsx`,
  `app/landing/site/chrome/Ctas.tsx` and the `app/page.tsx` wiring.
- **Missing:** an e2e. `e2e/landing.spec.ts` never runs in open mode on loopback.
- **Files:** `e2e/landing.spec.ts` (or a new spec).
- **Acceptance:**
  - Open mode on localhost: the hero CTA reads "Open your workspace".
  - With the localStorage marker set and the cookie cleared, `/` enters once per tab.
  - Password mode: labels are unchanged.
- **Effort 1 / impact 1 / risk 1.**
- **Needs:** none. **Not parked.**

### T3: `npm run up` render check. CLOSED
- triage.md:13-14, :59, closed by the Director (stale `node_modules`).
- Related hardening: `bcf23a6d3`.
- Nothing to deliver.

### T4: organization name in the DB. LANDED
- **Definition:** triage.md:17-19; decision at :60 (`organizations.name`, reversing the
  per-browser cookie).
- **On main:** `7dd794390` and the refactor `49a863292`. `setOrgName` writes the row
  (`app/_lib/org-actions.ts`); `readOrgName` migrates a legacy cookie once.
- **Missing (not a T-item):** the sibling `setOrgCurrency` is still the per-browser
  `kp_org_currency` cookie (`app/_lib/org-actions.ts` `setOrgCurrency` at `:83`, comment at `:80` "it is a
  per-browser cookie").
- **Effort 2 / impact 2 / risk 2.**
- **Needs:** schema (an `organizations.currency` column) **and** an owner call to reverse a
  second cookie decision. **PARKED.**

### T5: logo upload. LANDED (single org)
- **Definition:** triage.md:20-21; decision at :61 (PNG/SVG, stored locally, served by the app,
  size-capped).
- **On main:**
  - `a9f6bb4c4` adds `app/api/brand/logo/route.ts`, the `brand_settings` logo columns and
    `app/features/settings/branding/LogoUpload.tsx` (also used in the setup wizard).
  - `bda9067e5` names the cap as a constant.
  - `9c3273d71`, `0b4632827` and `ae9e08196` harden the SVG handling.
- **Missing:**
  - `brand_settings` is a deployment singleton (EXEMPT in `app/_lib/tenancy.ts`), so under
    multi-org one org's logo overwrites another's.
  - The decision did not ask for per-org scoping.
- **Effort 3 / impact 1 / risk 2** for org-scoping.
- **Needs:** schema plus an owner call. **PARKED**, and only if multi-org branding becomes a
  goal.

### T6: built-in sending, SMTP first. LANDED, one portability gap
- **Definition:** triage.md:24-25; decision at :62 (SMTP presets, test send, outbox log,
  unsubscribe and bounce basics; mailbox OAuth later). "First" means before OAuth, not first
  on screen.
- **On main:**
  - `0e50a4dd5`: `app/_lib/comms-smtp*.ts` and `/api/comms/smtp`(`/test`).
  - `7637ebb98`: the SMTP card, rendered at
    `app/features/hiring/channels/night/ChannelsNightSetupLevel.tsx:89` after the relay card.
  - Docs `5603cdd10`, `a5da1d378`.
  - Hardening `bbf76debd`, `860a7c0b5`, `bd99917a7`, `4be6e7322`.
- **Missing:**
  - `comms_smtp_config` is absent from `ORG_CONFIG_TABLES` (`scripts/db-dump.mjs:56-64`), while
    its relay sibling `comms_relay_config` is present (`:61`).
  - `app/_lib/tenancy.ts:473` / `:570` list the table, and the db-dump comment (`:54-55`) says
    the two sets must be identical.
  - The consequence: a `--redact` dump would carry the SMTP config in the clear and report
    itself clean.
- **Files:** `scripts/db-dump.mjs`, `app/_lib/tenancy.ts` (if the not-portable set needs it),
  and the rollback-drill / db-dump test that pins the two sets.
- **Acceptance:** a test asserting `ORG_CONFIG_TABLES` equals the tenancy not-portable set
  (including `comms_smtp_config`), and a `--redact` dump of a DB with a stored SMTP row omits
  it.
- **Effort 1 / impact 2 / risk 1.**
- **Needs:** none. **Not parked.**
- Mailbox OAuth would need Google/Microsoft app secrets plus an owner call. It is deferred by
  the decision itself.

### T7: offer to send the letters queued before a sender existed; the owner confirms. LANDED for the relay only
- **Definition:** triage.md:26-27; decision at :63.
- **On main:**
  - `8994df498` adds `app/_lib/comms-backlog.ts`, `app/api/comms/backlog/route.ts` and
    `ChannelsNightBacklogOffer.tsx`.
  - `5109b0a79` makes `isBacklogRow` an allow-list (`comms-backlog.ts:78`).
- **Missing:** an SMTP-only install never gets the offer.
  - `backlogOffer` gates on `relayHealth()` (`app/_lib/comms-backlog.ts:105-107`).
  - `confirmBacklogSend` does the same (`:127`) and skips every id with `relay_not_ready`
    (`:132`).
  - The client keys off `relayConfigured`
    (`app/features/hiring/channels/night/ledger/ChannelsNightBacklogOffer.tsx:30-50`).
  - Since `0e50a4dd5`, "a letter can leave" means relay **or** SMTP (`isRelayConfigured`). The
    gate should use that transport resolver.
  - `docs/features/comms-smtp.md:54,:128` record the gap.
- **Files:** `app/_lib/comms-backlog.ts` plus its test, `app/api/comms/backlog/route.ts`,
  `ChannelsNightBacklogOffer.tsx` and its prop source in `ChannelsNightLedger.tsx`,
  `docs/features/comms-smtp.md` and `docs/features/comms/README.md` (§ at `:60-72`). Add the 4
  catalogs only if the copy says "relay".
- **Acceptance:**
  - No relay, a stored SMTP sender, one outbox-queued row → `GET /api/comms/backlog` lists 1
    letter.
  - POST with its id → one `sent` row through a mock SMTP server answering 250, carrying the
    original `message_id`.
  - A devcase feedback draft is never offered.
- **Effort 2 / impact 3 / risk 2.** It sends real mail, but only on the owner's press.
- **Needs:** none; the T7 decision covers it. **Not parked.**

### T8: guided Google Calendar setup. LANDED, one wording deviation
- **Definition:** triage.md:28-29; decision at :64 ("walk the Google client creation, store
  encrypted, generate KP_SECRET, no restart").
- **On main:**
  - `01a80e42e` adds `app/_lib/calendar/{calendar-secret,calendar-key,google-client-store}.ts`
    and `app/api/calendar/google/client/route.ts`.
  - `2a631c70a` adds `app/features/settings/integrations/IntegrationsCalendarSetup.tsx`.
  - Docs `5abd67318`; the `.env.local` race fix `4a9ca7cbd`.
- **Deviation:** it generates `KP_CALENDAR_SECRET_KEY`, deliberately **not** `KP_SECRET`,
  because `KP_SECRET` also signs sessions (`app/_lib/calendar/calendar-key.ts`, header comment;
  `01a80e42e` body). This is reasoned, but it differs from the decision's words.
- **Missing:** nothing in code. The deviation needs an owner acknowledgement.
- **Effort 0 / impact 1 / risk 1.**
- **Needs:** an owner acknowledgement only. **PARKED (sign-off), nothing to build.**

### T9: `npm run up -- --public` with a quick tunnel and a forced password. LANDED, exposure open
- **Definition:** triage.md:32-33; decision at :65 (tunnel plus forced password, refuse open
  mode, candidate doors public, studio gated).
- **On main:**
  - `1f8a49ba8` adds `scripts/tunnel.mjs`, the wiring in `scripts/up.mjs`, and
    `app/_lib/link-base-warning.ts`.
  - `d16b47582` adds the 12-character minimum.
  - Documented at `docs/architecture/self-hosting.md` (the `--public` section).
- **Open:**
  - It depends on a user-installed `cloudflared` and a Cloudflare quick tunnel, which is a
    **third-party service outside the 2026-10-17 allow-list** (free; no account).
  - The tunnel fronts `next dev`, not a production build.
  - The URL changes on every start, so links already mailed go dead.
  - No smoke test proves the studio is gated and `/apply` reachable over the tunnel.
- **Effort 3 / impact 3 / risk 4.**
- **Needs:** an owner call on the external service, and on dev-vs-prod exposure. **PARKED.**

### T10: warn when candidate mail links point at localhost. Server log only
- **Definition:** triage.md:34-35 ("warn at boot / in ops"); folded into T9 at :66.
- **On main:** `1f8a49ba8` adds `warnLinkBaseOnce`, called at `app/_lib/comms-dispatch.ts:137`.
  It is a server log line, once per process.
- **Missing:** the "in ops" half. No studio surface tells the owner.
- **Files:** a pure predicate beside `app/_lib/link-base-warning.ts`, exposed on the channels
  data read; a chip on the relay level in `ChannelsNightSetupLevel.tsx`; `messages/*`; and
  `docs/features/comms/README.md`.
- **Acceptance:**
  - On a loopback origin with no `APP_BASE_URL` and a relay or SMTP configured, the relay level
    shows the warning naming `--public` / `APP_BASE_URL`.
  - Setting `APP_BASE_URL` clears it.
  - Keyless with no sender shows no warning.
- **Effort 2 / impact 2 / risk 1.**
- **Needs:** none. **Not parked.**

### T11..T15 (beyond the eight named in the brief)
- **T11, "production" read as "product":** `0ecfc943a` (`pipeline/jobfit/taxonomy.py`; the body
  carries the eval delta). The decision (:67) required the delta to reach the operator
  **before** merge, and no sign-off is recorded. **PARKED (sign-off).**
- **T12, index `pipeline_events(entry_id)`:** `ea9427292`. Done.
- **T13, deterministic non-software work samples:**
  - `365a6ecfb`, then the council-lite fix rounds `0df7fc1d3`, `036ed00ab` and `472efa156`.
  - The decision (:69) says "ship once council-lite passes", and no PASS is recorded.
  - Another council run is an owner call, since the multi-vendor seats may be paid.
    **PARKED.**
- **T14, persistent role shortlist:** `cd9dce69e` (ADR 0030). Done.
- **T15, "Everyone on this role" table in both themes and on phone:** `b28fef2c9`. It needs the
  owner's visual sign-off. **PARKED (sign-off).**

---

# Parked (report to the operator, do not build)

| Item | Why parked |
| --- | --- |
| C6 reply door + thread | schema (`candidate_replies`, `replied_at`), new public token surface |
| S2 ATS ingest runtime | schema likely (cursor, quarantine). The broker + decide/apply slice alone is unparked |
| S3 Greenhouse/Lever | schema + customer secrets; blocked on S2 |
| L1 email replies at the edge | owner call (MIME dependency, receiving domain); blocked on C6 |
| L2 completion record | schema; blocked on C5 |
| C4 durable `lastOkAt` | schema (column), "waits for the operator" (`docs/features/connect/README.md:70`) |
| T4 currency follow-up | schema + reversing a cookie decision |
| T5 per-org logo | schema + owner call |
| T8 key deviation | owner acknowledgement (`KP_CALENDAR_SECRET_KEY` vs the decision's `KP_SECRET`) |
| T9 tunnel exposure | external service outside the allow-list; dev server exposed |
| T11, T13, T15 | owner sign-off / council run |

# Ranked build order (no parked decision; one branch each)

| # | Delivery | Paths (disjoint unless noted) | E/I/R |
| --- | --- | --- | --- |
| 1 | **T7-SMTP**: the backlog offer follows "a letter can leave", not "relay" | `app/_lib/comms-backlog.ts`(+test), `app/api/comms/backlog/route.ts`, `app/features/hiring/channels/night/ledger/ChannelsNightBacklogOffer.tsx`, `ChannelsNightLedger.tsx`, `docs/features/comms-smtp.md`, `docs/features/comms/README.md` | 2/3/2 |
| 2 | **T6 portability**: `comms_smtp_config` joins `ORG_CONFIG_TABLES` | `scripts/db-dump.mjs`, its pinning test, `app/_lib/tenancy.ts` if needed | 1/2/1 |
| 3 | **C4 leftovers**: `smtp` catalog row, doc-map entry, ADR 0028 status fixes (C4 landed, `a5d958fce` for `02840920d`, drop the stale :143-144 bullet) | `app/_lib/connect/*`, `scripts/docs/feature-doc-map.json`, `docs/features/connect/README.md`, ADR 0028 | 1/2/1 |
| 4 | **C2-debt**: outreach-letter error codes + 1:1 halt-reason mapping | `app/_lib/api-errors/*`, `app/api/outreach-letters/**`, `task-fanout.ts`, `task-outcome-summary.ts`, `messages/*` (shared, see note) | 2/2/1 |
| 5 | **T10 ops warning**: localhost link base shown on the relay level | `app/_lib/link-base-warning.ts`, channels data read, `ChannelsNightSetupLevel.tsx`, `messages/*` | 2/2/1 |
| 6 | **C5 Connect hub** (after #3): Connectors deck, probe door, ATS deliveries with Replay, calendar Reconnect need, `?tab=integrations` redirect | `app/api/connect/[id]/probe/`, `app/features/hiring/channels/night/**` (overlaps #1 and #5), `app/features/shell/*`, `app/api/rate-limit-contract.test.ts`, `messages/*`, API reference | 3/3/2 |
| 7 | **T1 + T2 e2e**: drive the first-run choice on an unseeded DB, and open-mode entry on loopback | `e2e/*`, `playwright.config.ts`, `.claude/CLAUDE.md` (keyless list, pinned) | 2/2/2 |

Notes on the order:

- **#1-#3 are fully disjoint** and can run in parallel.
- **#4, #5 and #6 each add catalog keys.** `messages/*.json` is the one file they share, so run
  them sequentially, or rebase whichever lands second. Key collisions are unlikely, but the
  merge is textual.
- **#6 touches `channels/night/**`**, which #1 (the ledger offer) and #5 (the setup level) also
  touch. Land #1 and #5 first.
- **#7 is last** because it edits `.claude/CLAUDE.md`'s pinned keyless list and needs a second
  unseeded webServer.
- **An optional unparked slice of S2** (the `withAtsAuth` broker plus `decide`/`apply` split
  with no storage change, `app/_lib/ats/*`) could follow #6. It is disjoint from everything
  above.

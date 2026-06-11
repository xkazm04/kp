# ERIKA_GAP_BACKLOG — competitive gap analysis vs erikawork.com

> Research date: 2026-06-11. Source: https://erikawork.com/ (homepage + blog).
> Note: several unrelated products are also named "Erika" (talentrecruit.com,
> erikahire.ai) — this doc covers **erikawork.com only**.

## What Erika is

Erika is a Czech-based **AI sourcing engine for blue-collar hiring** ("sourcing,
not screening"). It automates exactly one slice of the funnel — the top:

1. **Brief in plain language** — recruiter pastes a JD or a sentence.
2. **AI creative at scale** — 6–12 vertical video/image ad variants per role,
   AI avatars + voiceovers, 8+ languages (EN, ES, PL, CZ, SK, RO, HU…).
3. **Deploy & optimize** — ads run on Facebook/Instagram Reels with geo/demo
   targeting; budget reallocates hourly to top variants, losers auto-paused.
4. **Leads land in pipeline** — native in-feed lead forms (≤30s, ~3 fields,
   autofilled), role-specific gating questions auto-discard non-matches;
   qualified leads sync to an ATS (BambooHR, Personio, Teamtailor, Bullhorn,
   SuccessFactors, Manatal, WTTJ) or their free built-in basic ATS, plus
   API/webhooks.

**Explicit non-goals:** phone bots, AI interviews, screening, landing pages.
Claimed economics: <$100/hire vs $400–800 on portals; first leads in hours;
~23s to first application.

Their published philosophy (blog) distills to five principles:

- **Reach**: job boards only index the ~18% actively looking; meet the other
  82% on platforms they already use.
- **Friction**: mobile forms over ~3 fields lose 80%+ of applicants; native
  one-tap apply, never a landing-page redirect.
- **Trust**: specifics beat boilerplate — open with pay/place/problem, never a
  logo; "competitive salary" and "join our team" kill conversion.
- **Speed**: contact in hours, not weeks.
- **Iteration**: 6–12 creative variants per role, pause bottom performers
  within 72h.

## Position vs KP

Erika and KP are **complementary, not head-to-head**. Erika owns acquisition
(top-of-funnel) and explicitly refuses everything KP is strongest at:
screening with fairness gates, interview prep + voice AI interviews, BARS
rubrics, dev cases, offers, decision audit. KP's weakest area is exactly
Erika's core: getting candidates **into** the pipeline (channels `email` and
`boards` are stubs, outbound dispatch is a local outbox unless a webhook relay
is configured, no campaign/creative tooling, no source economics).

| Erika capability | KP today | Gap |
|---|---|---|
| Plain-language brief → structured role | JD ingestion (work mode, seniority, salary band, languages) | none — KP richer |
| Ad creative generation (video scripts, copy, variants, languages) | — (outreach drafts only, per-candidate) | **full gap** |
| Ad deployment + hourly budget optimization on Meta | — | full gap — **deliberately out of scope** (E9) |
| Native ≤30s lead form, ~3 fields | Conversational apply (chat KO, minutes not seconds) | **partial gap** (E2) |
| Role-specific gating + auto-discard | KO filters + apply knockouts + fairness gates | none — KP richer, but only inside its own portal |
| Lead sync via API/webhooks | devcase comms webhook (outbound); no inbound lead API | **gap** (E3, E8) |
| Built-in basic ATS | Full pipeline board, stages, events, audit | none — KP far richer |
| 8+ candidate languages | en/cs (locked next-intl approach) | **partial gap** (E6) |
| Cost-per-applicant / per-hire economics | Funnel analytics (momentum, bottleneck, decision log) | **gap** (E5) |
| Speed-to-lead (first contact in hours) | Outbox is terminal `queued` without relay; no candidate email stored | **gap** (E4) |
| Screening / AI interviews | Erika's explicit non-goal | KP moat — no action |

## Backlog

Sized S / M / L. Ordered by priority. Each item names the existing seams it
plugs into; nothing here proposes rebuilding what `PIPELINE_EVOLUTION_PLAN.md`
(Phase 2 channels) or `COMMS_DELIVERY.md` (relay + recipient contract) already
pinned.

### P1 — close the intake gap

**E1 · Sourcing campaign pack generator — M — ✅ shipped 2026-06-11**
*As built:* `pipeline/jobfit/campaign.py` + `campaign_cli.py` (job-level, NOT the
entry-level automation path), Campaign tab in the job posting modal, durable
`campaign_packs` table (one pack per job × language), `POST /api/jobs/[id]/campaign`.
Hook taxonomy: number / location / problem / skills — the playbook's "employee
POV" is deliberately excluded (testimonials can't be fabricated honestly).
Honesty contract: `defaulted_fields` phantoms (assumed "Praha"/"medior") are
never advertised; missing facts surface as warning CODES localized in the UI.
Every CTA links the E2 quick-apply form. Markdown copy-all export included.
New automation task: from a published job, generate a localized campaign pack —
6–12 short ad-copy variants + 15s video **scripts** following Erika's 4-beat
formula (hook: number/place/problem, never company name → role + pay in plain
language → concrete proof → single low-friction CTA), per channel
(FB/IG/board) and per candidate language. LLM path via the existing
`pipeline/jobfit/automation.py` task pattern (Claude CLI) with a deterministic
fallback assembled from structured job fields (salary band, location, work
mode, shift). Persist per job; copy/download export. KP generates the
*scripts*; avatar/video rendering stays external (see E9).
*Leverages:* JD ingestion, automation task + cache pattern, `lang` threading.

**E2 · Quick-apply lead form — M — ✅ shipped 2026-06-11**
*As built:* `/apply/[id]/quick` (page + `POST /api/apply/[id]/quick`), KO prompts
derived from the same `applyKoSteps` script as the conversational flow. One
deviation from the text below: a KO fail records an **entry-less `ko_declined`
pipeline event** instead of a rejected pipeline row — a terminal row would trap a
mis-tapped answer behind the dedup/merge machinery ("already applied"), while the
event keeps the discard fully auditable AND the retry free. Leads land at
Accepted as intake-degraded stubs; the conversational apply is the enrichment
path (existing W8-6 merge rebuilds the profile in place and the candidate sees
"Profile completed"). Quick-apply link surfaced in the job posting modal.
A mobile-first ≤30s variant of the apply portal: ~3 fields (name, contact, the
job's KO gating questions auto-derived from its KO filters), one-tap submit.
Creates a pipeline entry at `Accepted` with a minimal "lead" profile
(reuse the `intake_degraded` pattern); the existing conversational apply
becomes the optional **enrichment** follow-up, linked from the auto-ack (E4).
KO fail = auto-discard, but routed through the existing rejection automation
so it stays auditable and fairness-gated — Erika discards silently; KP must
not.
*Leverages:* `app/apply/[id]`, `apply.ts`, KO filters, profile completeness.

**E3 · Inbound lead webhook (channels go live) — M — ✅ shipped 2026-06-11**
*As built:* per-(channel, job, language) webhook bindings (`channel_webhooks`,
CSPRNG tokens) managed from the Channels tab — `email`/`boards` cards read
"Listening" the moment a webhook exists, with create/copy-URL/revoke and receipt
counts inline. Public receiver `POST /api/channels/inbound/[token]` (rate-limited,
body-capped, honest machine statuses) maps plain JSON / `fields` / Meta
`field_data` payloads through diacritic-folded aliases (`lead-payload.ts`) into a
shared lead-intake core (`lead-intake.ts`) also used by the quick-apply form.
KO semantics for third-party payloads are provided-only: an explicit "no"
declines (audited), an unasked gate lands the lead visibly *unverified* — never a
silent discard. Source attribution shipped with it: `pipeline_entries.source_channel`
(`apply` | `quick-apply` | `email` | `boards`) — the queryable axis E5 needs.
Generic `POST /api/channels/[token]` accepting Meta-Lead-Ads-style or plain
form JSON, mapped per job into the same intake path as E2. This is the
concrete mechanism that turns the `channels.email` / `channels.boards` stubs
live, exactly as Pipeline Evolution **Phase 2** envisions ("listening" state
per channel). Includes per-job field mapping, the existing duplicate-window
check, and source attribution fields (feeds E5).
*Leverages:* channels registry, `apply.ts` intake, dedup window.

### P2 — speed-to-lead and measurement

**E4 · Candidate contact + real delivery + instant ack — M — ✅ shipped 2026-06-11**
*As built:* contact capture, `candidateRecipient` priority, and the instant ack
already existed (APP2/APP3); the delta landed is the **enrichment-link ack**
(`ack.bodyEnrich`, en+cs) fired the moment a quick-apply lead lands, with the
absolute `publicBaseUrl`-resolved link pinned to the candidate's locale. The
quick form REQUIRES email (the lead form's whole point is reachability). "Real
delivery" remains deployment config: set `COMMS_WEBHOOK_URL` to a relay per
docs/COMMS_DELIVERY.md — no code seam was missing.
`COMMS_DELIVERY.md` already names the seam: no candidate email is stored, so
`candidateRecipient()` leaks identifiers. Store email/phone at intake (E2
collects it as one of its 3 fields), resolve it in `candidateRecipient`, wire
`COMMS_WEBHOOK_URL` to a real relay, and dispatch an **immediate
acknowledgment** on apply with the enrichment/self-schedule link. This is
Erika's "first leads in hours" translated to KP: same-minute ack, next step in
hand. Reminder/dead-letter policy already exists — only the address and the
relay are missing.
*Leverages:* `comms-dispatch.ts`, `comms-status.ts`, outbox audit log.

**E5 · Source attribution + funnel economics — S/M — ✅ shipped 2026-06-11**
*As built:* `source_campaign`/`source_variant` columns captured end-to-end —
webhook payloads (UTM + ad-platform aliases), quick-apply `?c=`/`&v=` link
params, and E1 packs now emit **per-variant** apply links (`&v=v1…`) so a lead
attributes to the exact creative. Analytics gained a **Channel economics**
panel: per-channel conversion, median hours to first decision, inline
recruiter-entered spend (CZK, `channel_spend` table) → cost per applicant /
per hire; a creative-variants table; and the 72h **pause recommendation**
(pure rule in `source-analytics.ts`: ≥2 variants, ≥10 group leads, ≥72h of
data, share under half the fair split — a suggestion, never an actuator).
Webhook rows additionally show time-to-first-lead (`first_received_at`).
Add `source_channel` / `source_campaign` / `source_variant` (+ optional spend
input per campaign) to pipeline entries; extend Analytics with
time-to-first-apply, time-to-first-touch, per-channel conversion, and
cost-per-applicant / cost-per-hire. Per-variant performance table with a
"pause bottom performers" **recommendation card** (Erika's 72h rule) — a
suggestion, not an automated budget actuator.
*Leverages:* `pipeline_events`, `sub_analytics`, decision log.

**E6 · Candidate-language expansion for generated artifacts — M — ⏸ deferred 2026-06-11 (needs decision)**
Erika serves 8+ candidate languages; KP's i18n is deliberately locked to en+cs
**UI** catalogs. The Erika-relevant slice is narrower: thread more candidate
`lang` values (sk/pl/de/uk…) through the **generated** artifacts only — JD
output, campaign packs (E1), outreach/ack copy, and the small string set of
the quick-apply portal (E2). No new full UI catalogs, so the locked next-intl
decision stands. Requires a one-time decision on the supported candidate-lang
list.
*Leverages:* existing `lang` prompt threading, per-candidate locale field.

### P3 — opportunistic

**E7 · JD specificity lint ("trust" principle) — S — ✅ shipped 2026-06-11**
*As built:* pure rules module `app/_lib/jd-lint.ts` (no LLM — runs live on every
edit): EN+CS boilerplate patterns with inflection-tolerant Czech stems, plus
missing-concretes checks (pay figure, place of work — a work-mode keyword counts
as place; the structured market band suppresses the salary finding). Findings
panel in JdBuilderResult with an explicit all-clear state. Pinned by
`jd-lint.test.ts`.
Erika's highest-leverage content rule is anti-boilerplate: lead with pay,
place, shift; ban "competitive salary" / "join our team" / "dynamic
environment". Add a lint pass in the JD builder (rules + optional LLM) that
flags vague phrases and missing concretes (salary band absent, location
absent, shift unstated) before publish. Cheap, improves every downstream
artifact (E1 packs inherit the specifics).
*Leverages:* `sub_library/JdBuilder.tsx`, JD ingestion fields.

**E8 · Outbound candidate export schema — S — ✅ shipped 2026-06-11**
*As built:* the WebhookChannel now POSTs a versioned **`kp.comm.v1` envelope**
(`comms-envelope.ts`, pinned by its test): the legacy flat fields verbatim
(backward compatible) plus candidate/job/stage context auto-enriched from the
entry `ref` — `candidate.email` (E4 contact), `locale`, `sourceChannel`
(E3/E5 attribution). Full contract — push envelope, kind vocabulary, ATS
mapping guidance, and the pull-based `GET /api/pipeline` bulk-sync surface —
documented in **docs/OUTBOUND_EXPORT.md** with an additive-only compatibility
promise.
Erika syncs leads into seven ATSes; KP doesn't need per-ATS connectors, just a
clean, documented outbound JSON schema on the existing webhook channel so a
relay can map KP → any ATS. Mostly documentation + payload stabilization of
what `WebhookChannel` already sends.
*Leverages:* `comms.ts` WebhookChannel, `dev_outbox` audit.

**E9 · Meta ad deployment + budget auto-optimization — out of scope (revisit)**
The remaining Erika core — ad account integration, hourly budget reallocation,
avatar video rendering — is a heavy external dependency (Meta Ads API, ad
billing, creative rendering pipeline) and a different product muscle. Decision:
**do not build now.** E1's export pack + E3's inbound webhook let a recruiter
run the Erika playbook manually (or literally alongside Erika, importing its
leads). Revisit only if E1–E5 prove the sourcing channel earns it.

### Explicitly not adopted

- **Dropping screening/interviews to "focus on sourcing"** — Erika's
  positioning, KP's moat. No change.
- **Silent auto-discard of unqualified leads** — conflicts with KP's fairness
  gates and audit trail; E2 keeps discards auditable.
- **Credit-based pricing mechanics** — business-model concern, not product.

## Dependency sketch

```
E1 (campaign packs) ──────────┐
E2 (quick-apply) ─→ E4 (contact+ack) ─→ speed-to-lead loop closed
E3 (inbound webhook) ─→ E5 (attribution/economics)
E6 feeds E1/E2/E4 copy languages
E7 improves E1 inputs
```

Suggested first slice: **E2 + E4** (a candidate can apply in 30s and hears
back in a minute), then **E1 + E7** (campaign packs worth publishing), then
**E3 + E5** (external channels live and measured).

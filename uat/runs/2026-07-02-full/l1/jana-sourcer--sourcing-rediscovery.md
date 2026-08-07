# L1 — Jana Horáková (Senior Sourcer / Talent Researcher) × sourcing-rediscovery

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1 (theoretical, code-derived)**
- **Verdict:** **L1-conditional** — the sourcing loop is structurally complete on the seeded happy path (ranked pool → rediscovery with a why-now → one-click reach-out → campaign pack), but five majors carry to L2: outreach is **persisted, not delivered** (ship-bar), the outreach draft prompt is thin (no brand, no re-engagement context), the why-now is a 3-sentence stock template, and the Reach-out affordance **structurally fails** for in-app-created roles (404) and for analysis-sourced candidates (400).
- **Grounding score:** rediscovery why-now **3/6** · outreach draft **4/8** · campaign pack **6/8**
- **Time saved (designed):** vs Jana's ~13 h/role manual baseline, the *in-pool* work (rank + rediscover + draft outreach + campaign copy) collapses to ~45–75 min of review → **~6–8 h (≈420 min) saved per role where the internal pool suffices** · confidence **medium-low** — the number holds only if the drafts clear her send-bar (L2) and only for pool-internal sourcing; external (LinkedIn/Boolean) sourcing stays 100 % manual, the app never touches outside sources.

## Surface model (affordances → code)

| Affordance | Backing code |
|---|---|
| Jobs tab → standing rediscovery feed (alerts + Refresh sweep + dismiss + add) | `app/features/sub_jobs/JobsTab.tsx:103` → `RediscoveryFeed.tsx:31` → GET/POST/PATCH `/api/rediscovery/alerts` (`RediscoveryFeed.tsx:52,72,97`) → `app/api/rediscovery/alerts/route.ts:33,42,54` → `rediscover.ts:126-138` (sweep) + `rediscovery-alert-store.ts:70-138` (UNIQUE (job,candidate), sticky dismiss) |
| Job card → posting modal, tabs Campaign / Candidates / Rediscover | `JobPostingModal.tsx:300-304` (tab strip) → panels `:354-359` |
| "Score candidates" / auto-load ranked pool | `RecruiterCandidates.tsx:53-66,99-109` → GET `/api/jobs/[id]/candidates` → `route.ts:19` `buildCandidatePool` (`candidate-pool.ts:46-66`, profiles+analyses, caps 100+60) → `rankPoolForJob` (`recruiter-run.ts:21-51`, spawns `pipeline.jobfit.recruiter_cli` with `--job-json` = the live DB job) → rows decorated with persisted `inPipeline`/`outreachSent` (`route.ts:43-54`) |
| Per-candidate "Reach out" (candidates + rediscover panels) | `RecruiterCandidates.tsx:484-496` / `RediscoverPanel.tsx:99-110` → `useReachOut.ts:29-43` → POST `/api/jobs/[id]/candidates/outreach` (`route.ts:23`) → idempotent `createPipelineEntry` @ Screened (`route.ts:43-52`, jobTitle/roleFamily from the server job record) → `runAutomationTask(entry,"outreach")` (`route.ts:54`, `maxDuration=180` `:10`) |
| The outreach draft itself | `automation-run.ts:150-163` spawns `pipeline.jobfit.automation_cli outreach --profile-json … --job-id …` → `automation_cli.py:130-132` (strengths = `m.matched_skills` from a fresh `score_job`) → prompt `automation.py:318-326`; deterministic fallback `:328-342`; billing degrade `--no-llm` `automation-run.ts:154` |
| Outreach dispatch (the ship-bar seam) | `automation-run.ts:270-300` (durable `outreach_sent` gate + in-process single-flight) → `dispatchOutreach` (`comms-dispatch.ts:165-186`, consent gate first) → `sendComm` (`comms.ts:103-105`) → **`OutboxChannel` by default: status `queued`, explicitly "terminal dev state"** (`comms.ts:12-16,36-42`); `WebhookChannel` only when `COMMS_WEBHOOK_URL` is set (`comms.ts:97-100`) |
| Rediscover panel (auto-runs on tab open) | `RediscoverPanel.tsx:23-27` (`useJsonFetch` fires on mount) → GET `/api/jobs/[id]/rediscover` (`route.ts:20`) → `rediscoverForJob` (`rediscover.ts:59-103`: whole-pool rank, `koPassed && total ≥ 55`, not-already-in-this-pipeline `:83`, prior outcome via `pickPrior` `:41-54`, top-20 + honest `more` count) |
| Why-now line per rediscovered row | `RediscoverPanel.tsx:82-88` — `t("whyNow.<prior.kind>", { jobTitle, score })` ← `messages/cs.json:2087-2091` / `en.json:2087-2091` (3 fixed templates) |
| Campaign tab (ad-copy variants + 15 s scripts, copy/Markdown export) | `CampaignTab.tsx:45,88-106,163-179` → GET/POST `/api/jobs/[id]/campaign` (`route.ts:24,32`, `--job-json` = live DB job) → `campaign.py:163-264` (stated-facts-only, warning codes, per-variant attributed apply links) |
| Channels tab → Comms Center (outbox audit of the outreach) | `ChannelsTab.tsx:11,433` → `CommsCenter.tsx:54` (failed-first, body on expand, resend, relay banner, `deliverable=false` warnings `:105-111`) |

## Grounding audit (AI surfaces)

**Outreach draft** (`automation.py:318-326`) — what a senior sourcer's first-touch SHOULD be built from → what reaches the prompt:
1. ✓ candidate name (`:323`)
2. ✓ candidate's matched strengths vs THIS role — real fit, not generic (`automation_cli.py:131` → `:324`)
3. ✓ role title + company (`:323`) — *but resolved from the static seed corpus, not the live DB job — see SR-L1-004*
4. ✓ candidate language (Czech detection `automation.py:110-112` → `:322`)
5. ✗ richer role facts — team context, location, stack, salary band (all exist on the Job; never in the prompt)
6. ✗ ČS brand/tone kit — generic "hiring team" voice, zero employer-brand context
7. ✗ **prior-relationship context** — the draft has no idea the candidate is a rediscovered silver medalist; a person who reached our final round gets cold copy ("your background caught our eye" — literally false for them)
8. ✗ candidate profile depth beyond skills (employer, seniority, trajectory — `MatchCandidate` has them, prompt gets label + 3 skills)

**= grounding 4/8.**

**Rediscovery why-now** (`RediscoverPanel.tsx:82-88` + `rediscover.ts`):
1. ✓ real prior outcome kind + which role (from `candidateOutcomes`, `rediscover.ts:41-54` → chip)
2. ✓ real deterministic fit vs THIS job (`:78-95`, floor 55, KO-gated)
3. ✓ this job's title (interpolated)
4. ✗ the specific fit **delta** (matched/missing skills are in the ranked payload rows — dropped before the why-now)
5. ✗ what **changed** (time elapsed, profile updates, requirement differences vs the lost role)
6. ✗ candidate-profile evidence on the row (the candidates tab shows provenance chips; the rediscover row shows only score + chip)

**= grounding 3/6.**

**Campaign pack** (`campaign.py:91-160`):
1. ✓ real job facts with phantom filtering (`defaulted_fields` treated as absent, `:91-114`)
2. ✓ salary band, stated-only (`:76-88,111`)
3. ✓ top skills/stack (`:100-101`) 4. ✓ description excerpt (`:113`) 5. ✓ attributed apply link per variant (`:134-139,247-258`) 6. ✓ output language + boilerplate ban (`:154-159`)
7. ✗ ČS employer brand / EVP / benefits source 8. ✗ audience or past-campaign performance signal

**= grounding 6/8.**

## Reachability (resolved before judging)

Internal user, dev gate on → all workspace tabs, no per-role gating (`tabs.ts:98-153`). Jana's binding: Channels / Match / Jobs — every surface above is in-set. Fixture caveats, not gating: (a) rediscovery needs candidates with **prior outcomes** (rejected/role_closed/declined/elsewhere) — the seeded ČS pipeline provides them (`uat/env.md` fixtures); (b) the **standing feed** additionally needs a role with `status='published'` — seeded corpus rows carry status NULL, so on the bare fixture the feed sweeps 0 roles (see SR-L1-008). No out-of-set findings; nothing tagged `unreachable`.

## Ship-bar: is outreach actually SENT?

**No — persisted and audited, not delivered.** The chain ends at `sendComm` → `OutboxChannel.send` → `recordOutbox(status:"queued")`, and the code itself calls `queued` "a *terminal* dev state: the outbox IS the delivery target" (`comms.ts:12-16,36-42`). A real path exists only as a **generic webhook relay** when `COMMS_WEBHOOK_URL` is set (`comms.ts:97-100`) — there is **no email/SMS provider integration in-repo** (no SendGrid/SES/Twilio; the envelope is `kp.comm.v1` for an external ATS/relay to map). Worse for *this* journey: sourced/rediscovered candidates have **no address at all** — the recipient resolves to a human *name* (`comms-dispatch.ts:62-68`), which the comms contract itself says a relay "cannot deliver to … the message will dead-letter" (`comms.ts:19-23`, `comms-dispatch.ts:57-59`). Meanwhile the UI announces "a first-touch message **is on its way**" (`useReachOut.ts:43`). Mitigation that keeps this major-not-blocker: the Comms Center discloses honestly — relay-not-configured banner, `deliverable:false` warnings, bounce/dead-letter chase (`CommsCenter.tsx:59-66,105-111,24-33`) — and the architecture is documented (`docs/COMMS_DELIVERY.md`). → **SR-L1-001**.

## Cognitive walkthrough (in character)

1. **Will I try it?** Yes — the rediscovery feed sits at the top of Jobs (`JobsTab.tsx:103`), and the job modal's Rediscover tab is labeled with a History icon (`JobPostingModal.tsx:302`).
2. **Notice the control?** Yes. Rediscover auto-runs on open with a skeleton + "scanning" (`RediscoverPanel.tsx:33-41`) — no hidden button.
3. **Label ↔ intent?** "Reach out" says contact; it *also* silently files the person into the pipeline. The sr-only announce says so (`useReachOut.ts:43`) but the button label doesn't — acceptable, since the reached badge replaces both buttons (`RediscoverPanel.tsx:90-95`).
4. **Feedback after acting?** In-session: reaching → reached badge, per-row errors with retry (`RediscoverPanel.tsx:104-137`). Cross-session on the candidates tab: persisted `outreachSent`/`inPipeline` decoration — reopened roles show reality (`candidates/route.ts:43-54`, `RecruiterCandidates.tsx:441-444`). **But** "reached" here means an outbox row, and nothing on THIS surface says the message never left the building (SR-L1-001).
5. **Job advanced, at my bar?** The ranked pool: yes — skills with provenance, confidence bands, KO reasons, assumptions (`RecruiterCandidates.tsx:530-550,252-278`) — that answers my "found them *how*?". The rediscovery row: half — a real prior outcome + a real score, but the why-now is a stock sentence (SR-L1-003). The outreach copy: can't clear my bar with 4/8 grounding and no memory that we've met the candidate before (SR-L1-002).
6. **Trust it?** The math and the audit trail, yes. The delivery claim, no.

## Scored acceptance criteria (Jana's, applied identically every run)

| Criterion | Verdict |
|---|---|
| completion — role → matches → outreach + rediscovery, no dead-end | **pass on the seeded path**; structurally **fails** for in-app-created roles (SR-L1-004, 404) and analysis-sourced candidates (SR-L1-005, 400) |
| senior-quality/trust — every match carries a reason tied to THIS role | **pass** on the candidates tab (provenance chips, KO reasons, assumptions); **partial** on rediscover rows (score + prior chip only) |
| missing/senior-quality — every rediscovered candidate has an explicit why-now | **partial → major** — a why-now line exists (`RediscoverPanel.tsx:82-88`) and is grounded in the real prior outcome + real score, but it's one of 3 fixed templates, not this candidate's story (SR-L1-003) |
| senior-quality — outreach copy send-ready under ČS's name | **fail at the designed level** — 4/8 grounding, no brand, no re-engagement context (SR-L1-002); not blocker: the instruction set ("concise, non-creepy") + clean Czech fallback avoid embarrassment, but it reads agency-generic |
| trust — provenance/basis she can interrogate | **pass** (candidates tab + fairness audit + CSV `RecruiterCandidates.tsx:284-345`) |
| time-saved — minutes vs ~13 h, leverage beyond the obvious | **pass (designed), pool-bounded** — rediscovery IS the beyond-the-obvious leverage (nobody combs the ATS); but the pool is only what kp already holds (caps: SR-L1-006), no external sourcing |
| clarity — dispatch confirms what was sent and to whom | **partial** — the Comms Center answers both (body, recipient, status); the announce overstates delivery (SR-L1-001); "to whom" is a name, not an address |
| language — Czech UI + Czech outreach | **partial** — why-now + UI localized; **prior chips render English** in the Czech UI (SR-L1-007); draft language follows the candidate's languages (`automation.py:110-112`) |

## Findings (full schema in `sourcing-rediscovery.findings.json`)

- **SR-L1-001 · major · trust/completion** — Outreach is queued to a local outbox, never delivered: no provider integration; relay = optional generic webhook; sourced candidates are name-addressed → dead-letter even with a relay; UI says "on its way" (`comms.ts:36-42,97-100,19-23`; `useReachOut.ts:43`).
- **SR-L1-002 · major · senior-quality** — Outreach prompt grounding 4/8: no brand kit, no role depth, no profile depth, no silver-medalist re-engagement context (`automation.py:318-326`).
- **SR-L1-003 · major · missing/senior-quality** — Why-now is a per-kind stock template (3 sentences, jobTitle+score interpolation); the fit-delta data exists in the ranked payload and is dropped (`RediscoverPanel.tsx:82-88`; `messages/cs.json:2087-2091`).
- **SR-L1-004 · major · broken-flow** — Outreach resolves the job from the static seed file (`automation_cli.py:112,125` → `matching.py:797`), not the DB: Reach out on any in-app-created/published role → 404 "job not found"; in-app-edited seed roles draft from stale facts. The TS comment claims non-rematch tasks "skip the corpus entirely" — they don't (`automation-run.ts:118-119,163`).
- **SR-L1-005 · major · broken-flow** — Analysis-sourced pool candidates (ranked + rediscovered via `candidate-pool.ts:57-63`) fail Reach out with 400: `runAutomationTask` requires a `profiles`-table record (`automation-run.ts:92-93`, `db/profiles.ts:71-84`); and because the entry is created *before* the throw (`outreach/route.ts:43-54`), the failed candidate is silently filed at Screened and vanishes from the rediscover list on reload (`rediscover.ts:83`).
- **SR-L1-006 · minor · trust** — Pool caps (100 profiles + 60 analyses) silently bound who can ever be rediscovered; overflow is a server-console warning only (`candidate-pool.ts:17-18,50-60`). Low frequency on the seed; the core promise breaks at bank scale.
- **SR-L1-007 · minor · clarity/language** — `prior.label` is hardcoded English ("Rejected · …", "Closed · …") rendered verbatim in the Czech UI on both rediscovery surfaces (`rediscover.ts:44,50,52`; `RediscoverPanel.tsx:79-81`; `RediscoveryFeed.tsx:180-182`) — the code comment itself calls it "the legacy English prior.label".
- **SR-L1-008 · minor · confusion (by-design)** — The standing feed only sweeps `status='published'` roles (`rediscover.ts:129-131`; `alerts/route.ts:26-30`); seeded corpus rows are status NULL (`db/core.ts:1000-1004`) → on the bare ČS fixture the feed is permanently empty ("0 roles swept" note is at least honest, `RediscoveryFeed.tsx:78-82`).
- **Strengths:** SR-L1-S1 once-only + consent-gated outreach (durable `outreach_sent` gate, in-flight guard, audited suppression — `automation-run.ts:57,281-300`, `comms-dispatch.ts:165-186`); SR-L1-S2 unscorable candidates surfaced, never silently dropped (`rediscover/route.ts:22-28`, `RediscoverPanel.tsx:43-54`); SR-L1-S3 interrogable provenance on the ranked pool incl. fairness audit + CSV (`RecruiterCandidates.tsx:530-550,252-278,284-345`); SR-L1-S4 persisted sourcing state across sessions (`candidates/route.ts:43-54`); SR-L1-S5 campaign honesty contract — stated-facts-only, phantom filtering, warning codes, AI-vs-fallback provenance, per-variant attributed links (`campaign.py:91-127,247-258`, `CampaignTab.tsx:206-224`); SR-L1-S6 Comms Center deliverability honesty (`CommsCenter.tsx:59-66,105-111`).

## Scope notes

- Keyless/over-budget runs degrade the draft to the deterministic template (`automation-run.ts:154`, `automation.py:328-342`) — per the journey file this is a `scope_note`, not a defect; the Czech fallback is clean, if generic.
- First-pass shortlist reasoning → `jd-to-shortlist`; inbound webhook intake → `comms-inbound-channels` (out of scope here).
- Campaign pack is deliberately generate-and-copy (no ad-platform dispatch); video rendering explicitly external (`campaign.py:6`).

## L2 priorities (what only the live app can answer)

1. **SR-L1-003** — run rediscovery on a real role with ≥3 silver medalists: do the why-now lines read candidate-specific or visibly repeat the 3 templates?
2. **SR-L1-002 + journey** — fire one outreach on a Czech candidate: is the draft ČS-send-ready? Confirm once-only dispatch (`outreach_sent`) survives a double-click and the button state persists on reload (`candidates/route.ts:49-53`).
3. **SR-L1-001** — after the send, open Channels → Comms Center: confirm the row is `queued`, recipient is a bare name, and the relay banner/deliverability warning states the truth.
4. **SR-L1-004** — ingest/publish a fresh role in-app, Reach out → expect 404 "job not found".
5. **SR-L1-005** — Reach out on an analysis-sourced rediscovered candidate → expect 400 + the candidate silently filed at Screened (check the board).
6. **Latency** — the draft spawns the Claude CLI (`maxDuration=180`, `outreach/route.ts:10`): time it; an early client timeout is a finding.
7. **SR-L1-008** — Refresh the standing feed on the seeded fixture → expect "0 roles swept".

## Character feedback (first person, Jana)

„Napřed to dobré, protože ono toho dobrého je hodně. Otevřu roli, kandidáti se seřadí sami — a u každého vidím **na čem to stojí**: skill po skillu s označením, odkud se to ví, interval spolehlivosti, u vyřazených důvod PROČ nevyhověli, i ‚near-miss' na jednu podmínku. Tohle je přesně odpověď na moje ‚našlo — ale jak?'. A rediscovery — konečně někdo postavil věc, na kterou nikdy nemá nikdo čas. Stříbrní medailisté se mi hlásí sami, i s tím, kde tehdy skončili, a nezmizí mi ani lidi, které ranker nedokázal ohodnotit — ti jsou vypsaní zvlášť, ne zameteni. To je poctivost, kterou u AI nástrojů nevídám.

Ale teď to, co bych na demu rozporovala. To ‚proč teď' u znovuobjeveného člověka — přečtu si tři karty a vidím, že je to **stejná věta třikrát**, jen s jiným jménem role a procentem. Já potřebuju ‚tehdy mu chybělo X, tahle role X nechce' — ta data v systému prokazatelně jsou, jen se ke mně nedostanou. A oslovení: prompt dostane jméno, titul role a tři skilly. Nedostane tón banky, nedostane nic o roli kromě názvu — a hlavně **neví, že toho člověka známe**. Poslat finalistovi z loňska ‚zaujal nás váš profil' je přesně ten trapas, kvůli kterému tyhle nástroje nepouštím ke svému jménu.

A ta hlavní věc: kliknu ‚Oslovit', aplikace mi řekne, že zpráva ‚je na cestě' — a ona **leží v lokálním outboxu adresovaná jménem, ne adresou**. Comms Center to aspoň přizná, to oceňuju. Ale dokud první dotek reálně neodejde, tak tohle není kampaň, to je cvičení. Půlku své práce — tu vnitřní, co v ATS nikdo nedělá — by mi to reálně vzalo z 13 hodin na hodinu. Adoptovala bych to zítra, pod třemi podmínkami: why-now z reálné delty, oslovení, které si přečtu a odešlu bez přepisování, a jistota, že když to řekne ‚odesláno', tak to někomu opravdu přišlo."

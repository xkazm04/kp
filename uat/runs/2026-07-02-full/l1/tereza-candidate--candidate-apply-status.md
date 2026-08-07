# L1 theoretical — Tereza Králová × candidate-apply-status

- **Run:** 2026-07-02-full · main @ 3395b4c · cert_level L1 (no browser — code-derived surface model)
- **Verdict:** **L1-conditional** — the job completes structurally on the conversational path, but majors carry to L2 (capst-l1-001, -002, -003)
- **Grounding score:** 9/11 (apply script 5/6 · candidate comms 4/5)
- **Estimated time saved (if it all worked):** ~25–30 min per application vs. a 20–30 min portal form + the status-chasing email loop · **medium confidence** (capped by the comms delivery seam)

## Surface model (code-derived, import chains followed)

| Surface | Backing | Notes |
|---|---|---|
| `/apply/[id]` | `app/apply/[id]/page.tsx` → `buildApplyScript(job, t)` (`app/_lib/apply.ts:99-246`) → `ConversationalApply` | Script server-built from the REAL job, localized per request; paints on hydration with no round-trip (`page.tsx:42-47`). Lifecycle-gated: closed role → honest card, draft → 404 (`page.tsx:31-41`), API enforces the same gate (`app/api/apply/[id]/route.ts:213-215`). Own `LanguageSwitcher` (`page.tsx:84-86`). |
| `/apply/[id]/quick` | `app/apply/[id]/quick/page.tsx` → `applyKoSteps` (same script → one KO contract per job, `apply.ts:254-258`) → `QuickApplyForm` | 2 fields + this job's KO toggles; honeypot (`QuickApplyForm.tsx:50-61`); POST `api/apply/[id]/quick/route.ts` → `intakeLead` (`lead-intake.ts:98-212`) files an Accepted intake-degraded stub + instant ack with enrichment link. |
| `/status/[token]` | `app/status/[token]/page.tsx` → `GET /api/status/[token]` (`route.ts:13-31`) → `application-status-store.ts` + `application-status.ts` | Token minted at apply (`getOrCreateStatusLink`, `api/apply/[id]/route.ts:478`), returned in the JSON AND put in the ack email (`:479,481`); page renders the 5-step timeline + honest terminal cards (`page.tsx:77-116`). |
| Comms | `comms-dispatch.ts` → `sendComm` (`comms.ts:103-105`) | Ack/decline/rejection are deterministic catalog templates rendered in the candidate's stored locale (`comms-dispatch.ts:39-47,136`); GDPR erasure footer on every candidate comm (`:93-98`). **Delivery seam: outbox-terminal by default — see F-001.** |
| Consent / AI disclosure | `AiDisclosure.tsx` (jurisdiction-aware via public `GET /api/compliance`) + `recordEntryConsent` (TTL from `consent.ts:14-18`) | Conversational: full disclosure incl. data-consent pinned under the chat the whole time (`ConversationalApply.tsx:601`). Quick: data-consent line only AFTER submit — see F-003. Nothing is pre-ticked anywhere; there is no checkbox — submitting is the consent, as the copy states. |

## Reachability (resolved before judging)

Tereza reaches **only** `/apply/[id]`, `/apply/[id]/quick`, `/status/[token]` — all public. The status leg requires the token her own apply mints (`api/apply/[id]/route.ts:478-494`), so it is **reachable within the journey itself** at L1; starting mid-journey at L2 still needs the env.md fixture-#5 mint path (open question #3). Bare-URL 404 on `/status/...` is suppressed per `accepted-gaps.md` (example-tokenized-flows-need-real-token). No finding here touches the workspace.

## Cognitive walkthrough (cs, on her phone, in the evening)

1. **Opens the ad link → `/apply/[id]/quick`.** Role + company + "Tři rychlé otázky — do 30 sekund" — she'll try it; the promise is honest (2 fields + 1–3 yes/no gates). ✓
2. **Reads the disclosure before tapping Odeslat přihlášku.** She sees "Jak to funguje — AI asistuje, člověk rozhoduje" and the regime line — good — but the sentence she'd most want ("Odesláním souhlasíte… 12 měsíců… výmaz") is **not on the form**; it appears only on the success screen, after her consent was already recorded (**F-003, major**).
3. **Submits → "Přihláška přijata! Potvrzení jsme vám poslali e-mailem…".** Structurally false by default: the ack is a `queued` row in a recruiter-side outbox, no relay configured, no email provider exists (**F-001, major**). And the success screen offers only the enrichment CTA — **no status link**; the quick ack email (even if delivered) carries none either (**F-002, major**). Her fastest path re-creates the black hole.
4. **Escape hatch: the enrichment chat** (`?lead=` opens knowing her, seeded steps trimmed — `page.tsx:58-75,94`). Completing it returns `statusToken` and the in-page **"Sledovat stav přihlášky"** link (`ConversationalApply.tsx:443-450`). If she instead starts on `/apply/[id]` directly: ~9 short steps for a branch role (cv skippable, name, email, archetype, 1–2 lane answers, skills, github skippable, ko_auth, ko_mode, ko_lang), inline typo-fix on email, draft survives a dropped signal (`:129-175`). Genuinely a few minutes; no bait-and-switch. ✓
5. **Status page.** Timeline "Přijato → V posuzování → Pohovor → Nabídka → Přijat/a" with a current-step "now" line; rejection renders a respectful "Tentokrát jste nebyl/a vybrán/a" card, never silence (`status/[token]/page.tsx:77-116`, `application-status.ts:38-42`). She can check from her desk without emailing anyone. ✓ (Minor: no on-page language switch and the emailed link isn't `?lang`-pinned — **F-006**; Accept-Language covers her Czech phone.)
6. **Would she trust it?** The Czech is written by a human who speaks Czech ("Jste ve hře!", "Náborář/ka právě posuzuje váš profil") — no machine-translation smell anywhere in `apply.*`/`status.*`/`comms.*`. The rejection template is kind and keeps the early-career encouragement. ✓

## Scored acceptance criteria (applied identically every run)

| Criterion | Verdict | Evidence |
|---|---|---|
| **effort** — quick apply actually quick, mobile, no account wall | **PASS** — quick: 2 fields + KO toggles; conversational: ~9 one-line steps, drafts persist | `QuickApplyForm.tsx`, `apply.ts:99-246`, `ConversationalApply.tsx:129-175` |
| **completion/missing** — status view without emailing | **PASS conversational / FAIL quick** — quick path has no status link at all (F-002, major) | `api/apply/[id]/quick/route.ts:132-140`, `lead-intake.ts:131,210` |
| **trust** — AI-use disclosure + consent, plain Czech, before AI touches her, refusable | **CONDITIONAL** — disclosure is plain, honest-toned Czech and nothing is pre-ticked; but quick shows the consent sentence post-submit (F-003, major); "nothing adverse is decided automatically" overstates (F-004, minor) | `ConversationalApply.tsx:601`, `QuickApplyForm.tsx:126,228` |
| **clarity/trust** — comms read human, from the bank, real Czech | **PASS** — deterministic templates, native Czech, candidate-locale-pinned | `comms-dispatch.ts:39-47,194-205`, `messages/cs.json comms.*` |
| **completion** — self-scheduling | out of this journey's scope (interview journey) | — |
| **missing** — onboarding next step on offer/accept | out of this journey's scope | — |
| **trust** — no stage ends in silence | **CONDITIONAL** — every transition produces a message + the status page updates (pull), but push delivery is outbox-terminal by default (F-001, major) | `comms.ts:36-42,97-100` |

## Findings raised (see candidate-apply-status.findings.json)

- **capst-l1-001 (major, trust)** — candidate comms never actually delivered by default; outbox is a recruiter-only terminal sink; no email/SMS provider. `comms.ts:36-42,97-100`
- **capst-l1-002 (major, missing)** — quick-apply leads get no status link anywhere + "We've emailed you a confirmation" is false by default. `quick/route.ts:132-140`, `lead-intake.ts:131,210`
- **capst-l1-003 (major, trust)** — quick path shows the data-consent sentence only after submit. `QuickApplyForm.tsx:126,228`
- **capst-l1-004 (minor, trust)** — "nothing adverse is decided automatically" vs KO auto-decline + batch-approved screen-wave. `api/apply/[id]/route.ts:238-253`, `screen-wave.ts:253,281`
- **capst-l1-005 (minor, trust)** — "12 months" hardcoded vs configurable `KP_CONSENT_TTL_DAYS`. `consent.ts:14-18`
- **capst-l1-006 (minor, clarity)** — status page has no language switcher; status link not `?lang`-pinned. `status/[token]/page.tsx`, `api/apply/[id]/route.ts:479`
- **Strengths:** capst-l1-007 (status timeline candidate-safe + re-apply-stable), capst-l1-008 (apply genuinely quick + resilient), capst-l1-009 (humane, localized, GDPR-footered comms).

## L2 priorities (hand-off)

1. F-001: apply live, confirm where the ack actually lands (outbox-only vs relay) — can a candidate ever read it?
2. F-002: quick apply live — confirm no `/status/` link on the success screen or in the ack.
3. F-003: confirm the quick form's pre-submit view omits the retention sentence in cs + en.
4. Happy path: apply cs → recruiter moves stages → `/status/[token]` shows each step live; reject → the not_selected card, not silence.
5. F-006: open the status link in an en-locale browser after a cs application.

## Character feedback — Tereza, first person

„Ta konverzační přihláška je poprvé, kdy mi ‚rychlá přihláška' nepřipadala jako past. Devět krátkých otázek z telefonu, večer u televize, a když mi vypadl signál, rozepsaná odpověď tam po obnovení pořád byla. Česky to mluví jako člověk, ne jako přeložený robot — a to ‚Sledovat stav přihlášky' tlačítko? To je přesně to, co jsem vždycky chtěla. Vidět ‚Náborář/ka právě posuzuje váš profil' místo týdnů ticha — kvůli tomuhle bych se přihlásila znovu.

Ale dvě věci mi vadí, a nejsou malé. Ta úplně rychlá verze — ta z inzerátu — mi řekne ‚Potvrzení jsme vám poslali e-mailem', a když čtu, jak to je postavené, žádný e-mail ve výchozím stavu nikam nedorazí. A žádný odkaz na stav tam nedostanu vůbec, dokud nevyplním ten delší rozhovor. Takže přesně na té cestě, která je stavěná pro mě a můj mobil, končím zase v té černé díře — jen mi tentokrát někdo tvrdí, že mi napsal. To je horší než ticho. A ten souhlas se zpracováním údajů na 12 měsíců mi ukážou až POTOM, co jsem odeslala? Já bych to odsouhlasila i tak — ale chci to vědět předem, ne se to dozvědět zpětně.

Kdyby stav fungoval i pro rychlou přihlášku a ty e-maily opravdu odcházely, řeknu kamarádkám, ať to zkusí. Takhle říkám: použij tu delší verzi a ten odkaz na stav si hned ulož."

**Adoption:** yes for the conversational path + status page; not yet for the quick path. **Time saved:** ~25–30 min per application + the end of status-chasing — *if* the delivery seam closes.
